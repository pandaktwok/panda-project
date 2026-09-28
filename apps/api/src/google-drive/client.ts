// Cliente mínimo do Google (OAuth + Drive v3) sobre fetch. O fetch é
// substituível (testes usam um Google simulado). Nada aqui registra tokens.

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
let googleFetch: FetchLike = (input, init) => fetch(input, init);

/** Só para testes: troca o fetch usado para falar com o Google. */
export function setGoogleFetch(next: FetchLike | null) {
  googleFetch = next ?? ((input, init) => fetch(input, init));
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Token de renovação/credenciais recusados: precisa reconectar. */
    readonly authInvalid = false,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 60_000;

async function call(input: string, init: RequestInit = {}) {
  try {
    return await googleFetch(input, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GoogleApiError("Não foi possível falar com o Google.", 0);
  }
}

/** Mensagem curta do Google, sem repassar o corpo inteiro. */
async function failure(response: Response): Promise<GoogleApiError> {
  let detail = "";
  let code = "";
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string };
      error_description?: string;
    };
    code = typeof body.error === "string" ? body.error : "";
    detail =
      body.error_description ??
      (typeof body.error === "string" ? body.error : body.error?.message) ??
      "";
  } catch {
    // corpo sem JSON
  }
  const authInvalid =
    response.status === 401 ||
    /invalid_grant|invalid_client|unauthorized_client/i.test(code || detail);
  return new GoogleApiError(
    `Google respondeu ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
    response.status,
    authInvalid,
  );
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  // offline + consent: sem isso o Google não devolve o token de renovação.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

async function tokenRequest(body: Record<string, string>) {
  const response = await call("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as TokenResponse;
}

export function exchangeCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
}

export function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  });
}

/** Revoga o token no Google (melhor esforço; quem chama decide se ignora o erro). */
export async function revokeToken(token: string) {
  const response = await call("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok) throw await failure(response);
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const auth = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

export async function getAboutUser(accessToken: string) {
  const response = await call(
    `${DRIVE}/about?fields=${encodeURIComponent("user(emailAddress,displayName)")}`,
    { headers: auth(accessToken) },
  );
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as {
    user?: { emailAddress?: string; displayName?: string };
  };
  return { email: body.user?.emailAddress ?? null };
}

const escapeQuery = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Procura um item criado pelo app, pela marca guardada em appProperties. */
export async function findByAppProperty(
  accessToken: string,
  input: { key: string; value: string; parentId?: string; folder?: boolean },
): Promise<{ id: string } | null> {
  const clauses = [
    `appProperties has { key='${escapeQuery(input.key)}' and value='${escapeQuery(input.value)}' }`,
    "trashed = false",
  ];
  if (input.parentId)
    clauses.push(`'${escapeQuery(input.parentId)}' in parents`);
  if (input.folder) clauses.push(`mimeType = '${FOLDER_MIME}'`);
  const response = await call(
    `${DRIVE}/files?${new URLSearchParams({
      q: clauses.join(" and "),
      fields: "files(id)",
      pageSize: "1",
      spaces: "drive",
    })}`,
    { headers: auth(accessToken) },
  );
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { files?: Array<{ id: string }> };
  return body.files?.[0] ?? null;
}

export async function createFolder(
  accessToken: string,
  input: {
    name: string;
    parentId?: string;
    markKey: string;
    markValue: string;
  },
): Promise<{ id: string }> {
  const response = await call(`${DRIVE}/files?fields=id`, {
    method: "POST",
    headers: { ...auth(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      mimeType: FOLDER_MIME,
      ...(input.parentId ? { parents: [input.parentId] } : {}),
      appProperties: { [input.markKey]: input.markValue },
    }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as { id: string };
}

/** Confere que a pasta existe e não foi para a lixeira. */
export async function folderIsUsable(accessToken: string, folderId: string) {
  const response = await call(
    `${DRIVE}/files/${encodeURIComponent(folderId)}?fields=id,trashed`,
    { headers: auth(accessToken) },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { trashed?: boolean };
  return body.trashed !== true;
}

/** Envio resumível em uma única passada (aceita arquivos grandes). */
export async function uploadPdf(
  accessToken: string,
  input: {
    name: string;
    parentId: string;
    bytes: Uint8Array;
    markKey: string;
    markValue: string;
  },
): Promise<{ id: string }> {
  const start = await call(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      ...auth(accessToken),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/pdf",
      "X-Upload-Content-Length": String(input.bytes.byteLength),
    },
    body: JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      mimeType: "application/pdf",
      appProperties: { [input.markKey]: input.markValue },
    }),
  });
  if (!start.ok) throw await failure(start);
  const location = start.headers.get("location");
  if (!location) {
    throw new GoogleApiError("O Google não devolveu o endereço de envio.", 502);
  }
  const put = await call(location, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: input.bytes as BodyInit,
  });
  if (!put.ok) throw await failure(put);
  return (await put.json()) as { id: string };
}
