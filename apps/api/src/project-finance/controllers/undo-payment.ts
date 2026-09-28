import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  assetTable,
  projectInstallmentTable,
  projectPaymentLineTable,
} from "../../database/schema";
import { readFinanceStateOrThrow, withProjectFinanceLock } from "../lock";
import type { FinanceState } from "../response";
import {
  type FinanceActor,
  projectIdOfInstallment,
  publishFinanceUpdated,
  recalculateLine,
} from "./common";

/**
 * Desfaz um pagamento: a parcela volta a "não paga" e as demais não pagas da
 * linha são recalculadas pela mesma regra do salvar.
 */
async function undoPayment(
  installmentId: string,
  actor: FinanceActor,
): Promise<FinanceState> {
  const projectId = await projectIdOfInstallment(installmentId);
  const state = await withProjectFinanceLock(projectId, async (tx) => {
    const [item] = await tx
      .select({
        id: projectInstallmentTable.id,
        lineId: projectInstallmentTable.lineId,
        paidAt: projectInstallmentTable.paidAt,
        fileAssetId: projectInstallmentTable.fileAssetId,
      })
      .from(projectInstallmentTable)
      .innerJoin(
        projectPaymentLineTable,
        eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
      )
      .where(
        and(
          eq(projectInstallmentTable.id, installmentId),
          eq(projectPaymentLineTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!item)
      throw new HTTPException(404, { message: "Installment not found" });
    if (item.paidAt === null) {
      throw new HTTPException(409, { message: "The installment is not paid" });
    }

    // O PDF fica guardado, desligado da parcela e marcado como "pagamento
    // desfeito" (quem e quando). Só o administrador enxerga esses arquivos.
    if (item.fileAssetId) {
      await tx
        .update(assetTable)
        .set({ undoneAt: new Date(), undoneBy: actor.userId || null })
        .where(eq(assetTable.id, item.fileAssetId));
    }
    await tx
      .update(projectInstallmentTable)
      .set({ paidAt: null, paidCents: null, paidBy: null, fileAssetId: null })
      .where(eq(projectInstallmentTable.id, installmentId));

    await recalculateLine(tx, item.lineId);
    return readFinanceStateOrThrow(tx, projectId);
  });
  await publishFinanceUpdated(projectId, actor, "payment.undone");
  return state;
}

export default undoPayment;
