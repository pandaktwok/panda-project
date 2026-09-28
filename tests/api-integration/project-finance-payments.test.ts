import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import type { FinanceState } from "../../apps/api/src/project-finance/response";
import {
  addConnection,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { resetTestDatabase } from "./helpers/database";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  call,
  createLineVia,
  type FinanceContext,
  getState,
  reais,
  setupFinance,
} from "./helpers/finance";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

let ctx: FinanceContext;

const events: Array<{
  projectId: string;
  workspaceId: string;
  action: string;
}> = [];
await subscribeToEvent<{
  projectId: string;
  workspaceId: string;
  action: string;
}>("project-finance.updated", async (data) => {
  events.push(data);
});

beforeEach(async () => {
  await resetTestDatabase();
  resetFakeStorage();
  events.length = 0;
  vi.stubEnv("FINANCE_TODAY", "2026-09-24");
  ctx = await setupFinance();
});

// Linha do caso do dono: total 65.600,00 em 10 parcelas mensais.
async function ownerLine(total = reais(65_600), count = 10) {
  const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
    supplier: "Mirella Sombrio",
    totalCents: total,
    installmentsCount: count,
    firstDueDate: "2026-01-10",
  });
  return line;
}

async function save(
  actor: keyof FinanceContext["actors"],
  version: string,
  payments: Array<{
    installmentId: string;
    paidCents: number;
    paidAt: string;
    receiptAssetIds?: string[];
    invoiceAssetIds?: string[];
  }>,
) {
  return call(ctx.actors[actor], "POST", `/${ctx.project.id}/save`, {
    version,
    payments,
  });
}

async function installmentsSnapshot() {
  return db
    .select()
    .from(schema.projectInstallmentTable)
    .orderBy(
      schema.projectInstallmentTable.lineId,
      schema.projectInstallmentTable.number,
    );
}

