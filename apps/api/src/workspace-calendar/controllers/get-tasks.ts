import { and, eq, isNotNull, isNull, ne, notInArray, or } from "drizzle-orm";
import db from "../../database";
import {
  projectLabelTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { hiddenProjectIds } from "../../project-access";

/**
 * Tarefas com data (início ou vencimento) de todos os projetos não
 * arquivados do workspace, para o calendário global. Uma única consulta
 * (join), sem N+1: nada de repetir a busca por projeto.
 */
async function getWorkspaceCalendarTasks(workspaceId: string, userId?: string) {
  const hidden = userId ? await hiddenProjectIds(userId, workspaceId) : [];

  const rows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      projectLabelId: projectLabelTable.id,
      projectLabelName: projectLabelTable.name,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(projectLabelTable, eq(projectTable.labelId, projectLabelTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        ne(taskTable.status, "archived"),
        or(isNotNull(taskTable.startDate), isNotNull(taskTable.dueDate)),
        hidden.length > 0 ? notInArray(projectTable.id, hidden) : undefined,
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    number: row.number,
    status: row.status,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    projectId: row.projectId,
    projectName: row.projectName,
    projectSlug: row.projectSlug,
    projectLabel: row.projectLabelId
      ? { id: row.projectLabelId, name: row.projectLabelName ?? "" }
      : null,
  }));
}

export default getWorkspaceCalendarTasks;
