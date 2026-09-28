import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { insertNotification } from "../../apps/api/src/notification/controllers/create-notification";
import {
  runFinalStretchNotices,
  sendFinalStretchNotices,
} from "../../apps/api/src/scheduler/final-stretch-notices";
import { sendOutboundRequest } from "../../apps/api/src/utils/outbound-request";
import { resetTestDatabase } from "./helpers/database";
import {
  createLineVia,
  type FinanceContext,
  getState,
  reais,
  setupFinance,
} from "./helpers/finance";

vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/utils/outbound-request", async (original) => ({
  ...(await original<object>()),
  sendOutboundRequest: vi.fn(async () => undefined),
}));
vi.mock(
  "../../apps/api/src/notification/controllers/create-notification",
  async (original) => {
    const actual =
      await original<
        typeof import("../../apps/api/src/notification/controllers/create-notification")
      >();
    return {
      ...actual,
      insertNotification: vi.fn(actual.insertNotification),
    };
  },
);

// Fuso de Brasília = UTC-3 (sem horário de verão): 08:00 lá = 11:00Z.
const at = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

let ctx: FinanceContext;

async function noticeRows() {
  return db
    .select()
    .from(schema.projectFinalStretchNoticeTable)
    .where(eq(schema.projectFinalStretchNoticeTable.projectId, ctx.project.id));
}

async function notificationsOf(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, "project_final_stretch"),
      ),
    );
}

async function payEverything() {
  await db
    .update(schema.projectInstallmentTable)
    .set({ paidAt: "2026-08-01", paidCents: 1 });
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  vi.stubEnv("KANEO_CLIENT_URL", "https://panda.example.com");
  ctx = await setupFinance();
  // 10 parcelas mensais: 10/01 ... 10/10/2026. Reta final: a partir de 10/08.
  await createLineVia(ctx.actors.admin, ctx.project.id, {
    supplier: "Mirella Sombrio",
    totalCents: reais(65_600),
    installmentsCount: 10,
    firstDueDate: "2026-01-10",
  });
});

