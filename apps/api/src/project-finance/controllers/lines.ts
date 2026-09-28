import { and, asc, eq, max, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTable,
} from "../../database/schema";
import { recalculateAutomaticLinesForTags } from "../auto-lines";
import { monthsBetweenInclusive } from "../dates";
import {
  generateInstallments,
  InstallmentPlanError,
  planLineUpdate,
} from "../installment-plan";
import { readFinanceStateOrThrow, withProjectFinanceLock } from "../lock";
import type { FinanceState } from "../response";
import {
  assertTagInProject,
  type FinanceActor,
  projectIdOfLine,
  publishFinanceUpdated,
} from "./common";

export async function createLine(
  projectId: string,
  input: {
    supplier: string;
    tagId?: string | null;
    isFixedAmount?: boolean;
    totalCents?: number;
    installmentsCount?: number;
    firstDueDate?: string;
    finalDueDate?: string;
  },
  actor: FinanceActor,
): Promise<FinanceState> {
  const isFixedAmount = input.isFixedAmount ?? true;
  const state = await withProjectFinanceLock(projectId, async (tx) => {
    const [project] = await tx
      .select({
        financeMonths: projectTable.financeMonths,
        financeFirstDueDate: projectTable.financeFirstDueDate,
      })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });

    const firstDueDate = input.firstDueDate ?? project.financeFirstDueDate;
    if (firstDueDate == null) {
      throw new HTTPException(400, {
        message:
          "firstDueDate is required when the project has no default first due date",
      });
    }
    if (input.tagId) await assertTagInProject(tx, input.tagId, projectId);

    let installmentsCount: number;
    let totalCents: number;
    if (isFixedAmount) {
      const count = input.installmentsCount ?? project.financeMonths;
      if (count == null || input.totalCents == null) {
        throw new HTTPException(400, {
          message:
            "totalCents and installmentsCount are required when the project has no default months",
        });
      }
      installmentsCount = count;
      totalCents = input.totalCents;
    } else {
      if (!input.tagId || !input.finalDueDate) {
        throw new HTTPException(400, {
          message: "tagId and finalDueDate are required for automatic lines",
        });
      }
      installmentsCount = monthsBetweenInclusive(
        firstDueDate,
        input.finalDueDate,
      );
      // Ponto de partida; recalculateAutomaticLinesForTags corrige embaixo
      // pela sobra real da tag (que já conta esta linha, recém-inserida).
      totalCents = 0;
    }

    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectPaymentLineTable.position) })
      .from(projectPaymentLineTable)
      .where(eq(projectPaymentLineTable.projectId, projectId));

    const [line] = await tx
      .insert(projectPaymentLineTable)
      .values({
        projectId,
        tagId: input.tagId ?? null,
        isFixedAmount,
        supplier: input.supplier,
        totalCents,
        installmentsCount,
        firstDueDate,
        position: maxPosition === null ? 0 : maxPosition + 1,
      })
      .returning({ id: projectPaymentLineTable.id });
    if (!line) throw new Error("Failed to create the payment line");

    await tx.insert(projectInstallmentTable).values(
      generateInstallments({
        totalCents,
        count: installmentsCount,
        firstDueDate,
      }).map((item) => ({ ...item, lineId: line.id })),
    );
    if (input.tagId) {
      await recalculateAutomaticLinesForTags(tx, [input.tagId]);
    }
    return readFinanceStateOrThrow(tx, projectId);
  });
  await publishFinanceUpdated(projectId, actor, "line.created");
  return state;
}

