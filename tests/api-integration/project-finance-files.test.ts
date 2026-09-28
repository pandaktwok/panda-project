import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "../../apps/api/node_modules/fflate";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { cleanupExpiredFinanceUploads } from "../../apps/api/src/project-finance/files/cleanup";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  fakeStore,
  resetFakeStorage,
  storageFaults,
} from "./helpers/fake-storage";
import {
  CORRUPT_PDF_BYTES,
  ENCRYPTED_PDF_BYTES,
  HEIC_BYTES,
  JPEG_BYTES,
  JPEG_ORIENTATION_6_BYTES,
  PNG_BYTES,
  TEXT_BYTES,
  WEBP_BYTES,
} from "./helpers/file-fixtures";
import {
  call,
  createLineVia,
  type FinanceContext,
  getState,
  reais,
  setupFinance,
  uploadVia,
} from "./helpers/finance";
import { makePdf, pageSizes, pageTexts } from "./helpers/pdf";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

let ctx: FinanceContext;
const { app } = createApp();

beforeEach(async () => {
  await resetTestDatabase();
  resetFakeStorage();
  vi.stubEnv("FINANCE_TODAY", "2026-10-15");
  ctx = await setupFinance();
});

/** Linha "Mirella Sombrio", vencimento da 1ª parcela em 05/09/2026. */
async function line(supplier = "Mirella Sombrio", firstDueDate = "2026-09-05") {
  const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
    supplier,
    totalCents: reais(1000),
    installmentsCount: 4,
    firstDueDate,
  });
  return line;
}

async function upload(
  kind: "receipt" | "invoice",
  bytes: Uint8Array,
  actor: keyof FinanceContext["actors"] = "member",
) {
  const result = await uploadVia(
    ctx.actors[actor],
    ctx.project.id,
    kind,
    kind === "receipt" ? "comprovante.pdf" : "nota.pdf",
    bytes,
  );
  expect(result.status, result.text).toBe(200);
  return result.body.id;
}

async function pay(
  installmentId: string,
  receiptAssetId: string,
  invoiceAssetId: string,
  paidAt = "2026-10-10",
  actor: keyof FinanceContext["actors"] = "member",
) {
  const state = await getState(ctx.actors[actor], ctx.project.id);
  return call(ctx.actors[actor], "POST", `/${ctx.project.id}/save`, {
    version: state.version,
    payments: [
      {
        installmentId,
        paidCents: reais(250),
        paidAt,
        receiptAssetIds: [receiptAssetId],
        invoiceAssetIds: [invoiceAssetId],
      },
    ],
  });
}

async function paymentAsset(installmentId: string) {
  const state = await getState(ctx.actors.admin, ctx.project.id);
  const fileId = state.lines
    .flatMap((l) => l.installments)
    .find((i) => i.id === installmentId)?.fileAssetId;
  if (!fileId) throw new Error("installment has no file");
  const [asset] = await db
    .select()
    .from(schema.assetTable)
    .where(eq(schema.assetTable.id, fileId));
  if (!asset) throw new Error("asset row missing");
  return asset;
}

async function download(
  actor: keyof FinanceContext["actors"] | "outsider" | null,
  assetId: string,
) {
  if (actor === null) mockAnonymousSession();
  else
    mockAuthenticatedSession(
      actor === "outsider" ? ctx.outsider.user : ctx.actors[actor].user,
    );
  return app.request(`/api/asset/${assetId}`);
}