describe("aviso mensal de reta final", () => {
  it("nada antes do vencimento da antepenúltima parcela; dispara às 08:00 dele", async () => {
    expect((await sendFinalStretchNotices(at("2026-07-31T12:00"))).sent).toBe(
      0,
    );
    expect((await sendFinalStretchNotices(at("2026-08-09T23:59"))).sent).toBe(
      0,
    );
    // no dia 10, antes das 08:00
    expect((await sendFinalStretchNotices(at("2026-08-10T07:59"))).sent).toBe(
      0,
    );
    expect(await noticeRows()).toHaveLength(0);

    expect((await sendFinalStretchNotices(at("2026-08-10T08:00"))).sent).toBe(
      1,
    );
    const rows = await noticeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.month).toBe("2026-08");
  });

  it("não repete no mesmo mês, mesmo rodando o job várias vezes", async () => {
    await sendFinalStretchNotices(at("2026-08-10T08:00"));
    for (const when of [
      "2026-08-10T08:05",
      "2026-08-15T12:00",
      "2026-08-31T23:59",
    ]) {
      expect((await sendFinalStretchNotices(at(when))).sent).toBe(0);
    }
    expect(await noticeRows()).toHaveLength(1);
    expect(await notificationsOf(ctx.actors.admin.user.id)).toHaveLength(1);
  });

  it("repete no mês seguinte, no dia do vencimento (ajustando meses curtos) e para quando tudo está pago", async () => {
    await sendFinalStretchNotices(at("2026-08-10T08:00"));
    // setembro: antes do dia 10 não avisa
    expect((await sendFinalStretchNotices(at("2026-09-09T20:00"))).sent).toBe(
      0,
    );
    expect((await sendFinalStretchNotices(at("2026-09-10T08:00"))).sent).toBe(
      1,
    );
    expect((await sendFinalStretchNotices(at("2026-10-10T09:00"))).sent).toBe(
      1,
    );
    // depois do último vencimento, com parcela em aberto, continua todo mês
    expect((await sendFinalStretchNotices(at("2026-11-10T09:00"))).sent).toBe(
      1,
    );
    expect((await noticeRows()).map((r) => r.month).sort()).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);

    await payEverything();
    expect((await sendFinalStretchNotices(at("2026-12-10T09:00"))).sent).toBe(
      0,
    );
    expect(await noticeRows()).toHaveLength(4);
  });

  it("dia de vencimento 31: em mês curto avisa no último dia", async () => {
    await resetTestDatabase();
    ctx = await setupFinance();
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Linha 31",
      totalCents: reais(1_000),
      installmentsCount: 5,
      firstDueDate: "2026-05-31",
    });
    // vencimentos 31/05, 30/06, 31/07, 31/08, 30/09 -> reta final a partir de 31/07
    expect((await sendFinalStretchNotices(at("2026-07-30T12:00"))).sent).toBe(
      0,
    );
    expect((await sendFinalStretchNotices(at("2026-07-31T08:00"))).sent).toBe(
      1,
    );
    expect((await sendFinalStretchNotices(at("2026-08-30T12:00"))).sent).toBe(
      0,
    );
    expect((await sendFinalStretchNotices(at("2026-08-31T08:00"))).sent).toBe(
      1,
    );
    // setembro só tem 30 dias: o aviso sai no dia 30, não fica sem aviso
    expect((await sendFinalStretchNotices(at("2026-09-29T12:00"))).sent).toBe(
      0,
    );
    expect((await sendFinalStretchNotices(at("2026-09-30T08:00"))).sent).toBe(
      1,
    );
  });

  it("duas instâncias ao mesmo tempo enviam um único aviso", async () => {
    const when = at("2026-08-10T09:00");
    // com a trava de instância
    const leased = await Promise.all([
      runFinalStretchNotices(when),
      runFinalStretchNotices(when),
      runFinalStretchNotices(when),
    ]);
    expect(leased.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(await noticeRows()).toHaveLength(1);
    expect(await notificationsOf(ctx.actors.admin.user.id)).toHaveLength(1);

    // e mesmo sem a trava, a reserva do mês impede a duplicação
    await resetTestDatabase();
    vi.clearAllMocks();
    ctx = await setupFinance();
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Mirella Sombrio",
      totalCents: reais(65_600),
      installmentsCount: 10,
      firstDueDate: "2026-01-10",
    });
    const raced = await Promise.all([
      sendFinalStretchNotices(when),
      sendFinalStretchNotices(when),
    ]);
    expect(raced.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(await notificationsOf(ctx.actors.admin.user.id)).toHaveLength(1);
    expect(await notificationsOf(ctx.actors.owner.user.id)).toHaveLength(1);
  });

  it("só o dono e os administradores recebem", async () => {
    await sendFinalStretchNotices(at("2026-08-10T08:00"));
    expect(await notificationsOf(ctx.actors.owner.user.id)).toHaveLength(1);
    expect(await notificationsOf(ctx.actors.admin.user.id)).toHaveLength(1);
    expect(await notificationsOf(ctx.actors.member.user.id)).toHaveLength(0);
    expect(await notificationsOf(ctx.actors.viewer.user.id)).toHaveLength(0);
    expect(await notificationsOf(ctx.outsider.user.id)).toHaveLength(0);

    const [note] = await notificationsOf(ctx.actors.admin.user.id);
    expect(note?.title).toBe(
      "Reta final: Cultura e Informação para a Pessoa Idosa",
    );
    expect(note?.content).toBe(
      "As últimas parcelas vencem em 10/08/2026, 10/09/2026 e 10/10/2026. Faltam R$ 65.600,00 a pagar.",
    );
    expect(note?.resourceType).toBe("project");
    expect(note?.resourceId).toBe(ctx.project.id);
    expect(note?.eventData).toMatchObject({
      projectId: ctx.project.id,
      workspaceId: ctx.workspace.id,
      month: "2026-08",
    });
  });

  it("notificação de projeto respeita o acesso: quem saiu do workspace não recebe", async () => {
    const [note] = await notificationsOf(ctx.actors.admin.user.id);
    expect(note).toBeUndefined();
    const created = await insertNotification({
      userId: ctx.outsider.user.id,
      title: "x",
      content: "y",
      type: "project_final_stretch",
      resourceId: ctx.project.id,
      resourceType: "project",
    });
    expect(created).toBeNull();
    const member = await insertNotification({
      userId: ctx.actors.member.user.id,
      title: "x",
      content: "y",
      type: "project_final_stretch",
      resourceId: ctx.project.id,
      resourceType: "project",
    });
    expect(member).not.toBeNull();
  });

  it("webhook do usuário recebe o corpo esperado, com o link do Resumo", async () => {
    const admin = ctx.actors.admin.user;
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: admin.id,
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com/panda",
    });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: admin.id,
      workspaceId: ctx.workspace.id,
      isActive: true,
      webhookEnabled: true,
    });

    await sendFinalStretchNotices(at("2026-08-10T08:00"));

    const calls = vi.mocked(sendOutboundRequest).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toBe("https://hooks.example.com/panda");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(init.body);
    expect(payload.notification).toMatchObject({
      type: "project_final_stretch",
      title: "Reta final: Cultura e Informação para a Pessoa Idosa",
      resourceType: "project",
      resourceId: ctx.project.id,
    });
    expect(payload.project).toEqual({
      id: ctx.project.id,
      name: "Cultura e Informação para a Pessoa Idosa",
      url: `https://panda.example.com/dashboard/workspace/${ctx.workspace.id}/project/${ctx.project.id}/summary`,
    });
    expect(payload.task).toBeNull();
    expect(payload.workspace).toEqual({
      id: ctx.workspace.id,
      name: "Financeiro",
    });
    expect(payload.user.id).toBe(admin.id);

    // histórico do projeto: data e canais
    const [row] = await noticeRows();
    expect(row?.channels.sort()).toEqual(["app", "webhook"]);
    expect(row?.recipients).toBe(2);
  });

  it("falha total libera o mês para o próximo ciclo", async () => {
    vi.mocked(insertNotification).mockRejectedValueOnce(
      new Error("banco fora"),
    );
    vi.mocked(insertNotification).mockRejectedValueOnce(
      new Error("banco fora"),
    );
    const first = await sendFinalStretchNotices(at("2026-08-10T08:00"));
    expect(first.sent).toBe(0);
    expect(await noticeRows()).toHaveLength(0);

    const second = await sendFinalStretchNotices(at("2026-08-10T08:15"));
    expect(second.sent).toBe(1);
    expect(await noticeRows()).toHaveLength(1);
  });

  it("a faixa vermelha da tela e o aviso concordam", async () => {
    vi.stubEnv("FINANCE_TODAY", "2026-08-09");
    let state = await getState(ctx.actors.admin, ctx.project.id);
    expect(state.finalStretch.active).toBe(false);
    expect(state.finalStretch.lastNotice).toBeNull();

    vi.stubEnv("FINANCE_TODAY", "2026-08-10");
    state = await getState(ctx.actors.admin, ctx.project.id);
    expect(state.finalStretch.active).toBe(true);
    expect(state.finalStretch.referenceDate).toBe("2026-08-10");

    await sendFinalStretchNotices(at("2026-08-10T08:00"));
    state = await getState(ctx.actors.admin, ctx.project.id);
    expect(state.finalStretch.lastNotice).toMatchObject({
      month: "2026-08",
      recipients: 2,
      channels: ["app"],
    });
  });

  it("projeto com menos de 3 datas avisa a partir da primeira", async () => {
    await resetTestDatabase();
    ctx = await setupFinance();
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Curta",
      totalCents: reais(500),
      installmentsCount: 1,
      firstDueDate: "2026-09-10",
    });
    expect((await sendFinalStretchNotices(at("2026-09-09T12:00"))).sent).toBe(
      0,
    );
    expect((await sendFinalStretchNotices(at("2026-09-10T08:00"))).sent).toBe(
      1,
    );
  });

  it("projeto sem parcelas não avisa", async () => {
    await resetTestDatabase();
    ctx = await setupFinance();
    expect((await sendFinalStretchNotices(at("2026-09-10T08:00"))).sent).toBe(
      0,
    );
    expect(await noticeRows()).toHaveLength(0);
  });
});