describe("salvar em lote", () => {
  it("caso do dono: 8 parcelas pagas somando 52.820,00 -> a 9 e a 10 passam a valer 6.390,00", async () => {
    const line = await ownerLine();
    const state = await getState(ctx.actors.member, ctx.project.id);
    // 7 x 6.600,00 + 6.620,00 = 52.820,00
    const amounts = [...Array(7).fill(reais(6600)), reais(6620)];
    const payments = amounts.map((paidCents, index) => ({
      installmentId: line.installments[index]?.id as string,
      paidCents,
      paidAt: `2026-0${index + 1}-11`,
    }));
    const result = await save("member", state.version, payments);
    expect(result.status, result.text).toBe(200);

    const saved = result.body.lines[0];
    expect(saved?.paidCents).toBe(reais(52_820));
    expect(saved?.remainingCents).toBe(reais(12_780));
    expect(saved?.installments.slice(8).map((i) => i.expectedCents)).toEqual([
      639_000, 639_000,
    ]);
    expect(saved?.warning).toBeNull();
    expect(
      saved?.installments.slice(0, 8).every((i) => i.status === "paid"),
    ).toBe(true);
    expect(saved?.installments[0]).toMatchObject({
      paidBy: ctx.actors.member.user.id,
      paidAt: "2026-01-11",
      paidCents: reais(6600),
      fileAssetId: expect.any(String),
    });
    // Estado devolvido = estado lido depois.
    expect(await getState(ctx.actors.viewer, ctx.project.id)).toEqual(
      result.body,
    );
    expect(result.body.version).not.toBe(state.version);
  });

  it("pagar exatamente o previsto não muda os valores das outras", async () => {
    const line = await ownerLine();
    const state = await getState(ctx.actors.member, ctx.project.id);
    const result = await save("admin", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(6560),
        paidAt: "2026-01-10",
      },
    ]);
    expect(result.status).toBe(200);
    expect(
      new Set(
        result.body.lines[0]?.installments.slice(1).map((i) => i.expectedCents),
      ),
    ).toEqual(new Set([656_000]));
  });

  it("pagamento fora de ordem e da última parcela recalcula pela contagem de pagas", async () => {
    const line = await ownerLine(reais(1000), 10);
    const state = await getState(ctx.actors.member, ctx.project.id);
    // Paga só a 10ª por R$ 500,00.
    const result = await save("member", state.version, [
      {
        installmentId: line.installments[9]?.id as string,
        paidCents: reais(500),
        paidAt: "2026-10-10",
      },
    ]);
    expect(result.status).toBe(200);
    const items = result.body.lines[0]?.installments ?? [];
    const unpaid = items.filter((i) => !i.paidAt);
    expect(unpaid).toHaveLength(9);
    // (1000 - 500) / 9 = 55,5555 -> 5555 centavos e a última não paga leva o resto.
    expect(unpaid.slice(0, 8).map((i) => i.expectedCents)).toEqual(
      Array(8).fill(5555),
    );
    expect(unpaid[8]?.expectedCents).toBe(5560);
    expect(unpaid.reduce((s, i) => s + i.expectedCents, 0)).toBe(reais(500));
  });

  it("pago >= total da linha: restantes valem 0 e há aviso", async () => {
    const line = await ownerLine(reais(1000), 4);
    const state = await getState(ctx.actors.member, ctx.project.id);
    const result = await save("admin", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(1200),
        paidAt: "2026-01-10",
      },
    ]);
    expect(result.status).toBe(200);
    const saved = result.body.lines[0];
    expect(saved?.warning).toBe("paid_reached_total");
    expect(saved?.remainingCents).toBe(0);
    expect(saved?.installments.slice(1).map((i) => i.expectedCents)).toEqual([
      0, 0, 0,
    ]);
    expect(result.body.totals.remainingCents).toBe(0);
  });

  it("linhas diferentes no mesmo lote são recalculadas de forma independente", async () => {
    const a = await ownerLine(reais(1000), 4);
    const { line: b } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Outra",
      totalCents: reais(600),
      installmentsCount: 3,
      firstDueDate: "2026-01-10",
    });
    const state = await getState(ctx.actors.member, ctx.project.id);
    const result = await save("member", state.version, [
      {
        installmentId: a.installments[0]?.id as string,
        paidCents: reais(100),
        paidAt: "2026-01-10",
      },
      {
        installmentId: b.installments[0]?.id as string,
        paidCents: reais(300),
        paidAt: "2026-01-10",
      },
    ]);
    expect(result.status).toBe(200);
    const [la, lb] = result.body.lines;
    expect(la?.installments.slice(1).map((i) => i.expectedCents)).toEqual([
      30_000, 30_000, 30_000,
    ]);
    expect(lb?.installments.slice(1).map((i) => i.expectedCents)).toEqual([
      15_000, 15_000,
    ]);
  });

  it("tudo ou nada: um item inválido desfaz o lote inteiro", async () => {
    const line = await ownerLine(reais(1000), 4);
    const { line: foreign } = await createLineVia(
      ctx.outsider,
      ctx.otherProject.id,
      {
        supplier: "Alheio",
        totalCents: 1000,
        installmentsCount: 2,
        firstDueDate: "2026-01-10",
      },
    );
    const state = await getState(ctx.actors.member, ctx.project.id);
    const before = await installmentsSnapshot();
    events.length = 0;
    const good = {
      installmentId: line.installments[0]?.id as string,
      paidCents: reais(50),
      paidAt: "2026-01-10",
    };

    const attempts = [
      // parcela de outro projeto/workspace
      {
        expected: 404,
        extra: {
          installmentId: foreign.installments[0]?.id as string,
          paidCents: 1,
          paidAt: "2026-01-10",
        },
      },
      // parcela inexistente
      {
        expected: 404,
        extra: {
          installmentId: "nao-existe",
          paidCents: 1,
          paidAt: "2026-01-10",
        },
      },
      // arquivo inexistente
      {
        expected: 404,
        extra: {
          installmentId: line.installments[1]?.id as string,
          paidCents: 1,
          paidAt: "2026-01-10",
          receiptAssetIds: ["nao-existe"],
          invoiceAssetIds: ["nao-existe-tambem"],
        },
      },
      // valor negativo, fracionado, data inválida (rejeitados na validação)
      {
        expected: 400,
        extra: {
          installmentId: line.installments[1]?.id as string,
          paidCents: -1,
          paidAt: "2026-01-10",
        },
      },
      {
        expected: 400,
        extra: {
          installmentId: line.installments[1]?.id as string,
          paidCents: 10.5,
          paidAt: "2026-01-10",
        },
      },
      {
        expected: 400,
        extra: {
          installmentId: line.installments[1]?.id as string,
          paidCents: 1,
          paidAt: "2026-02-30",
        },
      },
      {
        expected: 400,
        extra: {
          installmentId: line.installments[1]?.id as string,
          paidCents: 1,
          paidAt: "amanhã",
        },
      },
      // a mesma parcela duas vezes
      { expected: 400, extra: good },
    ];
    for (const { expected, extra } of attempts) {
      const result = await save("member", state.version, [good, extra]);
      expect(result.status, JSON.stringify(extra)).toBe(expected);
      expect(await installmentsSnapshot()).toEqual(before);
      expect((await getState(ctx.actors.viewer, ctx.project.id)).version).toBe(
        state.version,
      );
    }
    expect(events).toEqual([]);
  });

  it("parcela já paga não pode ser paga de novo pelo salvar (desfazer é separado); lote intacto", async () => {
    const line = await ownerLine(reais(1000), 4);
    const state = await getState(ctx.actors.member, ctx.project.id);
    const first = await save("member", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-01-10",
      },
    ]);
    expect(first.status).toBe(200);
    const before = await installmentsSnapshot();
    const again = await save("member", first.body.version, [
      {
        installmentId: line.installments[1]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-02-10",
      },
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(999),
        paidAt: "2026-01-11",
      },
    ]);
    expect(again.status).toBe(409);
    expect(await installmentsSnapshot()).toEqual(before);
  });

  it("versão velha: 409 com o estado atual e nada é gravado", async () => {
    const line = await ownerLine(reais(1000), 4);
    const stale = await getState(ctx.actors.member, ctx.project.id);
    // Outra pessoa mexe no meio (renomeia o fornecedor).
    const other = await call(ctx.actors.admin, "PUT", `/lines/${line.id}`, {
      supplier: "Mirella S.",
    });
    expect(other.status).toBe(200);
    const before = await installmentsSnapshot();
    events.length = 0;

    const result = await call<{ message: string; state: FinanceState }>(
      ctx.actors.member,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: stale.version,
        payments: [
          {
            installmentId: line.installments[0]?.id as string,
            paidCents: reais(250),
            paidAt: "2026-01-10",
          },
        ],
      },
    );
    expect(result.status).toBe(409);
    expect(result.body.message).toEqual(expect.any(String));
    expect(result.body.state.version).toBe(other.body.version);
    expect(result.body.state.lines[0]?.supplier).toBe("Mirella S.");
    expect(await installmentsSnapshot()).toEqual(before);
    expect(events).toEqual([]);

    // Com a versão atual funciona.
    const retry = await save("member", result.body.state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-01-10",
      },
    ]);
    expect(retry.status).toBe(200);
  });

  it("alterar uma tag ou o padrão do projeto também invalida a versão", async () => {
    await ownerLine(reais(1000), 4);
    const v1 = await getState(ctx.actors.member, ctx.project.id);
    await call(ctx.actors.admin, "POST", `/${ctx.project.id}/tags`, {
      name: "Nova",
    });
    const v2 = await getState(ctx.actors.member, ctx.project.id);
    expect(v2.version).not.toBe(v1.version);
    await call(ctx.actors.admin, "PUT", `/${ctx.project.id}/settings`, {
      financeMonths: 3,
    });
    const v3 = await getState(ctx.actors.member, ctx.project.id);
    expect(v3.version).not.toBe(v2.version);
  });

  it("dois salvamentos ao mesmo tempo com a mesma versão: um vence, o outro recebe 409; totais ficam certos", async () => {
    const line = await ownerLine(reais(1000), 4);
    const state = await getState(ctx.actors.member, ctx.project.id);
    events.length = 0;
    const [a, b] = await Promise.all([
      save("member", state.version, [
        {
          installmentId: line.installments[0]?.id as string,
          paidCents: reais(400),
          paidAt: "2026-01-10",
        },
      ]),
      save("admin", state.version, [
        {
          installmentId: line.installments[1]?.id as string,
          paidCents: reais(100),
          paidAt: "2026-02-10",
        },
      ]),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(
      (loser.body as unknown as { state: FinanceState }).state.version,
    ).toBeDefined();

    const final = await getState(ctx.actors.viewer, ctx.project.id);
    const items = final.lines[0]?.installments ?? [];
    expect(items.filter((i) => i.paidAt)).toHaveLength(1);
    const totalPaid = items.reduce((s, i) => s + (i.paidCents ?? 0), 0);
    const expectedSum = items
      .filter((i) => !i.paidAt)
      .reduce((s, i) => s + i.expectedCents, 0);
    expect(totalPaid + expectedSum).toBe(reais(1000));
    expect(final.totals.paidCents).toBe(totalPaid);
    expect(events).toHaveLength(1);
  });

  it("muitos salvamentos simultâneos, cada um refazendo com a versão nova, aplicam todos e o total fecha", async () => {
    const line = await ownerLine(reais(1200), 6);
    const ids = line.installments.map((i) => i.id);

    async function saveWithRetry(installmentId: string, cents: number) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const state = await getState(ctx.actors.member, ctx.project.id);
        const result = await save("member", state.version, [
          { installmentId, paidCents: cents, paidAt: "2026-03-10" },
        ]);
        if (result.status === 200) return attempt;
        expect(result.status).toBe(409);
      }
      throw new Error("too many conflicts");
    }
    await Promise.all(
      ids
        .slice(0, 5)
        .map((id, index) => saveWithRetry(id, reais(100 + index * 10))),
    );

    const final = await getState(ctx.actors.viewer, ctx.project.id);
    const items = final.lines[0]?.installments ?? [];
    const paid = items.filter((i) => i.paidAt);
    expect(paid).toHaveLength(5);
    const paidTotal = paid.reduce((s, i) => s + (i.paidCents ?? 0), 0);
    expect(paidTotal).toBe(reais(100 + 110 + 120 + 130 + 140));
    // A única não paga leva exatamente o que falta.
    const last = items.filter((i) => !i.paidAt);
    expect(last).toHaveLength(1);
    expect(last[0]?.expectedCents).toBe(reais(1200) - paidTotal);
    expect(final.totals).toMatchObject({
      paidCents: paidTotal,
      remainingCents: reais(1200) - paidTotal,
    });
  });

  it("pagar exige finance:attach (todo pagamento leva arquivos); papel personalizado sem attach é recusado e nada é gravado", async () => {
    const line = await ownerLine(reais(1000), 4);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: ctx.workspace.id,
      role: "member",
      permission: JSON.stringify({ finance: ["read", "pay"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const state = await getState(ctx.actors.member, ctx.project.id);
    const denied = await save("member", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-01-10",
      },
    ]);
    expect(denied.status).toBe(403);
    expect(await installmentsSnapshot()).toSatisfy(
      (rows: Array<{ paidAt: string | null }>) => rows.every((r) => !r.paidAt),
    );
  });

  it("o pagamento guarda a referência do PDF único gerado", async () => {
    const line = await ownerLine(reais(1000), 4);
    const state = await getState(ctx.actors.member, ctx.project.id);
    const result = await save("member", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-01-10",
      },
    ]);
    expect(result.status, result.text).toBe(200);
    const fileId = result.body.lines[0]?.installments[0]?.fileAssetId;
    expect(fileId).toEqual(expect.any(String));
    const [asset] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, fileId as string));
    expect(asset).toMatchObject({
      surface: "payment",
      mimeType: "application/pdf",
      projectId: ctx.project.id,
      filename: "Mirella Sombrio - Parcela 1.pdf",
      folderLabel: "Parcela 1 - 01-2026",
    });
  });
});

