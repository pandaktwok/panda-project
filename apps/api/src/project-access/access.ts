// Permissão efetiva por projeto (Panda Project, Fase 7A).
//
// Regra única usada em TODOS os pontos da API:
//   - dono/administrador do workspace (ou administrador da instância) ignora a
//     tabela project_member_access: sempre vê e faz tudo;
//   - os demais: sem linha = padrão do papel (liberado); com linha, cada chave
//     (ver, registrar pagamentos, anexar) só RESTRINGE. A permissão do papel
//     (finance:pay, finance:attach...) continua valendo por cima, nas rotas.
// Projeto que o usuário não pode ver responde 404 (nunca 403), para não
// revelar que ele existe.

import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

export const PROJECT_ADMIN_ROLES = ["owner", "admin"] as const;

export type ProjectAccess = {
  workspaceId: string;
  /** Dono/administrador: nenhuma chave se aplica. */
  bypass: boolean;
  canView: boolean;
  canPay: boolean;
  canAttach: boolean;
};

export type ProjectKey = "pay" | "attach";

export const PROJECT_KEY_DENIED_MESSAGE: Record<ProjectKey, string> = {
  pay: "Você não tem permissão para registrar pagamentos neste projeto.",
  attach: "Você não tem permissão para anexar arquivos neste projeto.",
};

function isAdminRole(role: string | null | undefined) {
  return (
    role !== null &&
    role !== undefined &&
    (PROJECT_ADMIN_ROLES as readonly string[]).includes(role)
  );
}

/** Dono/administrador do workspace ou administrador da instância. */
export async function isWorkspaceAdminOrOwner(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      userRole: schema.userTable.role,
      memberRole: schema.workspaceUserTable.role,
    })
    .from(schema.userTable)
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(schema.workspaceUserTable.userId, schema.userTable.id),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row?.userRole === "admin" || isAdminRole(row?.memberRole);
}

/** Null quando o projeto não existe. */
export async function getProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  const [row] = await db
    .select({
      workspaceId: schema.projectTable.workspaceId,
      userRole: schema.userTable.role,
      memberRole: schema.workspaceUserTable.role,
      isMember: schema.workspaceUserTable.id,
      canView: schema.projectMemberAccessTable.canView,
      canPay: schema.projectMemberAccessTable.canPay,
      canAttach: schema.projectMemberAccessTable.canAttach,
    })
    .from(schema.projectTable)
    .leftJoin(schema.userTable, eq(schema.userTable.id, userId))
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(
          schema.workspaceUserTable.workspaceId,
          schema.projectTable.workspaceId,
        ),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .leftJoin(
      schema.projectMemberAccessTable,
      and(
        eq(schema.projectMemberAccessTable.projectId, schema.projectTable.id),
        eq(schema.projectMemberAccessTable.userId, userId),
      ),
    )
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  if (!row) return null;

  const bypass = row.userRole === "admin" || isAdminRole(row.memberRole);
  if (bypass) {
    return {
      workspaceId: row.workspaceId,
      bypass: true,
      canView: true,
      canPay: true,
      canAttach: true,
    };
  }
  // Quem nem é do workspace não vê o projeto.
  if (!row.isMember) {
    return {
      workspaceId: row.workspaceId,
      bypass: false,
      canView: false,
      canPay: false,
      canAttach: false,
    };
  }
  const canView = row.canView ?? true;
  return {
    workspaceId: row.workspaceId,
    bypass: false,
    canView,
    canPay: canView && (row.canPay ?? true),
    canAttach: canView && (row.canAttach ?? true),
  };
}

const notFound = () => new HTTPException(404, { message: "Not found" });

/** 404 se o projeto não existe OU o usuário não pode vê-lo. */
export async function assertProjectVisible(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const access = await getProjectAccess(userId, projectId);
  if (!access?.canView) throw notFound();
  return access;
}

/** 404 se não pode ver; 403 (mensagem em português) se falta a chave. */
export async function assertProjectKey(
  userId: string,
  projectId: string,
  key: ProjectKey,
): Promise<ProjectAccess> {
  const access = await assertProjectVisible(userId, projectId);
  const allowed = key === "pay" ? access.canPay : access.canAttach;
  if (!allowed) {
    throw new HTTPException(403, { message: PROJECT_KEY_DENIED_MESSAGE[key] });
  }
  return access;
}

/**
 * Projetos do workspace que o usuário NÃO pode ver (lista curta). Vazia para
 * dono/administrador. Use com notInArray(coluna, ids) nas consultas de lista.
 */
export async function hiddenProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  if (await isWorkspaceAdminOrOwner(userId, workspaceId)) return [];
  const rows = await db
    .select({ projectId: schema.projectMemberAccessTable.projectId })
    .from(schema.projectMemberAccessTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.projectMemberAccessTable.projectId),
    )
    .where(
      and(
        eq(schema.projectMemberAccessTable.userId, userId),
        eq(schema.projectMemberAccessTable.canView, false),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    );
  return rows.map((row) => row.projectId);
}

/** Igual a hiddenProjectIds, em todos os workspaces (usado por notificações). */
export async function hiddenProjectIdsForUser(
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      projectId: schema.projectMemberAccessTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
      userRole: schema.userTable.role,
      memberRole: schema.workspaceUserTable.role,
    })
    .from(schema.projectMemberAccessTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.projectMemberAccessTable.projectId),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.projectMemberAccessTable.userId),
    )
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(
          schema.workspaceUserTable.workspaceId,
          schema.projectTable.workspaceId,
        ),
        eq(
          schema.workspaceUserTable.userId,
          schema.projectMemberAccessTable.userId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.projectMemberAccessTable.userId, userId),
        eq(schema.projectMemberAccessTable.canView, false),
      ),
    );
  return rows
    .filter((row) => row.userRole !== "admin" && !isAdminRole(row.memberRole))
    .map((row) => row.projectId);
}

/** Dos ids recebidos, devolve só os que o usuário pode ver (mesmo workspace). */
export async function filterVisibleProjectIds(
  userId: string,
  projectIds: string[],
): Promise<Set<string>> {
  const visible = new Set<string>();
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return visible;
  const projects = await db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.projectTable)
    .where(inArray(schema.projectTable.id, unique));
  const hiddenByWorkspace = new Map<string, Set<string>>();
  for (const project of projects) {
    let hidden = hiddenByWorkspace.get(project.workspaceId);
    if (!hidden) {
      hidden = new Set(await hiddenProjectIds(userId, project.workspaceId));
      hiddenByWorkspace.set(project.workspaceId, hidden);
    }
    if (!hidden.has(project.id)) visible.add(project.id);
  }
  return visible;
}
