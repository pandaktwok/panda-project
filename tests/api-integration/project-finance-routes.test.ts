import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  call,
  createLineVia,
  createTagVia,
  type FinanceContext,
  getState,
  reais,
  setupFinance,
} from "./helpers/finance";

let ctx: FinanceContext;

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

beforeEach(async () => {
  await resetTestDatabase();
  resetFakeStorage();
  vi.stubEnv("FINANCE_TODAY", "2026-09-24");
  ctx = await setupFinance();
});

const ROLES = ["owner", "admin", "member", "viewer"] as const;

describe("matriz de permissões das rotas", () => {
  type Spec = {
    name: string;
    allowed: ReadonlyArray<(typeof ROLES)[number]>;
    // Cria o que for preciso (dados novos a cada chamada) e devolve a requisição.
    build: (c: FinanceContext) => Promise<{
      method: "GET" | "POST" | "PUT" | "DELETE";
      path: string;
      body?: unknown;
    }>;
  };

  async function freshLine(c: FinanceContext, project = c.project.id) {
    const { line } = await createLineVia(c.actors.owner, project, {
      supplier: `Fornecedor ${Math.random()}`,
      totalCents: reais(1000),
      installmentsCount: 4,
      firstDueDate: "2026-10-10",
    });
    return line;
  }

  async function freshPaidInstallment(c: FinanceContext) {
    const line = await freshLine(c);
    const state = await getState(c.actors.owner, c.project.id);
    const first = line.installments[0];
    if (!first) throw new Error("no installment");
    await db
      .update(schema.projectInstallmentTable)
      .set({ paidAt: "2026-10-10", paidCents: first.expectedCents })
      .where(eq(schema.projectInstallmentTable.id, first.id));
    return { first, state, line };
  }

  const specs: Spec[] = [
    {
      name: "GET /{projectId}",
      allowed: ROLES,
      build: async (c) => ({ method: "GET", path: `/${c.project.id}` }),
    },
    {
      name: "PUT /{projectId}/settings",
      allowed: ["owner", "admin"],
      build: async (c) => ({
        method: "PUT",
        path: `/${c.project.id}/settings`,
        body: { financeMonths: 12 },
      }),
    },
    {
      name: "POST /{projectId}/tags",
      allowed: ["owner", "admin"],
      build: async (c) => ({
        method: "POST",
        path: `/${c.project.id}/tags`,
        body: { name: `Tag ${Math.random()}` },
      }),
    },
    {
      name: "PUT /tags/{tagId}",
      allowed: ["owner", "admin"],
      build: async (c) => {
        const { tag } = await createTagVia(c.actors.owner, c.project.id, {
          name: `T ${Math.random()}`,
        });
        return {
          method: "PUT",
          path: `/tags/${tag.id}`,
          body: { valueCents: 500 },
        };
      },
    },
    {
      name: "DELETE /tags/{tagId}",
      allowed: ["owner", "admin"],
      build: async (c) => {
        const { tag } = await createTagVia(c.actors.owner, c.project.id, {
          name: `T ${Math.random()}`,
        });
        return { method: "DELETE", path: `/tags/${tag.id}` };
      },
    },
    {
      name: "POST /{projectId}/lines",
      allowed: ["owner", "admin"],
      build: async (c) => ({
        method: "POST",
        path: `/${c.project.id}/lines`,
        body: {
          supplier: `F ${Math.random()}`,
          totalCents: 1000,
          installmentsCount: 2,
          firstDueDate: "2026-10-10",
        },
      }),
    },
    {
      name: "PUT /lines/{lineId}",
      allowed: ["owner", "admin"],
      build: async (c) => {
        const line = await freshLine(c);
        return {
          method: "PUT",
          path: `/lines/${line.id}`,
          body: { totalCents: 2000 },
        };
      },
    },
    {
      name: "DELETE /lines/{lineId}",
      allowed: ["owner", "admin"],
      build: async (c) => {
        const line = await freshLine(c);
        return { method: "DELETE", path: `/lines/${line.id}` };
      },
    },
    {
      name: "POST /{projectId}/save",
      allowed: ["owner", "admin", "member"],
      build: async (c) => {
        const line = await freshLine(c);
        const state = await getState(c.actors.owner, c.project.id);
        const target = line.installments[0];
        if (!target) throw new Error("no installment");
        return {
          method: "POST",
          path: `/${c.project.id}/save`,
          body: {
            version: state.version,
            payments: [
              {
                installmentId: target.id,
                paidCents: target.expectedCents,
                paidAt: "2026-10-10",
              },
            ],
          },
        };
      },
    },
    {
      name: "POST /installments/{id}/undo",
      allowed: ["owner", "admin"],
      build: async (c) => {
        const { first } = await freshPaidInstallment(c);
        return { method: "POST", path: `/installments/${first.id}/undo` };
      },
    },
  ];

  for (const spec of specs) {
    it(`${spec.name}: quem pode e quem não pode`, async () => {
      for (const role of ROLES) {
        const request = await spec.build(ctx);
        const result = await call(
          ctx.actors[role],
          request.method,
          request.path,
          request.body,
        );
        if (spec.allowed.includes(role)) {
          expect(result.status, `${role}: ${result.text}`).toBe(200);
        } else {
          expect(result.status, `${role}: ${result.text}`).toBe(403);
        }
      }
    });

    it(`${spec.name}: usuário de outro workspace não acessa`, async () => {
      const request = await spec.build(ctx);
      const result = await call(
        ctx.outsider,
        request.method,
        request.path,
        request.body,
      );
      expect([403, 404]).toContain(result.status);
    });
  }

  it("sem sessão ninguém acessa", async () => {
    const { mockAnonymousSession } = await import("./helpers/auth");
    mockAnonymousSession();
    const { createApp } = await import("../../apps/api/src/index");
    const { app } = createApp();
    const response = await app.request(
      `/api/project-finance/${ctx.project.id}`,
    );
    expect(response.status).toBe(401);
  });

  it("ids de tag/linha/parcela de outro workspace também são barrados (403), nunca vazam dados", async () => {
    // Dados reais no workspace ALHEIO, criados pelo dono de lá.
    const { tag } = await createTagVia(ctx.outsider, ctx.otherProject.id, {
      name: "Alheia",
    });
    const { line } = await createLineVia(ctx.outsider, ctx.otherProject.id, {
      supplier: "Alheio",
      totalCents: 1000,
      installmentsCount: 2,
      firstDueDate: "2026-10-10",
    });
    const installment = line.installments[0];
    if (!installment) throw new Error("no installment");

    // Mesmo o dono do OUTRO workspace-alvo (aqui: owner do nosso) é barrado.
    for (const actor of [ctx.actors.owner, ctx.actors.admin]) {
      const attempts = [
        call(actor, "GET", `/${ctx.otherProject.id}`),
        call(actor, "PUT", `/tags/${tag.id}`, { name: "x" }),
        call(actor, "DELETE", `/tags/${tag.id}`),
        call(actor, "PUT", `/lines/${line.id}`, { totalCents: 1 }),
        call(actor, "DELETE", `/lines/${line.id}`),
        call(actor, "POST", `/installments/${installment.id}/undo`),
        call(actor, "POST", `/${ctx.otherProject.id}/save`, {
          version: "x",
          payments: [
            {
              installmentId: installment.id,
              paidCents: 1,
              paidAt: "2026-10-10",
            },
          ],
        }),
        call(actor, "POST", `/${ctx.otherProject.id}/tags`, { name: "y" }),
        call(actor, "POST", `/${ctx.otherProject.id}/lines`, {
          supplier: "y",
          totalCents: 1,
          installmentsCount: 1,
          firstDueDate: "2026-10-10",
        }),
      ];
      for (const result of await Promise.all(attempts)) {
        expect(result.status).toBe(403);
      }
    }
    const untouched = await getState(ctx.outsider, ctx.otherProject.id);
    expect(untouched.tags[0]?.name).toBe("Alheia");
    expect(untouched.lines[0]?.totalCents).toBe(1000);
  });

  it("não deixa apontar para a tag de outro projeto/workspace, nem misturar parcela de outro projeto no save", async () => {
    const { tag: foreignTag } = await createTagVia(
      ctx.outsider,
      ctx.otherProject.id,
      { name: "Alheia" },
    );
    const created = await call(
      ctx.actors.owner,
      "POST",
      `/${ctx.project.id}/lines`,
      {
        supplier: "F",
        totalCents: 1000,
        installmentsCount: 2,
        firstDueDate: "2026-10-10",
        tagId: foreignTag.id,
      },
    );
    expect(created.status).toBe(404);

    const { line: foreignLine } = await createLineVia(
      ctx.outsider,
      ctx.otherProject.id,
      {
        supplier: "Alheio",
        totalCents: 1000,
        installmentsCount: 2,
        firstDueDate: "2026-10-10",
      },
    );
    const state = await getState(ctx.actors.owner, ctx.project.id);
    const save = await call(
      ctx.actors.owner,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: foreignLine.installments[0]?.id,
            paidCents: 1,
            paidAt: "2026-10-10",
          },
        ],
      },
    );
    expect(save.status).toBe(404);
    const foreign = await getState(ctx.outsider, ctx.otherProject.id);
    expect(foreign.lines[0]?.paidCents).toBe(0);
  });
});