describe("junção em PDF único", () => {
  it("comprovante primeiro, NF depois: o PDF final tem as páginas na ordem", async () => {
    const l = await line();
    const receipt = await upload(
      "receipt",
      await makePdf(["COMPROVANTE pagina 1", "COMPROVANTE pagina 2"]),
    );
    const invoice = await upload(
      "invoice",
      await makePdf(["NOTA FISCAL pagina 1"]),
    );
    const result = await pay(l.installments[0]?.id as string, receipt, invoice);
    expect(result.status, result.text).toBe(200);

    const asset = await paymentAsset(l.installments[0]?.id as string);
    const stored = fakeStore.get(asset.objectKey);
    expect(stored?.contentType).toBe("application/pdf");
    expect(await pageTexts(stored?.bytes as Uint8Array)).toEqual([
      "COMPROVANTE pagina 1",
      "COMPROVANTE pagina 2",
      "NOTA FISCAL pagina 1",
    ]);
  });

  it("JPG e PNG viram uma página A4 cada, sem distorcer; a foto em pé (EXIF 6) também", async () => {
    const l = await line();
    const receipt = await upload("receipt", JPEG_ORIENTATION_6_BYTES);
    const invoice = await upload("invoice", PNG_BYTES);
    const result = await pay(l.installments[0]?.id as string, receipt, invoice);
    expect(result.status, result.text).toBe(200);
    const asset = await paymentAsset(l.installments[0]?.id as string);
    const sizes = await pageSizes(
      fakeStore.get(asset.objectKey)?.bytes as Uint8Array,
    );
    expect(sizes).toHaveLength(2);
    for (const size of sizes) {
      expect(size.width).toBeCloseTo(595.28, 1);
      expect(size.height).toBeCloseTo(841.89, 1);
    }
  });

  it("um JPG simples e um PNG entram como páginas; misturar PDF e imagem funciona", async () => {
    const l = await line();
    const receipt = await upload("receipt", JPEG_BYTES);
    const invoice = await upload("invoice", await makePdf(["NF em PDF"]));
    const result = await pay(l.installments[0]?.id as string, receipt, invoice);
    expect(result.status, result.text).toBe(200);
    const asset = await paymentAsset(l.installments[0]?.id as string);
    const bytes = fakeStore.get(asset.objectKey)?.bytes as Uint8Array;
    const texts = await pageTexts(bytes);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe("NF em PDF");
  });

  it("WebP e HEIC são recusados no envio com pedido de conversão", async () => {
    for (const bytes of [WEBP_BYTES, HEIC_BYTES]) {
      const result = await uploadVia(
        ctx.actors.member,
        ctx.project.id,
        "receipt",
        "foto",
        bytes,
      );
      expect(result.status).toBe(415);
      expect(result.body.code).toBe("FILE_NEEDS_CONVERSION");
      expect(result.body.message).toMatch(/PDF, JPG or PNG/);
    }
    expect([...fakeStore.keys()]).toHaveLength(0);
  });

  it("o tipo vem do conteúdo, não da extensão: texto com nome .pdf é recusado", async () => {
    const result = await uploadVia(
      ctx.actors.member,
      ctx.project.id,
      "receipt",
      "comprovante.pdf",
      TEXT_BYTES,
    );
    expect(result.status).toBe(415);
    expect(result.body.code).toBe("FILE_TYPE_UNSUPPORTED");
  });

  it("PDF protegido por senha e PDF corrompido: erro claro e nada é gravado", async () => {
    const l = await line();
    const invoice = await upload("invoice", await makePdf(["NF"]));
    const before = fakeStore.size;

    const encrypted = await upload("receipt", ENCRYPTED_PDF_BYTES);
    const first = await pay(
      l.installments[0]?.id as string,
      encrypted,
      invoice,
    );
    expect(first.status).toBe(422);
    expect((first.body as unknown as { code: string }).code).toBe(
      "PDF_ENCRYPTED",
    );

    const corrupt = await upload("receipt", CORRUPT_PDF_BYTES);
    const second = await pay(l.installments[0]?.id as string, corrupt, invoice);
    expect(second.status).toBe(422);
    expect((second.body as unknown as { code: string }).code).toBe(
      "PDF_CORRUPT",
    );

    // Nenhum PDF final gravado, parcela continua não paga, envios continuam usáveis.
    expect(fakeStore.size).toBe(before + 2);
    const state = await getState(ctx.actors.admin, ctx.project.id);
    expect(state.lines[0]?.installments[0]?.paidAt).toBeNull();
    const finals = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.surface, "payment"));
    expect(finals).toHaveLength(0);
  });

  it("sem comprovante ou sem NF a API recusa", async () => {
    const l = await line();
    const state = await getState(ctx.actors.member, ctx.project.id);
    const receipt = await upload("receipt", await makePdf(["C"]));
    const installmentId = l.installments[0]?.id as string;
    for (const payment of [
      { installmentId, paidCents: 1, paidAt: "2026-10-10" },
      {
        installmentId,
        paidCents: 1,
        paidAt: "2026-10-10",
        receiptAssetIds: [receipt],
      },
    ]) {
      const result = await call(
        ctx.actors.member,
        "POST",
        `/${ctx.project.id}/save`,
        {
          version: state.version,
          payments: [payment],
        },
      );
      // O helper acrescenta arquivos só quando faltam os dois; aqui falta um.
      if ("receiptAssetIds" in payment) {
        expect(result.status).toBe(400);
      } else {
        // sem nenhum arquivo o helper anexa um par; o pedido cru é testado abaixo
        expect([200, 400]).toContain(result.status);
      }
    }
    // Pedido cru, sem passar pelo helper de anexos:
    mockAuthenticatedSession(ctx.actors.member.user);
    const raw = await app.request(
      `/api/project-finance/${ctx.project.id}/save`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: (await getState(ctx.actors.member, ctx.project.id)).version,
          payments: [
            {
              installmentId: l.installments[1]?.id,
              paidCents: 1,
              paidAt: "2026-10-10",
            },
          ],
        }),
      },
    );
    expect(raw.status).toBe(400);
  });

  it("um envio de comprovante não serve como NF, nem de outro projeto, nem duas vezes", async () => {
    const l = await line();
    const r1 = await upload("receipt", await makePdf(["R1"]));
    const r2 = await upload("receipt", await makePdf(["R2"]));
    const swapped = await pay(l.installments[0]?.id as string, r1, r2);
    expect(swapped.status).toBe(400);

    // arquivo de outro projeto/workspace
    const foreign = await uploadVia(
      ctx.outsider,
      ctx.otherProject.id,
      "invoice",
      "nf.pdf",
      await makePdf(["X"]),
    );
    expect(foreign.status).toBe(200);
    const crossed = await pay(
      l.installments[0]?.id as string,
      r1,
      foreign.body.id,
    );
    expect(crossed.status).toBe(404);

    // Pagamento bem-sucedido consome os envios: reaproveitar falha.
    const inv = await upload("invoice", await makePdf(["N1"]));
    expect((await pay(l.installments[0]?.id as string, r1, inv)).status).toBe(
      200,
    );
    const inv2 = await upload("invoice", await makePdf(["N2"]));
    const reuse = await pay(l.installments[1]?.id as string, r1, inv2);
    expect(reuse.status).toBe(404);
  });

  it("falha do armazenamento no meio do lote: o que já foi gravado é apagado e nada fica pago", async () => {
    const l = await line();
    const uploads = [];
    for (let index = 0; index < 2; index += 1) {
      uploads.push({
        receipt: await upload("receipt", await makePdf([`C${index}`])),
        invoice: await upload("invoice", await makePdf([`N${index}`])),
      });
    }
    const keysBefore = new Set(fakeStore.keys());
    storageFaults.failPutAfter = storageFaults.puts + 1; // 1º PDF final ok, 2º falha
    const state = await getState(ctx.actors.member, ctx.project.id);
    const result = await call(
      ctx.actors.member,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [0, 1].map((index) => ({
          installmentId: l.installments[index]?.id,
          paidCents: reais(250),
          paidAt: "2026-10-10",
          receiptAssetIds: [uploads[index]?.receipt],
          invoiceAssetIds: [uploads[index]?.invoice],
        })),
      },
    );
    expect(result.status).toBe(503);
    expect(new Set(fakeStore.keys())).toEqual(keysBefore);
    const after = await getState(ctx.actors.admin, ctx.project.id);
    expect(after.lines[0]?.installments.every((i) => i.paidAt === null)).toBe(
      true,
    );
    expect(
      await db
        .select()
        .from(schema.assetTable)
        .where(eq(schema.assetTable.surface, "payment")),
    ).toHaveLength(0);
  });
});

