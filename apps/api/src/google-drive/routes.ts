import { HTTPException } from "hono/http-exception";
import { isAnyAdmin } from "../ai-connection/access";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  buildAuthUrl,
  exchangeCode,
  folderIsUsable,
  GoogleApiError,
  getAboutUser,
  revokeToken,
} from "./client";
import {
  clearConnection,
  getConfigRow,
  getCredentials,
  getRedirectUri,
  markConnected,
  markError,
  saveCredentials,
} from "./config";
import {
  isSecretsKeyConfigured,
  SecretsKeyMissingError,
  signOAuthState,
  verifyOAuthState,
} from "./crypto";
import {
  backfillOldPayments,
  createRootFolder,
  forgetAccessToken,
  getAccessToken,
  listOpenCopies,
  queueSummary,
  retryCopy,
} from "./mirror";
import {
  driveBackfillSchema,
  driveConnectSchema,
  driveRetrySchema,
  driveStatusSchema,
  driveTestSchema,
} from "./response";
import { callbackQuery, retryCopyBody, saveCredentialsBody } from "./schema";

const TAGS = ["Google Drive"];
const ADMIN_ONLY = "Só administradores podem configurar o Google Drive.";

async function assertAdmin(userId: string) {
  if (!(await isAnyAdmin(userId))) {
    throw new HTTPException(403, { message: ADMIN_ONLY });
  }
}

const clientUrl = () =>
  (process.env.KANEO_CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");

const settingsUrl = (result: "connected" | "error") =>
  `${clientUrl()}/dashboard/settings/workspace/google-drive?drive=${result}`;

async function buildStatus() {
  const row = await getConfigRow();
  const [queue, open] = await Promise.all([queueSummary(), listOpenCopies()]);
  return {
    status: (row?.status ?? "disconnected") as
      | "disconnected"
      | "connected"
      | "error",
    hasCredentials: Boolean(row?.clientId && row.clientSecretEnc),
    clientId: row?.clientId ?? null,
    hasClientSecret: Boolean(row?.clientSecretEnc),
    accountEmail: row?.accountEmail ?? null,
    lastError: row?.lastError ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    redirectUri: getRedirectUri(),
    secretsKeyConfigured: isSecretsKeyConfigured(),
    queue,
    open: open.map((item) => ({
      assetId: item.assetId,
      filename: item.filename,
      projectName: item.projectName,
      status: item.status as "pending" | "copied" | "failed",
      attempts: item.attempts,
      lastError: item.lastError,
      nextAttemptAt: item.nextAttemptAt.toISOString(),
    })),
  };
}

const adminErrors = { 403: errorResponse("Not an administrator") };

const statusRoute = createRoute({
  method: "get",
  operationId: "getGoogleDriveStatus",
  path: "/",
  tags: TAGS,
  summary: "Google Drive mirror status",
  description:
    "Connection state, the exact redirect address to register in Google Cloud and the copy queue. Never returns the client secret or tokens. Administrators only.",
  responses: { 200: jsonResponse("Status", driveStatusSchema), ...adminErrors },
});

const credentialsRoute = createRoute({
  method: "put",
  operationId: "saveGoogleDriveCredentials",
  path: "/credentials",
  tags: TAGS,
  summary: "Save the Google OAuth client",
  description:
    "Stores the OAuth client ID and secret (the secret is encrypted). Changing them disconnects the current account. Administrators only.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: saveCredentialsBody } },
    },
  },
  responses: {
    200: jsonResponse("Status", driveStatusSchema),
    400: errorResponse("Missing secret or encryption key"),
    ...adminErrors,
  },
});

const connectRoute = createRoute({
  method: "post",
  operationId: "connectGoogleDrive",
  path: "/connect",
  tags: TAGS,
  summary: "Start the Google sign-in",
  description:
    "Returns the Google consent address. The person is sent back to the callback route. Administrators only.",
  responses: {
    200: jsonResponse("Consent address", driveConnectSchema),
    400: errorResponse("Credentials not saved"),
    ...adminErrors,
  },
});

const callbackRoute = createRoute({
  method: "get",
  operationId: "googleDriveCallback",
  path: "/callback",
  tags: TAGS,
  summary: "Google sign-in return",
  description:
    "Google sends the browser here after consent. Exchanges the code, stores the refresh token encrypted and redirects to the settings page.",
  request: { query: callbackQuery },
  responses: {
    302: { description: "Redirect to the Google Drive settings page" },
    ...adminErrors,
  },
});

const testRoute = createRoute({
  method: "post",
  operationId: "testGoogleDrive",
  path: "/test",
  tags: TAGS,
  summary: "Test the Google Drive connection",
  description:
    "Gets an access token and checks the root folder. Administrators only.",
  responses: { 200: jsonResponse("Result", driveTestSchema), ...adminErrors },
});

const disconnectRoute = createRoute({
  method: "post",
  operationId: "disconnectGoogleDrive",
  path: "/disconnect",
  tags: TAGS,
  summary: "Disconnect Google Drive",
  description:
    "Revokes the token at Google and wipes it here. Copies already in Drive stay there; payments keep working. Administrators only.",
  responses: { 200: jsonResponse("Status", driveStatusSchema), ...adminErrors },
});

