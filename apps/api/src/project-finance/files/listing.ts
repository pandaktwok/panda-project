import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import db from "../../database";
import {
  assetTable,
  projectInstallmentTable,
  projectPaymentLineTable,
  userTable,
} from "../../database/schema";
import {
  driveStatusForAssets,
  isDriveConnected,
} from "../../google-drive/mirror";
import { deleteS3Object } from "../../storage/s3";
import type { FinanceActor } from "../controllers/common";
import { publishFinanceUpdated } from "../controllers/common";
import { FinanceFileError } from "./errors";

export type FinanceFileItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
};

export type ParcelFile = FinanceFileItem & {
  installmentId: string | null;
  supplier: string | null;
  paidAt: string | null;
  undoneAt: string | null;
  undoneByName: string | null;
  /** Cópia no Google Drive; null se o Drive não está ligado. */
  drive: "pending" | "copied" | "failed" | null;
};

export type ParcelFolder = {
  label: string;
  number: number;
  dueDate: string | null;
  files: ParcelFile[];
};

export type FinanceFiles = {
  projectFiles: FinanceFileItem[];
  paidInstallments: number;
  filesCount: number;
  parcels: ParcelFolder[];
  /** Só para quem pode desfazer: PDFs de pagamentos desfeitos. */
  undone: ParcelFile[];
};

const iso = (date: Date) => date.toISOString();

/**
 * Monta a árvore virtual Financeiro > Parcela > arquivos a partir das parcelas
 * PAGAS (a pasta é o rótulo congelado no asset). Não existe pasta no
 * armazenamento: só ids.
 */
export async function listFinanceFiles(
  projectId: string,
  options: { includeUndone: boolean },
): Promise<FinanceFiles> {
  const projectRows = await db
    .select()
    .from(assetTable)
    .where(
      and(
        eq(assetTable.projectId, projectId),
        eq(assetTable.surface, "project"),
      ),
    )
    .orderBy(desc(assetTable.createdAt));

  const paid = await db
    .select({
      installmentId: projectInstallmentTable.id,
      number: projectInstallmentTable.number,
      dueDate: projectInstallmentTable.dueDate,
      paidAt: projectInstallmentTable.paidAt,
      supplier: projectPaymentLineTable.supplier,
      assetId: assetTable.id,
      name: assetTable.filename,
      size: assetTable.size,
      mimeType: assetTable.mimeType,
      createdAt: assetTable.createdAt,
      folderLabel: assetTable.folderLabel,
    })
    .from(projectInstallmentTable)
    .innerJoin(
      projectPaymentLineTable,
      eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
    )
    .innerJoin(
      assetTable,
      eq(projectInstallmentTable.fileAssetId, assetTable.id),
    )
    .where(
      and(
        eq(projectPaymentLineTable.projectId, projectId),
        isNotNull(projectInstallmentTable.paidAt),
        isNull(assetTable.undoneAt),
      ),
    )
    .orderBy(
      asc(projectInstallmentTable.number),
      asc(projectPaymentLineTable.position),
      asc(projectPaymentLineTable.supplier),
    );

  const folders = new Map<string, ParcelFolder>();
  for (const row of paid) {
    const label = row.folderLabel ?? `Parcela ${row.number}`;
    let folder = folders.get(label);
    if (!folder) {
      folder = { label, number: row.number, dueDate: row.dueDate, files: [] };
      folders.set(label, folder);
    }
    folder.files.push({
      id: row.assetId,
      name: row.name,
      size: row.size,
      mimeType: row.mimeType,
      createdAt: iso(row.createdAt),
      installmentId: row.installmentId,
      supplier: row.supplier,
      paidAt: row.paidAt,
      undoneAt: null,
      undoneByName: null,
      drive: null,
    });
  }

  let undone: ParcelFile[] = [];
  if (options.includeUndone) {
    const rows = await db
      .select({
        asset: assetTable,
        undoneByName: userTable.name,
      })
      .from(assetTable)
      .leftJoin(userTable, eq(assetTable.undoneBy, userTable.id))
      .where(
        and(
          eq(assetTable.projectId, projectId),
          eq(assetTable.surface, "payment"),
          isNotNull(assetTable.undoneAt),
        ),
      )
      .orderBy(desc(assetTable.undoneAt));
    undone = rows.map(({ asset, undoneByName }) => ({
      id: asset.id,
      name: asset.filename,
      size: asset.size,
      mimeType: asset.mimeType,
      createdAt: iso(asset.createdAt),
      installmentId: null,
      supplier: null,
      paidAt: null,
      undoneAt: asset.undoneAt ? iso(asset.undoneAt) : null,
      undoneByName: undoneByName ?? null,
      drive: null,
    }));
  }

  if (paid.length > 0 && (await isDriveConnected())) {
    const copies = await driveStatusForAssets(paid.map((row) => row.assetId));
    for (const folder of folders.values()) {
      for (const file of folder.files) {
        file.drive = copies.get(file.id)?.state ?? null;
      }
    }
  }

  return {
    projectFiles: projectRows.map((asset) => ({
      id: asset.id,
      name: asset.filename,
      size: asset.size,
      mimeType: asset.mimeType,
      createdAt: iso(asset.createdAt),
    })),
    paidInstallments: new Set(paid.map((row) => row.installmentId)).size,
    filesCount: paid.length,
    parcels: [...folders.values()],
    undone,
  };
}

/** Remove um anexo do projeto (só os de origem "project"; PDFs de pagamento não). */
export async function deleteProjectAttachment(
  projectId: string,
  assetId: string,
  actor: FinanceActor,
): Promise<void> {
  const [asset] = await db
    .select({ id: assetTable.id, objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(
      and(
        eq(assetTable.id, assetId),
        eq(assetTable.projectId, projectId),
        eq(assetTable.surface, "project"),
      ),
    )
    .limit(1);
  if (!asset) {
    throw new FinanceFileError(404, "FILE_NOT_FOUND", "File not found.");
  }
  // Primeiro a linha (o download some na hora), depois o objeto. Se apagar o
  // objeto falhar, sobra um arquivo sem dono no armazenamento, nunca um link
  // quebrado na tela.
  await db.delete(assetTable).where(eq(assetTable.id, asset.id));
  await deleteS3Object(asset.objectKey).catch((error) => {
    console.error("Failed to delete finance attachment object", error);
  });
  await publishFinanceUpdated(projectId, actor, "attachment.deleted");
}