describe("nomes e pastas", () => {
  it("pasta usa o mês e ano do VENCIMENTO, mesmo pagando em outubro", async () => {
    const l = await line("Mirella Sombrio", "2026-09-05");
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    const result = await pay(
      l.installments[0]?.id as string,
      r,
      n,
      "2026-10-20",
    );
    expect(result.status, result.text).toBe(200);
    const asset = await paymentAsset(l.installments[0]?.id as string);
    expect(asset.folderLabel).toBe("Parcela 1 - 09-2026");
    expect(asset.filename).toBe("Mirella Sombrio - Parcela 1.pdf");
    const files = await call<{
      parcels: Array<{ label: string; files: Array<{ name: string }> }>;
    }>(ctx.actors.member, "GET", `/${ctx.project.id}/files`);
    expect(files.body.parcels[0]?.label).toBe("Parcela 1 - 09-2026");
    expect(files.body.parcels[0]?.files[0]?.name).toBe(
      "Mirella Sombrio - Parcela 1.pdf",
    );
  });

  it("vencimento em 31/08 às 23h de Brasília não vira o mês anterior nem o seguinte", async () => {
    const l = await line("Fornecedor", "2026-08-31");
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    await pay(l.installments[0]?.id as string, r, n, "2026-09-02");
    const asset = await paymentAsset(l.installments[0]?.id as string);
    expect(asset.folderLabel).toBe("Parcela 1 - 08-2026");
  });

  it("nome higienizado e duplicado ganha (2), (3)", async () => {
    // Três nomes diferentes que, higienizados, viram o mesmo "Ana Souza ME".
    const first = await line('Ana/Souza: "ME"?', "2026-09-05");
    const second = await line("Ana|Souza *ME*", "2026-09-05");
    const third = await line("Ana\\Souza <ME>", "2026-09-05");
    const names: string[] = [];
    for (const l of [first, second, third]) {
      const r = await upload("receipt", await makePdf(["C"]));
      const n = await upload("invoice", await makePdf(["N"]));
      const state = await getState(ctx.actors.member, ctx.project.id);
      const result = await call(
        ctx.actors.member,
        "POST",
        `/${ctx.project.id}/save`,
        {
          version: state.version,
          payments: [
            {
              installmentId: l.installments[0]?.id,
              paidCents: 1000,
              paidAt: "2026-10-10",
              receiptAssetIds: [r],
              invoiceAssetIds: [n],
            },
          ],
        },
      );
      expect(result.status, result.text).toBe(200);
      names.push(
        (await paymentAsset(l.installments[0]?.id as string)).filename,
      );
    }
    expect(names).toEqual([
      "Ana Souza ME - Parcela 1.pdf",
      "Ana Souza ME - Parcela 1 (2).pdf",
      "Ana Souza ME - Parcela 1 (3).pdf",
    ]);
  });

  it("renomear o projeto não quebra nada: a chave no armazenamento só tem ids", async () => {
    const l = await line();
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    await pay(l.installments[0]?.id as string, r, n);
    const asset = await paymentAsset(l.installments[0]?.id as string);
    expect(asset.objectKey).toContain(
      `/project/${ctx.project.id}/financeiro/${l.installments[0]?.id}/`,
    );
    expect(asset.objectKey.toLowerCase()).not.toContain("cultura");
    expect(asset.objectKey.toLowerCase()).not.toContain("mirella");
    await db
      .update(schema.projectTable)
      .set({ name: "Outro nome" })
      .where(eq(schema.projectTable.id, ctx.project.id));
    expect((await download("member", asset.id)).status).toBe(200);
  });
});

