import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  assetTable,
  projectInstallmentTable,
  projectPaymentLineTable,
} from "../../database/schema";
import { enqueueCopies } from "../../google-drive/mirror";
import {
  buildFinanceObjectKey,
  deleteS3Object,
  getMaxFinanceFileBytes,
  getPrivateObjectBytes,
  putPrivateObject,
} from "../../storage/s3";
import { FinanceFileError } from "../files/errors";
import {
  detectFileType,
  FILE_TYPE_INFO,
  isMergeable,
} from "../files/file-type";
import { mergeToSinglePdf } from "../files/merge-pdf";
import {
  folderLabelFor,
  paymentBaseName,
  uniqueFileName,
} from "../files/names";
import { readFinanceStateOrThrow, withProjectFinanceLock } from "../lock";
import type { FinanceState } from "../response";
import {
  type FinanceActor,
  publishFinanceUpdated,
  recalculateLine,
} from "./common";

export type Payment = {
  installmentId: string;
  paidCents: number;
  paidAt: string;
  /** Envios temporários (uploads) já confirmados: 1+ comprovantes e 1+ NFs. */
  receiptAssetIds: string[];
  invoiceAssetIds: string[];
};

export type SavePaymentsResult =
  | { conflict: false; state: FinanceState }
  | { conflict: true; state: FinanceState };

/** Le um envio temporário e devolve tipo + bytes; erros viram códigos claros. */
async function loadUpload(objectKey: string, label: string) {
  let bytes: Uint8Array;
  try {
    bytes = await getPrivateObjectBytes(objectKey, getMaxFinanceFileBytes());
  } catch (error) {
    console.error(`Failed to read the ${label} upload`, error);
    throw new FinanceFileError(
      503,
      "STORAGE_UNAVAILABLE",
      "Unable to read an uploaded file. Try again in a moment.",
    );
  }
  const type = detectFileType(bytes);
  if (!isMergeable(type) || !type) {
    throw new FinanceFileError(
      415,
      "FILE_NEEDS_CONVERSION",
      "This file cannot be merged. Convert it to PDF, JPG or PNG and send it again.",
    );
  }
  return { bytes, type };
}

/**
 * Salvar alterações em lote: tudo ou nada, numa transação, com a trava do
 * projeto. Se `version` não é mais a atual, não grava nada e devolve o estado
 * atual (a rota responde 409). A permissão finance:pay e finance:attach é
 * exigida pela rota.
 *
 * Para cada parcela marcada: confere que comprovante e NF são envios
 * confirmados DESTE projeto, junta os dois num PDF único (comprovante primeiro),
 * grava o PDF e liga ao asset da parcela. O arquivo é gravado antes do commit;
 * se qualquer coisa falhar (junção, banco), o que já foi gravado é apagado e
 * nada fica pela metade.
 */