describe("tags do projeto", () => {
  it("cria, lista com valor e atualiza; nome é único por projeto (sem diferenciar caixa)", async () => {
    const { tag } = await createTagVia(ctx.actors.admin, ctx.project.id, {
      name: "Cultura",
      description: "Ações culturais",
      valueCents: reais(30_000),
    });
    expect(tag).toMatchObject({
      name: "Cultura",
      description: "Ações culturais",
      valueCents: 3_000_000,
      linesCount: 0,
      paidCents: 0,
      paidBasisPoints: 0,
    });

    const dup = await call(
      ctx.actors.admin,
      "POST",
      `/${ctx.project.id}/tags`,
      {
        name: "  cultura ",
      },
    );
    expect(dup.status).toBe(409);

    // Outro projeto pode ter o mesmo nome.
    const { project: second } = await (
      await import("./helpers/fixtures")
    ).createProjectFixture({ workspaceId: ctx.workspace.id });
    const other = await call(ctx.actors.admin, "POST", `/${second.id}/tags`, {
      name: "Cultura",
    });
    expect(other.status).toBe(200);

    const { tag: informacao } = await createTagVia(
      ctx.actors.admin,
      ctx.project.id,
      {
        name: "Informação",
      },
    );
    const clash = await call(
      ctx.actors.admin,
      "PUT",
      `/tags/${informacao.id}`,
      {
        name: "cultura",
      },
    );
    expect(clash.status).toBe(409);
    const ok = await call(ctx.actors.admin, "PUT", `/tags/${informacao.id}`, {
      name: "Informação e Cultura",
      valueCents: reais(1500),
      description: null,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.tags.find((t) => t.id === informacao.id)).toMatchObject({
      name: "Informação e Cultura",
      valueCents: 150_000,
      description: null,
    });
    // Renomear para o próprio nome não conflita consigo mesma.
    const same = await call(ctx.actors.admin, "PUT", `/tags/${informacao.id}`, {
      name: "Informação e Cultura",
    });
    expect(same.status).toBe(200);
  });

  it("valida entradas: nome vazio, valor negativo ou fracionado", async () => {
    for (const body of [
      { name: "  " },
      { name: "x", valueCents: -1 },
      { name: "x", valueCents: 10.5 },
      {},
    ]) {
      const result = await call(
        ctx.actors.admin,
        "POST",
        `/${ctx.project.id}/tags`,
        body,
      );
      expect(result.status).toBe(400);
    }
  });

  it("apagar tag sem uso funciona; em uso responde 409 com a contagem e só apaga com force (linhas ficam sem tipo)", async () => {
    const { tag } = await createTagVia(ctx.actors.admin, ctx.project.id, {
      name: "Em uso",
    });
    const { tag: free } = await createTagVia(ctx.actors.admin, ctx.project.id, {
      name: "Livre",
    });
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "A",
      totalCents: 1000,
      installmentsCount: 2,
      firstDueDate: "2026-10-10",
      tagId: tag.id,
    });
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "B",
      totalCents: 1000,
      installmentsCount: 2,
      firstDueDate: "2026-10-10",
      tagId: tag.id,
    });

    const del = await call(ctx.actors.admin, "DELETE", `/tags/${free.id}`);
    expect(del.status).toBe(200);
    expect(del.body.tags.map((t) => t.name)).toEqual(["Em uso"]);

    const refused = await call<{ code: string; linesInUse: number }>(
      ctx.actors.admin,
      "DELETE",
      `/tags/${tag.id}`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "TAG_IN_USE", linesInUse: 2 });
    expect(
      await db
        .select()
        .from(schema.projectTagTable)
        .where(eq(schema.projectTagTable.id, tag.id)),
    ).toHaveLength(1);

    const forced = await call(
      ctx.actors.admin,
      "DELETE",
      `/tags/${tag.id}?force=true`,
    );
    expect(forced.status).toBe(200);
    expect(forced.body.tags).toEqual([]);
    expect(forced.body.lines.map((l) => l.tag)).toEqual([null, null]);
  });

  it("totais por tag: pago e percentual do valor da tag", async () => {
    const { tag } = await createTagVia(ctx.actors.admin, ctx.project.id, {
      name: "Cultura",
      valueCents: reais(1000),
    });
    const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "A",
      totalCents: reais(800),
      installmentsCount: 4,
      firstDueDate: "2026-10-10",
      tagId: tag.id,
    });
    const first = line.installments[0];
    if (!first) throw new Error("no installment");
    const state = await getState(ctx.actors.admin, ctx.project.id);
    const saved = await call(
      ctx.actors.member,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: first.id,
            paidCents: reais(200),
            paidAt: "2026-10-10",
          },
        ],
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.tags[0]).toMatchObject({
      valueCents: 100_000,
      linesCount: 1,
      linesTotalCents: 80_000,
      paidCents: 20_000,
      paidBasisPoints: 2_000,
    });
  });
});

