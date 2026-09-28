import { eq, max, sql } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable } from "../../database/schema";
import { ensureProjectLabel } from "../label";

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "A fazer", slug: "to-do", position: 0, isFinal: false },
  { name: "Em andamento", slug: "in-progress", position: 1, isFinal: false },
  { name: "Em revisão", slug: "in-review", position: 2, isFinal: false },
  { name: "Concluído", slug: "done", position: 3, isFinal: true },
] as const;

export type CreateProjectExtras = {
  description?: string;
  financeTotalCents?: number;
  financeMonths?: number;
  financeFirstDueDate?: string;
  label?: string;
};

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  extras: CreateProjectExtras = {},
) {
  return db.transaction(async (tx) => {
    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. `reorderProjects` takes
    // the same lock with the same key.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
    );

    // New projects go to the bottom of the workspace's ordering.
    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectTable.position) })
      .from(projectTable)
      .where(eq(projectTable.workspaceId, workspaceId));

    const labelId = extras.label
      ? await ensureProjectLabel(tx, workspaceId, extras.label)
      : undefined;

    const [createdProject] = await tx
      .insert(projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
        description: extras.description,
        financeTotalCents: extras.financeTotalCents,
        financeMonths: extras.financeMonths,
        financeFirstDueDate: extras.financeFirstDueDate,
        labelId,
        position: maxPosition === null ? 0 : maxPosition + 1,
      })
      .returning();

    if (createdProject) {
      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await tx.insert(columnTable).values({
          projectId: createdProject.id,
          name: col.name,
          slug: col.slug,
          position: col.position,
          isFinal: col.isFinal,
        });
      }
    }

    if (!createdProject) return createdProject;

    // Devolve com a etiqueta já resolvida (join), em vez de repetir a lógica
    // de resposta aqui.
    return tx.query.projectTable.findFirst({
      where: eq(projectTable.id, createdProject.id),
      with: { label: true },
    });
  });
}

export default createProject;
