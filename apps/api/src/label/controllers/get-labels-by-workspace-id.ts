import { and, eq, isNull, notInArray, or } from "drizzle-orm";
import db from "../../database";
import { labelTable, taskTable } from "../../database/schema";
import { hiddenProjectIds } from "../../project-access";

// Etiquetas de tarefa de projeto escondido do usuário (Fase 7A) não aparecem.
async function getLabelsByWorkspaceId(workspaceId: string, userId?: string) {
  const hidden = userId ? await hiddenProjectIds(userId, workspaceId) : [];
  if (hidden.length === 0) {
    return db
      .select()
      .from(labelTable)
      .where(eq(labelTable.workspaceId, workspaceId));
  }
  const rows = await db
    .select({ label: labelTable })
    .from(labelTable)
    .leftJoin(taskTable, eq(labelTable.taskId, taskTable.id))
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        or(
          isNull(taskTable.projectId),
          notInArray(taskTable.projectId, hidden),
        ),
      ),
    );
  return rows.map((row) => row.label);
}

export default getLabelsByWorkspaceId;