export async function savePayments(
  projectId: string,
  version: string,
  payments: Payment[],
  actor: FinanceActor,
): Promise<SavePaymentsResult> {
  const ids = payments.map((payment) => payment.installmentId);
  if (new Set(ids).size !== ids.length) {
    throw new HTTPException(400, {
      message: "The same installment appears more than once in the request",
    });
  }
  const uploadIds = payments.flatMap((payment) => [
    ...payment.receiptAssetIds,
    ...payment.invoiceAssetIds,
  ]);
  if (new Set(uploadIds).size !== uploadIds.length) {
    throw new HTTPException(400, {
      message: "The same uploaded file was used more than once in the request",
    });
  }

  const writtenKeys: string[] = [];
  const usedUploadKeys: string[] = [];
  const createdPaymentAssets: Array<{ id: string; projectId: string }> = [];
  let result: SavePaymentsResult;
  try {
    result = await withProjectFinanceLock(
      projectId,
      async (tx): Promise<SavePaymentsResult> => {
        const current = await readFinanceStateOrThrow(tx, projectId);
        if (current.version !== version)
          return { conflict: true, state: current };

        const found = await tx
          .select({
            id: projectInstallmentTable.id,
            lineId: projectInstallmentTable.lineId,
            number: projectInstallmentTable.number,
            dueDate: projectInstallmentTable.dueDate,
            paidAt: projectInstallmentTable.paidAt,
            supplier: projectPaymentLineTable.supplier,
          })
          .from(projectInstallmentTable)
          .innerJoin(
            projectPaymentLineTable,
            eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
          )
          .where(
            and(
              inArray(projectInstallmentTable.id, ids),
              eq(projectPaymentLineTable.projectId, projectId),
            ),
          );
        if (found.length !== ids.length) {
          throw new HTTPException(404, {
            message: "Installment not found in this project",
          });
        }
        if (found.some((item) => item.paidAt !== null)) {
          throw new HTTPException(409, {
            message:
              "An installment in the request is already paid; undo it before paying again",
          });
        }

        const uploads = await tx
          .select({
            id: assetTable.id,
            kind: assetTable.kind,
            objectKey: assetTable.objectKey,
          })
          .from(assetTable)
          .where(
            and(
              inArray(assetTable.id, uploadIds),
              eq(assetTable.projectId, projectId),
              eq(assetTable.surface, "payment_upload"),
            ),
          );
        if (uploads.length !== uploadIds.length) {
          throw new FinanceFileError(
            404,
            "FILE_NOT_FOUND",
            "Receipt or invoice file not found in this project. Attach the files again.",
          );
        }
        const uploadById = new Map(
          uploads.map((upload) => [upload.id, upload]),
        );
        for (const payment of payments) {
          const receiptsOk = payment.receiptAssetIds.every(
            (id) => uploadById.get(id)?.kind === "receipt",
          );
          const invoicesOk = payment.invoiceAssetIds.every(
            (id) => uploadById.get(id)?.kind === "invoice",
          );
          if (!receiptsOk || !invoicesOk) {
            throw new FinanceFileError(
              400,
              "FILE_NOT_ALLOWED",
              "Every receipt and invoice must be sent in their own field.",
            );
          }
        }

        // Nomes já usados em cada pasta (inclui PDFs de pagamentos desfeitos).
        const takenRows = await tx
          .select({
            folder: assetTable.folderLabel,
            name: assetTable.filename,
          })
          .from(assetTable)
          .where(
            and(
              eq(assetTable.projectId, projectId),
              eq(assetTable.surface, "payment"),
            ),
          );
        const takenByFolder = new Map<string, Set<string>>();
        for (const row of takenRows) {
          if (!row.folder) continue;
          const set = takenByFolder.get(row.folder) ?? new Set<string>();
          set.add(row.name);
          takenByFolder.set(row.folder, set);
        }

        const foundById = new Map(found.map((item) => [item.id, item]));
        for (const payment of payments) {
          const item = foundById.get(payment.installmentId);
          const receipts = payment.receiptAssetIds.map((id) =>
            uploadById.get(id),
          );
          const invoices = payment.invoiceAssetIds.map((id) =>
            uploadById.get(id),
          );
          if (!item || receipts.some((r) => !r) || invoices.some((i) => !i))
            continue;

          // Todos os comprovantes primeiro (na ordem em que foram
          // adicionados), depois todas as notas fiscais/boletos.
          const orderedUploads = [...receipts, ...invoices] as Array<{
            id: string;
            kind: string;
            objectKey: string;
          }>;
          const merged = await mergeToSinglePdf(
            await Promise.all(
              orderedUploads.map((upload) =>
                loadUpload(upload.objectKey, upload.kind),
              ),
            ),
          );

          const folder = folderLabelFor(item.number, item.dueDate);
          const taken = takenByFolder.get(folder) ?? new Set<string>();
          const filename = uniqueFileName(
            paymentBaseName(item.supplier, item.number),
            "pdf",
            taken,
          );
          taken.add(filename);
          takenByFolder.set(folder, taken);

          const key = buildFinanceObjectKey(
            {
              workspaceId: actor.workspaceId,
              projectId,
              extension: FILE_TYPE_INFO.pdf.extension,
            },
            { area: "parcela", installmentId: item.id },
          );
          try {
            await putPrivateObject(key, merged, FILE_TYPE_INFO.pdf.mime);
          } catch (error) {
            console.error("Failed to store the merged payment PDF", error);
            throw new FinanceFileError(
              503,
              "STORAGE_UNAVAILABLE",
              "Unable to store the PDF. Try again in a moment.",
            );
          }
          writtenKeys.push(key);

          const [asset] = await tx
            .insert(assetTable)
            .values({
              workspaceId: actor.workspaceId,
              projectId,
              objectKey: key,
              filename,
              mimeType: FILE_TYPE_INFO.pdf.mime,
              size: merged.byteLength,
              kind: "attachment",
              surface: "payment",
              folderLabel: folder,
              createdBy: actor.userId || null,
            })
            .returning({ id: assetTable.id });
          if (!asset) {
            throw new HTTPException(500, { message: "Failed to save file" });
          }

          await tx
            .update(projectInstallmentTable)
            .set({
              paidAt: payment.paidAt,
              paidCents: payment.paidCents,
              paidBy: actor.userId,
              fileAssetId: asset.id,
            })
            .where(eq(projectInstallmentTable.id, payment.installmentId));
          usedUploadKeys.push(
            ...orderedUploads.map((upload) => upload.objectKey),
          );
          createdPaymentAssets.push({ id: asset.id, projectId });
        }

        // Os envios já foram usados: não podem ser reaproveitados. Objetos e
        // linhas são apagados depois do commit (a limpeza de 24 h cobre sobras).
        await tx
          .update(assetTable)
          .set({ surface: "payment_merged" })
          .where(inArray(assetTable.id, uploadIds));

        for (const lineId of new Set(found.map((item) => item.lineId))) {
          await recalculateLine(tx, lineId);
        }
        return {
          conflict: false,
          state: await readFinanceStateOrThrow(tx, projectId),
        };
      },
    );
  } catch (error) {
    await Promise.allSettled(writtenKeys.map((key) => deleteS3Object(key)));
    throw error;
  }

  if (!result.conflict) {
    await discardUsedUploads(uploadIds, usedUploadKeys);
    await publishFinanceUpdated(projectId, actor, "payments.saved");
    // Espelho no Google Drive (opcional): nunca atrapalha o pagamento já salvo.
    await enqueueCopies(createdPaymentAssets);
  }
  return result;
}

/** Guardamos só o PDF final: apaga os envios temporários (melhor esforço). */
async function discardUsedUploads(uploadIds: string[], objectKeys: string[]) {
  const results = await Promise.allSettled(
    objectKeys.map((key) => deleteS3Object(key)),
  );
  if (results.every((result) => result.status === "fulfilled")) {
    await db
      .delete(assetTable)
      .where(inArray(assetTable.id, uploadIds))
      .catch((error) => {
        console.error("Failed to remove merged upload rows", error);
      });
  }
}
