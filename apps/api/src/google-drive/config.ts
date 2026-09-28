import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { decryptGoogleSecret, encryptGoogleSecret } from "./crypto";

const ID = "instance";

const publicApiUrl = () =>
  (process.env.KANEO_API_URL || "http://localhost:1337")
    .replace(/\/api\/?$/, "")
    .replace(/\/+$/, "");

/** Endereço de retorno EXATO que precisa estar no cliente OAuth do Google. */
export const getRedirectUri = () =>
  `${publicApiUrl()}/api/google-drive/callback`;

export type DriveConfigRow = typeof schema.googleDriveConfigTable.$inferSelect;

export async function getConfigRow(): Promise<DriveConfigRow | null> {
  const [row] = await db
    .select()
    .from(schema.googleDriveConfigTable)
    .where(eq(schema.googleDriveConfigTable.id, ID))
    .limit(1);
  return row ?? null;
}

async function upsert(values: Partial<DriveConfigRow>) {
  await db
    .insert(schema.googleDriveConfigTable)
    .values({ id: ID, ...values })
    .onConflictDoUpdate({
      target: schema.googleDriveConfigTable.id,
      set: values,
    });
}

/** Segredo nunca sai daqui para a API: só dentro do servidor. */
export async function getCredentials() {
  const row = await getConfigRow();
  if (!row?.clientId) return null;
  const clientSecret = decryptGoogleSecret(row.clientSecretEnc);
  if (!clientSecret) return null;
  return {
    clientId: row.clientId,
    clientSecret,
    refreshToken: decryptGoogleSecret(row.refreshTokenEnc),
    rootFolderId: row.rootFolderId,
    status: row.status,
  };
}

export async function saveCredentials(input: {
  clientId: string;
  clientSecret?: string;
}) {
  const row = await getConfigRow();
  const clientChanged =
    row?.clientId !== input.clientId || input.clientSecret !== undefined;
  await upsert({
    clientId: input.clientId,
    ...(input.clientSecret !== undefined
      ? { clientSecretEnc: encryptGoogleSecret(input.clientSecret) }
      : {}),
    // O token pertence ao cliente OAuth anterior: trocar as credenciais desliga.
    ...(clientChanged && row?.refreshTokenEnc
      ? {
          refreshTokenEnc: null,
          accountEmail: null,
          rootFolderId: null,
          status: "disconnected",
          lastError: null,
          connectedAt: null,
        }
      : {}),
  });
}

export async function markConnected(input: {
  refreshToken: string;
  email: string | null;
  rootFolderId: string;
  userId: string;
}) {
  await upsert({
    refreshTokenEnc: encryptGoogleSecret(input.refreshToken),
    accountEmail: input.email,
    rootFolderId: input.rootFolderId,
    status: "connected",
    lastError: null,
    connectedAt: new Date(),
    connectedBy: input.userId,
  });
}

export async function markError(message: string) {
  await upsert({ status: "error", lastError: message.slice(0, 300) });
}

export async function markHealthy() {
  const row = await getConfigRow();
  if (row?.status === "error" && row.refreshTokenEnc) {
    await upsert({ status: "connected", lastError: null });
  }
}

export async function clearConnection() {
  await upsert({
    refreshTokenEnc: null,
    accountEmail: null,
    rootFolderId: null,
    status: "disconnected",
    lastError: null,
    connectedAt: null,
    connectedBy: null,
  });
}
