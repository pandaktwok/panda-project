import { z } from "../openapi";

export const aiConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    authorizedByName: z.string().nullable(),
    authorizedByEmail: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    status: z.enum(["active", "revoked", "expired"]),
    canPay: z.boolean(),
    canEdit: z.boolean(),
  })
  .openapi("AiConnection");

export const aiConnectionListSchema = z
  .object({
    mcpUrl: z.string().openapi({ description: "Endereço do MCP para copiar." }),
    connections: z.array(aiConnectionSchema),
  })
  .openapi("AiConnectionList");

export const aiActionSchema = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    connectionName: z.string(),
    action: z.string(),
    method: z.string(),
    path: z.string(),
    status: z.number().int(),
    projectId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("AiAction");

export const aiHistorySchema = z
  .object({ actions: z.array(aiActionSchema) })
  .openapi("AiHistory");

export const aiEligibilitySchema = z
  .object({ canAuthorize: z.boolean() })
  .openapi("AiEligibility");
