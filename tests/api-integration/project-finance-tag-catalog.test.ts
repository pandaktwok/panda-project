import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  call,
  createTagVia,
  type FinanceContext,
  setupFinance,
} from "./helpers/finance";
import { createProjectFixture } from "./helpers/fixtures";

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

async function catalog(projectId: string) {
  const result = await call(
    ctx.actors.owner,
    "GET",
    `/${projectId}/tag-catalog`,
  );
  expect(result.status, result.text).toBe(200);
  return (result.body as unknown as { tags: { id: string; name: string }[] })
    .tags;
}

describe("catálogo de etiquetas reaproveitável entre projetos", () => {
  it("uma etiqueta criada em um projeto aparece no catálogo do workspace", async () => {
    await createTagVia(ctx.actors.owner, ctx.project.id, {
      name: "Professor de música",
      valueCents: 6_000_000,
    });
    const names = (await catalog(ctx.project.id)).map((t) => t.name);
    expect(names).toContain("Professor de música");
  });

  it("um segundo projeto do mesmo workspace vê a etiqueta já criada e pode reutilizar o nome", async () => {
    await createTagVia(ctx.actors.owner, ctx.project.id, {
      name: "Aluguel",
      valueCents: 100_000,
    });
    const { project: second } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      name: "Segundo projeto",
    });
    const names = (await catalog(second.id)).map((t) => t.name);
    expect(names).toContain("Aluguel");

    // Mesmo nome, projeto diferente: cada projeto tem seu próprio orçamento
    // para a mesma etiqueta, e nenhum catálogo novo é criado (dedup por nome,
    // sem diferenciar maiúsculas/minúsculas).
    const { tag } = await createTagVia(ctx.actors.owner, second.id, {
      name: "aluguel",
      valueCents: 250_000,
    });
    expect(tag.valueCents).toBe(250_000);
    const afterNames = (await catalog(second.id)).filter(
      (t) => t.name.toLowerCase() === "aluguel",
    );
    expect(afterNames).toHaveLength(1);
  });

  it("etiquetas de outro workspace não aparecem no catálogo", async () => {
    await createTagVia(ctx.outsider, ctx.otherProject.id, {
      name: "Só do outro workspace",
    });
    const names = (await catalog(ctx.project.id)).map((t) => t.name);
    expect(names).not.toContain("Só do outro workspace");
  });

  it("viewer consegue ler o catálogo, mas não criar etiqueta", async () => {
    const asViewer = await call(
      ctx.actors.viewer,
      "GET",
      `/${ctx.project.id}/tag-catalog`,
    );
    expect(asViewer.status).toBe(200);
  });
});