describe("desfazer pagamento", () => {
  it("a parcela volta a não paga e as restantes são recalculadas pela regra; desfazer tudo restaura o original", async () => {
    const line = await ownerLine();
    const state = await getState(ctx.actors.member, ctx.project.id);
    const amounts = [...Array(7).fill(reais(6600)), reais(6620)];
    const paid = await save(
      "member",
      state.version,
      amounts.map((paidCents, index) => ({
        installmentId: line.installments[index]?.id as string,
        paidCents,
        paidAt: `2026-0${index + 1}-11`,
      })),
    );
    expect(paid.status).toBe(200);
    events.length = 0;

    // Desfaz a 8ª: sobram 7 pagas (46.200) -> (65.600 - 46.200) / 3 = 6.466,66...
    const undone = await call(
      ctx.actors.admin,
      "POST",
      `/installments/${line.installments[7]?.id}/undo`,
    );
    expect(undone.status, undone.text).toBe(200);
    const items = undone.body.lines[0]?.installments ?? [];
    expect(items[7]).toMatchObject({
      paidAt: null,
      paidCents: null,
      paidBy: null,
      fileAssetId: null,
      status: "overdue",
    });
    expect(items.slice(7).map((i) => i.expectedCents)).toEqual([
      646_666, 646_666, 646_668,
    ]);
    expect(undone.body.lines[0]?.paidCents).toBe(reais(46_200));
    expect(events.map((e) => e.action)).toEqual(["payment.undone"]);

    // Desfazendo todas, o cronograma volta ao original (6.560,00 cada).
    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      const step = await call(
        ctx.actors.owner,
        "POST",
        `/installments/${line.installments[index]?.id}/undo`,
      );
      expect(step.status).toBe(200);
    }
    const restored = await getState(ctx.actors.viewer, ctx.project.id);
    expect(restored.lines[0]?.installments.map((i) => i.expectedCents)).toEqual(
      Array(10).fill(656_000),
    );
    expect(restored.lines[0]?.paidCents).toBe(0);
    expect(restored.totals.paidCents).toBe(0);
  });

  it("desfazer parcela que não está paga é 409; parcela inexistente não vaza", async () => {
    const line = await ownerLine(reais(1000), 4);
    const notPaid = await call(
      ctx.actors.admin,
      "POST",
      `/installments/${line.installments[0]?.id}/undo`,
    );
    expect(notPaid.status).toBe(409);
    const missing = await call(
      ctx.actors.admin,
      "POST",
      "/installments/nao-existe/undo",
    );
    expect([400, 404]).toContain(missing.status);
  });

  it("usuário (member) e viewer não desfazem; o pagamento continua", async () => {
    const line = await ownerLine(reais(1000), 4);
    const state = await getState(ctx.actors.member, ctx.project.id);
    await save("member", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-01-10",
      },
    ]);
    for (const role of ["member", "viewer"] as const) {
      const result = await call(
        ctx.actors[role],
        "POST",
        `/installments/${line.installments[0]?.id}/undo`,
      );
      expect(result.status).toBe(403);
    }
    const [row] = await db
      .select()
      .from(schema.projectInstallmentTable)
      .where(
        eq(
          schema.projectInstallmentTable.id,
          line.installments[0]?.id as string,
        ),
      );
    expect(row?.paidAt).toBe("2026-01-10");
  });
});

