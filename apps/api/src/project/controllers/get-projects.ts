import { and, count, eq, isNull, max, min, notInArray, sql } from "drizzle-orm";
import db from "../../database";
import {
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { hiddenProjectIds } from "../../project-access";
import { getFinanceToday } from "../../project-finance/dates";

type ProjectStatistics = {
  completionPercentage: number;
  totalTasks: number;
  dueDate: Date | null;
};

const EMPTY_STATISTICS: ProjectStatistics = {
  completionPercentage: 0,
  totalTasks: 0,
  dueDate: null,
};

async function getProjectStatistics(
  workspaceId: string,
  includeArchived: boolean,
) {
  const statisticsByProject = new Map<string, ProjectStatistics>();

  // Aggregate in the database instead of loading every task row into memory.
  // This endpoint needs three numbers per project; the previous
  // `with: { tasks: true }` made both the query and the response grow linearly
  // with the number of tasks in the workspace. Scoping by workspaceId through
  // a join (rather than an `IN (...projectIds)` list) keeps the statement size
  // constant regardless of how many projects the workspace has.
  const rows = await db
    .select({
      projectId: taskTable.projectId,
      totalTasks: count(),
      completedTasks: count(
        sql`case when ${taskTable.status} in ('done', 'archived') then 1 end`,
      ),
      dueDate: min(taskTable.dueDate),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      includeArchived
        ? eq(projectTable.workspaceId, workspaceId)
        : and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.archivedAt),
          ),
    )
    .groupBy(taskTable.projectId);

  for (const row of rows) {
    const totalTasks = Number(row.totalTasks);
    const completedTasks = Number(row.completedTasks);

    statisticsByProject.set(row.projectId, {
      totalTasks,
      completionPercentage:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      dueDate: row.dueDate ?? null,
    });
  }

  return statisticsByProject;
}

type FinanceSummary = {
  financeEndDate: string | null;
  hasOverdueFinanceInstallment: boolean;
};

const EMPTY_FINANCE_SUMMARY: FinanceSummary = {
  financeEndDate: null,
  hasOverdueFinanceInstallment: false,
};

async function getProjectFinanceSummaries(
  workspaceId: string,
  includeArchived: boolean,
) {
  const financeByProject = new Map<string, FinanceSummary>();
  const today = getFinanceToday();

  // `project_installment` is already persisted (Financeiro), so this reads
  // straight off it instead of re-running `buildFinanceState` per project --
  // the same reasoning as the workspace-calendar's finance-installments query.
  const rows = await db
    .select({
      projectId: projectPaymentLineTable.projectId,
      lastDueDate: max(projectInstallmentTable.dueDate),
      overdueCount: count(
        sql`case when ${projectInstallmentTable.paidAt} is null and ${projectInstallmentTable.dueDate} < ${today} then 1 end`,
      ),
    })
    .from(projectInstallmentTable)
    .innerJoin(
      projectPaymentLineTable,
      eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
    )
    .innerJoin(
      projectTable,
      eq(projectPaymentLineTable.projectId, projectTable.id),
    )
    .where(
      includeArchived
        ? eq(projectTable.workspaceId, workspaceId)
        : and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.archivedAt),
          ),
    )
    .groupBy(projectPaymentLineTable.projectId);

  for (const row of rows) {
    financeByProject.set(row.projectId, {
      financeEndDate: row.lastDueDate ?? null,
      hasOverdueFinanceInstallment: Number(row.overdueCount) > 0,
    });
  }

  return financeByProject;
}

async function getProjects(
  workspaceId: string,
  includeArchived = false,
  // Quem pede: projetos que ele não pode ver (Fase 7A) somem da lista.
  userId?: string,
) {
  const hidden = userId ? await hiddenProjectIds(userId, workspaceId) : [];
  const projects = await db.query.projectTable.findMany({
    where: and(
      eq(projectTable.workspaceId, workspaceId),
      includeArchived ? undefined : isNull(projectTable.archivedAt),
      hidden.length > 0 ? notInArray(projectTable.id, hidden) : undefined,
    ),
    // `id` is the deterministic tie-breaker: without it, rows sharing both a
    // position and a createdAt come back in an unspecified order.
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
    // Uma consulta extra (não uma por projeto): a query relacional do
    // Drizzle resolve `with` num segundo SELECT com IN (...), não N+1.
    with: { label: true },
  });

  const statisticsByProject = await getProjectStatistics(
    workspaceId,
    includeArchived,
  );
  const financeByProject = await getProjectFinanceSummaries(
    workspaceId,
    includeArchived,
  );

  return projects.map((project) => ({
    ...project,
    statistics: statisticsByProject.get(project.id) ?? EMPTY_STATISTICS,
    ...(financeByProject.get(project.id) ?? EMPTY_FINANCE_SUMMARY),
    archivedTasks: [],
    plannedTasks: [],
    columns: [],
  }));
}

export default getProjects;
