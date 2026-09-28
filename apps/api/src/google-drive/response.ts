import { z } from "../openapi";

// Nada aqui devolve segredo, token ou o texto cru da resposta do Google.
export const driveStatusSchema = z
  .object({
    status: z.enum(["disconnected", "connected", "error"]),
    hasCredentials: z.boolean(),
    clientId: z.string().nullable(),
    hasClientSecret: z.boolean(),
    accountEmail: z.string().nullable(),
    lastError: z.string().nullable(),
    connectedAt: z.string().nullable(),
    redirectUri: z.string().openapi({
      description: "Endereço de retorno exato a cadastrar no Google Cloud.",
    }),
    secretsKeyConfigured: z.boolean(),
    queue: z.object({
      pending: z.number().int(),
      copied: z.number().int(),
      failed: z.number().int(),
    }),
    open: z.array(
      z.object({
        assetId: z.string(),
        filename: z.string(),
        projectName: z.string(),
        status: z.enum(["pending", "copied", "failed"]),
        attempts: z.number().int(),
        lastError: z.string().nullable(),
        nextAttemptAt: z.string(),
      }),
    ),
  })
  .openapi("GoogleDriveStatus");

export const driveConnectSchema = z
  .object({ url: z.string() })
  .openapi("GoogleDriveConnect");

export const driveTestSchema = z
  .object({ ok: z.boolean(), message: z.string() })
  .openapi("GoogleDriveTest");

export const driveBackfillSchema = z
  .object({ queued: z.number().int() })
  .openapi("GoogleDriveBackfill");

export const driveRetrySchema = z
  .object({ retried: z.boolean() })
  .openapi("GoogleDriveRetry");
