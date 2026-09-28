import { describe, expect, it } from "vitest";
import {
  basisPoints,
  buildFinanceState,
  computeVersion,
  type FinanceRows,
} from "../../../apps/api/src/project-finance/state";

const now = new Date("2026-01-01T00:00:00Z");

function rows(): FinanceRows {
  return {
    project: {
      id: "p1",
      name: "Projeto",
      financeTotalCents: 1000,
      financeMonths: 2,
      financeFirstDueDate: "2026-10-10",
    },
    tags: [
      {
        id: "t1",
        projectId: "p1",
        name: "Cultura",
        description: null,
        valueCents: 5000,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    lines: [
      {
        id: "l1",
        projectId: "p1",
        tagId: "t1",
        supplier: "F",
        totalCents: 1000,
        installmentsCount: 2,
        firstDueDate: "2026-10-10",
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    installments: [1, 2].map((number) => ({
      id: `i${number}`,
      lineId: "l1",
      number,
      dueDate: `2026-1${number - 1}-10`,
      expectedCents: 500,
      paidAt: null,
      paidCents: null,
      paidBy: null,
      fileAssetId: null,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

describe("basisPoints", () => {
  it("usa inteiros, arredonda para baixo e não estoura com valores grandes", () => {
    expect(basisPoints(1, 3)).toBe(3333);
    expect(basisPoints(50, 100)).toBe(5000);
    expect(basisPoints(0, 100)).toBe(0);
    expect(basisPoints(10, 0)).toBe(0);
    expect(basisPoints(2_000_000_000_000, 4_000_000_000_000)).toBe(5000);
  });
});

describe("computeVersion", () => {
  it("é estável e não depende da ordem das linhas em memória", () => {
    const a = rows();
    const b = rows();
    b.installments.reverse();
    expect(computeVersion(a)).toBe(computeVersion(b));
    expect(computeVersion(a)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("muda quando qualquer dado muda (pagamento, valor, tag, padrão do projeto)", () => {
    const base = computeVersion(rows());
    const paid = rows();
    paid.installments[0] = {
      ...(paid.installments[0] as FinanceRows["installments"][number]),
      paidAt: "2026-10-11",
      paidCents: 500,
    };
    const value = rows();
    (
      value.installments[1] as FinanceRows["installments"][number]
    ).expectedCents = 501;
    const tag = rows();
    (tag.tags[0] as FinanceRows["tags"][number]).name = "Outra";
    const project = rows();
    project.project.financeMonths = 3;
    for (const changed of [paid, value, tag, project]) {
      expect(computeVersion(changed)).not.toBe(base);
    }
  });

  it("não muda com a data de 'hoje' nem com updatedAt", () => {
    const a = rows();
    const b = rows();
    (b.tags[0] as FinanceRows["tags"][number]).updatedAt = new Date();
    expect(buildFinanceState(a, "2026-01-01").version).toBe(
      buildFinanceState(b, "2030-01-01").version,
    );
  });
});

describe("buildFinanceState", () => {
  it("linha com pago >= total sinaliza aviso e restante 0", () => {
    const data = rows();
    data.installments[0] = {
      ...(data.installments[0] as FinanceRows["installments"][number]),
      paidAt: "2026-10-10",
      paidCents: 1200,
    };
    const state = buildFinanceState(data, "2026-10-20");
    expect(state.lines[0]).toMatchObject({
      paidCents: 1200,
      remainingCents: 0,
      warning: "paid_reached_total",
    });
    expect(state.totals.remainingCents).toBe(0);
    expect(state.tags[0]?.paidBasisPoints).toBe(2400);
  });
});
