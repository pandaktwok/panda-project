import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAiRequest } from "../../apps/api/src/ai-connection/access";
import db, { schema } from "../../apps/api/src/database";
import { setGoogleFetch } from "../../apps/api/src/google-drive/client";
import {
  awaitDriveIdle,
  processDriveQueue,
} from "../../apps/api/src/google-drive/mirror";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  driveFiles,
  fakeGoogle,
  installFakeGoogle,
  pathOf,
} from "./helpers/fake-google";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  type Actor,
  call,
  createLineVia,
  type FinanceContext,
  getState,
  reais,
  setupFinance,
  uploadVia,
} from "./helpers/finance";
import { makePdf } from "./helpers/pdf";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

const { app } = createApp();
const CLIENT_SECRET = "segredo-do-cliente-987";
let ctx: FinanceContext;

beforeEach(async () => {
  await resetTestDatabase();
  resetFakeStorage();
  installFakeGoogle();
  vi.stubEnv("FINANCE_TODAY", "2026-10-15");
  vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "chave-de-teste-do-drive");
  ctx = await setupFinance();
});

afterEach(() => {
  setGoogleFetch(null);
});

async function drive(
  actor: Actor,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
) {
  mockAuthenticatedSession(actor.user);
  const response = await app.request(`/api/google-drive${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // texto simples
  }
  return { status: response.status, body: parsed, text, response };
}

async function connectDrive(actor: Actor = ctx.actors.admin) {
  const saved = await drive(actor, "PUT", "/credentials", {
    clientId: "1234567890-abc.apps.googleusercontent.com",
    clientSecret: CLIENT_SECRET,
  });
  expect(saved.status, saved.text).toBe(200);
  const start = await drive(actor, "POST", "/connect");
  expect(start.status, start.text).toBe(200);
  const state = new URL(start.body.url).searchParams.get("state") as string;
  const back = await drive(
    actor,
    "GET",
    `/callback?code=codigo-bom&state=${encodeURIComponent(state)}`,
  );
  expect(back.status).toBe(302);
  expect(back.response.headers.get("location")).toContain("drive=connected");
}

async function payInstallment(
  supplier: string,
  firstDueDate: string,
  installmentIndex = 0,
) {
  const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
    supplier,
    totalCents: reais(1000),
    installmentsCount: 4,
    firstDueDate,
  });
  const up = async (kind: "receipt" | "invoice") => {
    const r = await uploadVia(
      ctx.actors.member,
      ctx.project.id,
      kind,
      `${kind}.pdf`,
      await makePdf([`${kind} ${supplier}`]),
    );
    expect(r.status, r.text).toBe(200);
    return r.body.id;
  };
  const receipt = await up("receipt");
  const invoice = await up("invoice");
  const state = await getState(ctx.actors.member, ctx.project.id);
  const installment = line.installments[installmentIndex];
  const result = await call(
    ctx.actors.member,
    "POST",
    `/${ctx.project.id}/save`,
    {
      version: state.version,
      payments: [
        {
          installmentId: installment?.id,
          paidCents: reais(250),
          paidAt: "2026-10-10",
          receiptAssetIds: [receipt],
          invoiceAssetIds: [invoice],
        },
      ],
    },
  );
  expect(result.status, result.text).toBe(200);
  await awaitDriveIdle();
  return { installmentId: installment?.id as string, result };
}

async function copies() {
  return db.select().from(schema.googleDriveCopyTable);
}

async function parcelFiles() {
  const r = await call<any>(
    ctx.actors.admin,
    "GET",
    `/${ctx.project.id}/files`,
  );
  expect(r.status, r.text).toBe(200);
  return r.body.parcels.flatMap((p: any) => p.files) as Array<{
    drive: string | null;
    name: string;
    id: string;
  }>;
}

const makeDue = () =>
  db
    .update(schema.googleDriveCopyTable)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) });

describe("Google Drive não configurado", () => {
  it("o sistema funciona igual: pagamento salva, nada é enfileirado, lista sem estado", async () => {
    await payInstallment("Mirella Sombrio", "2026-09-05");
    expect(await copies()).toHaveLength(0);
    expect(fakeGoogle.uploads).toBe(0);
    const files = await parcelFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.drive).toBeNull();
    const status = await drive(ctx.actors.admin, "GET", "");
    expect(status.body).toMatchObject({
      status: "disconnected",
      hasCredentials: false,
      queue: { pending: 0, copied: 0, failed: 0 },
    });
  });

  it("só administradores mexem no Drive; a IA nunca", async () => {
    for (const actor of [ctx.actors.member, ctx.actors.viewer]) {
      expect((await drive(actor, "GET", "")).status).toBe(403);
      expect(
        (
          await drive(actor, "PUT", "/credentials", {
            clientId: "1234567890-abc",
            clientSecret: "abcdefgh",
          })
        ).status,
      ).toBe(403);
      expect((await drive(actor, "POST", "/connect")).status).toBe(403);
      expect((await drive(actor, "POST", "/disconnect")).status).toBe(403);
    }
    expect(classifyAiRequest("GET", "/google-drive")).toBe("forbidden");
    expect(classifyAiRequest("POST", "/google-drive/backfill")).toBe(
      "forbidden",
    );
  });
});

describe("conexão", () => {
  it("conecta pelo fluxo OAuth, guarda o segredo criptografado e cria a pasta raiz", async () => {
    await connectDrive();
    const status = await drive(ctx.actors.admin, "GET", "");
    expect(status.body).toMatchObject({
      status: "connected",
      accountEmail: "financeiro@empresa.com",
      hasClientSecret: true,
      redirectUri: "http://localhost:1337/api/google-drive/callback",
    });
    // Nada de segredo ou token na resposta.
    expect(status.text).not.toContain(CLIENT_SECRET);
    expect(status.text).not.toContain(fakeGoogle.refreshToken);
    const [row] = await db.select().from(schema.googleDriveConfigTable);
    expect(row?.clientSecretEnc).not.toContain(CLIENT_SECRET);
    expect(row?.refreshTokenEnc).not.toContain(fakeGoogle.refreshToken);
    expect(row?.clientSecretEnc).toMatch(/^gcm:v1:/);
    const root = [...fakeGoogle.items.values()].find(
      (item) => item.name === "Panda Project",
    );
    expect(root?.parents).toEqual([]);
    expect(row?.rootFolderId).toBe(root?.id);
  });

  it("recusa a volta do Google com state inválido ou de outra pessoa", async () => {
    await drive(ctx.actors.admin, "PUT", "/credentials", {
      clientId: "1234567890-abc",
      clientSecret: CLIENT_SECRET,
    });
    const start = await drive(ctx.actors.admin, "POST", "/connect");
    const state = new URL(start.body.url).searchParams.get("state") as string;
    const forged = await drive(
      ctx.actors.admin,
      "GET",
      "/callback?code=codigo-bom&state=lixo.lixo",
    );
    expect(forged.response.headers.get("location")).toContain("drive=error");
    const otherAdmin = await drive(
      ctx.actors.owner,
      "GET",
      `/callback?code=codigo-bom&state=${encodeURIComponent(state)}`,
    );
    expect(otherAdmin.response.headers.get("location")).toContain(
      "drive=error",
    );
    const status = await drive(ctx.actors.admin, "GET", "");
    expect(status.body.status).toBe("disconnected");
  });

  it("o endereço de conexão pede acesso offline e só o escopo drive.file", async () => {
    await drive(ctx.actors.admin, "PUT", "/credentials", {
      clientId: "1234567890-abc",
      clientSecret: CLIENT_SECRET,
    });
    const start = await drive(ctx.actors.admin, "POST", "/connect");
    const url = new URL(start.body.url);
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:1337/api/google-drive/callback",
    );
  });

  it("desconectar revoga o token no Google e apaga os tokens daqui", async () => {
    await connectDrive();
    const out = await drive(ctx.actors.admin, "POST", "/disconnect");
    expect(out.status).toBe(200);
    expect(out.body.status).toBe("disconnected");
    expect(fakeGoogle.revoked).toEqual([fakeGoogle.refreshToken]);
    const [row] = await db.select().from(schema.googleDriveConfigTable);
    expect(row?.refreshTokenEnc).toBeNull();
    // Depois de desconectado, pagar não enfileira nada.
    await payInstallment("Mirella Sombrio", "2026-09-05");
    expect(await copies()).toHaveLength(0);
  });
});

describe("cópia dos pagamentos", () => {
  it("o PDF do pagamento vai para Projeto/Financeiro/Parcela N - MM-AAAA com o nome certo", async () => {
    await connectDrive();
    await payInstallment("Mirella Sombrio", "2026-09-05");
    const files = driveFiles();
    expect(files).toHaveLength(1);
    expect(pathOf(files[0] as never)).toBe(
      "Panda Project/Cultura e Informação para a Pessoa Idosa/Financeiro/Parcela 1 - 09-2026/Mirella Sombrio - Parcela 1.pdf",
    );
    // O mesmo PDF que o sistema guardou.
    const [asset] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.surface, "payment"));
    const { fakeStore } = await import("./helpers/fake-storage");
    const stored = fakeStore.get(asset?.objectKey as string)?.bytes;
    expect(files[0]?.bytes).toEqual(stored);
    const [copy] = await copies();
    expect(copy).toMatchObject({ status: "copied", attempts: 0 });
    expect((await parcelFiles())[0]?.drive).toBe("copied");
  });

  it("parcelas de meses diferentes vão para pastas separadas e as pastas não se repetem", async () => {
    await connectDrive();
    await payInstallment("Mirella Sombrio", "2026-09-05", 0);
    await payInstallment("Mirella Sombrio", "2026-09-05", 1);
    await payInstallment("Outro Fornecedor", "2026-09-20", 0);
    const paths = driveFiles()
      .map((item) => pathOf(item))
      .sort();
    expect(paths).toEqual(
      [
        "Financeiro/Parcela 1 - 09-2026/Mirella Sombrio - Parcela 1.pdf",
        "Financeiro/Parcela 2 - 10-2026/Mirella Sombrio - Parcela 2.pdf",
        "Financeiro/Parcela 1 - 09-2026/Outro Fornecedor - Parcela 1.pdf",
      ]
        .map(
          (tail) =>
            `Panda Project/Cultura e Informação para a Pessoa Idosa/${tail}`,
        )
        .sort(),
    );
    const folders = [...fakeGoogle.items.values()].filter(
      (item) => item.mimeType === "application/vnd.google-apps.folder",
    );
    // raiz + projeto + Financeiro + 2 pastas de parcela = 5, sem duplicatas.
    expect(folders).toHaveLength(5);
  });

  it("reprocessar um item já enviado não duplica o arquivo", async () => {
    await connectDrive();
    await payInstallment("Mirella Sombrio", "2026-09-05");
    // Simula "o arquivo subiu mas a anotação se perdeu".
    await db
      .update(schema.googleDriveCopyTable)
      .set({ status: "pending", nextAttemptAt: new Date(Date.now() - 1000) });
    await processDriveQueue();
    expect(driveFiles()).toHaveLength(1);
    expect(fakeGoogle.uploads).toBe(1);
    expect((await copies())[0]?.status).toBe("copied");
  });

  it("Drive fora do ar: o pagamento salva, a cópia fica pendente e termina sozinha depois", async () => {
    await connectDrive();
    fakeGoogle.fault = "down";
    const { result } = await payInstallment("Mirella Sombrio", "2026-09-05");
    expect(result.status).toBe(200);
    let [copy] = await copies();
    expect(copy).toMatchObject({ status: "pending", attempts: 1 });
    expect(copy?.lastError).toContain("Não foi possível falar com o Google");
    expect((await parcelFiles())[0]?.drive).toBe("pending");
    // Ainda dentro da espera: a rodada não mexe.
    await processDriveQueue();
    expect((await copies())[0]?.attempts).toBe(1);
    // O Google volta e o tempo de espera passa.
    fakeGoogle.fault = null;
    await makeDue();
    const round = await processDriveQueue();
    expect(round.copied).toBe(1);
    [copy] = await copies();
    expect(copy).toMatchObject({ status: "copied", lastError: null });
    expect(driveFiles()).toHaveLength(1);
  });

  it("falha no envio do arquivo depois de criar pastas: tenta de novo sem duplicar pastas", async () => {
    await connectDrive();
    fakeGoogle.fault = "upload";
    await payInstallment("Mirella Sombrio", "2026-09-05");
    expect((await copies())[0]?.status).toBe("pending");
    fakeGoogle.fault = null;
    await makeDue();
    await processDriveQueue();
    expect((await copies())[0]?.status).toBe("copied");
    const folders = [...fakeGoogle.items.values()].filter(
      (item) => item.mimeType === "application/vnd.google-apps.folder",
    );
    expect(folders).toHaveLength(4);
  });

  it("depois de 8 tentativas vira Falhou, e 'Tentar de novo' recomeça", async () => {
    await connectDrive();
    fakeGoogle.fault = "down";
    await payInstallment("Mirella Sombrio", "2026-09-05");
    for (let i = 0; i < 10; i += 1) {
      await makeDue();
      await processDriveQueue();
    }
    let [copy] = await copies();
    expect(copy).toMatchObject({ status: "failed", attempts: 8 });
    expect((await parcelFiles())[0]?.drive).toBe("failed");
    fakeGoogle.fault = null;
    const retry = await drive(ctx.actors.admin, "POST", "/retry", {
      assetId: copy?.assetId,
    });
    expect(retry.body).toEqual({ retried: true });
    await awaitDriveIdle();
    [copy] = await copies();
    expect(copy?.status).toBe("copied");
    expect(copy?.attempts).toBe(0);
  });

  it("Google recusa o acesso: a tela mostra o erro e o pagamento não é afetado", async () => {
    await connectDrive();
    fakeGoogle.fault = "auth";
    const { result } = await payInstallment("Mirella Sombrio", "2026-09-05");
    expect(result.status).toBe(200);
    const status = await drive(ctx.actors.admin, "GET", "");
    expect(status.body.status).toBe("error");
    expect(status.body.lastError).toContain("Reconecte");
    expect(status.text).not.toContain(fakeGoogle.refreshToken);
    // Reconectar volta ao normal e a fila esvazia.
    fakeGoogle.fault = null;
    await connectDrive();
    await makeDue();
    await processDriveQueue();
    expect((await copies())[0]?.status).toBe("copied");
  });

  it("'Copiar pagamentos antigos' envia o que foi pago antes de conectar", async () => {
    await payInstallment("Mirella Sombrio", "2026-09-05");
    expect(await copies()).toHaveLength(0);
    await connectDrive();
    const backfill = await drive(ctx.actors.admin, "POST", "/backfill");
    expect(backfill.body).toEqual({ queued: 1 });
    await awaitDriveIdle();
    expect(driveFiles()).toHaveLength(1);
    // Repetir não duplica.
    const again = await drive(ctx.actors.admin, "POST", "/backfill");
    expect(again.body).toEqual({ queued: 0 });
    await awaitDriveIdle();
    expect(driveFiles()).toHaveLength(1);
  });

  it("'Testar conexão' informa a conta e avisa se a pasta sumiu", async () => {
    await connectDrive();
    const ok = await drive(ctx.actors.admin, "POST", "/test");
    expect(ok.body).toEqual({
      ok: true,
      message: "Conectado como financeiro@empresa.com.",
    });
    for (const item of fakeGoogle.items.values()) {
      if (item.name === "Panda Project") item.trashed = true;
    }
    const gone = await drive(ctx.actors.admin, "POST", "/test");
    expect(gone.body.ok).toBe(false);
  });

  it("a chave de criptografia ausente recusa salvar o segredo", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "");
    vi.stubEnv("APP_SECRETS_KEY", "");
    const saved = await drive(ctx.actors.admin, "PUT", "/credentials", {
      clientId: "1234567890-abc",
      clientSecret: CLIENT_SECRET,
    });
    expect(saved.status).toBe(400);
  });
});
