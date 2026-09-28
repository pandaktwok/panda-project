// Modelo de exibição do cronograma: junta o estado que veio da API com as
// marcações "pago, ainda não salvo" que existem só na tela. Nada aqui grava
// dado: o recálculo é uma PRÉVIA; a API refaz e devolve o valor definitivo.

import type {
  FinanceInstallment,
  FinanceLine,
  FinanceState,
  FinanceTag,
} from "@/fetchers/project-finance/types";
import { recalculateInstallments } from "./recalculate";

/** `label` é o nome digitado pela pessoa só para organização na lista antes de
 * salvar (Atualização 3); não entra no nome do arquivo final. */
export type MarkFile = {
  assetId: string;
  name: string;
  size: number;
  label: string;
};
export type Mark = {
  paidCents: number;
  paidAt: string;
  /** Comprovantes e NFs já enviados, na ordem de inclusão; a API junta todos
   * num PDF ao salvar (comprovantes primeiro, depois notas fiscais). */
  receipts: MarkFile[];
  invoices: MarkFile[];
};
export type Marks = Record<string, Mark>;

export type CellStatus = "paid" | "unsaved" | "overdue" | "pending" | "empty";

export type CellModel = {
  status: CellStatus;
  lineId: string;
  number: number;
  installmentId: string | null;
  dueDate: string | null;
  /** Valor exibido: pago (salvo ou marcado) ou previsto já recalculado. */
  amountCents: number;
  /** Previsto que veio da API (antes de aplicar as marcações). */
  serverExpectedCents: number;
  paidAt: string | null;
  isFinalStretch: boolean;
  hasFile: boolean;
};

export type RowModel = {
  line: FinanceLine;
  cells: CellModel[];
  /** Pago salvo + marcado. */
  paidCents: number;
  paidBasisPoints: number;
  paidCount: number;
  warning: "paid_reached_total" | null;
};

export type ColumnHead = {
  number: number;
  date: string | null;
  isFinalStretch: boolean;
};

export type TagRow = {
  tag: FinanceTag;
  paidCents: number;
  paidBasisPoints: number;
};

export type ScheduleModel = {
  columns: number;
  heads: ColumnHead[];
  rows: RowModel[];
  columnTotals: number[];
  tagRows: TagRow[];
  totals: {
    projectTotalCents: number;
    /** Soma do "Total da linha" de cada linha (rodapé dessa coluna na tabela). */
    linesTotalCents: number;
    paidCents: number;
    remainingCents: number;
    executedBasisPoints: number;
    openInstallments: number;
    overdueInstallments: number;
    overdueCents: number;
    nextDue: { date: string; cents: number } | null;
  };
  /** Quantas parcelas estão marcadas e ainda não salvas. */
  changes: number;
  /** Menor número de parcela ainda em aberto (para a rolagem inicial). */
  firstOpenNumber: number | null;
};

export function basisPoints(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  return Number((BigInt(part) * 10000n) / BigInt(whole));
}

function isPaid(installment: FinanceInstallment) {
  return installment.status === "paid";
}

