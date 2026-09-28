// Regra de recálculo das parcelas (função pura, sem banco). Dinheiro sempre em
// centavos inteiros; nenhuma divisão produz casas decimais.

export const MAX_MONEY_CENTS = 1_000_000_000_000; // R$ 10 bilhões: soma segura (< 2^53)

export type RecalcWarning = "paid_reached_total";

export type RecalcInput = {
  /** Total contratado da linha, em centavos. */
  lineTotalCents: number;
  /** Soma do valor efetivamente pago nas parcelas já pagas. */
  paidTotalCents: number;
  /** Quantidade total de parcelas da linha (pagas + não pagas). */
  installmentsCount: number;
  /** Quantas parcelas já estão pagas (contagem, não posição). */
  paidCount: number;
  /** Parcelas ainda não pagas. A de maior `number` absorve o resto. */
  unpaid: ReadonlyArray<{ id: string; number: number }>;
};

export type RecalcResult = {
  values: Array<{ id: string; number: number; expectedCents: number }>;
  /** max(0, total da linha - total pago). */
  remainingCents: number;
  warning: RecalcWarning | null;
};

function assertCents(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

/**
 * Divide `totalCents` em `count` partes inteiras iguais; a última absorve o
 * resto (10000 em 3 -> 3333, 3333, 3334). Devolve na ordem das parcelas.
 */
export function distributeCents(totalCents: number, count: number): number[] {
  assertCents("totalCents", totalCents);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative safe integer");
  }
  if (count === 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const parts = new Array<number>(count).fill(base);
  parts[count - 1] = base + remainder;
  return parts;
}

/**
 * Novo valor previsto de cada parcela não paga:
 * (total da linha - total pago) / (total de parcelas - parcelas pagas),
 * em centavos, com a última parcela absorvendo o arredondamento.
 * Se o pago já alcançou ou passou o total, as restantes viram 0 e vem um aviso.
 */
export function recalculateInstallments(input: RecalcInput): RecalcResult {
  const {
    lineTotalCents,
    paidTotalCents,
    installmentsCount,
    paidCount,
    unpaid,
  } = input;
  assertCents("lineTotalCents", lineTotalCents);
  assertCents("paidTotalCents", paidTotalCents);
  assertCents("installmentsCount", installmentsCount);
  assertCents("paidCount", paidCount);

  const divisor = installmentsCount - paidCount;
  if (divisor !== unpaid.length) {
    throw new RangeError(
      "installmentsCount - paidCount must equal the number of unpaid installments",
    );
  }

  const ordered = [...unpaid].sort((a, b) => a.number - b.number);
  const rawRemaining = lineTotalCents - paidTotalCents;
  const remainingCents = Math.max(0, rawRemaining);
  const warning: RecalcWarning | null =
    rawRemaining < 0 || (rawRemaining === 0 && ordered.length > 0)
      ? "paid_reached_total"
      : null;

  const shares = distributeCents(remainingCents, ordered.length);
  return {
    values: ordered.map((item, index) => ({
      id: item.id,
      number: item.number,
      expectedCents: shares[index] ?? 0,
    })),
    remainingCents,
    warning,
  };
}
