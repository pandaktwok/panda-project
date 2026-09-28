import type {
  FinanceLine,
  FinanceState,
  FinanceTag,
} from "@/fetchers/project-finance/types";
import type { MarkFile } from "@/lib/finance/schedule";

// Dados de teste do financeiro: parcelas mensais a partir de 05/02/2026,
// "hoje" = 24/09/2026 (mesmo cenário do mockup).
export function makeTag(input: {
  id: string;
  name: string;
  valueCents: number;
  linesTotalCents?: number;
  paidCents?: number;
}): FinanceTag {
  const linesTotalCents = input.linesTotalCents ?? input.valueCents;
  const paidCents = input.paidCents ?? 0;
  return {
    id: input.id,
    name: input.name,
    description: null,
    valueCents: input.valueCents,
    position: 0,
    linesCount: 1,
    linesTotalCents,
    paidCents,
    paidBasisPoints:
      input.valueCents === 0
        ? 0
        : Math.floor((paidCents * 10_000) / input.valueCents),
  } as FinanceTag;
}

export function makeLine(input: {
  id: string;
  supplier: string;
  total: number;
  count: number;
  paid: number;
  paidValue?: number;
  today?: string;
  tag?: FinanceTag | null;
  isFixedAmount?: boolean;
}): FinanceLine {
  const today = input.today ?? "2026-09-24";
  const each = Math.floor(input.total / input.count);
  const installments = Array.from({ length: input.count }, (_, i) => {
    const number = i + 1;
    const month = 2 + i; // fev/2026 em diante, dia 5
    const year = 2026 + Math.floor((month - 1) / 12);
    const m = ((month - 1) % 12) + 1;
    const dueDate = `${year}-${String(m).padStart(2, "0")}-05`;
    const isPaid = number <= input.paid;
    return {
      id: `${input.id}-${number}`,
      number,
      dueDate,
      expectedCents:
        number === input.count ? input.total - each * (input.count - 1) : each,
      paidAt: isPaid ? dueDate : null,
      paidCents: isPaid ? (input.paidValue ?? each) : null,
      paidBy: isPaid ? "u1" : null,
      fileAssetId: null,
      isFinalStretch: number > input.count - 3,
      status: isPaid
        ? ("paid" as const)
        : dueDate < today
          ? ("overdue" as const)
          : ("pending" as const),
    };
  });
  const paidCents = installments.reduce((s, i) => s + (i.paidCents ?? 0), 0);
  return {
    id: input.id,
    supplier: input.supplier,
    tag: input.tag ? { id: input.tag.id, name: input.tag.name } : null,
    isFixedAmount: input.isFixedAmount ?? true,
    totalCents: input.total,
    installmentsCount: input.count,
    firstDueDate: installments[0].dueDate,
    position: 0,
    paidCents,
    remainingCents: Math.max(0, input.total - paidCents),
    warning: null,
    installments,
  };
}

export function makeState(
  lines: FinanceLine[],
  tags: FinanceTag[] = [],
): FinanceState {
  return {
    version: "v1",
    asOf: "2026-09-24",
    project: {
      id: "p1",
      name: "Projeto",
      description: null,
      totalCents: lines.reduce((s, l) => s + l.totalCents, 0),
      months: 10,
      firstDueDate: "2026-02-05",
    },
    tags,
    lines,
    totals: {} as FinanceState["totals"],
    finalStretch: {} as FinanceState["finalStretch"],
  } as unknown as FinanceState;
}

/** Comprovante e NF de mentira, só para montar uma marcação nos testes
 * (spread direto em cima de paidCents/paidAt para formar um Mark completo). */
export const MARK_FILES: { receipts: MarkFile[]; invoices: MarkFile[] } = {
  receipts: [
    {
      assetId: "asset-receipt",
      name: "comprovante.pdf",
      size: 1024,
      label: "comprovante",
    },
  ],
  invoices: [
    {
      assetId: "asset-invoice",
      name: "nf.pdf",
      size: 2048,
      label: "nf",
    },
  ],
};
