import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

export const AI_DISABLED_MESSAGE =
  "Desativado em Configurações > Conexão com IA";
export const AI_FORBIDDEN_MESSAGE =
  "A IA não pode alterar contas, permissões, usuários ou conexões.";
export const AI_AUTHORIZER_NOT_ADMIN_MESSAGE =
  "A pessoa que autorizou esta conexão deixou de ser administradora. Revogue e autorize de novo em Configurações > Conexão com IA.";
export const AI_ADMIN_ONLY_MESSAGE =
  "Somente administradores podem conectar a IA. Peça a um administrador para autorizar.";

export type AiRequestKind = "read" | "edit" | "pay" | "files" | "forbidden";

export type AiConnectionInfo = {
  id: string;
  name: string;
  userId: string;
  canPay: boolean;
  canEdit: boolean;
  authorizerIsAdmin: boolean;
};

const WORKSPACE_ADMIN_ROLES = ["owner", "admin"];

/** Administrador da instância ou dono/admin de algum workspace. */
export async function isAnyAdmin(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  if (user?.role === "admin") return true;
  const [member] = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        or(
          ...WORKSPACE_ADMIN_ROLES.map((role) =>
            eq(schema.workspaceUserTable.role, role),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(member);
}

/**
 * Conexão ativa dona desta sessão (ou null quando a sessão não é da IA).
 * O reconhecimento vem do próprio token, nunca de um cabeçalho do cliente.
 */
export async function findAiConnectionBySessionId(
  sessionId: string,
): Promise<AiConnectionInfo | null> {
  const [row] = await db
    .select({
      id: schema.aiConnectionTable.id,
      name: schema.aiConnectionTable.name,
      userId: schema.aiConnectionTable.authorizedByUserId,
      canPay: schema.aiConnectionTable.canPay,
      canEdit: schema.aiConnectionTable.canEdit,
      revokedAt: schema.aiConnectionTable.revokedAt,
    })
    .from(schema.aiConnectionTable)
    .where(eq(schema.aiConnectionTable.sessionId, sessionId))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return {
    id: row.id,
    name: row.name,
    userId: row.userId,
    canPay: row.canPay,
    canEdit: row.canEdit,
    authorizerIsAdmin: await isAnyAdmin(row.userId),
  };
}

/** Mesma busca, a partir do valor do token (sessão) enviado no Authorization. */
export async function findAiConnectionByToken(
  token: string,
): Promise<AiConnectionInfo | null> {
  const [session] = await db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.token, token))
    .limit(1);
  if (!session) return null;
  return findAiConnectionBySessionId(session.id);
}

function normalizePath(path: string) {
  return path.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
}

/**
 * Leitura, edição ou pagamento. Tudo que não for reconhecido como leitura é
 * edição: na dúvida, a chave "IA pode editar" decide.
 */
export function classifyAiRequest(
  method: string,
  rawPath: string,
): AiRequestKind {
  const path = normalizePath(rawPath);
  const verb = method.toUpperCase();
  const isRead = verb === "GET" || verb === "HEAD" || verb === "OPTIONS";

  if (path === "/ai-connection" || path.startsWith("/ai-connection/")) {
    return "forbidden";
  }
  if (path === "/google-drive" || path.startsWith("/google-drive/")) {
    return "forbidden";
  }
  if (path === "/project-access" || path.startsWith("/project-access/")) {
    return isRead ? "read" : "forbidden";
  }
  if (path.startsWith("/auth/")) {
    const allowed = ["/auth/get-session", "/auth/organization/list"];
    return isRead && allowed.includes(path) ? "read" : "forbidden";
  }
  if (verb === "POST") {
    if (/^\/project-finance\/[^/]+\/save$/.test(path)) return "pay";
    if (/^\/project-finance\/installments\/[^/]+\/undo$/.test(path)) {
      return "pay";
    }
    if (/^\/project-finance\/[^/]+\/files$/.test(path)) return "files";
  }
  return isRead ? "read" : "edit";
}

export function assertAiRequestAllowed(
  connection: AiConnectionInfo,
  kind: AiRequestKind,
): void {
  if (kind === "forbidden") {
    throw new HTTPException(403, { message: AI_FORBIDDEN_MESSAGE });
  }
  if (!connection.authorizerIsAdmin) {
    throw new HTTPException(403, {
      message: AI_AUTHORIZER_NOT_ADMIN_MESSAGE,
    });
  }
  if (kind === "read") return;
  const allowed =
    kind === "pay"
      ? connection.canPay
      : kind === "edit"
        ? connection.canEdit
        : connection.canPay || connection.canEdit;
  if (!allowed) {
    throw new HTTPException(403, { message: AI_DISABLED_MESSAGE });
  }
}

