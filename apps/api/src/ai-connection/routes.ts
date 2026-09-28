import { desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { AI_ADMIN_ONLY_MESSAGE, isAnyAdmin } from "./access";
import {
  aiConnectionListSchema,
  aiConnectionSchema,
  aiEligibilitySchema,
  aiHistorySchema,
} from "./response";
import {
  aiConnectionIdParam,
  aiHistoryQuery,
  updateAiConnectionBody,
} from "./schema";

const TAGS = ["AI Connection"];

const publicApiUrl = () =>
  (process.env.KANEO_API_URL || "http://localhost:1337")
    .replace(/\/api\/?$/, "")
    .replace(/\/+$/, "");

async function assertAdmin(userId: string) {
  if (!(await isAnyAdmin(userId))) {
    throw new HTTPException(403, { message: AI_ADMIN_ONLY_MESSAGE });
  }
}

async function loadConnection(id: string) {
  const [row] = await selectAll(id);
  return row ? serialize(row) : null;
}

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof selectAll>>>[number];

function selectAll(id?: string) {
  return db
    .select({
      id: schema.aiConnectionTable.id,
      name: schema.aiConnectionTable.name,
      canPay: schema.aiConnectionTable.canPay,
      canEdit: schema.aiConnectionTable.canEdit,
      createdAt: schema.aiConnectionTable.createdAt,
      lastUsedAt: schema.aiConnectionTable.lastUsedAt,
      revokedAt: schema.aiConnectionTable.revokedAt,
      authorizedByName: schema.userTable.name,
      authorizedByEmail: schema.userTable.email,
      expiresAt: schema.sessionTable.expiresAt,
    })
    .from(schema.aiConnectionTable)
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.aiConnectionTable.authorizedByUserId),
    )
    .leftJoin(
      schema.sessionTable,
      eq(schema.sessionTable.id, schema.aiConnectionTable.sessionId),
    )
    .where(id ? eq(schema.aiConnectionTable.id, id) : undefined)
    .orderBy(desc(schema.aiConnectionTable.createdAt));
}

function serialize(row: ConnectionRow) {
  const expired = !row.expiresAt || row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id,
    name: row.name,
    authorizedByName: row.authorizedByName,
    authorizedByEmail: row.authorizedByEmail,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    status: row.revokedAt
      ? ("revoked" as const)
      : expired
        ? ("expired" as const)
        : ("active" as const),
    canPay: row.canPay,
    canEdit: row.canEdit,
  };
}

const eligibilityRoute = createRoute({
  method: "get",
  operationId: "getAiConnectionEligibility",
  path: "/eligibility",
  tags: TAGS,
  summary: "Can the current user authorize the AI?",
  description:
    "Only instance administrators and workspace owners/administrators can authorize the AI to connect. The consent screen uses this to explain why a regular user cannot continue.",
  responses: { 200: jsonResponse("Eligibility", aiEligibilitySchema) },
});

const listRoute = createRoute({
  method: "get",
  operationId: "listAiConnections",
  path: "/",
  tags: TAGS,
  summary: "List AI connections",
  description:
    "Connections authorized for the AI (MCP), with the MCP address, last use and the two switches. Administrators only.",
  responses: {
    200: jsonResponse("Connections", aiConnectionListSchema),
    403: errorResponse("Not an administrator"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  operationId: "updateAiConnection",
  path: "/{id}",
  tags: TAGS,
  summary: "Change an AI connection",
  description:
    'Turns "IA pode registrar pagamentos" and "IA pode editar" on or off, or renames the connection. Takes effect on the next call the AI makes. Administrators only.',
  request: {
    params: aiConnectionIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAiConnectionBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated connection", aiConnectionSchema),
    403: errorResponse("Not an administrator"),
    404: errorResponse("Connection not found"),
  },
});

const revokeRoute = createRoute({
  method: "post",
  operationId: "revokeAiConnection",
  path: "/{id}/revoke",
  tags: TAGS,
  summary: "Revoke an AI connection",
  description:
    "Cuts the AI's access immediately: the connection's session is deleted, so its very next call gets 401. Administrators only.",
  request: { params: aiConnectionIdParam },
  responses: {
    200: jsonResponse("The revoked connection", aiConnectionSchema),
    403: errorResponse("Not an administrator"),
    404: errorResponse("Connection not found"),
  },
});

const historyRoute = createRoute({
  method: "get",
  operationId: "listAiActions",
  path: "/history",
  tags: TAGS,
  summary: "History of actions made by the AI",
  description:
    "Latest changes attempted by AI connections (edits, payments and refused attempts), with the connection name. Administrators only.",
  request: { query: aiHistoryQuery },
  responses: {
    200: jsonResponse("Latest actions", aiHistorySchema),
    403: errorResponse("Not an administrator"),
  },
});

const aiConnection = apiRouter()
  .openapi(eligibilityRoute, async (c) =>
    c.json({ canAuthorize: await isAnyAdmin(c.get("userId")) }, 200),
  )
  .openapi(historyRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const { limit } = c.req.valid("query");
    const rows = await db
      .select()
      .from(schema.aiActionLogTable)
      .orderBy(desc(schema.aiActionLogTable.createdAt))
      .limit(limit ?? 50);
    return c.json(
      {
        actions: rows.map((row) => ({
          id: row.id,
          connectionId: row.connectionId,
          connectionName: row.connectionName,
          action: row.action,
          method: row.method,
          path: row.path,
          status: row.status,
          projectId: row.projectId,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      200,
    );
  })
  .openapi(listRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const rows = await selectAll();
    return c.json(
      {
        mcpUrl: `${publicApiUrl()}/api/mcp`,
        connections: rows.map(serialize),
      },
      200,
    );
  })
  .openapi(updateRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const updated = await db
      .update(schema.aiConnectionTable)
      .set({
        ...(body.canPay !== undefined && { canPay: body.canPay }),
        ...(body.canEdit !== undefined && { canEdit: body.canEdit }),
        ...(body.name !== undefined && { name: body.name }),
      })
      .where(eq(schema.aiConnectionTable.id, id))
      .returning({ id: schema.aiConnectionTable.id });
    if (!updated.length) {
      throw new HTTPException(404, { message: "Conexão não encontrada." });
    }
    const connection = await loadConnection(id);
    if (!connection) {
      throw new HTTPException(404, { message: "Conexão não encontrada." });
    }
    return c.json(connection, 200);
  })
  .openapi(revokeRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const { id } = c.req.valid("param");
    const [existing] = await db
      .select({
        sessionId: schema.aiConnectionTable.sessionId,
        revokedAt: schema.aiConnectionTable.revokedAt,
      })
      .from(schema.aiConnectionTable)
      .where(eq(schema.aiConnectionTable.id, id))
      .limit(1);
    if (!existing) {
      throw new HTTPException(404, { message: "Conexão não encontrada." });
    }
    await db.transaction(async (tx) => {
      if (!existing.revokedAt) {
        await tx
          .update(schema.aiConnectionTable)
          .set({ revokedAt: new Date() })
          .where(eq(schema.aiConnectionTable.id, id));
      }
      await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.id, existing.sessionId));
    });
    const connection = await loadConnection(id);
    if (!connection) {
      throw new HTTPException(404, { message: "Conexão não encontrada." });
    }
    return c.json(connection, 200);
  });

export default aiConnection;
