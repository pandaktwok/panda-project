import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { ensureProjectLabel } from "../label";

async function updateProject(
  id: string,
  name: string,
  icon: string,
  slug: string,
  description: string,
  isPublic: boolean,
  workspaceId: string,
  canShare: boolean,
  // undefined: mantém a etiqueta atual. null: remove. string: reaproveita/cria.
  label?: string | null,
) {
  return db.transaction(async (tx) => {
    const [existingProject] = await tx
      .select()
      .from(projectTable)
      .where(
        and(eq(projectTable.id, id), eq(projectTable.workspaceId, workspaceId)),
      );

    if (!existingProject) {
      throw new HTTPException(404, {
        message:
          "Project doesn't exist or doesn't belong to the specified workspace",
      });
    }

    if (isPublic !== existingProject.isPublic && !canShare) {
      throw new HTTPException(403, {
        message:
          "Changing project visibility requires the project:share permission",
      });
    }

    const labelId =
      label === undefined
        ? existingProject.labelId
        : label === null
          ? null
          : await ensureProjectLabel(tx, workspaceId, label);

    await tx
      .update(projectTable)
      .set({
        name,
        icon,
        slug,
        description,
        isPublic,
        labelId,
      })
      .where(eq(projectTable.id, id));

    return tx.query.projectTable.findFirst({
      where: eq(projectTable.id, id),
      with: { label: true },
    });
  });
}

export default updateProject;
