// Geração e reajuste das parcelas de uma linha (funções puras).
import { addMonthsClamped } from "./dates";
import {
  distributeCents,
  type RecalcWarning,
  recalculateInstallments,
} from "./recalculate";

export type PlannedInstallment = {
  number: number;
  dueDate: string;
  expectedCents: number;
};

/**
 * Parcelas mensais de uma linha nova: vencimentos a partir da data da 1ª
 * parcela (dia 31 vai para o último dia dos meses curtos, sem "escorregar") e
 * valores iguais, com a última absorvendo o resto.
 */
export function generateInstallments(input: {
  totalCents: number;
  count: number;
  firstDueDate: string;
}): PlannedInstallment[] {
  const values = distributeCents(input.totalCents, input.count);
  return values.map((expectedCents, index) => ({
    number: index + 1,
    dueDate: addMonthsClamped(input.firstDueDate, index),
    expectedCents,
  }));
}

export type ExistingInstallment = {
  id: string;
  number: number;
  dueDate: string;
  expectedCents: number;
  paidAt: string | null;
  paidCents: number | null;
};

export type LineUpdatePlan = {
  /** Parcelas não pagas cujo vencimento e/ou valor mudam. */
  updates: Array<{ id: string; dueDate: string; expectedCents: number }>;
  /** Parcelas novas, sempre no fim (numeração contínua). */
  creates: PlannedInstallment[];
  /** Ids das últimas parcelas não pagas que deixam de existir. */
  removes: string[];
  warning: RecalcWarning | null;
};

export class InstallmentPlanError extends Error {
  readonly code = "COUNT_BELOW_LAST_PAID";
  constructor(readonly lastPaidNumber: number) {
    super(
      `A quantidade de parcelas não pode ser menor que o número da última parcela paga (${lastPaidNumber})`,
    );
  }
}

/**
 * Reajusta uma linha existente (novo total, quantidade de parcelas e/ou data
 * da 1ª parcela). Só parcelas NÃO pagas mudam; as pagas ficam intactas.
 *
 * - Reduzir a quantidade remove as últimas parcelas (todas não pagas). Se
 *   alguma parcela paga tiver número maior que a nova quantidade, recusa
 *   (InstallmentPlanError): renumerar apagaria o vínculo da parcela paga com
 *   seu comprovante e com a pasta "Parcela N".
 * - Aumentar a quantidade cria parcelas novas no fim.
 * - O vencimento de toda parcela não paga é recalculado a partir da nova
 *   data da 1ª parcela; o valor, pela regra de recálculo (total - pago)/restantes.
 */
export function planLineUpdate(input: {
  existing: ExistingInstallment[];
  totalCents: number;
  count: number;
  firstDueDate: string;
}): LineUpdatePlan {
  const { existing, totalCents, count, firstDueDate } = input;
  const paid = existing.filter((item) => item.paidAt !== null);
  const unpaid = existing.filter((item) => item.paidAt === null);

  const lastPaidNumber = paid.reduce(
    (max, item) => Math.max(max, item.number),
    0,
  );
  if (count < lastPaidNumber) throw new InstallmentPlanError(lastPaidNumber);

  const kept = unpaid.filter((item) => item.number <= count);
  const removes = unpaid
    .filter((item) => item.number > count)
    .sort((a, b) => b.number - a.number)
    .map((item) => item.id);

  const usedNumbers = new Set(existing.map((item) => item.number));
  const missingNumbers: number[] = [];
  for (let n = 1; n <= count; n += 1) {
    if (!usedNumbers.has(n)) missingNumbers.push(n);
  }

  const paidTotalCents = paid.reduce(
    (sum, item) => sum + (item.paidCents ?? 0),
    0,
  );
  const targets = [
    ...kept.map((item) => ({ id: item.id, number: item.number })),
    ...missingNumbers.map((number) => ({ id: `new:${number}`, number })),
  ];

  const recalculated = recalculateInstallments({
    lineTotalCents: totalCents,
    paidTotalCents,
    installmentsCount: count,
    paidCount: paid.length,
    unpaid: targets,
  });

  const byId = new Map(kept.map((item) => [item.id, item]));
  const updates: LineUpdatePlan["updates"] = [];
  const creates: PlannedInstallment[] = [];
  for (const value of recalculated.values) {
    const dueDate = addMonthsClamped(firstDueDate, value.number - 1);
    const current = byId.get(value.id);
    if (!current) {
      creates.push({
        number: value.number,
        dueDate,
        expectedCents: value.expectedCents,
      });
    } else if (
      current.dueDate !== dueDate ||
      current.expectedCents !== value.expectedCents
    ) {
      updates.push({
        id: current.id,
        dueDate,
        expectedCents: value.expectedCents,
      });
    }
  }

  return { updates, creates, removes, warning: recalculated.warning };
}
