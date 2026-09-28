import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  FINANCE_TOOL_KINDS,
  registerFinanceTools,
} from "../../apps/api/src/mcp/finance-tools";
import { registerMcpTools } from "../../apps/api/src/mcp/tools";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  type Actor,
  call,
  createLineVia,
  type FinanceContext,
  getState,
  setupFinance,
} from "./helpers/finance";
import { makePdf } from "./helpers/pdf";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

const { app } = createApp();
const CLIENT_ORIGIN = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
const REDIRECT = "http://localhost:9999/callback";
const DISABLED = "Desativado em Configurações > Conexão com IA";
const INTERNAL = "http://ai.internal.test";

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };
type ToolHandler = (args: unknown) => Promise<ToolResult>;

/** Os tools chamam a API por fetch: aqui o fetch cai direto no app. */
function routeFetchToApp() {
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      return app.request(`${url.pathname}${url.search}`, init);
    },
  );
}

function loadTools(token: string) {
  const handlers = new Map<string, ToolHandler>();
  const descriptions = new Map<string, string>();
  registerMcpTools(
    {
      registerTool: (name, config, callback) => {
        handlers.set(name, callback as ToolHandler);
        descriptions.set(name, config.description);
      },
    },
    INTERNAL,
    token,
  );
  return {
    descriptions,
    async run(name: string, args: unknown) {
      vi.restoreAllMocks();
      const handler = handlers.get(name);
      if (!handler) throw new Error(`tool ${name} not registered`);
      const result = await handler(args);
      const text = result.content[0]?.text ?? "";
      let json: any = text;
      try {
        json = JSON.parse(text);
      } catch {
        // texto simples
      }
      return { isError: Boolean(result.isError), json, text };
    },
  };
}

