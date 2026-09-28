import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import type { z } from "../../openapi";
import type { projectStatusSchema } from "../schema";

type ProjectStatus = z.infer<typeof projectStatusSchema>;

/**
 * Grava o status manual do Kanban de projetos (arrastar um cartão entre
 * colunas). Não mexe no progresso calculado a partir das tarefas
 * (getProjectStatistics) -- os dois convivem lado a lado no cartão.
 */
async function updateProjectStatus(
  id: string,
  workspaceId: string,
  status: ProjectStatus,
) {
  const [updated] = await db
    .update(projectTable)
    .set({ status })
    .where(
      and(eq(projectTable.id, id), eq(projectTable.workspaceId, workspaceId)),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  return db.query.projectTable.findFirst({
    where: eq(projectTable.id, id),
    with: { label: true },
  });
}

export default updateProjectStatus;