describe("linhas e geração de parcelas", () => {
  it("gera parcelas mensais; dia 31 acompanha o fim dos meses curtos sem escorregar; a soma fecha", async () => {
    const { line, state } = await createLineVia(
      ctx.actors.admin,
      ctx.project.id,
      {
        supplier: "Mirella Sombrio",
        totalCents: 10_000,
        installmentsCount: 5,
        firstDueDate: "2027-01-31",
      },
    );
    expect(line.installments.map((i) => i.dueDate)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
    expect(line.installments.map((i) => i.expectedCents)).toEqual([
      2000, 2000, 2000, 2000, 2000,
    ]);

    const odd = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Impar",
      totalCents: 10_000,
      installmentsCount: 3,
      firstDueDate: "2028-01-31",
    });
    expect(odd.line.installments.map((i) => i.expectedCents)).toEqual([
      3333, 3333, 3334,
    ]);
    expect(odd.line.installments[1]?.dueDate).toBe("2028-02-29");
    expect(odd.line.installments.reduce((s, i) => s + i.expectedCents, 0)).toBe(
      10_000,
    );

    expect(state.lines).toHaveLength(1);
    expect(line).toMatchObject({
      totalCents: 10_000,
      installmentsCount: 5,
      firstDueDate: "2027-01-31",
      paidCents: 0,
      remainingCents: 10_000,
      tag: null,
    });
  });

  it("usa meses e data do projeto quando omitidos; sem padrão e sem valores, 400", async () => {
    const missing = await call(
      ctx.actors.admin,
      "POST",
      `/${ctx.project.id}/lines`,
      {
        supplier: "F",
        totalCents: 1000,
      },
    );
    expect(missing.status).toBe(400);

    const settings = await call(
      ctx.actors.admin,
      "PUT",
      `/${ctx.project.id}/settings`,
      {
        financeTotalCents: reais(65_600),
        financeMonths: 10,
        financeFirstDueDate: "2026-01-10",
      },
    );
    expect(settings.status).toBe(200);
    expect(settings.body.project).toMatchObject({
      totalCents: 6_560_000,
      months: 10,
      firstDueDate: "2026-01-10",
    });

    const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "F",
      totalCents: reais(65_600),
    });
    expect(line.installmentsCount).toBe(10);
    expect(line.installments[0]?.dueDate).toBe("2026-01-10");
    expect(line.installments[9]?.dueDate).toBe("2026-10-10");
    expect(line.installments[0]?.expectedCents).toBe(656_000);
  });

  it("valida entradas: total fracionado/negativo, meses fora de 1..600, data inexistente", async () => {
    const base = {
      supplier: "F",
      totalCents: 1000,
      installmentsCount: 2,
      firstDueDate: "2026-10-10",
    };
    for (const patch of [
      { totalCents: 10.5 },
      { totalCents: -5 },
      { installmentsCount: 0 },
      { installmentsCount: 601 },
      { firstDueDate: "2026-02-30" },
      { firstDueDate: "10/10/2026" },
      { supplier: "" },
    ]) {
      const result = await call(
        ctx.actors.admin,
        "POST",
        `/${ctx.project.id}/lines`,
        { ...base, ...patch },
      );
      expect(result.status, JSON.stringify(patch)).toBe(400);
    }
  });

  it("PUT só mexe nas parcelas não pagas (valor, vencimento e quantidade)", async () => {
    const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "F",
      totalCents: reais(1000),
      installmentsCount: 4,
      firstDueDate: "2026-10-10",
    });
    const state = await getState(ctx.actors.admin, ctx.project.id);
    const first = line.installments[0];
    if (!first) throw new Error("no installment");
    const paid = await call(
      ctx.actors.member,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: first.id,
            paidCents: reais(300),
            paidAt: "2026-10-12",
          },
        ],
      },
    );
    expect(paid.status).toBe(200);

    // Novo total, mais parcelas e nova data da 1ª parcela.
    const changed = await call(ctx.actors.admin, "PUT", `/lines/${line.id}`, {
      totalCents: reais(1600),
      installmentsCount: 5,
      firstDueDate: "2026-11-30",
    });
    expect(changed.status, changed.text).toBe(200);
    const updated = changed.body.lines[0];
    if (!updated) throw new Error("no line");
    expect(updated.installments).toHaveLength(5);
    // A paga não mudou em nada.
    expect(updated.installments[0]).toMatchObject({
      id: first.id,
      dueDate: "2026-10-10",
      expectedCents: first.expectedCents,
      paidAt: "2026-10-12",
      paidCents: reais(300),
      status: "paid",
    });
    // Não pagas: vencimentos a partir de 30/11 (fim de mês respeitado) e
    // (1600 - 300) / 4 = 325 cada.
    expect(updated.installments.slice(1).map((i) => i.dueDate)).toEqual([
      "2026-12-30",
      "2027-01-30",
      "2027-02-28",
      "2027-03-30",
    ]);
    expect(updated.installments.slice(1).map((i) => i.expectedCents)).toEqual(
      Array(4).fill(reais(325)),
    );
    expect(updated).toMatchObject({
      totalCents: 160_000,
      installmentsCount: 5,
      firstDueDate: "2026-11-30",
      paidCents: 30_000,
      remainingCents: 130_000,
    });
  });

  it("reduzir a quantidade remove as últimas não pagas; abaixo da última paga é 409 sem mudar nada", async () => {
    const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "F",
      totalCents: reais(1000),
      installmentsCount: 5,
      firstDueDate: "2026-10-10",
    });
    const third = line.installments[2];
    if (!third) throw new Error("no installment");
    const state = await getState(ctx.actors.admin, ctx.project.id);
    // Pagamento fora de ordem: só a 3ª.
    const paid = await call(
      ctx.actors.member,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: third.id,
            paidCents: reais(200),
            paidAt: "2026-10-12",
          },
        ],
      },
    );
    expect(paid.status).toBe(200);

    const refused = await call(ctx.actors.admin, "PUT", `/lines/${line.id}`, {
      installmentsCount: 2,
    });
    expect(refused.status).toBe(409);
    const afterRefuse = await getState(ctx.actors.admin, ctx.project.id);
    expect(afterRefuse.lines[0]?.installments).toHaveLength(5);
    expect(afterRefuse.version).toBe(paid.body.version);

    const reduced = await call(ctx.actors.admin, "PUT", `/lines/${line.id}`, {
      installmentsCount: 3,
    });
    expect(reduced.status).toBe(200);
    const items = reduced.body.lines[0]?.installments ?? [];
    expect(items.map((i) => i.number)).toEqual([1, 2, 3]);
    // (1000 - 200) / 2 não pagas = 400 cada.
    expect(items.filter((i) => !i.paidAt).map((i) => i.expectedCents)).toEqual([
      40_000, 40_000,
    ]);
  });

  it("apagar linha: com parcela paga só com force; sem pagamento apaga direto", async () => {
    const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "F",
      totalCents: reais(100),
      installmentsCount: 2,
      firstDueDate: "2026-10-10",
    });
    const first = line.installments[0];
    if (!first) throw new Error("no installment");
    const state = await getState(ctx.actors.admin, ctx.project.id);
    await call(ctx.actors.member, "POST", `/${ctx.project.id}/save`, {
      version: state.version,
      payments: [
        { installmentId: first.id, paidCents: reais(50), paidAt: "2026-10-10" },
      ],
    });
    const refused = await call<{ code: string; paidInstallments: number }>(
      ctx.actors.admin,
      "DELETE",
      `/lines/${line.id}`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "LINE_HAS_PAYMENTS",
      paidInstallments: 1,
    });
    const forced = await call(
      ctx.actors.admin,
      "DELETE",
      `/lines/${line.id}?force=true`,
    );
    expect(forced.status).toBe(200);
    expect(forced.body.lines).toEqual([]);
    expect(await db.select().from(schema.projectInstallmentTable)).toHaveLength(
      0,
    );

    const { line: unpaid } = await createLineVia(
      ctx.actors.admin,
      ctx.project.id,
      {
        supplier: "G",
        totalCents: reais(100),
        installmentsCount: 2,
        firstDueDate: "2026-10-10",
      },
    );
    const direct = await call(
      ctx.actors.admin,
      "DELETE",
      `/lines/${unpaid.id}`,
    );
    expect(direct.status).toBe(200);
  });
});

