// Cópia fiel da regra de recálculo da API (apps/api/src/project-finance/
// recalculate.ts), usada só para a PRÉVIA na janela de pagamento e na tabela.
// O valor gravado é sempre o que a API devolve depois de "Salvar alterações".
// Os testes deste arquivo repetem os casos obrigatórios da API.

export type RecalcInput = {
  lineTotalCents: number;
  paidTotalCents: number;
  installmentsCount: number;
  paidCount: number;
  unpaid: ReadonlyArray<{ id: string; number: number }>;
};

export type RecalcResult = {
  values: Array<{ id: string; number: number; expectedCents: number }>;
  remainingCents: number;
  warning: "paid_reached_total" | null;
};

export function distributeCents(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const parts = new Array<number>(count).fill(base);
  parts[count - 1] = base + remainder;
  return parts;
}

export function recalculateInstallments(input: RecalcInput): RecalcResult {
  const ordered = [...input.unpaid].sort((a, b) => a.number - b.number);
  const rawRemaining = input.lineTotalCents - input.paidTotalCents;
  const remainingCents = Math.max(0, rawRemaining);
  const warning =
    rawRemaining < 0 || (rawRemaining === 0 && ordered.length > 0)
      ? ("paid_reached_total" as const)
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
