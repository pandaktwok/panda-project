import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// AES-256-GCM para os segredos do Google Drive. A chave vem de APP_SECRETS_KEY;
// se ela não existir, usa a NOTIFICATION_SECRET_ENCRYPTION_KEY (que a instalação
// padrão já exige), para não pedir mais uma variável a quem instala.

const PREFIX = "gcm:v1:";
const IV_BYTES = 12;

export class SecretsKeyMissingError extends Error {
  constructor() {
    super(
      "APP_SECRETS_KEY (ou NOTIFICATION_SECRET_ENCRYPTION_KEY) não está definida.",
    );
  }
}

function getKey(): Buffer {
  const raw = (
    process.env.APP_SECRETS_KEY ||
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||
    ""
  ).trim();
  if (!raw) throw new SecretsKeyMissingError();
  return createHash("sha256").update(raw).digest();
}

export function isSecretsKeyConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptGoogleSecret(value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return `${PREFIX}${[iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".")}`;
}

/** Devolve null se o valor não abre (chave trocada ou dado corrompido). */
export function decryptGoogleSecret(value: string | null): string | null {
  if (!value?.startsWith(PREFIX)) return null;
  const [iv, tag, data] = value
    .slice(PREFIX.length)
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

const STATE_TTL_MS = 10 * 60 * 1000;

const sign = (payload: string) =>
  createHmac("sha256", getKey())
    .update(`google-drive-state:${payload}`)
    .digest("base64url");

/** "state" do OAuth: amarra a volta do Google a quem clicou em Conectar. */
export function signOAuthState(userId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: userId,
      e: now + STATE_TTL_MS,
      n: randomBytes(8).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyOAuthState(
  state: string | undefined,
  userId: string,
  now = Date.now(),
): boolean {
  if (!state) return false;
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return false;
  }
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      u?: string;
      e?: number;
    };
    return data.u === userId && typeof data.e === "number" && data.e > now;
  } catch {
    return false;
  }
}
