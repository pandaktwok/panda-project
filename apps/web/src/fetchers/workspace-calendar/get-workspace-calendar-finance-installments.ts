import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

/**
 * Parcelas do Financeiro de todos os projetos não arquivados do workspace,
 * para o calendário global (Visão geral > Calendário).
 */
async function getWorkspaceCalendarFinanceInstallments(workspaceId: string) {
  if (!workspaceId) return [];

  const response = await client["workspace-calendar"][
    "finance-installments"
  ].$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceCalendarFinanceInstallments;
