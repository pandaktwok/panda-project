import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

type ProjectRow = typeof schema.projectTable.$inferSelect;

async function createProject(body: Record<string, unknown>) {
  const member = await createWorkspaceMember();
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const response = await app.request("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: member.workspace.id,
      name: "Cultura e Informação para a Pessoa Idosa",
      icon: "Folder",
      slug: "cip",
      ...body,
    }),
  });
  return { response, member, app };
}

describe("criação de projeto com dados do financeiro", () => {
  beforeEach(() => resetTestDatabase());

  it("guarda descrição, total (centavos), meses e data da 1ª parcela e os devolve", async () => {
    const { response, member, app } = await createProject({
      description: "Projeto de cultura",
      financeTotalCents: 6_560_000,
      financeMonths: 10,
      financeFirstDueDate: "2026-01-31",
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as ProjectRow;
    expect(created).toMatchObject({
      description: "Projeto de cultura",
      financeTotalCents: 6_560_000,
      financeMonths: 10,
      financeFirstDueDate: "2026-01-31",
    });
    const [row] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, created.id));
    expect(row).toMatchObject({
      description: "Projeto de cultura",
      financeTotalCents: 6_560_000,
      financeMonths: 10,
      financeFirstDueDate: "2026-01-31",
    });

    // Também aparece ao ler o projeto e na lista.
    mockAuthenticatedSession(member.user);
    const single = await app.request(`/api/project/${created.id}`);
    expect(single.status).toBe(200);
    expect(await single.json()).toMatchObject({ financeTotalCents: 6_560_000 });
    const list = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    expect(((await list.json()) as ProjectRow[])[0]).toMatchObject({
      financeMonths: 10,
      financeFirstDueDate: "2026-01-31",
    });
  });

  it("chamadas antigas (sem os campos novos) continuam valendo e ficam nulas", async () => {
    const { response } = await createProject({});
    expect(response.status).toBe(200);
    const created = (await response.json()) as ProjectRow;
    expect(created).toMatchObject({
      description: null,
      financeTotalCents: null,
      financeMonths: null,
      financeFirstDueDate: null,
    });
    const columns = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, created.id));
    expect(columns).toHaveLength(4);
  });

  it("recusa valores inválidos e não cria o projeto", async () => {
    for (const patch of [
      { financeTotalCents: -1 },
      { financeTotalCents: 10.5 },
      { financeMonths: 0 },
      { financeMonths: 601 },
      { financeMonths: 2.5 },
      { financeFirstDueDate: "2026-02-30" },
      { financeFirstDueDate: "31/01/2026" },
    ]) {
      const { response } = await createProject(patch);
      expect(response.status, JSON.stringify(patch)).toBe(400);
    }
    expect(await db.select().from(schema.projectTable)).toHaveLength(0);
  });

  it("os padrões do projeto alimentam a criação de linhas", async () => {
    const { response, member, app } = await createProject({
      financeTotalCents: 300_000,
      financeMonths: 3,
      financeFirstDueDate: "2026-01-31",
    });
    const created = (await response.json()) as ProjectRow;
    mockAuthenticatedSession(member.user);
    const line = await app.request(`/api/project-finance/${created.id}/lines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ supplier: "Mirella", totalCents: 300_000 }),
    });
    // O criador aqui é "member" (sem finance:manage): recusado.
    expect(line.status).toBe(403);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "admin" })
      .where(eq(schema.workspaceUserTable.userId, member.user.id));
    const ok = await app.request(`/api/project-finance/${created.id}/lines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ supplier: "Mirella", totalCents: 300_000 }),
    });
    expect(ok.status).toBe(200);
    const state = (await ok.json()) as {
      lines: Array<{ installments: Array<{ dueDate: string }> }>;
    };
    expect(state.lines[0]?.installments.map((i) => i.dueDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });
});