function buildRow(line: FinanceLine, marks: Marks): RowModel {
  const byNumber = new Map(line.installments.map((i) => [i.number, i]));
  const isTouched = line.installments.some((i) => marks[i.id] && !isPaid(i));

  let paidCents = 0;
  let paidCount = 0;
  const unpaid: Array<{ id: string; number: number }> = [];
  for (const installment of line.installments) {
    const mark = marks[installment.id];
    if (isPaid(installment)) {
      paidCents += installment.paidCents ?? 0;
      paidCount += 1;
    } else if (mark) {
      paidCents += mark.paidCents;
      paidCount += 1;
    } else {
      unpaid.push({ id: installment.id, number: installment.number });
    }
  }

  const recalculated = isTouched
    ? recalculateInstallments({
        lineTotalCents: line.totalCents,
        paidTotalCents: paidCents,
        installmentsCount: line.installmentsCount,
        paidCount,
        unpaid,
      })
    : null;
  const recalculatedById = new Map(
    (recalculated?.values ?? []).map((v) => [v.id, v.expectedCents]),
  );

  const cells: CellModel[] = [];
  for (let number = 1; number <= line.installmentsCount; number += 1) {
    const installment = byNumber.get(number);
    if (!installment) {
      cells.push({
        status: "empty",
        lineId: line.id,
        number,
        installmentId: null,
        dueDate: null,
        amountCents: 0,
        serverExpectedCents: 0,
        paidAt: null,
        isFinalStretch: false,
        hasFile: false,
      });
      continue;
    }
    const mark = marks[installment.id];
    const paid = isPaid(installment);
    const status: CellStatus = paid
      ? "paid"
      : mark
        ? "unsaved"
        : installment.status === "overdue"
          ? "overdue"
          : "pending";
    const amountCents = paid
      ? (installment.paidCents ?? 0)
      : mark
        ? mark.paidCents
        : (recalculatedById.get(installment.id) ?? installment.expectedCents);
    cells.push({
      status,
      lineId: line.id,
      number,
      installmentId: installment.id,
      dueDate: installment.dueDate,
      amountCents,
      serverExpectedCents: installment.expectedCents,
      paidAt: paid ? installment.paidAt : (mark?.paidAt ?? null),
      isFinalStretch: installment.isFinalStretch,
      hasFile: Boolean(installment.fileAssetId),
    });
  }

  const remaining = Math.max(0, line.totalCents - paidCents);
  return {
    line,
    cells,
    paidCents,
    paidBasisPoints: basisPoints(paidCents, line.totalCents),
    paidCount,
    warning:
      line.totalCents - paidCents < 0 || (remaining === 0 && unpaid.length > 0)
        ? "paid_reached_total"
        : null,
  };
}

export function buildSchedule(
  state: FinanceState,
  marks: Marks,
): ScheduleModel {
  const rows = state.lines.map((line) => buildRow(line, marks));
  const columns = rows.reduce(
    (max, row) => Math.max(max, row.line.installmentsCount),
    0,
  );

  // Coluna vermelha = data entre as 3 últimas do projeto (a mesma lista do
  // aviso). Cada célula ainda usa o isFinalStretch da própria linha.
  const lastThree = new Set(lastThreeDueDates(state));
  const heads: ColumnHead[] = [];
  const columnTotals: number[] = [];
  for (let n = 1; n <= columns; n += 1) {
    let date: string | null = null;
    let total = 0;
    for (const row of rows) {
      const cell = row.cells[n - 1];
      if (!cell || cell.status === "empty") continue;
      if (date === null && cell.dueDate) date = cell.dueDate;
      total += cell.amountCents;
    }
    heads.push({
      number: n,
      date,
      isFinalStretch: date !== null && lastThree.has(date),
    });
    columnTotals.push(total);
  }

  let changes = 0;
  let openInstallments = 0;
  let overdueInstallments = 0;
  let overdueCents = 0;
  let firstOpenNumber: number | null = null;
  const openByDate = new Map<string, number>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.status === "unsaved") changes += 1;
      if (cell.status === "overdue" || cell.status === "pending") {
        openInstallments += 1;
        if (firstOpenNumber === null || cell.number < firstOpenNumber) {
          firstOpenNumber = cell.number;
        }
        if (cell.status === "overdue") {
          overdueInstallments += 1;
          overdueCents += cell.amountCents;
        } else if (cell.dueDate && cell.dueDate >= state.asOf) {
          openByDate.set(
            cell.dueDate,
            (openByDate.get(cell.dueDate) ?? 0) + cell.amountCents,
          );
        }
      }
    }
  }
  const nextDate = [...openByDate.keys()].sort()[0];

  // Total do projeto = soma do valor (orçamento) de cada etiqueta, não a soma
  // dos totais das linhas — espelha a mesma regra de apps/api/.../state.ts
  // (Atualização 2). "linesTotalCents" continua sendo a soma das linhas, para
  // o rodapé da coluna "Total da linha".
  const projectTotalCents = state.tags.reduce(
    (sum, tag) => sum + tag.valueCents,
    0,
  );
  const linesTotalCents = rows.reduce((sum, r) => sum + r.line.totalCents, 0);
  const paidCents = rows.reduce((sum, r) => sum + r.paidCents, 0);
  const remainingCents = rows.reduce(
    (sum, r) => sum + Math.max(0, r.line.totalCents - r.paidCents),
    0,
  );

  const tagRows: TagRow[] = state.tags.map((tag) => {
    const tagPaid = rows
      .filter((r) => r.line.tag?.id === tag.id)
      .reduce((sum, r) => sum + r.paidCents, 0);
    return {
      tag,
      paidCents: tagPaid,
      paidBasisPoints: basisPoints(tagPaid, tag.valueCents),
    };
  });

  return {
    columns,
    heads,
    rows,
    columnTotals,
    tagRows,
    totals: {
      projectTotalCents,
      linesTotalCents,
      paidCents,
      remainingCents,
      executedBasisPoints: basisPoints(paidCents, projectTotalCents),
      openInstallments,
      overdueInstallments,
      overdueCents,
      nextDue:
        nextDate === undefined
          ? null
          : { date: nextDate, cents: openByDate.get(nextDate) ?? 0 },
    },
    changes,
    firstOpenNumber,
  };
}