describe("acesso aos arquivos", () => {
  it("baixa com o nome certo; outro workspace e anônimo não baixam; não há link público", async () => {
    const l = await line();
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    await pay(l.installments[0]?.id as string, r, n);
    const asset = await paymentAsset(l.installments[0]?.id as string);

    const ok = await download("member", asset.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toContain(
      "Mirella Sombrio - Parcela 1.pdf",
    );
    for (const role of ["viewer", "admin", "owner"] as const) {
      expect((await download(role, asset.id)).status).toBe(200);
    }

    expect((await download("outsider", asset.id)).status).toBe(403);
    expect((await download(null, asset.id)).status).toBe(401);

    // Projeto público não abre os arquivos do financeiro.
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, ctx.project.id));
    expect((await download(null, asset.id)).status).toBe(401);
    expect((await download("outsider", asset.id)).status).toBe(403);
  });

  it("papel personalizado sem finance:read não baixa", async () => {
    const l = await line();
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    await pay(l.installments[0]?.id as string, r, n);
    const asset = await paymentAsset(l.installments[0]?.id as string);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: ctx.workspace.id,
      role: "viewer",
      permission: JSON.stringify({ project: ["read"], task: ["read"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await download("viewer", asset.id)).status).toBe(403);
  });

  it("viewer não envia arquivos; member envia comprovante e NF", async () => {
    const denied = await uploadVia(
      ctx.actors.viewer,
      ctx.project.id,
      "receipt",
      "c.pdf",
      await makePdf(["C"]),
    );
    expect(denied.status).toBe(403);
    const okay = await uploadVia(
      ctx.actors.member,
      ctx.project.id,
      "receipt",
      "c.pdf",
      await makePdf(["C"]),
    );
    expect(okay.status).toBe(200);
    const foreign = await uploadVia(
      ctx.outsider,
      ctx.project.id,
      "receipt",
      "c.pdf",
      await makePdf(["C"]),
    );
    expect(foreign.status).toBe(403);
  });

  it("arquivo grande demais é recusado pelo limite (FINANCE_MAX_FILE_BYTES)", async () => {
    vi.stubEnv("FINANCE_MAX_FILE_BYTES", "2000");
    const big = await makePdf(
      Array.from({ length: 60 }, (_, index) => `pagina ${index}`),
    );
    expect(big.byteLength).toBeGreaterThan(2000);
    const result = await uploadVia(
      ctx.actors.member,
      ctx.project.id,
      "receipt",
      "grande.pdf",
      big,
    );
    expect(result.status).toBe(413);
  });
});

