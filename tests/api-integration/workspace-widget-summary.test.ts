import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createLineVia,
  type FinanceContext,
  reais,
  setupFinance,
} from "./helpers/finance";
import { createProjectFixture } from "./helpers/fixtures";

const { app } = createApp();
let ctx: FinanceContext;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

async function summary(
  actor: FinanceContext["actors"]["owner"],
  workspaceId: string,
  extra = "",
) {
  mockAuthenticatedSession(actor.user);
  const response = await app.request(
    `/api/workspace-calendar/widget-summary?workspaceId=${workspaceId}${extra}`,
  );
  const text = await response.text();
  let body: unknown = text; // erros (400/403) vêm em texto simples
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: response.status, body };
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("FINANCE_TODAY", "2026-09-29");
  ctx = await setupFinance();
});

describe("GET /workspace-calendar/widget-summary", () => {
  it("separa próximo pagamento e atrasados", async () => {
    // Parcelas em 10/09, 10/10 e 10/11: hoje é 29/09.
    await createLineVia(ctx.actors.owner, ctx.project.id, {
      supplier: "Gráfica",
      totalCents: reais(3000),
      installmentsCount: 3,
      firstDueDate: "2026-09-10",
    });

    const { status, body } = await summary(ctx.actors.owner, ctx.workspace.id);
    expect(status).toBe(200);
    expect(body.today).toBe("2026-09-29");
    expect(body.overdue.count).toBe(1);
    expect(body.overdue.totalCents).toBe(reais(1000));
    expect(body.overdue.items[0].dueDate).toBe("2026-09-10");
    expect(body.nextInstallment.dueDate).toBe("2026-10-10");
    expect(body.nextInstallment.supplier).toBe("Gráfica");
    // O calendário traz as três parcelas dentro da janela.
    expect(body.calendar.installments).toHaveLength(3);
  });

  it("sem parcelas: próximo é nulo e atrasados zerados", async () => {
    const { body } = await summary(ctx.actors.owner, ctx.workspace.id);
    expect(body.nextInstallment).toBeNull();
    expect(body.overdue).toEqual({ count: 0, totalCents: 0, items: [] });
  });

  it("lista só projetos dos últimos 3 meses (e não os arquivados)", async () => {
    const { project: recent } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      name: "Projeto recente",
    });
    const { project: old } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      name: "Projeto antigo",
    });
    const { project: archived } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      name: "Projeto arquivado",
    });
    const { eq } = await import("drizzle-orm");
    const set = (
      id: string,
      values: Partial<typeof schema.projectTable.$inferInsert>,
    ) =>
      db
        .update(schema.projectTable)
        .set(values)
        .where(eq(schema.projectTable.id, id));
    await set(recent.id, { createdAt: daysAgo(20) });
    await set(old.id, { createdAt: daysAgo(120) });
    await set(archived.id, { createdAt: daysAgo(5), archivedAt: new Date() });

    const { body } = await summary(ctx.actors.owner, ctx.workspace.id);
    const names = body.recentProjects.map((p: { name: string }) => p.name);
    expect(names).toContain("Projeto recente");
    expect(names).not.toContain("Projeto antigo");
    expect(names).not.toContain("Projeto arquivado");
  });

  it("tarefas novas respeitam a janela de dias", async () => {
    const { eq } = await import("drizzle-orm");
    const [fresh, stale] = await Promise.all(
      [1, 2].map(async (number) => {
        const [task] = await db
          .insert(schema.taskTable)
          .values({
            projectId: ctx.project.id,
            title: `Tarefa ${number}`,
            number,
          })
          .returning();
        return task as typeof schema.taskTable.$inferSelect;
      }),
    );
    await db
      .update(schema.taskTable)
      .set({ createdAt: daysAgo(30) })
      .where(eq(schema.taskTable.id, stale.id));

    const week = await summary(ctx.actors.owner, ctx.workspace.id);
    expect(week.body.newTasks.map((t: { id: string }) => t.id)).toEqual([
      fresh.id,
    ]);

    const wide = await summary(
      ctx.actors.owner,
      ctx.workspace.id,
      "&newTasksDays=60",
    );
    expect(wide.body.newTasks).toHaveLength(2);

    const invalid = await summary(
      ctx.actors.owner,
      ctx.workspace.id,
      "&newTasksDays=0",
    );
    expect(invalid.status).toBe(400);
  });

  it("não vaza dados de outro workspace", async () => {
    await createLineVia(ctx.actors.owner, ctx.project.id, {
      supplier: "Privado",
      totalCents: reais(1000),
      installmentsCount: 1,
      firstDueDate: "2026-10-05",
    });
    const denied = await summary(ctx.outsider, ctx.workspace.id);
    expect(denied.status).toBe(403);

    const own = await summary(ctx.outsider, ctx.otherWorkspace.id);
    expect(own.status).toBe(200);
    expect(own.body.nextInstallment).toBeNull();
    expect(own.body.recentProjects.map((p: { id: string }) => p.id)).toEqual([
      ctx.otherProject.id,
    ]);
  });
});
