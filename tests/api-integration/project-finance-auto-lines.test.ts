import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  call,
  createLineVia,
  createTagVia,
  reais,
  setupFinance,
} from "./helpers/finance";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

beforeEach(async () => {
  await resetTestDatabase();
  resetFakeStorage();
});

describe("Atualização 3: linha automática (rateio livre)", () => {
  it("uma linha automática recebe a sobra do orçamento da tag depois das linhas fixas", async () => {
    const { actors, project } = await setupFinance();
    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Despesas fixas e variáveis",
      valueCents: reais(40_000),
    });
    await createLineVia(actors.owner, project.id, {
      supplier: "Internet",
      tagId: tag.id,
      totalCents: reais(120) * 10,
      installmentsCount: 10,
      firstDueDate: "2026-01-05",
    });
    const { line: auto } = await createLineVia(actors.owner, project.id, {
      supplier: "Luz e água",
      tagId: tag.id,
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-10-05",
    });

    // (40.000 - 1.200) / 10 = 3.880,00 por parcela.
    expect(auto.installmentsCount).toBe(10);
    expect(auto.totalCents).toBe(reais(3_880) * 10);
    expect(
      auto.installments.every((i) => i.expectedCents === reais(3_880)),
    ).toBe(true);
  });

  it("duas linhas automáticas dividem a sobra 50/50 antes de dividir pelos meses de cada uma", async () => {
    const { actors, project } = await setupFinance();
    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Verba dividida",
      valueCents: reais(20_000),
    });
    const { line: autoA } = await createLineVia(actors.owner, project.id, {
      supplier: "Luz",
      tagId: tag.id,
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-10-05",
    });
    const stateAfterFirst = (
      await createLineVia(actors.owner, project.id, {
        supplier: "Água",
        tagId: tag.id,
        isFixedAmount: false,
        firstDueDate: "2026-01-05",
        finalDueDate: "2026-10-05",
      })
    ).state;

    const refreshedA = stateAfterFirst.lines.find((l) => l.id === autoA.id);
    const autoB = stateAfterFirst.lines.find((l) => l.supplier === "Água");
    if (!refreshedA || !autoB) throw new Error("linhas não encontradas");

    // sobra = 20.000 (sem linha fixa); dividido 50/50 = 10.000 cada; ÷10 meses = 1.000,00.
    expect(refreshedA.totalCents).toBe(reais(10_000));
    expect(autoB.totalCents).toBe(reais(10_000));
    expect(
      refreshedA.installments.every((i) => i.expectedCents === reais(1_000)),
    ).toBe(true);
  });

  it("editar o valor da tag recalcula as parcelas não pagas das linhas automáticas", async () => {
    const { actors, project } = await setupFinance();
    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Reajustável",
      valueCents: reais(10_000),
    });
    const { line: auto } = await createLineVia(actors.owner, project.id, {
      supplier: "Variável",
      tagId: tag.id,
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-05-05",
    });
    expect(auto.totalCents).toBe(reais(10_000));

    const updateResult = await call(actors.owner, "PUT", `/tags/${tag.id}`, {
      valueCents: reais(20_000),
    });
    expect(updateResult.status, updateResult.text).toBe(200);
    const updated = updateResult.body.lines.find((l) => l.id === auto.id);
    if (!updated) throw new Error("linha não encontrada");
    // (20.000 - 0) / 5 meses = 4.000,00.
    expect(updated.totalCents).toBe(reais(20_000));
    expect(
      updated.installments.every((i) => i.expectedCents === reais(4_000)),
    ).toBe(true);
  });

  it("criar uma nova linha fixa na mesma tag recalcula a fatia das linhas automáticas", async () => {
    const { actors, project } = await setupFinance();
    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Mista",
      valueCents: reais(10_000),
    });
    const { line: auto } = await createLineVia(actors.owner, project.id, {
      supplier: "Variável",
      tagId: tag.id,
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-05-05",
    });
    expect(auto.totalCents).toBe(reais(10_000));

    const { state } = await createLineVia(actors.owner, project.id, {
      supplier: "Fixa nova",
      tagId: tag.id,
      totalCents: reais(2_000),
      installmentsCount: 5,
      firstDueDate: "2026-01-05",
    });
    const updated = state.lines.find((l) => l.id === auto.id);
    if (!updated) throw new Error("linha não encontrada");
    // sobra = 10.000 - 2.000 = 8.000 / 5 meses = 1.600,00.
    expect(updated.totalCents).toBe(reais(8_000));
    expect(
      updated.installments.every((i) => i.expectedCents === reais(1_600)),
    ).toBe(true);
  });

  it("sobra negativa (linhas fixas já passam do valor da tag) zera as automáticas sem travar", async () => {
    const { actors, project } = await setupFinance();
    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Estourada",
      valueCents: reais(1_000),
    });
    await createLineVia(actors.owner, project.id, {
      supplier: "Fixa cara",
      tagId: tag.id,
      totalCents: reais(5_000),
      installmentsCount: 1,
      firstDueDate: "2026-01-05",
    });
    const { line: auto } = await createLineVia(actors.owner, project.id, {
      supplier: "Variável",
      tagId: tag.id,
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-03-05",
    });
    expect(auto.totalCents).toBe(0);
    expect(auto.installments.every((i) => i.expectedCents === 0)).toBe(true);
  });

  it("pagar uma parcela da linha automática com valor diferente recalcula só as parcelas seguintes dela (Fase 2-A), sem mexer nas outras linhas", async () => {
    const { actors, project } = await setupFinance();
    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Com pagamento",
      valueCents: reais(10_000),
    });
    const { line: autoA } = await createLineVia(actors.owner, project.id, {
      supplier: "Variável A",
      tagId: tag.id,
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-05-05",
    });
    const stateBoth = (
      await createLineVia(actors.owner, project.id, {
        supplier: "Variável B",
        tagId: tag.id,
        isFixedAmount: false,
        firstDueDate: "2026-01-05",
        finalDueDate: "2026-05-05",
      })
    ).state;
    const lineA = stateBoth.lines.find((l) => l.id === autoA.id);
    const lineB = stateBoth.lines.find((l) => l.supplier === "Variável B");
    if (!lineA || !lineB) throw new Error("linhas não encontradas");
    // sobra 10.000 / 2 linhas = 5.000 cada / 5 meses = 1.000,00 cada parcela.
    expect(lineA.totalCents).toBe(reais(5_000));

    const firstInstallment = lineA.installments[0];
    if (!firstInstallment) throw new Error("parcela não encontrada");
    const saveResult = await call(actors.owner, "POST", `/${project.id}/save`, {
      version: stateBoth.version,
      payments: [
        {
          installmentId: firstInstallment.id,
          paidCents: reais(1_400),
          paidAt: "2026-01-05",
        },
      ],
    });
    expect(saveResult.status, saveResult.text).toBe(200);
    const afterA = saveResult.body.lines.find((l) => l.id === autoA.id);
    const afterB = saveResult.body.lines.find((l) => l.id === lineB.id);
    if (!afterA || !afterB) throw new Error("linhas não encontradas");

    // Fase 2-A: (5.000 - 1.400) / 4 restantes = 900,00 cada, só na linha A.
    const unpaidA = afterA.installments.filter((i) => i.paidAt === null);
    expect(unpaidA.every((i) => i.expectedCents === reais(900))).toBe(true);
    // A linha B não muda: continua com as 5 parcelas de 1.000,00.
    expect(
      afterB.installments.every((i) => i.expectedCents === reais(1_000)),
    ).toBe(true);
    expect(afterB.totalCents).toBe(reais(5_000));
  });

  it("400 ao criar linha automática sem tag ou sem finalDueDate", async () => {
    const { actors, project } = await setupFinance();
    const noTag = await call(actors.owner, "POST", `/${project.id}/lines`, {
      supplier: "Sem tag",
      isFixedAmount: false,
      firstDueDate: "2026-01-05",
      finalDueDate: "2026-05-05",
    });
    expect(noTag.status).toBe(400);

    const { tag } = await createTagVia(actors.owner, project.id, {
      name: "Qualquer",
      valueCents: reais(1_000),
    });
    const noFinalDate = await call(
      actors.owner,
      "POST",
      `/${project.id}/lines`,
      {
        supplier: "Sem data final",
        tagId: tag.id,
        isFixedAmount: false,
        firstDueDate: "2026-01-05",
      },
    );
    expect(noFinalDate.status).toBe(400);
  });
});