/** Fluxo OAuth de verdade do MCP até o token da IA. */
async function connectAi(actor: Actor, connectionName?: string) {
  mockAuthenticatedSession(actor.user);
  const registered = await app.request("/api/mcp/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      client_name: "Claude de teste",
    }),
  });
  const client = (await registered.json()) as { client_id: string };
  const verifier = `${randomUUID()}${randomUUID()}`;
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = await app.request(
    `/api/mcp/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "abc",
    })}`,
  );
  const requestId = new URL(
    authorize.headers.get("location") ?? "",
  ).searchParams.get("request_id");
  const decide = await app.request(`/api/mcp/authorize/request/${requestId}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: CLIENT_ORIGIN },
    body: JSON.stringify({ approved: true, connectionName }),
  });
  if (decide.status !== 200) {
    return { status: decide.status, body: (await decide.json()) as any };
  }
  const { redirect } = (await decide.json()) as { redirect: string };
  const code = new URL(redirect).searchParams.get("code");
  const tokenResponse = await app.request("/api/mcp/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const token = ((await tokenResponse.json()) as { access_token: string })
    .access_token;
  vi.restoreAllMocks();
  routeFetchToApp();
  return { status: 200, token };
}

async function ai(token: string, method: string, path: string, body?: unknown) {
  // Os atores humanos usam getSession simulado; a IA entra pelo token de verdade.
  vi.restoreAllMocks();
  const response = await app.request(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    // texto simples
  }
  return { status: response.status, json, text };
}

async function human(
  actor: Actor,
  method: string,
  path: string,
  body?: unknown,
) {
  mockAuthenticatedSession(actor.user);
  const response = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    // texto simples
  }
  return { status: response.status, json, text };
}

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

describe("conexão com a IA (MCP)", () => {
  let ctx: FinanceContext;
  let admin: Actor;
  let member: Actor;
  let token: string;
  let connectionId: string;
  let installmentId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    resetFakeStorage();
    routeFetchToApp();
    ctx = await setupFinance();
    admin = ctx.actors.admin;
    member = ctx.actors.member;
    await human(admin, "PUT", `/project-finance/${ctx.project.id}/settings`, {
      financeTotalCents: 300_000,
      financeMonths: 3,
      financeFirstDueDate: "2026-09-30",
    });
    const { line } = await createLineVia(admin, ctx.project.id, {
      supplier: "Gráfica Alfa",
      totalCents: 300_000,
      installmentsCount: 3,
      firstDueDate: "2026-09-30",
    });
    installmentId = line.installments[0]?.id as string;
    const connected = await connectAi(admin, "Claude do Renan");
    expect(connected.status).toBe(200);
    token = connected.token as string;
    const [row] = await db.select().from(schema.aiConnectionTable);
    connectionId = row?.id as string;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("A) Usuário comum não consegue autorizar a IA (rota e elegibilidade)", async () => {
    const denied = await connectAi(member);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("admin_required");
    expect(denied.body.error_description).toContain("administradores");
    // nenhuma conexão nova além da do administrador
    expect(await db.select().from(schema.aiConnectionTable)).toHaveLength(1);

    expect(
      (await human(member, "GET", "/ai-connection/eligibility")).json,
    ).toEqual({ canAuthorize: false });
    expect(
      (await human(admin, "GET", "/ai-connection/eligibility")).json,
    ).toEqual({ canAuthorize: true });
    // o usuário comum também não vê nem mexe nas conexões
    expect((await human(member, "GET", "/ai-connection")).status).toBe(403);
    expect(
      (
        await human(member, "PATCH", `/ai-connection/${connectionId}`, {
          canEdit: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (await human(member, "POST", `/ai-connection/${connectionId}/revoke`))
        .status,
    ).toBe(403);
  });

  it("B) /mcp só aceita token de conexão de IA (sessão comum e chave de API não passam)", async () => {
    const initialize = (bearer: string) =>
      app.request("/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "teste", version: "1" },
          },
        }),
      });
    expect((await initialize(token)).status).toBe(200);

    // sessão comum de outra pessoa (token válido, mas não é da IA)
    const plainToken = randomUUID();
    await db.insert(schema.sessionTable).values({
      id: `session-${randomUUID()}`,
      token: plainToken,
      userId: admin.user.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await initialize(plainToken)).status).toBe(401);

    // chave de API pessoal
    const rawKey = `kaneo_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: admin.user.id,
      userId: admin.user.id,
      key: createHash("sha256").update(rawKey).digest("base64url"),
      name: "chave de teste",
      start: rawKey.slice(0, 12),
      prefix: "kaneo",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await initialize(rawKey)).status).toBe(401);
  });

  it("C) a IA lê o cronograma e marca uma parcela com os dois arquivos", async () => {
    const tools = loadTools(token);
    const read = await tools.run("get_project_finance", {
      projectId: ctx.project.id,
    });
    expect(read.isError).toBe(false);
    expect(read.json.lines[0].supplier).toBe("Gráfica Alfa");
    expect(
      (await tools.run("list_project_tags", { projectId: ctx.project.id }))
        .json,
    ).toEqual([]);

    const paid = await tools.run("mark_installment_paid", {
      projectId: ctx.project.id,
      installmentId,
      paidCents: 100_000,
      paidAt: "2026-09-20",
      receipt: {
        upload: {
          base64: base64(await makePdf(["Comprovante IA"])),
          filename: "comprovante.pdf",
        },
      },
      invoice: {
        upload: {
          base64: base64(await makePdf(["NF IA"])),
          filename: "nf.pdf",
        },
      },
    });
    expect(paid.isError, paid.text).toBe(false);
    const state = await getState(admin, ctx.project.id);
    const first = state.lines[0]?.installments[0];
    expect(first?.status).toBe("paid");
    expect(first?.paidCents).toBe(100_000);

    // desfaz pela ferramenta
    const undone = await tools.run("undo_installment_payment", {
      installmentId,
    });
    expect(undone.isError, undone.text).toBe(false);
    expect(
      (await getState(admin, ctx.project.id)).lines[0]?.installments[0]?.status,
    ).not.toBe("paid");
  });

  it("C2) sem comprovante e NF a IA é recusada, e envio já feito vale por referência", async () => {
    const tools = loadTools(token);
    const semArquivos = await tools.run("mark_installment_paid", {
      projectId: ctx.project.id,
      installmentId,
      paidCents: 100_000,
      paidAt: "2026-09-20",
      receipt: {},
      invoice: {},
    });
    expect(semArquivos.isError).toBe(true);
    expect(semArquivos.text).toContain("obrigatórios");

    const soUm = await tools.run("mark_installment_paid", {
      projectId: ctx.project.id,
      installmentId,
      paidCents: 100_000,
      paidAt: "2026-09-20",
      receipt: {
        upload: { base64: base64(await makePdf(["c"])), filename: "c.pdf" },
      },
      invoice: {},
    });
    expect(soUm.isError).toBe(true);
    expect(soUm.text).toContain("nota fiscal");

    const invalido = await tools.run("mark_installment_paid", {
      projectId: ctx.project.id,
      installmentId,
      paidCents: 100_000,
      paidAt: "2026-09-20",
      receipt: { upload: { base64: "###", filename: "c.pdf" } },
      invoice: { upload: { base64: "###", filename: "n.pdf" } },
    });
    expect(invalido.isError).toBe(true);
    expect(invalido.text).toContain("base64 inválido");
    expect(
      (await getState(admin, ctx.project.id)).lines[0]?.installments[0]?.status,
    ).not.toBe("paid");

    // referência a envios já feitos (pela própria IA, pela rota de arquivos)
    const upload = async (purpose: string) => {
      vi.restoreAllMocks();
      const response = await app.request(
        `/api/project-finance/${ctx.project.id}/files?purpose=${purpose}&filename=x.pdf`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/octet-stream",
          },
          body: (await makePdf([purpose])) as BodyInit,
        },
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { id: string }).id;
    };
    const receiptId = await upload("receipt");
    const invoiceId = await upload("invoice");
    const byRef = await tools.run("mark_installment_paid", {
      projectId: ctx.project.id,
      installmentId,
      paidCents: 100_000,
      paidAt: "2026-09-20",
      receipt: { assetId: receiptId },
      invoice: { assetId: invoiceId },
    });
    expect(byRef.isError, byRef.text).toBe(false);
  });

  it("D) 'registrar pagamentos' desligado: marcar e desfazer voltam 403, leitura e edição continuam", async () => {
    // uma parcela paga antes de desligar, para poder testar o desfazer
    const tools = loadTools(token);
    await tools.run("mark_installment_paid", {
      projectId: ctx.project.id,
      installmentId,
      paidCents: 100_000,
      paidAt: "2026-09-20",
      receipt: {
        upload: { base64: base64(await makePdf(["c"])), filename: "c.pdf" },
      },
      invoice: {
        upload: { base64: base64(await makePdf(["n"])), filename: "n.pdf" },
      },
    });
    const off = await human(admin, "PATCH", `/ai-connection/${connectionId}`, {
      canPay: false,
    });
    expect(off.status).toBe(200);
    expect(off.json).toMatchObject({ canPay: false, canEdit: true });

    // pela API direto, com o token da IA
    const state = await getState(admin, ctx.project.id);
    const second = state.lines[0]?.installments[1]?.id as string;
    const save = await ai(
      token,
      "POST",
      `/project-finance/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: second,
            paidCents: 100_000,
            paidAt: "2026-09-21",
            receiptAssetIds: ["x"],
            invoiceAssetIds: ["y"],
          },
        ],
      },
    );
    expect(save.status).toBe(403);
    expect(save.text).toBe(DISABLED);
    const undo = await ai(
      token,
      "POST",
      `/project-finance/installments/${installmentId}/undo`,
    );
    expect(undo.status).toBe(403);
    expect(undo.text).toBe(DISABLED);

    // pelas ferramentas
    const viaTool = await tools.run("undo_installment_payment", {
      installmentId,
    });
    expect(viaTool.isError).toBe(true);
    expect(viaTool.text).toContain(DISABLED);

    // leitura e edição seguem
    expect(
      (await ai(token, "GET", `/project-finance/${ctx.project.id}`)).status,
    ).toBe(200);
    const edit = await tools.run("create_finance_tag", {
      projectId: ctx.project.id,
      name: "Divulgação",
    });
    expect(edit.isError, edit.text).toBe(false);
    // a parcela continua paga: nada foi desfeito
    expect(
      (await getState(admin, ctx.project.id)).lines[0]?.installments[0]?.status,
    ).toBe("paid");
  });

  it("E) 'editar' desligado: criar, editar e apagar voltam 403 e a leitura continua", async () => {
    const tools = loadTools(token);
    const tag = await tools.run("create_finance_tag", {
      projectId: ctx.project.id,
      name: "Produção",
      valueCents: 50_000,
    });
    expect(tag.isError, tag.text).toBe(false);
    const lineId = (await getState(admin, ctx.project.id)).lines[0]
      ?.id as string;

    await human(admin, "PATCH", `/ai-connection/${connectionId}`, {
      canEdit: false,
    });
    const projectId = ctx.project.id;
    const attempts = [
      ai(token, "POST", `/project-finance/${projectId}/tags`, {
        name: "Outra",
      }),
      ai(token, "PUT", `/project-finance/${projectId}/settings`, {
        financeMonths: 5,
      }),
      ai(token, "POST", `/project-finance/${projectId}/lines`, {
        supplier: "Nova",
        totalCents: 1000,
        installmentsCount: 1,
        firstDueDate: "2026-12-01",
      }),
      ai(token, "PUT", `/project-finance/lines/${lineId}`, { supplier: "X" }),
      ai(token, "DELETE", `/project-finance/lines/${lineId}`),
      ai(token, "PATCH", `/project/${projectId}`, { name: "Renomeado" }),
      ai(token, "DELETE", `/project/${projectId}`),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.status, result.text).toBe(403);
      expect(result.text).toBe(DISABLED);
    }
    const viaTool = await tools.run("delete_finance_line", { lineId });
    expect(viaTool.isError).toBe(true);
    expect(viaTool.text).toContain(DISABLED);
    // leitura segue funcionando
    expect(
      (await tools.run("get_project_finance", { projectId })).isError,
    ).toBe(false);
    expect(
      (await ai(token, "GET", `/project?workspaceId=${ctx.workspace.id}`))
        .status,
    ).toBe(200);
    // e nada mudou
    const after = await getState(admin, projectId);
    expect(after.lines).toHaveLength(1);
    expect(after.tags.map((t) => t.name)).toEqual(["Produção"]);

    // com as duas desligadas, só lê; religar volta a permitir
    await human(admin, "PATCH", `/ai-connection/${connectionId}`, {
      canPay: false,
    });
    const upload = await ai(
      token,
      "POST",
      `/project-finance/${projectId}/files?purpose=receipt&filename=a.pdf`,
    );
    expect(upload.status).toBe(403);
    await human(admin, "PATCH", `/ai-connection/${connectionId}`, {
      canEdit: true,
    });
    expect(
      (
        await ai(token, "POST", `/project-finance/${projectId}/tags`, {
          name: "Outra",
        })
      ).status,
    ).toBe(200);
  });

  it("F) revogar corta o acesso na hora (API e /mcp)", async () => {
    expect(
      (await ai(token, "GET", `/project-finance/${ctx.project.id}`)).status,
    ).toBe(200);
    const revoked = await human(
      admin,
      "POST",
      `/ai-connection/${connectionId}/revoke`,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.json.status).toBe("revoked");
    expect(
      (await ai(token, "GET", `/project-finance/${ctx.project.id}`)).status,
    ).toBe(401);
    // sem sessão, o get-session responde vazio (null): não devolve mais o usuário
    expect((await ai(token, "GET", "/auth/get-session")).json).toBeNull();
    vi.restoreAllMocks();
    const mcpResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{}",
    });
    expect(mcpResponse.status).toBe(401);
    const tools = loadTools(token);
    expect(
      (await tools.run("get_project_finance", { projectId: ctx.project.id }))
        .isError,
    ).toBe(true);
    // revogar de novo é inofensivo
    expect(
      (await human(admin, "POST", `/ai-connection/${connectionId}/revoke`))
        .status,
    ).toBe(200);
  });

  it("G) o histórico mostra a ação da IA com o nome da conexão (inclusive as recusadas)", async () => {
    const tools = loadTools(token);
    await tools.run("create_finance_tag", {
      projectId: ctx.project.id,
      name: "Som",
    });
    await human(admin, "PATCH", `/ai-connection/${connectionId}`, {
      canEdit: false,
    });
    await tools.run("create_finance_tag", {
      projectId: ctx.project.id,
      name: "Luz",
    });
    // leitura não vira histórico
    await tools.run("get_project_finance", { projectId: ctx.project.id });

    const history = await human(admin, "GET", "/ai-connection/history");
    expect(history.status).toBe(200);
    const actions = history.json.actions as Array<{
      connectionName: string;
      action: string;
      status: number;
      projectId: string | null;
    }>;
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.connectionName === "Claude do Renan")).toBe(
      true,
    );
    expect(actions.map((a) => [a.action, a.status]).sort()).toEqual([
      ["Criou tag", 200],
      ["Criou tag", 403],
    ]);
    expect(actions[0]?.projectId).toBe(ctx.project.id);
    expect((await human(member, "GET", "/ai-connection/history")).status).toBe(
      403,
    );

    const list = await human(admin, "GET", "/ai-connection");
    expect(list.json.mcpUrl).toMatch(/\/api\/mcp$/);
    expect(list.json.connections[0]).toMatchObject({
      name: "Claude do Renan",
      status: "active",
      canPay: true,
      canEdit: false,
      authorizedByName: admin.user.name,
    });
    expect(list.json.connections[0].lastUsedAt).toBeTruthy();
  });

  it("H) a IA não mexe em contas, chaves, permissões nem nas próprias conexões", async () => {
    expect((await ai(token, "GET", "/auth/get-session")).status).toBe(200);
    expect((await ai(token, "GET", "/auth/organization/list")).status).toBe(
      200,
    );
    const forbidden = [
      ai(token, "POST", "/auth/api-key/create", { name: "escapei" }),
      ai(token, "POST", "/auth/sign-out"),
      ai(token, "POST", "/auth/organization/update-member-role", {}),
      ai(token, "PUT", `/project-access/${ctx.project.id}/${member.user.id}`, {
        canView: false,
        canPay: false,
        canAttach: false,
      }),
      ai(token, "PATCH", `/ai-connection/${connectionId}`, { canPay: true }),
      ai(token, "POST", `/ai-connection/${connectionId}/revoke`),
      ai(token, "GET", "/ai-connection"),
    ];
    for (const result of await Promise.all(forbidden)) {
      expect(result.status, result.text).toBe(403);
    }
    expect(await db.select().from(schema.apikeyTable)).toHaveLength(0);
  });

  it("I) se quem autorizou deixa de ser administrador, a IA perde a escrita", async () => {
    expect(
      (await ai(token, "GET", `/project-finance/${ctx.project.id}`)).status,
    ).toBe(200);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "member" })
      .where(eq(schema.workspaceUserTable.userId, admin.user.id));
    const result = await ai(token, "GET", `/project-finance/${ctx.project.id}`);
    expect(result.status).toBe(403);
    expect(result.text).toContain("deixou de ser administradora");
  });

  it("J) toda ferramenta do financeiro declara se é leitura, edição ou pagamento", () => {
    const tools = loadTools(token);
    for (const [name, kind] of Object.entries(FINANCE_TOOL_KINDS)) {
      const description = tools.descriptions.get(name);
      expect(description, name).toBeTruthy();
      const label = { read: "[LEITURA]", edit: "[EDIÇÃO", pay: "[PAGAMENTO" }[
        kind
      ];
      expect(description).toContain(label);
    }
    expect(registerFinanceTools).toBeTypeOf("function");
    expect(
      Object.values(FINANCE_TOOL_KINDS).filter((k) => k === "pay"),
    ).toHaveLength(2);
  });
});