export async function updateLine(
  lineId: string,
  input: {
    supplier?: string;
    tagId?: string | null;
    isFixedAmount?: boolean;
    totalCents?: number;
    installmentsCount?: number;
    firstDueDate?: string;
    finalDueDate?: string;
  },
  actor: FinanceActor,
): Promise<FinanceState> {
  const projectId = await projectIdOfLine(lineId);
  const state = await withProjectFinanceLock(projectId, async (tx) => {
    const [line] = await tx
      .select()
      .from(projectPaymentLineTable)
      .where(
        and(
          eq(projectPaymentLineTable.id, lineId),
          eq(projectPaymentLineTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!line) throw new HTTPException(404, { message: "Line not found" });
    if (input.tagId) await assertTagInProject(tx, input.tagId, projectId);

    const existing = await tx
      .select()
      .from(projectInstallmentTable)
      .where(eq(projectInstallmentTable.lineId, lineId))
      .orderBy(asc(projectInstallmentTable.number));

    const isFixedAmount = input.isFixedAmount ?? line.isFixedAmount;
    const firstDueDate = input.firstDueDate ?? line.firstDueDate;
    const tagId = input.tagId !== undefined ? input.tagId : line.tagId;

    let totalCents: number;
    let installmentsCount: number;
    if (isFixedAmount) {
      totalCents = input.totalCents ?? line.totalCents;
      installmentsCount = input.installmentsCount ?? existing.length;
    } else {
      if (!tagId) {
        throw new HTTPException(400, {
          message: "Linha automática precisa de uma etiqueta",
        });
      }
      // finalDueDate omitido: mantém a quantidade de parcelas atual (a linha
      // já era automática e só outro campo mudou). Trocar de fixa para
      // automática sem informar finalDueDate é barrado pelo schema Zod.
      installmentsCount =
        input.finalDueDate !== undefined
          ? monthsBetweenInclusive(firstDueDate, input.finalDueDate)
          : existing.length;
      // O valor de cada parcela é recalculado por recalculateAutomaticLinesForTags
      // logo abaixo; aqui só precisamos de um total provisório para reformar as
      // parcelas (quantidade e datas) sem alterar a soma antes da hora.
      totalCents = line.totalCents;
    }

    let plan: ReturnType<typeof planLineUpdate>;
    try {
      plan = planLineUpdate({
        existing,
        totalCents,
        count: installmentsCount,
        firstDueDate,
      });
    } catch (error) {
      if (error instanceof InstallmentPlanError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }

    await tx
      .update(projectPaymentLineTable)
      .set({
        totalCents,
        installmentsCount,
        firstDueDate,
        isFixedAmount,
        ...(input.supplier !== undefined ? { supplier: input.supplier } : {}),
        ...(input.tagId !== undefined ? { tagId: input.tagId } : {}),
      })
      .where(eq(projectPaymentLineTable.id, lineId));

    for (const id of plan.removes) {
      await tx
        .delete(projectInstallmentTable)
        .where(eq(projectInstallmentTable.id, id));
    }
    for (const item of plan.updates) {
      await tx
        .update(projectInstallmentTable)
        .set({ dueDate: item.dueDate, expectedCents: item.expectedCents })
        .where(eq(projectInstallmentTable.id, item.id));
    }
    if (plan.creates.length > 0) {
      await tx
        .insert(projectInstallmentTable)
        .values(plan.creates.map((item) => ({ ...item, lineId })));
    }
    // Qualquer mudança na linha pode afetar a sobra da tag antiga e/ou da
    // nova (troca de etiqueta): recalcula as automáticas das duas.
    await recalculateAutomaticLinesForTags(tx, [line.tagId, tagId]);
    return readFinanceStateOrThrow(tx, projectId);
  });
  await publishFinanceUpdated(projectId, actor, "line.updated");
  return state;
}

export type DeleteLineResult =
  | { deleted: true; state: FinanceState }
  | { deleted: false; paidInstallments: number };

/** Linha com parcelas pagas só é apagada com `force` (perde o histórico). */
export async function deleteLine(
  lineId: string,
  force: boolean,
  actor: FinanceActor,
): Promise<DeleteLineResult> {
  const projectId = await projectIdOfLine(lineId);
  const result = await withProjectFinanceLock(
    projectId,
    async (tx): Promise<DeleteLineResult> => {
      const [line] = await tx
        .select({
          id: projectPaymentLineTable.id,
          tagId: projectPaymentLineTable.tagId,
        })
        .from(projectPaymentLineTable)
        .where(
          and(
            eq(projectPaymentLineTable.id, lineId),
            eq(projectPaymentLineTable.projectId, projectId),
          ),
        )
        .limit(1);
      if (!line) throw new HTTPException(404, { message: "Line not found" });

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(projectInstallmentTable)
        .where(
          and(
            eq(projectInstallmentTable.lineId, lineId),
            sql`${projectInstallmentTable.paidAt} is not null`,
          ),
        );
      const count = countRow?.count ?? 0;
      if (count > 0 && !force)
        return { deleted: false, paidInstallments: count };

      // TODO(Fase 4): apagar também os PDFs (assets) das parcelas pagas.
      await tx
        .delete(projectPaymentLineTable)
        .where(eq(projectPaymentLineTable.id, lineId));
      if (line.tagId) {
        await recalculateAutomaticLinesForTags(tx, [line.tagId]);
      }
      return {
        deleted: true,
        state: await readFinanceStateOrThrow(tx, projectId),
      };
    },
  );
  if (result.deleted) {
    await publishFinanceUpdated(projectId, actor, "line.deleted");
  }
  return result;
}
