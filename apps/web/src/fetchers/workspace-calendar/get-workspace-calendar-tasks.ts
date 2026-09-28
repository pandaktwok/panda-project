import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

/**
 * Tarefas com data (início ou vencimento) de todos os projetos não
 * arquivados do workspace, para o calendário global (Visão geral >
 * Calendário).
 */
async function getWorkspaceCalendarTasks(workspaceId: string) {
  if (!workspaceId) return [];

  const response = await client["workspace-calendar"].tasks.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceCalendarTasks;