describe("eventos em tempo real", () => {
  it("cada mutação publica project-finance.updated com projeto e workspace", async () => {
    const { tag } = await (await import("./helpers/finance")).createTagVia(
      ctx.actors.admin,
      ctx.project.id,
      { name: "T" },
    );
    const line = await ownerLine(reais(1000), 4);
    await call(ctx.actors.admin, "PUT", `/tags/${tag.id}`, { valueCents: 5 });
    await call(ctx.actors.admin, "PUT", `/lines/${line.id}`, { supplier: "Z" });
    await call(ctx.actors.admin, "PUT", `/${ctx.project.id}/settings`, {
      financeMonths: 2,
    });
    const state = await getState(ctx.actors.member, ctx.project.id);
    await save("member", state.version, [
      {
        installmentId: line.installments[0]?.id as string,
        paidCents: reais(250),
        paidAt: "2026-01-10",
      },
    ]);
    await call(
      ctx.actors.admin,
      "POST",
      `/installments/${line.installments[0]?.id}/undo`,
    );
    await call(ctx.actors.admin, "DELETE", `/tags/${tag.id}`);
    await call(ctx.actors.admin, "DELETE", `/lines/${line.id}`);

    expect(events.map((e) => e.action)).toEqual([
      "tag.created",
      "line.created",
      "tag.updated",
      "line.updated",
      "settings.updated",
      "payments.saved",
      "payment.undone",
      "tag.deleted",
      "line.deleted",
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        projectId: ctx.project.id,
        workspaceId: ctx.workspace.id,
      });
    }
  });

  it("negados e recusados (403, 409, validação) não publicam nada", async () => {
    const { tag } = await (await import("./helpers/finance")).createTagVia(
      ctx.actors.admin,
      ctx.project.id,
      { name: "T" },
    );
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "F",
      totalCents: 1000,
      installmentsCount: 2,
      firstDueDate: "2026-01-10",
      tagId: tag.id,
    });
    events.length = 0;
    await call(ctx.actors.member, "POST", `/${ctx.project.id}/tags`, {
      name: "x",
    });
    await call(ctx.actors.admin, "POST", `/${ctx.project.id}/tags`, {
      name: "T",
    });
    await call(ctx.actors.admin, "DELETE", `/tags/${tag.id}`); // em uso
    await call(ctx.actors.admin, "POST", `/${ctx.project.id}/tags`, {
      name: "",
    });
    expect(events).toEqual([]);
  });

  it("o WebSocket do projeto recebe PROJECT_FINANCE_UPDATED (menos quem originou)", async () => {
    await initializeWebSocketAdapter();
    const other = { send: vi.fn() };
    const origin = { send: vi.fn() };
    const otherConn = addConnection(
      ctx.project.id,
      other as never,
      ctx.actors.viewer.user.id,
      `${ctx.actors.viewer.user.id}:janela`,
    );
    const originConn = addConnection(
      ctx.project.id,
      origin as never,
      ctx.actors.admin.user.id,
      ctx.actors.admin.user.id,
    );
    try {
      const result = await call(
        ctx.actors.admin,
        "POST",
        `/${ctx.project.id}/tags`,
        {
          name: "Ao vivo",
        },
      );
      expect(result.status).toBe(200);
      await vi.waitFor(() => expect(other.send).toHaveBeenCalledTimes(1), {
        timeout: 2_000,
      });
      expect(JSON.parse(other.send.mock.calls[0]?.[0] as string)).toEqual({
        type: "PROJECT_FINANCE_UPDATED",
        projectId: ctx.project.id,
      });
      expect(origin.send).not.toHaveBeenCalled();
    } finally {
      removeConnection(ctx.project.id, otherConn);
      removeConnection(ctx.project.id, originConn);
      await shutdownWebSocketAdapter();
    }
  });
});