describe("estado (GET)", () => {
  it("devolve totais, status das parcelas, reta final e asOf", async () => {
    const { tag } = await createTagVia(ctx.actors.admin, ctx.project.id, {
      name: "Cultura",
      valueCents: reais(10_000),
    });
    // 6 parcelas mensais a partir de 10/05/2026 -> venc. 05..10/2026.
    const { line } = await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Mirella",
      totalCents: reais(6000),
      installmentsCount: 6,
      firstDueDate: "2026-05-10",
      tagId: tag.id,
    });
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Curta",
      totalCents: reais(200),
      installmentsCount: 2,
      firstDueDate: "2026-05-10",
    });
    const state = await getState(ctx.actors.viewer, ctx.project.id);
    expect(state.asOf).toBe("2026-09-24"); // FINANCE_TODAY
    expect(state.version).toMatch(/^[0-9a-f]{32}$/);

    const target = line.installments[0];
    if (!target) throw new Error("no installment");
    const saved = await call(
      ctx.actors.member,
      "POST",
      `/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: target.id,
            paidCents: reais(1000),
            paidAt: "2026-05-11",
          },
        ],
      },
    );
    expect(saved.status).toBe(200);

    const after = await getState(ctx.actors.viewer, ctx.project.id);
    const main = after.lines.find((l) => l.supplier === "Mirella");
    expect(main?.installments.map((i) => i.status)).toEqual([
      "paid", // 10/05
      "overdue", // 10/06
      "overdue", // 10/07
      "overdue", // 10/08
      "overdue", // 10/09 (hoje é 24/09/2026)
      "pending", // 10/10
    ]);
    expect(main?.installments.map((i) => i.isFinalStretch)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    const short = after.lines.find((l) => l.supplier === "Curta");
    expect(short?.installments.map((i) => i.isFinalStretch)).toEqual([
      true,
      true,
    ]);

    expect(after.totals).toMatchObject({
      // Total do projeto = soma do valor (orçamento) das etiquetas, não das
      // linhas: só a etiqueta "Cultura" (R$ 10.000,00) conta; a linha "Curta"
      // não tem etiqueta e não entra nessa soma (Atualização 2).
      projectTotalCents: reais(10_000),
      paidCents: reais(1000),
      remainingCents: reais(5200),
      executedBasisPoints: 1000, // 1000/10000 = 10,00%
      openInstallments: 7,
      nextDueDate: "2026-10-10",
      tagsCount: 1,
    });
    // Vencidas: Mirella 10/06..10/09 (4) e Curta 10/05 e 10/06 (2).
    expect(after.totals.overdueInstallments).toBe(6);
    // Projeto tem vencimentos em 05..10/2026: antepenúltimo mês = 08/2026.
    expect(after.finalStretch).toMatchObject({
      active: true,
      referenceDate: "2026-08-10",
      lastDueDate: "2026-10-10",
      alertMonths: ["2026-08", "2026-09", "2026-10"],
      currentMonth: "2026-09",
    });
  });

  it("reta final só começa na data de referência", async () => {
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "A",
      totalCents: 1000,
      installmentsCount: 6,
      firstDueDate: "2026-10-10",
    });
    // asOf = 24/09/2026; venc. 10/2026..03/2027: antepenúltimo mês = 01/2027.
    const state = await getState(ctx.actors.viewer, ctx.project.id);
    expect(state.finalStretch.active).toBe(false);
    expect(state.finalStretch.referenceDate).toBe("2027-01-10");
    vi.stubEnv("FINANCE_TODAY", "2027-01-10");
    const later = await getState(ctx.actors.viewer, ctx.project.id);
    expect(later.finalStretch.active).toBe(true);
    // O token de concorrência não depende do relógio.
    expect(later.version).toBe(state.version);
  });

  it("projeto sem financeiro devolve estado vazio", async () => {
    const state = await getState(ctx.actors.viewer, ctx.project.id);
    expect(state).toMatchObject({
      tags: [],
      lines: [],
      totals: {
        projectTotalCents: 0,
        paidCents: 0,
        remainingCents: 0,
        executedBasisPoints: 0,
        nextDueDate: null,
      },
      finalStretch: { active: false, referenceDate: null },
    });
  });
});