const backfillRoute = createRoute({
  method: "post",
  operationId: "backfillGoogleDrive",
  path: "/backfill",
  tags: TAGS,
  summary: "Copy old payments to Drive",
  description:
    "Queues every paid installment PDF that is not in Drive yet. Administrators only.",
  responses: {
    200: jsonResponse("Queued", driveBackfillSchema),
    ...adminErrors,
  },
});

const retryRoute = createRoute({
  method: "post",
  operationId: "retryGoogleDriveCopy",
  path: "/retry",
  tags: TAGS,
  summary: "Retry a copy",
  description:
    "Puts a pending or failed copy back in the queue. Administrators only.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: retryCopyBody } },
    },
  },
  responses: { 200: jsonResponse("Result", driveRetrySchema), ...adminErrors },
});

const googleDrive = apiRouter()
  .openapi(statusRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    return c.json(await buildStatus(), 200);
  })
  .openapi(credentialsRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    if (!isSecretsKeyConfigured()) {
      throw new HTTPException(400, {
        message:
          "Falta a chave de criptografia (NOTIFICATION_SECRET_ENCRYPTION_KEY ou APP_SECRETS_KEY) no servidor.",
      });
    }
    const body = c.req.valid("json");
    const existing = await getConfigRow();
    if (!body.clientSecret && !existing?.clientSecretEnc) {
      throw new HTTPException(400, {
        message: "Informe o segredo do cliente.",
      });
    }
    await saveCredentials({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    });
    return c.json(await buildStatus(), 200);
  })
  .openapi(connectRoute, async (c) => {
    const userId = c.get("userId");
    await assertAdmin(userId);
    const creds = await getCredentials();
    if (!creds) {
      throw new HTTPException(400, {
        message: "Salve o ID e o segredo do cliente antes de conectar.",
      });
    }
    return c.json(
      {
        url: buildAuthUrl({
          clientId: creds.clientId,
          redirectUri: getRedirectUri(),
          state: signOAuthState(userId),
        }),
      },
      200,
    );
  })
  .openapi(callbackRoute, async (c) => {
    const userId = c.get("userId");
    await assertAdmin(userId);
    const { code, state, error } = c.req.valid("query");
    if (error || !code || !verifyOAuthState(state, userId)) {
      return c.redirect(settingsUrl("error"), 302);
    }
    try {
      const creds = await getCredentials();
      if (!creds) return c.redirect(settingsUrl("error"), 302);
      const tokens = await exchangeCode({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        code,
        redirectUri: getRedirectUri(),
      });
      // Sem token de renovação não há como copiar depois: peça de novo.
      if (!tokens.refresh_token) {
        await markError(
          "O Google não devolveu a permissão permanente. Tente conectar de novo.",
        );
        return c.redirect(settingsUrl("error"), 302);
      }
      const about = await getAboutUser(tokens.access_token);
      const rootFolderId = await createRootFolder(tokens.access_token);
      forgetAccessToken();
      await markConnected({
        refreshToken: tokens.refresh_token,
        email: about.email,
        rootFolderId,
        userId,
      });
      return c.redirect(settingsUrl("connected"), 302);
    } catch (caught) {
      await markError(
        caught instanceof GoogleApiError
          ? caught.message
          : "Não foi possível concluir a conexão com o Google.",
      ).catch(() => undefined);
      return c.redirect(settingsUrl("error"), 302);
    }
  })
  .openapi(testRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    try {
      const { token, rootFolderId } = await getAccessToken();
      const about = await getAboutUser(token);
      const usable = await folderIsUsable(token, rootFolderId);
      if (!usable) {
        return c.json(
          {
            ok: false,
            message:
              "A pasta Panda Project não está mais no Drive (foi apagada ou está na lixeira).",
          },
          200,
        );
      }
      return c.json(
        {
          ok: true,
          message: `Conectado como ${about.email ?? "conta do Google"}.`,
        },
        200,
      );
    } catch (caught) {
      const message =
        caught instanceof GoogleApiError ||
        caught instanceof SecretsKeyMissingError
          ? caught.message
          : "Não foi possível testar a conexão.";
      if (caught instanceof GoogleApiError && caught.authInvalid) {
        forgetAccessToken();
        await markError("O Google recusou o acesso. Reconecte a conta.");
      }
      return c.json({ ok: false, message }, 200);
    }
  })
  .openapi(disconnectRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const creds = await getCredentials();
    if (creds?.refreshToken) {
      // Se o Google não responder, o token some daqui do mesmo jeito.
      await revokeToken(creds.refreshToken).catch(() => undefined);
    }
    forgetAccessToken();
    await clearConnection();
    return c.json(await buildStatus(), 200);
  })
  .openapi(backfillRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const row = await getConfigRow();
    if (!row || row.status === "disconnected") {
      throw new HTTPException(400, {
        message: "Conecte o Google Drive primeiro.",
      });
    }
    return c.json(await backfillOldPayments(), 200);
  })
  .openapi(retryRoute, async (c) => {
    await assertAdmin(c.get("userId"));
    const { assetId } = c.req.valid("json");
    return c.json({ retried: await retryCopy(assetId) }, 200);
  });

export default googleDrive;