export type MarkPreview = {
  line: FinanceLine;
  before: Array<{ number: number; dueDate: string | null; cents: number }>;
  after: Array<{ number: number; dueDate: string | null; cents: number }>;
  /** Peças da fórmula (total da linha - pago) / (parcelas - pagas). */
  formula: {
    lineTotalCents: number;
    paidTotalCents: number;
    installmentsCount: number;
    paidCount: number;
    perInstallmentCents: number | null;
  };
  expectedCents: number;
  /** paid - previsto (positivo: acima do previsto). */
  differenceCents: number;
  warning: "paid_reached_total" | null;
};

/** Prévia de marcar UMA parcela (além das marcações que já existem). */
export function previewMark(
  state: FinanceState,
  marks: Marks,
  installmentId: string,
  candidate: Mark,
): MarkPreview | null {
  const line = state.lines.find((l) =>
    l.installments.some((i) => i.id === installmentId),
  );
  if (!line) return null;
  const withoutThis: Marks = { ...marks };
  delete withoutThis[installmentId];
  const before = buildRow(line, withoutThis);
  const after = buildRow(line, { ...withoutThis, [installmentId]: candidate });

  const pick = (row: RowModel) =>
    row.cells
      .filter(
        (c) =>
          (c.status === "pending" || c.status === "overdue") &&
          c.installmentId !== installmentId,
      )
      .map((c) => ({
        number: c.number,
        dueDate: c.dueDate,
        cents: c.amountCents,
      }));
  const afterOpen = pick(after);
  const target = line.installments.find((i) => i.id === installmentId);
  const expectedCents =
    before.cells.find((c) => c.installmentId === installmentId)?.amountCents ??
    target?.expectedCents ??
    0;

  return {
    line,
    before: pick(before),
    after: afterOpen,
    formula: {
      lineTotalCents: line.totalCents,
      paidTotalCents: after.paidCents,
      installmentsCount: line.installmentsCount,
      paidCount: after.paidCount,
      perInstallmentCents: afterOpen.length > 0 ? afterOpen[0].cents : null,
    },
    expectedCents,
    differenceCents: candidate.paidCents - expectedCents,
    warning: after.warning,
  };
}

/** Datas (dd/mm em ISO) das 3 últimas datas de vencimento distintas do projeto. */
export function lastThreeDueDates(state: FinanceState): string[] {
  const dates = new Set<string>();
  for (const line of state.lines) {
    for (const installment of line.installments) dates.add(installment.dueDate);
  }
  return [...dates].sort().slice(-3);
}

/** Ordem estável de cores para as etiquetas das tags (por posição). */
export const TAG_PALETTE = [
  { bg: "bg-blue-500/12", fg: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-purple-500/12", fg: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-teal-500/12", fg: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-amber-500/14", fg: "text-amber-800 dark:text-amber-300" },
  { bg: "bg-pink-500/12", fg: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-lime-500/14", fg: "text-lime-800 dark:text-lime-300" },
] as const;

export function tagPaletteFor(state: FinanceState, tagId: string | null) {
  if (!tagId) return null;
  const index = state.tags.findIndex((t) => t.id === tagId);
  if (index < 0) return null;
  return TAG_PALETTE[index % TAG_PALETTE.length];
}
