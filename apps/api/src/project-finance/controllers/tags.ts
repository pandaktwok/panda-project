import { and, asc, eq, max, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  financeTagCatalogTable,
  projectPaymentLineTable,
  projectTagTable,
} from "../../database/schema";
import { recalculateAutomaticLinesForTags } from "../auto-lines";
import { readFinanceStateOrThrow, withProjectFinanceLock } from "../lock";
import type { FinanceState } from "../response";
import type { Tx } from "../state";
import {
  type FinanceActor,
  projectIdOfTag,
  publishFinanceUpdated,
} from "./common";

/**
 * Reaproveita ou cria a entrada do catálogo de etiquetas do workspace (só o
 * nome; o valor/orçamento continua por projeto em project_tag). Ignora
 * maiúsculas/minúsculas ao procurar uma já existente; se duas chamadas
 * concorrentes criarem a mesma no mesmo instante, a violação de unicidade é
 * tratada como "já existe" em vez de falhar a operação.
 */
async function ensureTagCatalogEntry(
  tx: Tx,
  workspaceId: string,
  name: string,
) {
  const trimmed = name.trim();
  const wanted = trimmed.toLowerCase();
  const rows = await tx
    .select({
      id: financeTagCatalogTable.id,
      name: financeTagCatalogTable.name,
    })
    .from(financeTagCatalogTable)
    .where(eq(financeTagCatalogTable.workspaceId, workspaceId));
  const existing = rows.find((row) => row.name.trim().toLowerCase() === wanted);
  if (existing) return;
  try {
    await tx
      .insert(financeTagCatalogTable)
      .values({ workspaceId, name: trimmed });
  } catch {
    // Corrida rara: outra transação inseriu o mesmo nome primeiro. O nome já
    // está no catálogo, não há nada a fazer.
  }
}

async function assertUniqueName(
  tx: Tx,
  projectId: string,
  name: string,
  exceptId?: string,
) {
  const rows = await tx
    .select({ id: projectTagTable.id, name: projectTagTable.name })
    .from(projectTagTable)
    .where(eq(projectTagTable.projectId, projectId));
  const wanted = name.trim().toLowerCase();
  if (
    rows.some(
      (row) => row.id !== exceptId && row.name.trim().toLowerCase() === wanted,
    )
  ) {
    throw new HTTPException(409, {
      message: "A tag with this name already exists in the project",
    });
  }
}

export async function createTag(
  projectId: string,
  input: { name: string; description?: string | null; valueCents?: number },
  actor: FinanceActor,
): Promise<FinanceState> {
  const state = await withProjectFinanceLock(projectId, async (tx) => {
    await assertUniqueName(tx, projectId, input.name);
    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectTagTable.position) })
      .from(projectTagTable)
      .where(eq(projectTagTable.projectId, projectId));
    await tx.insert(projectTagTable).values({
      projectId,
      name: input.name,
      description: input.description ?? null,
      valueCents: input.valueCents ?? 0,
      position: maxPosition === null ? 0 : maxPosition + 1,
    });
    await ensureTagCatalogEntry(tx, actor.workspaceId, input.name);
    return readFinanceStateOrThrow(tx, projectId);
  });
  await publishFinanceUpdated(projectId, actor, "tag.created");
  return state;
}

export async function updateTag(
  tagId: string,
  input: { name?: string; description?: string | null; valueCents?: number },
  actor: FinanceActor,
): Promise<FinanceState> {
  const projectId = await projectIdOfTag(tagId);
  const state = await withProjectFinanceLock(projectId, async (tx) => {
    const [tag] = await tx
      .select()
      .from(projectTagTable)
      .where(
        and(
          eq(projectTagTable.id, tagId),
          eq(projectTagTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!tag) throw new HTTPException(404, { message: "Tag not found" });
    if (input.name !== undefined) {
      await assertUniqueName(tx, projectId, input.name, tagId);
    }
    await tx
      .update(projectTagTable)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.valueCents !== undefined
          ? { valueCents: input.valueCents }
          : {}),
      })
      .where(eq(projectTagTable.id, tagId));
    if (input.name !== undefined) {
      await ensureTagCatalogEntry(tx, actor.workspaceId, input.name);
    }
    // O valor da tag é o orçamento que as linhas automáticas dividem entre
    // si (Atualização 3): mudar valueCents muda a sobra.
    if (input.valueCents !== undefined) {
      await recalculateAutomaticLinesForTags(tx, [tagId]);
    }
    return readFinanceStateOrThrow(tx, projectId);
  });
  await publishFinanceUpdated(projectId, actor, "tag.updated");
  return state;
}

/** Nomes já usados no workspace, para sugerir/reaproveitar ao criar uma etiqueta. */
export async function listTagCatalog(workspaceId: string) {
  const rows = await db
    .select({
      id: financeTagCatalogTable.id,
      name: financeTagCatalogTable.name,
    })
    .from(financeTagCatalogTable)
    .where(eq(financeTagCatalogTable.workspaceId, workspaceId))
    .orderBy(asc(financeTagCatalogTable.name));
  return rows;
}

export type DeleteTagResult =
  | { deleted: true; state: FinanceState }
  | { deleted: false; linesInUse: number };

/**
 * Tag em uso por linhas não some "sem aviso": sem `force` devolve a contagem
 * (a rota responde 409); com `force` as linhas ficam sem tipo e a tag é apagada.
 */
export async function deleteTag(
  tagId: string,
  force: boolean,
  actor: FinanceActor,
): Promise<DeleteTagResult> {
  const projectId = await projectIdOfTag(tagId);
  const result = await withProjectFinanceLock(
    projectId,
    async (tx): Promise<DeleteTagResult> => {
      const [tag] = await tx
        .select({ id: projectTagTable.id })
        .from(projectTagTable)
        .where(
          and(
            eq(projectTagTable.id, tagId),
            eq(projectTagTable.projectId, projectId),
          ),
        )
        .limit(1);
      if (!tag) throw new HTTPException(404, { message: "Tag not found" });

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(projectPaymentLineTable)
        .where(eq(projectPaymentLineTable.tagId, tagId));
      const count = countRow?.count ?? 0;
      if (count > 0 && !force) return { deleted: false, linesInUse: count };

      if (count > 0) {
        await tx
          .update(projectPaymentLineTable)
          .set({ tagId: null })
          .where(eq(projectPaymentLineTable.tagId, tagId));
      }
      await tx.delete(projectTagTable).where(eq(projectTagTable.id, tagId));
      return {
        deleted: true,
        state: await readFinanceStateOrThrow(tx, projectId),
      };
    },
  );
  if (result.deleted) {
    await publishFinanceUpdated(projectId, actor, "tag.deleted");
  }
  return result;
}
