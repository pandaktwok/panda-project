import { setGoogleFetch } from "../../../apps/api/src/google-drive/client";

// Google simulado em memória: OAuth (token/revoke) e Drive v3 (about, busca por
// appProperties, criar pasta, consultar pasta, envio resumível).

export type FakeItem = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  trashed: boolean;
  bytes?: Uint8Array;
};

export const fakeGoogle = {
  items: new Map<string, FakeItem>(),
  counter: 0,
  revoked: [] as string[],
  tokenRequests: 0,
  uploads: 0,
  refreshToken: "refresh-secreto-123",
  email: "financeiro@empresa.com",
  /** "down" = rede caída; "auth" = invalid_grant; null = normal */
  fault: null as null | "down" | "auth" | "upload",
  seenBodies: [] as string[],
};

export function resetFakeGoogle() {
  fakeGoogle.items.clear();
  fakeGoogle.counter = 0;
  fakeGoogle.revoked = [];
  fakeGoogle.tokenRequests = 0;
  fakeGoogle.uploads = 0;
  fakeGoogle.fault = null;
  fakeGoogle.seenBodies = [];
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function nextId(prefix: string) {
  fakeGoogle.counter += 1;
  return `${prefix}${fakeGoogle.counter}`;
}

function matches(item: FakeItem, q: string) {
  const prop = /appProperties has \{ key='([^']*)' and value='([^']*)' \}/.exec(
    q,
  );
  if (prop && item.appProperties[prop[1] as string] !== prop[2]) return false;
  if (q.includes("trashed = false") && item.trashed) return false;
  const parent = /'([^']*)' in parents/.exec(q);
  if (parent && !item.parents.includes(parent[1] as string)) return false;
  if (
    q.includes("mimeType =") &&
    item.mimeType !== "application/vnd.google-apps.folder"
  ) {
    return false;
  }
  return true;
}

async function handle(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  if (fakeGoogle.fault === "down") throw new Error("network down");

  if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
    fakeGoogle.tokenRequests += 1;
    const body = new URLSearchParams(String(init.body));
    fakeGoogle.seenBodies.push(body.toString());
    if (fakeGoogle.fault === "auth") {
      return json(
        {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        },
        400,
      );
    }
    if (body.get("grant_type") === "authorization_code") {
      if (body.get("code") !== "codigo-bom") {
        return json({ error: "invalid_grant" }, 400);
      }
      return json({
        access_token: "access-1",
        expires_in: 3600,
        refresh_token: fakeGoogle.refreshToken,
      });
    }
    if (body.get("refresh_token") !== fakeGoogle.refreshToken) {
      return json({ error: "invalid_grant" }, 400);
    }
    return json({
      access_token: `access-${fakeGoogle.tokenRequests}`,
      expires_in: 3600,
    });
  }

  if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") {
    fakeGoogle.revoked.push(
      new URLSearchParams(String(init.body)).get("token") ?? "",
    );
    return json({});
  }

  const headers = new Headers(init.headers);
  const bearer = headers.get("authorization");
  if (
    url.host === "www.googleapis.com" &&
    !url.pathname.startsWith("/upload/") &&
    !bearer
  ) {
    return json({ error: { message: "no auth" } }, 401);
  }
  if (fakeGoogle.fault === "auth" && bearer) {
    return json({ error: { message: "Invalid Credentials" } }, 401);
  }

  if (url.pathname === "/drive/v3/about") {
    return json({
      user: { emailAddress: fakeGoogle.email, displayName: "Financeiro" },
    });
  }

  if (url.pathname === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const files = [...fakeGoogle.items.values()]
      .filter((item) => matches(item, q))
      .slice(0, Number(url.searchParams.get("pageSize") ?? 100))
      .map((item) => ({ id: item.id }));
    return json({ files });
  }

  if (url.pathname === "/drive/v3/files" && method === "POST") {
    const body = JSON.parse(String(init.body)) as Partial<FakeItem>;
    const item: FakeItem = {
      id: nextId("folder-"),
      name: body.name ?? "",
      mimeType: body.mimeType ?? "",
      parents: body.parents ?? [],
      appProperties: body.appProperties ?? {},
      trashed: false,
    };
    fakeGoogle.items.set(item.id, item);
    return json({ id: item.id });
  }

  const single = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
  if (single && method === "GET") {
    const item = fakeGoogle.items.get(decodeURIComponent(single[1] as string));
    if (!item) return json({ error: { message: "not found" } }, 404);
    return json({ id: item.id, trashed: item.trashed });
  }

  if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
    if (fakeGoogle.fault === "upload")
      return json({ error: { message: "backend error" } }, 503);
    const body = JSON.parse(String(init.body)) as Partial<FakeItem>;
    const item: FakeItem = {
      id: nextId("file-"),
      name: body.name ?? "",
      mimeType: body.mimeType ?? "",
      parents: body.parents ?? [],
      appProperties: body.appProperties ?? {},
      trashed: false,
    };
    fakeGoogle.items.set(item.id, item);
    return new Response(null, {
      status: 200,
      headers: {
        location: `https://www.googleapis.com/upload/session/${item.id}`,
      },
    });
  }

  const session = /^\/upload\/session\/([^/]+)$/.exec(url.pathname);
  if (session && method === "PUT") {
    const item = fakeGoogle.items.get(session[1] as string);
    if (!item) return json({ error: { message: "gone" } }, 404);
    item.bytes = new Uint8Array(
      await new Response(init.body as BodyInit).arrayBuffer(),
    );
    fakeGoogle.uploads += 1;
    return json({ id: item.id });
  }

  return json(
    { error: { message: `unhandled ${method} ${url.pathname}` } },
    500,
  );
}

export function installFakeGoogle() {
  resetFakeGoogle();
  setGoogleFetch(handle);
}

export function uninstallFakeGoogle() {
  setGoogleFetch(null);
}

/** Caminho "Projeto/Financeiro/Parcela 1 - 09-2026/arquivo.pdf" dentro da pasta raiz. */
export function pathOf(item: FakeItem): string {
  const names = [item.name];
  let parent = item.parents[0];
  while (parent) {
    const found = fakeGoogle.items.get(parent);
    if (!found) break;
    names.unshift(found.name);
    parent = found.parents[0];
  }
  return names.join("/");
}

export function driveFiles() {
  return [...fakeGoogle.items.values()].filter(
    (item) => item.mimeType === "application/pdf",
  );
}
