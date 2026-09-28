import { createHash } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type db from "../database";
import {
  projectFinalStretchNoticeTable,
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTable,
  projectTagTable,
} from "../database/schema";
import {
  computeFinalStretch,
  isFinalStretchInstallment,
} from "./final-stretch";
import type { FinanceState } from "./response";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type FinanceRows = {
  project: {
    id: string;
    name: string;
    financeTotalCents: number | null;
    financeMonths: number | null;
    financeFirstDueDate: string | null;
  };
  tags: Array<typeof projectTagTable.$inferSelect>;
  lines: Array<typeof projectPaymentLineTable.$inferSelect>;
  installments: Array<typeof projectInstallmentTable.$inferSelect>;
  /** Último aviso mensal de reta final enviado (histórico do projeto). */
  lastNotice?: {
    month: string;
    sentAt: Date;
    channels: string[];
    recipients: number;
  } | null;
};

/** Pontos-base (10000 = 100%) em inteiros; BigInt evita estourar 2^53. */
export function basisPoints(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  return Number((BigInt(part) * 10000n) / BigInt(whole));
}

/**
 * Token de concorrência: hash dos DADOS do financeiro do projeto (não do
 * relógio nem dos campos derivados). Qualquer mudança em tags, linhas,
 * parcelas ou nos padrões do projeto muda o token.
 */
