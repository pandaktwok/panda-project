import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { zipSync } from "fflate";
import db from "../../database";
import {
  assetTable,
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTable,
} from "../../database/schema";
import {
  getMaxFinanceFileBytes,
  getPrivateObjectBytes,
} from "../../storage/s3";
import { FinanceFileError } from "./errors";
import { sanitizeNamePart, uniqueFileName } from "./names";

// Soma máxima de um ZIP (em memória). Acima disso pede-se para baixar por
// arquivo; na prática uma parcela tem poucos PDFs.
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/** ZIP com todos os PDFs de uma parcela (todas as linhas), sem compressão: PDF já é comprimido. */
export async function buildParcelZip(
  projectId: string,
  installmentNumber: number,
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const [project] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const rows = await db
    .select({
      name: assetTable.filename,
      objectKey: assetTable.objectKey,
      folderLabel: assetTable.folderLabel,
      size: assetTable.size,
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
        eq(projectInstallmentTable.number, installmentNumber),
        isNotNull(projectInstallmentTable.paidAt),
        isNull(assetTable.undoneAt),
      ),
    )
    .orderBy(asc(projectPaymentLineTable.position));

  if (rows.length === 0) return null;
  if (rows.reduce((sum, row) => sum + row.size, 0) > MAX_ZIP_BYTES) {
    throw new FinanceFileError(
      413,
      "FILE_TOO_LARGE",
      "The files of this installment are too large for a single ZIP. Download them one by one.",
    );
  }

  const entries: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  for (const row of rows) {
    const folder = sanitizeNamePart(
      row.folderLabel ?? `Parcela ${installmentNumber}`,
    );
    const base = row.name.replace(/\.pdf$/i, "");
    const name = uniqueFileName(base, "pdf", taken);
    taken.add(name);
    entries[`${folder}/${name}`] = await getPrivateObjectBytes(
      row.objectKey,
      getMaxFinanceFileBytes() * 2,
    );
  }

  return {
    filename: `${sanitizeNamePart(project.name, 60)} - Parcela ${installmentNumber}.zip`,
    bytes: zipSync(entries, { level: 0 }),
  };
}
