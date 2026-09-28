import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

/**
 * Catálogo de etiquetas de projeto do workspace (fundo/categoria: FIA, FMI,
 * Educação...), para autocompletar na criação/edição do projeto. Não confundir
 * com o catálogo de etiquetas de orçamento do financeiro (outro endpoint,
 * escopado por projeto).
 */
async function getProjectLabels(workspaceId: string) {
  if (!workspaceId) return [];

  const response = await client.project.labels.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getProjectLabels;
