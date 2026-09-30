import { and, desc, eq, gte, isNull, ne, notInArray } from "drizzle-orm";
import db from "../../database";
import {
  projectLabelTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { hiddenProjectIds } from "../../project-access";
import {
  daysInMonth,
  formatIsoDate,
  getFinanceToday,
  parseIsoDate,
} from "../../project-finance/dates";
import getWorkspaceCalendarFinanceInstallments from "./get-finance-installments";
import getWorkspaceCalendarTasks from "./get-tasks";

const RECENT_PROJECT_MONTHS = 3;
const CALENDAR_DAYS_BEFORE = 45;
const CALENDAR_DAYS_AFTER = 120;
const LIST_LIMIT = 20;

/** Soma (ou subtrai) dias de uma data "AAAA-MM-DD" sem passar por fuso. */
function shiftIsoDate(iso: string, days: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** Subtrai meses de "AAAA-MM-DD" prendendo o dia ao fim de meses curtos. */
function subtractMonths(iso: string, months: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const index = parsed.year * 12 + (parsed.month - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return formatIsoDate({
    year,
    month,
    day: Math.min(parsed.day, daysInMonth(year, month)),
  });
}

/** Meia-noite (horário de Brasília, UTC-3) do dia "AAAA-MM-DD". */
function startOfDayInSaoPaulo(iso: string): Date {
  return new Date(`${iso}T00:00:00-03:00`);
}

/**
 * Resumo para o widget de área de trabalho: uma única chamada com tudo
 * que ele mostra. Reaproveita as consultas do calendário global (mesmas
 * regras de projetos arquivados e projetos escondidos por acesso).
 */
async function getWorkspaceWidgetSummary(
  workspaceId: string,
  userId: string | undefined,
  newTasksDays: number,
) {
  const hidden = userId ? await hiddenProjectIds(userId, workspaceId) : [];
  const today = getFinanceToday();

  const [installments, calendarTasks] = await Promise.all([
    getWorkspaceCalendarFinanceInstallments(workspaceId, userId),
    getWorkspaceCalendarTasks(workspaceId, userId),
  ]);

  const compareInstallments = (
    a: (typeof installments)[number],
    b: (typeof installments)[number],
  ) =>
    a.dueDate.localeCompare(b.dueDate) ||
    a.projectName.localeCompare(b.projectName) ||
    a.supplier.localeCompare(b.supplier);

  const overdue = installments
    .filter((item) => item.status === "overdue")
    .sort(compareInstallments);
  const upcoming = installments
    .filter((item) => item.status === "pending")
    .sort(compareInstallments);

  // Projetos criados nos últimos 3 meses (não arquivados, visíveis).
  const projectsSince = startOfDayInSaoPaulo(
    subtractMonths(today, RECENT_PROJECT_MONTHS),
  );
  const projectRows = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      createdAt: projectTable.createdAt,
      labelId: projectLabelTable.id,
      labelName: projectLabelTable.name,
    })
    .from(projectTable)
    .leftJoin(projectLabelTable, eq(projectTable.labelId, projectLabelTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        gte(projectTable.createdAt, projectsSince),
        hidden.length > 0 ? notInArray(projectTable.id, hidden) : undefined,
      ),
    )
    .orderBy(desc(projectTable.createdAt))
    .limit(LIST_LIMIT);

  // Tarefas criadas nos últimos N dias.
  const tasksSince = startOfDayInSaoPaulo(shiftIsoDate(today, -newTasksDays));
  const taskRows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      dueDate: taskTable.dueDate,
      createdAt: taskTable.createdAt,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        ne(taskTable.status, "archived"),
        gte(taskTable.createdAt, tasksSince),
        hidden.length > 0 ? notInArray(projectTable.id, hidden) : undefined,
      ),
    )
    .orderBy(desc(taskTable.createdAt))
    .limit(LIST_LIMIT);

  // Janela do calendário: só o necessário para o mês exibido e vizinhos.
  const windowStart = shiftIsoDate(today, -CALENDAR_DAYS_BEFORE);
  const windowEnd = shiftIsoDate(today, CALENDAR_DAYS_AFTER);
  const inWindow = (isoDay: string) =>
    isoDay >= windowStart && isoDay <= windowEnd;

  return {
    generatedAt: new Date().toISOString(),
    today,
    nextInstallment: upcoming[0] ?? null,
    overdue: {
      count: overdue.length,
      totalCents: overdue.reduce((sum, item) => sum + item.expectedCents, 0),
      items: overdue.slice(0, LIST_LIMIT),
    },
    recentProjects: projectRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
      projectLabel: row.labelId
        ? { id: row.labelId, name: row.labelName ?? "" }
        : null,
    })),
    newTasks: taskRows.map((row) => ({
      id: row.id,
      title: row.title,
      number: row.number,
      status: row.status,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      projectId: row.projectId,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
    })),
    calendar: {
      installments: installments.filter((item) => inWindow(item.dueDate)),
      tasks: calendarTasks.filter((task) => {
        const day = (task.dueDate ?? task.startDate)?.slice(0, 10);
        return day ? inWindow(day) : false;
      }),
    },
  };
}

export default getWorkspaceWidgetSummary;
