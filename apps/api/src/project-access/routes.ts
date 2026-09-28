import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { disconnectUserFromProject } from "../ws";
import { isWorkspaceAdminOrOwner, PROJECT_ADMIN_ROLES } from "./access";
import { projectAccessEntrySchema, projectAccessListSchema } from "./response";
import {
  projectAccessMemberParams,
  projectAccessParams,
  updateProjectAccessBody,
} from "./schema";

async function assertAdmin(userId: string, workspaceId: string) {
  if (!(await isWorkspaceAdminOrOwner(userId, workspaceId))) {
    throw new HTTPException(403, {
      message: "Somente administradores gerenciam o acesso aos projetos.",
    });
  }
}

async function listEntries(projectId: string, workspaceId: string) {
  const rows = await db
    .select({
      userId: schema.userTable.id,
      name: schema.userTable.name,
      email: schema.userTable.email,
      role: schema.workspaceUserTable.role,
      canView: schema.projectMemberAccessTable.canView,
      canPay: schema.projectMemberAccessTable.canPay,
      canAttach: schema.projectMemberAccessTable.canAttach,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.workspaceUserTable.userId),
    )
    .leftJoin(
      schema.projectMemberAccessTable,
      and(
        eq(schema.projectMemberAccessTable.userId, schema.userTable.id),
        eq(schema.projectMemberAccessTable.projectId, projectId),
      ),
    )
    .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));

  return rows
    .map((row) => {
      const locked = (PROJECT_ADMIN_ROLES as readonly string[]).includes(
        row.role,
      );
      const canView = locked || (row.canView ?? true);
      return {
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        locked,
        canView,
        canPay: locked || (canView && (row.canPay ?? true)),
        canAttach: locked || (canView && (row.canAttach ?? true)),
      };
    })
    .sort(
      (a, b) =>
        Number(b.locked) - Number(a.locked) || a.name.localeCompare(b.name),
    );
}

const listRoute = createRoute({
  method: "get",
  operationId: "getProjectAccess",
  path: "/{projectId}",
  tags: ["Project Access"],
  summary: "List per-project access",
  description:
    "Lists every workspace member with the three project keys (view, register payments, attach files). Owners and administrators are always fully allowed. Only administrators can call this.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectAccessParams },
  responses: {
    200: jsonResponse("Members and their keys", projectAccessListSchema),
    403: errorResponse("Not an administrator"),
    404: errorResponse("Project not found"),
  },
});

const updateRoute = createRoute({
  method: "put",
  operationId: "updateProjectAccess",
  path: "/{projectId}/{userId}",
  tags: ["Project Access"],
  summary: "Set a member's keys for a project",
  description:
    "Sets the three keys for one member. Turning View off also turns the other two off. All keys on removes the restriction (the default). Owners and administrators cannot be restricted. Only administrators can call this.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: {
    params: projectAccessMemberParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectAccessBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated entry", projectAccessEntrySchema),
    400: errorResponse("The target is an owner/administrator or not a member"),
    403: errorResponse("Not an administrator"),
    404: errorResponse("Project not found"),
  },
});

const projectAccess = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    await assertAdmin(c.get("userId"), workspaceId);
    return c.json({ members: await listEntries(projectId, workspaceId) }, 200);
  })
  .openapi(updateRoute, async (c) => {
    const { projectId, userId } = c.req.valid("param");
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const actorId = c.get("userId");
    await assertAdmin(actorId, workspaceId);

    const entries = await listEntries(projectId, workspaceId);
    const target = entries.find((entry) => entry.userId === userId);
    if (!target) {
      throw new HTTPException(400, {
        message: "A pessoa não é membro deste workspace.",
      });
    }
    if (target.locked) {
      throw new HTTPException(400, {
        message: "Administradores sempre têm acesso total aos projetos.",
      });
    }

    const canView = body.canView;
    const canPay = canView && body.canPay;
    const canAttach = canView && body.canAttach;

    if (canView && canPay && canAttach) {
      // Tudo ligado é o padrão do papel: sem linha.
      await db
        .delete(schema.projectMemberAccessTable)
        .where(
          and(
            eq(schema.projectMemberAccessTable.projectId, projectId),
            eq(schema.projectMemberAccessTable.userId, userId),
          ),
        );
    } else {
      await db
        .insert(schema.projectMemberAccessTable)
        .values({
          projectId,
          userId,
          canView,
          canPay,
          canAttach,
          updatedBy: actorId,
        })
        .onConflictDoUpdate({
          target: [
            schema.projectMemberAccessTable.projectId,
            schema.projectMemberAccessTable.userId,
          ],
          set: { canView, canPay, canAttach, updatedBy: actorId },
        });
    }

    // Sem "Ver": derruba a conexão ao vivo dessa pessoa neste projeto.
    if (!canView) disconnectUserFromProject(projectId, userId);

    return c.json({ ...target, canView, canPay, canAttach }, 200);
  });

export default projectAccess;