/** Marca o uso, no máximo uma vez a cada 30 segundos por conexão. */
export async function touchAiConnection(connectionId: string) {
  await db
    .update(schema.aiConnectionTable)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(schema.aiConnectionTable.id, connectionId),
        or(
          isNull(schema.aiConnectionTable.lastUsedAt),
          sql`${schema.aiConnectionTable.lastUsedAt} < now() - interval '30 seconds'`,
        ),
      ),
    );
}

function projectIdFromPath(rawPath: string): string | undefined {
  const path = normalizePath(rawPath);
  return (
    path.match(
      /^\/project-finance\/(?!tags\/|lines\/|installments\/)([^/]+)/,
    )?.[1] ?? path.match(/^\/project\/([^/]+)/)?.[1]
  );
}

const ACTION_LABELS: Array<[RegExp, string, string]> = [
  [/^\/project-finance\/[^/]+\/save$/, "POST", "Registrou pagamento(s)"],
  [
    /^\/project-finance\/installments\/[^/]+\/undo$/,
    "POST",
    "Desfez pagamento",
  ],
  [/^\/project-finance\/[^/]+\/files$/, "POST", "Enviou arquivo do financeiro"],
  [/^\/project-finance\/[^/]+\/files\/[^/]+$/, "DELETE", "Apagou arquivo"],
  [
    /^\/project-finance\/[^/]+\/settings$/,
    "PUT",
    "Alterou total/meses/1ª parcela",
  ],
  [
    /^\/project-finance\/[^/]+\/settings$/,
    "PATCH",
    "Alterou total/meses/1ª parcela",
  ],
  [/^\/project-finance\/[^/]+\/tags$/, "POST", "Criou tag"],
  [/^\/project-finance\/tags\/[^/]+$/, "PUT", "Editou tag"],
  [/^\/project-finance\/tags\/[^/]+$/, "PATCH", "Editou tag"],
  [/^\/project-finance\/tags\/[^/]+$/, "DELETE", "Apagou tag"],
  [/^\/project-finance\/[^/]+\/lines$/, "POST", "Criou linha"],
  [/^\/project-finance\/lines\/[^/]+$/, "PUT", "Editou linha"],
  [/^\/project-finance\/lines\/[^/]+$/, "PATCH", "Editou linha"],
  [/^\/project-finance\/lines\/[^/]+$/, "DELETE", "Apagou linha"],
];

export function describeAiAction(method: string, rawPath: string): string {
  const path = normalizePath(rawPath);
  const verb = method.toUpperCase();
  const hit = ACTION_LABELS.find(
    ([pattern, m]) => m === verb && pattern.test(path),
  );
  if (hit) return hit[2];
  const kindLabel =
    verb === "DELETE" ? "Apagou" : verb === "POST" ? "Criou" : "Alterou";
  return `${kindLabel} (${verb} ${path})`;
}

export async function recordAiAction(
  connection: AiConnectionInfo,
  entry: { method: string; path: string; status: number; projectId?: string },
) {
  try {
    await db.insert(schema.aiActionLogTable).values({
      connectionId: connection.id,
      connectionName: connection.name,
      userId: connection.userId,
      projectId: entry.projectId ?? null,
      action: describeAiAction(entry.method, entry.path),
      method: entry.method.toUpperCase(),
      path: normalizePath(entry.path).slice(0, 300),
      status: entry.status,
    });
  } catch (error) {
    // O histórico nunca derruba a ação em si.
    console.error("Failed to record AI action:", error);
  }
}

/** Middleware colocado depois da autenticação: registra ações de escrita da IA. */
export async function aiAuditMiddleware(
  c: Context,
  next: () => Promise<void>,
): Promise<void> {
  await next();
  const connection = c.get("aiConnection") as AiConnectionInfo | undefined;
  if (!connection) return;
  const kind = classifyAiRequest(c.req.method, c.req.path);
  if (kind === "read") return;
  await recordAiAction(connection, {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    projectId: projectIdFromPath(c.req.path),
  });
}

/** Chamado pela autenticação quando a sessão pertence a uma conexão de IA. */
export async function applyAiConnection(
  c: Context,
  sessionId: string,
): Promise<void> {
  const connection = await findAiConnectionBySessionId(sessionId);
  if (!connection) return;
  c.set("aiConnection", connection);
  const kind = classifyAiRequest(c.req.method, c.req.path);
  try {
    assertAiRequestAllowed(connection, kind);
  } catch (error) {
    await recordAiAction(connection, {
      method: c.req.method,
      path: c.req.path,
      status: 403,
      projectId: projectIdFromPath(c.req.path),
    });
    throw error;
  }
  await touchAiConnection(connection.id);
}
