import { and, inArray, lt } from "drizzle-orm";
import db from "../../database";
import { assetTable } from "../../database/schema";
import { deleteS3Object } from "../../storage/s3";

export const FINANCE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Apaga envios temporários (comprovante/NF que ninguém salvou) com mais de 24 h,
 * e sobras de junções já concluídas. Recebe o relógio para poder ser testada.
 */
export async function cleanupExpiredFinanceUploads(
  now: Date = new Date(),
  maxAgeMs: number = FINANCE_UPLOAD_MAX_AGE_MS,
): Promise<{ removed: number; degraded: boolean }> {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const stale = await db
    .select({ id: assetTable.id, objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(
      and(
        inArray(assetTable.surface, ["payment_upload", "payment_merged"]),
        lt(assetTable.createdAt, cutoff),
      ),
    )
    .limit(500);
  if (stale.length === 0) return { removed: 0, degraded: false };

  const results = await Promise.allSettled(
    stale.map((asset) => deleteS3Object(asset.objectKey)),
  );
  const deletable = stale.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );
  if (deletable.length > 0) {
    await db.delete(assetTable).where(
      inArray(
        assetTable.id,
        deletable.map((asset) => asset.id),
      ),
    );
  }
  const failed = stale.length - deletable.length;
  if (failed > 0) {
    console.error(
      `finance: ${failed} temporary upload(s) could not be removed`,
    );
  }
  return { removed: deletable.length, degraded: failed > 0 };
}