export function computeVersion(rows: FinanceRows): string {
  const byId = <T extends { id: string }>(list: T[]) =>
    [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const canonical = JSON.stringify({
    p: [
      rows.project.id,
      rows.project.financeTotalCents,
      rows.project.financeMonths,
      rows.project.financeFirstDueDate,
    ],
    t: byId(rows.tags).map((t) => [
      t.id,
      t.name,
      t.description,
      t.valueCents,
      t.position,
    ]),
    l: byId(rows.lines).map((l) => [
      l.id,
      l.tagId,
      l.supplier,
      l.isFixedAmount,
      l.totalCents,
      l.installmentsCount,
      l.firstDueDate,
      l.position,
    ]),
    i: byId(rows.installments).map((i) => [
      i.id,
      i.lineId,
      i.number,
      i.dueDate,
      i.expectedCents,
      i.paidAt,
      i.paidCents,
      i.paidBy,
      i.fileAssetId,
    ]),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function buildFinanceState(
  rows: FinanceRows,
  asOf: string,
): FinanceState {
  const tagsById = new Map(rows.tags.map((tag) => [tag.id, tag]));
  const installmentsByLine = new Map<
    string,
    Array<typeof projectInstallmentTable.$inferSelect>
  >();
  for (const item of rows.installments) {
    const list = installmentsByLine.get(item.lineId) ?? [];
    list.push(item);
    installmentsByLine.set(item.lineId, list);
  }

  const paidByTag = new Map<string, number>();
  const linesByTag = new Map<string, { count: number; total: number }>();
  // "Total do projeto" é a soma do VALOR (orçamento) de cada etiqueta, não a
  // soma dos totais das linhas — uma linha sem etiqueta não entra na conta
  // (Atualização 2: o orçamento vem das etiquetas, cadastradas por mim).
  const projectTotalCents = rows.tags.reduce(
    (sum, tag) => sum + tag.valueCents,
    0,
  );
  let paidCents = 0;
  let remainingCents = 0;
  let openInstallments = 0;
  let overdueInstallments = 0;
  let nextDueDate: string | null = null;

  const lines = rows.lines.map((line) => {
    const items = (installmentsByLine.get(line.id) ?? []).sort(
      (a, b) => a.number - b.number,
    );
    const count = items.length;
    const paid = items.filter((item) => item.paidAt !== null);
    const linePaid = paid.reduce((sum, item) => sum + (item.paidCents ?? 0), 0);
    const lineRemaining = Math.max(0, line.totalCents - linePaid);
    const unpaidCount = count - paid.length;
    const overpaid =
      linePaid > line.totalCents ||
      (linePaid === line.totalCents && unpaidCount > 0);

    paidCents += linePaid;
    remainingCents += lineRemaining;
    if (line.tagId) {
      paidByTag.set(line.tagId, (paidByTag.get(line.tagId) ?? 0) + linePaid);
      const agg = linesByTag.get(line.tagId) ?? { count: 0, total: 0 };
      agg.count += 1;
      agg.total += line.totalCents;
      linesByTag.set(line.tagId, agg);
    }

    const tag = line.tagId ? tagsById.get(line.tagId) : undefined;
    return {
      id: line.id,
      supplier: line.supplier,
      tag: tag ? { id: tag.id, name: tag.name } : null,
      isFixedAmount: line.isFixedAmount,
      totalCents: line.totalCents,
      installmentsCount: line.installmentsCount,
      firstDueDate: line.firstDueDate,
      position: line.position,
      paidCents: linePaid,
      remainingCents: lineRemaining,
      warning: overpaid ? ("paid_reached_total" as const) : null,
      installments: items.map((item) => {
        const isPaid = item.paidAt !== null;
        if (!isPaid) {
          openInstallments += 1;
          if (item.dueDate < asOf) overdueInstallments += 1;
          else if (nextDueDate === null || item.dueDate < nextDueDate)
            nextDueDate = item.dueDate;
        }
        return {
          id: item.id,
          number: item.number,
          dueDate: item.dueDate,
          expectedCents: item.expectedCents,
          paidAt: item.paidAt,
          paidCents: item.paidCents,
          paidBy: item.paidBy,
          fileAssetId: item.fileAssetId,
          isFinalStretch: isFinalStretchInstallment(item.number, count),
          status: isPaid
            ? ("paid" as const)
            : item.dueDate < asOf
              ? ("overdue" as const)
              : ("pending" as const),
        };
      }),
    };
  });

  const tags = rows.tags.map((tag) => {
    const tagPaid = paidByTag.get(tag.id) ?? 0;
    const agg = linesByTag.get(tag.id);
    return {
      id: tag.id,
      name: tag.name,
      description: tag.description,
      valueCents: tag.valueCents,
      position: tag.position,
      linesCount: agg?.count ?? 0,
      linesTotalCents: agg?.total ?? 0,
      paidCents: tagPaid,
      paidBasisPoints: basisPoints(tagPaid, tag.valueCents),
    };
  });

  return {
    version: computeVersion(rows),
    asOf,
    project: {
      id: rows.project.id,
      name: rows.project.name,
      totalCents: rows.project.financeTotalCents,
      months: rows.project.financeMonths,
      firstDueDate: rows.project.financeFirstDueDate,
    },
    tags,
    lines,
    totals: {
      projectTotalCents,
      paidCents,
      remainingCents,
      executedBasisPoints: basisPoints(paidCents, projectTotalCents),
      openInstallments,
      overdueInstallments,
      nextDueDate,
      tagsCount: rows.tags.length,
    },
    finalStretch: {
      ...computeFinalStretch(
        rows.installments.map((item) => ({
          dueDate: item.dueDate,
          paid: item.paidAt !== null,
        })),
        asOf,
      ),
      lastNotice: rows.lastNotice
        ? {
            month: rows.lastNotice.month,
            sentAt: rows.lastNotice.sentAt.toISOString(),
            channels: rows.lastNotice.channels,
            recipients: rows.lastNotice.recipients,
          }
        : null,
    },
  };
}

export async function loadFinanceRows(
  tx: Tx,
  projectId: string,
): Promise<FinanceRows | null> {
  const [project] = await tx
    .select({
      id: projectTable.id,
      name: projectTable.name,
      financeTotalCents: projectTable.financeTotalCents,
      financeMonths: projectTable.financeMonths,
      financeFirstDueDate: projectTable.financeFirstDueDate,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const tags = await tx
    .select()
    .from(projectTagTable)
    .where(eq(projectTagTable.projectId, projectId))
    .orderBy(
      asc(projectTagTable.position),
      asc(projectTagTable.createdAt),
      asc(projectTagTable.id),
    );
  const lines = await tx
    .select()
    .from(projectPaymentLineTable)
    .where(eq(projectPaymentLineTable.projectId, projectId))
    .orderBy(
      asc(projectPaymentLineTable.position),
      asc(projectPaymentLineTable.createdAt),
      asc(projectPaymentLineTable.id),
    );
  const installments =
    lines.length === 0
      ? []
      : await tx
          .select()
          .from(projectInstallmentTable)
          .where(
            inArray(
              projectInstallmentTable.lineId,
              lines.map((line) => line.id),
            ),
          )
          .orderBy(
            asc(projectInstallmentTable.lineId),
            asc(projectInstallmentTable.number),
          );
  const [lastNotice] = await tx
    .select({
      month: projectFinalStretchNoticeTable.month,
      sentAt: projectFinalStretchNoticeTable.sentAt,
      channels: projectFinalStretchNoticeTable.channels,
      recipients: projectFinalStretchNoticeTable.recipients,
    })
    .from(projectFinalStretchNoticeTable)
    .where(eq(projectFinalStretchNoticeTable.projectId, projectId))
    .orderBy(desc(projectFinalStretchNoticeTable.month))
    .limit(1);
  return { project, tags, lines, installments, lastNotice: lastNotice ?? null };
}
