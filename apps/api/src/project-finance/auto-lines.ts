// Rateio livre das linhas automáticas (Atualização 3): dentro de uma tag, o
// que sobra do orçamento depois das linhas de valor fixo é dividido em partes
// iguais entre as linhas automáticas, e cada fatia é dividida pelos meses
// daquela linha. Recalculado sempre que algo muda a sobra da tag.
import { asc, eq } from "drizzle-orm";
import {
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTagTable,
} from "../database/schema";
import { distributeCents, recalculateInstallments } from "./recalculate";
import type { Tx } from "./state";

/**
 * Recalcula o valor de cada parcela NÃO paga de toda linha automática da tag
 * (a quantidade de parcelas e as datas de cada linha não mudam aqui). Se a
 * tag não existir mais, ou não tiver linha automática, não faz nada. Sobra
 * negativa (linhas fixas já passam do valor da tag) vira 0 para as
 * automáticas — o aviso de estouro da tag continua valendo por conta das
 * linhas fixas.
 */
export async function recalculateAutomaticLinesForTag(tx: Tx, tagId: string) {
  const [tag] = await tx
    .select({ valueCents: projectTagTable.valueCents })
    .from(projectTagTable)
    .where(eq(projectTagTable.id, tagId))
    .limit(1);
  if (!tag) return;

  const lines = await tx
    .select()
    .from(projectPaymentLineTable)
    .where(eq(projectPaymentLineTable.tagId, tagId));
  const fixedLines = lines.filter((line) => line.isFixedAmount);
  const autoLines = lines.filter((line) => !line.isFixedAmount);
  if (autoLines.length === 0) return;

  const fixedTotalCents = fixedLines.reduce(
    (sum, line) => sum + line.totalCents,
    0,
  );
  const leftoverCents = Math.max(0, tag.valueCents - fixedTotalCents);
  const shares = distributeCents(leftoverCents, autoLines.length);

  for (const [index, line] of autoLines.entries()) {
    const fatiaCents = shares[index] ?? 0;
    if (fatiaCents === line.totalCents) continue;

    const items = await tx
      .select()
      .from(projectInstallmentTable)
      .where(eq(projectInstallmentTable.lineId, line.id))
      .orderBy(asc(projectInstallmentTable.number));
    const paid = items.filter((item) => item.paidAt !== null);
    const unpaid = items.filter((item) => item.paidAt === null);

    const result = recalculateInstallments({
      lineTotalCents: fatiaCents,
      paidTotalCents: paid.reduce(
        (sum, item) => sum + (item.paidCents ?? 0),
        0,
      ),
      installmentsCount: items.length,
      paidCount: paid.length,
      unpaid: unpaid.map((item) => ({ id: item.id, number: item.number })),
    });

    const current = new Map(
      unpaid.map((item) => [item.id, item.expectedCents]),
    );
    for (const value of result.values) {
      if (current.get(value.id) !== value.expectedCents) {
        await tx
          .update(projectInstallmentTable)
          .set({ expectedCents: value.expectedCents })
          .where(eq(projectInstallmentTable.id, value.id));
      }
    }
    await tx
      .update(projectPaymentLineTable)
      .set({ totalCents: fatiaCents })
      .where(eq(projectPaymentLineTable.id, line.id));
  }
}

/** Chamar depois de qualquer criação/edição/exclusão de linha ou mudança do
 * valor de uma tag: recalcula a(s) tag(s) afetada(s), evitando duplicar. */
export async function recalculateAutomaticLinesForTags(
  tx: Tx,
  tagIds: Array<string | null | undefined>,
) {
  const unique = [...new Set(tagIds.filter((id): id is string => !!id))];
  for (const tagId of unique) {
    await recalculateAutomaticLinesForTag(tx, tagId);
  }
}