describe("anexos do projeto", () => {
  it("member anexa e lista; só quem gerencia remove", async () => {
    const created = await uploadVia(
      ctx.actors.member,
      ctx.project.id,
      "project",
      "Projeto aprovado.pdf",
      await makePdf(["Projeto"]),
    );
    expect(created.status, created.text).toBe(200);
    const listed = await call<{
      projectFiles: Array<{ id: string; name: string }>;
    }>(ctx.actors.viewer, "GET", `/${ctx.project.id}/files`);
    expect(listed.body.projectFiles.map((f) => f.name)).toEqual([
      "Projeto aprovado.pdf",
    ]);

    const asDelete = (actor: keyof FinanceContext["actors"]) =>
      call(
        ctx.actors[actor],
        "DELETE",
        `/${ctx.project.id}/files/${created.body.id}`,
      );
    expect((await asDelete("member")).status).toBe(403);
    expect((await asDelete("viewer")).status).toBe(403);
    const removed = await asDelete("admin");
    expect(removed.status).toBe(204);
    expect(fakeStore.size).toBe(0);
    expect((await asDelete("admin")).status).toBe(404);
  });

  it("PDF de pagamento não é removido por essa rota", async () => {
    const l = await line();
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    await pay(l.installments[0]?.id as string, r, n);
    const asset = await paymentAsset(l.installments[0]?.id as string);
    const result = await call(
      ctx.actors.admin,
      "DELETE",
      `/${ctx.project.id}/files/${asset.id}`,
    );
    expect(result.status).toBe(404);
    expect(fakeStore.has(asset.objectKey)).toBe(true);
  });
});

describe("desfazer pagamento", () => {
  it("o PDF continua guardado, marcado como desfeito (quem e quando), e some da árvore de quem não é admin", async () => {
    const l = await line();
    const r = await upload("receipt", await makePdf(["C"]));
    const n = await upload("invoice", await makePdf(["N"]));
    await pay(l.installments[0]?.id as string, r, n);
    const asset = await paymentAsset(l.installments[0]?.id as string);

    const undone = await call(
      ctx.actors.admin,
      "POST",
      `/installments/${l.installments[0]?.id}/undo`,
    );
    expect(undone.status, undone.text).toBe(200);

    const [row] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, asset.id));
    expect(row?.undoneBy).toBe(ctx.actors.admin.user.id);
    expect(row?.undoneAt).toBeInstanceOf(Date);
    expect(fakeStore.has(asset.objectKey)).toBe(true);
    expect(undone.body.lines[0]?.installments[0]?.fileAssetId).toBeNull();

    type Files = {
      parcels: unknown[];
      filesCount: number;
      undone: Array<{ name: string; undoneByName: string | null }>;
    };
    const asMember = await call<Files>(
      ctx.actors.member,
      "GET",
      `/${ctx.project.id}/files`,
    );
    expect(asMember.body.filesCount).toBe(0);
    expect(asMember.body.undone).toEqual([]);
    const asAdmin = await call<Files>(
      ctx.actors.admin,
      "GET",
      `/${ctx.project.id}/files`,
    );
    expect(asAdmin.body.undone.map((f) => f.name)).toEqual([
      "Mirella Sombrio - Parcela 1.pdf",
    ]);
    expect(asAdmin.body.undone[0]?.undoneByName).toBe(
      ctx.actors.admin.user.name,
    );

    // Pagar de novo gera outro arquivo, com " (2)" porque o antigo continua na pasta.
    const r2 = await upload("receipt", await makePdf(["C2"]));
    const n2 = await upload("invoice", await makePdf(["N2"]));
    expect((await pay(l.installments[0]?.id as string, r2, n2)).status).toBe(
      200,
    );
    expect((await paymentAsset(l.installments[0]?.id as string)).filename).toBe(
      "Mirella Sombrio - Parcela 1 (2).pdf",
    );
  });
});

