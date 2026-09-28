import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTagTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { recalculateInstallments } from "../recalculate";
import type { Tx } from "../state";

export type FinanceActor = { userId: string; workspaceId: string };

export const FINANCE_UPDATED_EVENT = "project-finance.updated";

/** Chamar DEPOIS do commit: o front invalida o cache ao receber o evento. */
export async function publishFinanceUpdated(
  projectId: string,
  actor: FinanceActor,
  action: string,
) {
  await publishEvent(FINANCE_UPDATED_EVENT, {
    projectId,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action,
  });
}

// Resolve o projeto de uma tag/linha/parcela ANTES de pegar a trava. O projeto
// de um item nunca muda, então é seguro; o item é relido depois da trava.
export async function projectIdOfTag(tagId: string) {
  const [row] = await db
    .select({ projectId: projectTagTable.projectId })
    .from(projectTagTable)
    .where(eq(projectTagTable.id, tagId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Tag not found" });
  return row.projectId;
}

export async function projectIdOfLine(lineId: string) {
  const [row] = await db
    .select({ projectId: projectPaymentLineTable.projectId })
    .from(projectPaymentLineTable)
    .where(eq(projectPaymentLineTable.id, lineId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Line not found" });
  return row.projectId;
}

export async function projectIdOfInstallment(installmentId: string) {
  const [row] = await db
    .select({ projectId: projectPaymentLineTable.projectId })
    .from(projectInstallmentTable)
    .innerJoin(
      projectPaymentLineTable,
      eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
    )
    .where(eq(projectInstallmentTable.id, installmentId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Installment not found" });
  return row.projectId;
}

/** Uma tag só pode ser usada por linhas do próprio projeto. */
export async function assertTagInProject(
  tx: Tx,
  tagId: string,
  projectId: string,
) {
  const [tag] = await tx
    .select({ id: projectTagTable.id })
    .from(projectTagTable)
    .where(
      and(
        eq(projectTagTable.id, tagId),
        eq(projectTagTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!tag) throw new HTTPException(404, { message: "Tag not found" });
}

/**
 * Reaplica a regra de recálculo às parcelas NÃO pagas de uma linha
 * (total da linha - total pago) / (parcelas - pagas), última absorve o resto.
 * Só grava as que mudaram.
 */
export async function recalculateLine(tx: Tx, lineId: string) {
  const [line] = await tx
    .select({ totalCents: projectPaymentLineTable.totalCents })
    .from(projectPaymentLineTable)
    .where(eq(projectPaymentLineTable.id, lineId))
    .limit(1);
  if (!line) return;

  const items = await tx
    .select()
    .from(projectInstallmentTable)
    .where(eq(projectInstallmentTable.lineId, lineId))
    .orderBy(asc(projectInstallmentTable.number));
  const paid = items.filter((item) => item.paidAt !== null);
  const unpaid = items.filter((item) => item.paidAt === null);

  const result = recalculateInstallments({
    lineTotalCents: line.totalCents,
    paidTotalCents: paid.reduce((sum, item) => sum + (item.paidCents ?? 0), 0),
    installmentsCount: items.length,
    paidCount: paid.length,
    unpaid: unpaid.map((item) => ({ id: item.id, number: item.number })),
  });

  const current = new Map(unpaid.map((item) => [item.id, item.expectedCents]));
  for (const value of result.values) {
    if (current.get(value.id) !== value.expectedCents) {
      await tx
        .update(projectInstallmentTable)
        .set({ expectedCents: value.expectedCents })
        .where(eq(projectInstallmentTable.id, value.id));
    }
  }
}
