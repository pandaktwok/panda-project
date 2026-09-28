import { asc, eq } from "drizzle-orm";
import db from "../database";
import { projectLabelTable } from "../database/schema";
import type { Tx } from "../project-finance/state";

/**
 * Etiqueta do projeto (fundo/categoria: FIA, FMI, Educação...) -- diferente
 * das etiquetas de orçamento do financeiro (project_tag). É um catálogo por
 * workspace que a aplicação nunca apaga: uma vez criado um nome, ele
 * continua disponível para outros projetos mesmo que nenhum o esteja usando
 * no momento (ver project_label em database/schema.ts).
 *
 * Reaproveita a entrada existente (comparação sem diferenciar
 * maiúsculas/minúsculas) ou cria uma nova, e devolve o id para gravar em
 * project.labelId. Corrida rara entre duas criações do mesmo nome: a
 * violação de unicidade é tratada como "já existe" em vez de falhar.
 */
export async function ensureProjectLabel(
  tx: Tx,
  workspaceId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  const wanted = trimmed.toLowerCase();
  const rows = await tx
    .select({ id: projectLabelTable.id, name: projectLabelTable.name })
    .from(projectLabelTable)
    .where(eq(projectLabelTable.workspaceId, workspaceId));
  const existing = rows.find((row) => row.name.trim().toLowerCase() === wanted);
  if (existing) return existing.id;

  try {
    const [created] = await tx
      .insert(projectLabelTable)
      .values({ workspaceId, name: trimmed })
      .returning({ id: projectLabelTable.id });
    if (created) return created.id;
  } catch {
    // Outra transação criou o mesmo nome primeiro; recupera o id dela abaixo.
  }

  const rowsAfterRace = await tx
    .select({ id: projectLabelTable.id, name: projectLabelTable.name })
    .from(projectLabelTable)
    .where(eq(projectLabelTable.workspaceId, workspaceId));
  const winner = rowsAfterRace.find(
    (row) => row.name.trim().toLowerCase() === wanted,
  );
  if (winner) return winner.id;
  // Não deveria acontecer (a inserção só falha por causa dessa mesma
  // restrição de unicidade), mas evita devolver undefined em silêncio.
  throw new Error(`Could not resolve project label "${trimmed}"`);
}

/** Catálogo de etiquetas já usadas no workspace, para autocompletar. */
export async function listProjectLabels(workspaceId: string) {
  return db
    .select({ id: projectLabelTable.id, name: projectLabelTable.name })
    .from(projectLabelTable)
    .where(eq(projectLabelTable.workspaceId, workspaceId))
    .orderBy(asc(projectLabelTable.name));
}