describe("árvore, contagem e download em ZIP", () => {
  it("N parcelas pagas · N arquivos; ZIP traz a pasta e o nome certos", async () => {
    const a = await line("Mirella Sombrio");
    const b = await line("Fabio Matias");
    for (const l of [a, b]) {
      const r = await upload("receipt", await makePdf([`C ${l.supplier}`]));
      const n = await upload("invoice", await makePdf([`N ${l.supplier}`]));
      expect((await pay(l.installments[0]?.id as string, r, n)).status).toBe(
        200,
      );
    }
    type Files = {
      paidInstallments: number;
      filesCount: number;
      parcels: Array<{ label: string; number: number; files: unknown[] }>;
    };
    const files = await call<Files>(
      ctx.actors.viewer,
      "GET",
      `/${ctx.project.id}/files`,
    );
    expect(files.body.paidInstallments).toBe(2);
    expect(files.body.filesCount).toBe(2);
    expect(files.body.parcels).toHaveLength(1);
    expect(files.body.parcels[0]).toMatchObject({
      label: "Parcela 1 - 09-2026",
      number: 1,
    });

    mockAuthenticatedSession(ctx.actors.viewer.user);
    const zip = await app.request(
      `/api/project-finance/${ctx.project.id}/files/parcels/1/zip`,
    );
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "Parcela 1 - 09-2026/Fabio Matias - Parcela 1.pdf",
      "Parcela 1 - 09-2026/Mirella Sombrio - Parcela 1.pdf",
    ]);

    mockAuthenticatedSession(ctx.actors.viewer.user);
    const none = await app.request(
      `/api/project-finance/${ctx.project.id}/files/parcels/2/zip`,
    );
    expect(none.status).toBe(404);
    mockAuthenticatedSession(ctx.outsider.user);
    const denied = await app.request(
      `/api/project-finance/${ctx.project.id}/files/parcels/1/zip`,
    );
    expect(denied.status).toBe(403);
  });
});

describe("limpeza de envios temporários", () => {
  it("apaga só os envios com mais de 24 h sem uso", async () => {
    const old = await upload("receipt", await makePdf(["velho"]));
    const fresh = await upload("invoice", await makePdf(["novo"]));
    const [oldRow] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, old));
    const now = new Date(
      (oldRow?.createdAt.getTime() as number) + 25 * 60 * 60 * 1000,
    );
    // O "novo" foi criado 25 h antes de "agora" também; recente = criado agora.
    await db
      .update(schema.assetTable)
      .set({ createdAt: new Date(now.getTime() - 60_000) })
      .where(eq(schema.assetTable.id, fresh));

    const result = await cleanupExpiredFinanceUploads(now);
    expect(result).toEqual({ removed: 1, degraded: false });
    const remaining = await db
      .select({ id: schema.assetTable.id })
      .from(schema.assetTable);
    expect(remaining.map((row) => row.id)).toEqual([fresh]);
    expect(fakeStore.size).toBe(1);
  });

  it("não mexe em anexos do projeto nem em PDFs de pagamento", async () => {
    const project = await uploadVia(
      ctx.actors.member,
      ctx.project.id,
      "project",
      "a.pdf",
      await makePdf(["A"]),
    );
    expect(project.status).toBe(200);
    const result = await cleanupExpiredFinanceUploads(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );
    expect(result.removed).toBe(0);
    expect(fakeStore.size).toBe(1);
  });
});
