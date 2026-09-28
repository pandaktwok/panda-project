import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { assetTable } from "../../database/schema";
import {
  assertStorageConfigured,
  buildFinanceObjectKey,
  deleteS3Object,
  getMaxFinanceFileBytes,
  putPrivateObject,
} from "../../storage/s3";
import type { FinanceActor } from "../controllers/common";
import { FinanceFileError } from "./errors";
import {
  type DetectedFileType,
  detectFileType,
  FILE_TYPE_INFO,
} from "./file-type";
import { attachmentName } from "./names";

export type UploadPurpose = "project" | "receipt" | "invoice";

const PROJECT_TYPES: DetectedFileType[] = ["pdf", "jpeg", "png", "webp"];
const PAYMENT_TYPES: DetectedFileType[] = ["pdf", "jpeg", "png"];

export type UploadedFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  purpose: UploadPurpose;
};

/**
 * Recebe os bytes pelo servidor (nada de URL assinada para o navegador), confere
 * tipo e tamanho pelo CONTEÚDO e grava no armazenamento privado:
 * - "project": anexo do projeto (surface "project");
 * - "receipt"/"invoice": envio temporário de um pagamento (surface
 *   "payment_upload"); só existe até o Salvar alterações juntar tudo em PDF.
 */
export async function uploadFinanceFile(input: {
  projectId: string;
  purpose: UploadPurpose;
  filename: string;
  bytes: Uint8Array;
  actor: FinanceActor;
}): Promise<UploadedFile> {
  const { projectId, purpose, bytes, actor } = input;
  const max = getMaxFinanceFileBytes();
  if (bytes.byteLength === 0) {
    throw new FinanceFileError(400, "FILE_EMPTY", "The file is empty.");
  }
  if (bytes.byteLength > max) {
    throw new FinanceFileError(
      413,
      "FILE_TOO_LARGE",
      `The file exceeds the maximum size of ${Math.floor(max / (1024 * 1024))} MB.`,
    );
  }

  const type = detectFileType(bytes);
  const allowed = purpose === "project" ? PROJECT_TYPES : PAYMENT_TYPES;
  if (!type || !allowed.includes(type)) {
    if (type === "webp" || type === "heic") {
      throw new FinanceFileError(
        415,
        "FILE_NEEDS_CONVERSION",
        `${type.toUpperCase()} files are not accepted here. Convert the image to PDF, JPG or PNG and send it again.`,
      );
    }
    throw new FinanceFileError(
      415,
      "FILE_TYPE_UNSUPPORTED",
      "Only PDF, JPG or PNG files are accepted.",
    );
  }

  try {
    assertStorageConfigured();
  } catch {
    throw new FinanceFileError(
      503,
      "STORAGE_UNAVAILABLE",
      "File storage is not configured on this instance.",
    );
  }

  const info = FILE_TYPE_INFO[type];
  const key = buildFinanceObjectKey(
    {
      workspaceId: actor.workspaceId,
      projectId,
      extension: info.extension,
    },
    purpose === "project" ? { area: "anexos" } : { area: "envios" },
  );
  const filename = attachmentName(input.filename || "arquivo", info.extension);

  try {
    await putPrivateObject(key, bytes, info.mime);
  } catch (error) {
    console.error("Failed to store finance file", error);
    throw new FinanceFileError(
      503,
      "STORAGE_UNAVAILABLE",
      "Unable to store the file. Try again in a moment.",
    );
  }

  try {
    const [asset] = await db
      .insert(assetTable)
      .values({
        workspaceId: actor.workspaceId,
        projectId,
        objectKey: key,
        filename,
        mimeType: info.mime,
        size: bytes.byteLength,
        kind: purpose === "project" ? "attachment" : purpose,
        surface: purpose === "project" ? "project" : "payment_upload",
        createdBy: actor.userId || null,
      })
      .returning({ id: assetTable.id });
    if (!asset)
      throw new HTTPException(500, { message: "Failed to save file" });
    return {
      id: asset.id,
      filename,
      mimeType: info.mime,
      size: bytes.byteLength,
      purpose,
    };
  } catch (error) {
    await deleteS3Object(key).catch(() => {});
    throw error;
  }
}
