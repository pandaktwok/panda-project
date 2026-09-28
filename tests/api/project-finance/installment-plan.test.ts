import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  getFinanceToday,
  isValidIsoDate,
  todayInSaoPaulo,
} from "../../../apps/api/src/project-finance/dates";
import {
  type ExistingInstallment,
  generateInstallments,
  InstallmentPlanError,
  planLineUpdate,
} from "../../../apps/api/src/project-finance/installment-plan";

describe("addMonthsClamped", () => {
  it("dia 31 vai para o último dia dos meses curtos sem escorregar", () => {
    expect(addMonthsClamped("2026-01-31", 0)).toBe("2026-01-31");
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonthsClamped("2026-01-31", 4)).toBe("2026-05-31");
  });

  it("ano bissexto: fevereiro tem 29", () => {
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2028-01-30", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2100-01-31", 1)).toBe("2100-02-28"); // 2100 não é bissexto
  });

  it("dia 30 e 29 também ajustam em fevereiro", () => {
    expect(addMonthsClamped("2026-01-30", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-29", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-29", 2)).toBe("2026-03-29");
  });

  it("vira o ano", () => {
    expect(addMonthsClamped("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-12-31", 12)).toBe("2027-12-31");
    expect(addMonthsClamped("2026-12-31", 14)).toBe("2028-02-29");
  });

  it("recusa datas inválidas", () => {
    expect(() => addMonthsClamped("2026-02-30", 1)).toThrow();
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("31/01/2026")).toBe(false);
  });
});

describe("hoje do financeiro", () => {
  it("usa o fuso de Brasília (madrugada UTC ainda é o dia anterior)", () => {
    expect(todayInSaoPaulo(new Date("2026-09-24T02:30:00Z"))).toBe(
      "2026-09-23",
    );
    expect(todayInSaoPaulo(new Date("2026-09-24T12:00:00Z"))).toBe(
      "2026-09-24",
    );
  });

  it("FINANCE_TODAY vale quando válido e é ignorado quando inválido", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(getFinanceToday({ FINANCE_TODAY: "2027-03-01" }, now)).toBe(
      "2027-03-01",
    );
    expect(getFinanceToday({ FINANCE_TODAY: "abc" }, now)).toBe("2026-09-24");
    expect(getFinanceToday({}, now)).toBe("2026-09-24");
  });
});

describe("generateInstallments", () => {
  it("gera vencimentos mensais e valores iguais; a última absorve o resto", () => {
    const list = generateInstallments({
      totalCents: 10_000,
      count: 3,
      firstDueDate: "2026-01-31",
    });
    expect(list).toEqual([
      { number: 1, dueDate: "2026-01-31", expectedCents: 3333 },
      { number: 2, dueDate: "2026-02-28", expectedCents: 3333 },
      { number: 3, dueDate: "2026-03-31", expectedCents: 3334 },
    ]);
  });

  it("propriedade: a soma das parcelas é exatamente o total", () => {
    for (const total of [0, 1, 7, 99, 100, 65_600_00, 123_456_789]) {
      for (const count of [1, 2, 3, 7, 10, 12, 36, 600]) {
        const list = generateInstallments({
          totalCents: total,
          count,
          firstDueDate: "2026-05-15",
        });
        expect(list).toHaveLength(count);
        expect(list.reduce((s, i) => s + i.expectedCents, 0)).toBe(total);
        expect(list.map((i) => i.number)).toEqual(
          Array.from({ length: count }, (_, k) => k + 1),
        );
      }
    }
  });
});

function existing(
  count: number,
  totalCents: number,
  paid: Record<number, number> = {},
): ExistingInstallment[] {
  return generateInstallments({
    totalCents,
    count,
    firstDueDate: "2026-01-10",
  }).map((item) => ({
    id: `i${item.number}`,
    number: item.number,
    dueDate: item.dueDate,
    expectedCents: item.expectedCents,
    paidAt: paid[item.number] === undefined ? null : item.dueDate,
    paidCents: paid[item.number] ?? null,
  }));
}

describe("planLineUpdate", () => {
  it("mudar o total só mexe nas não pagas e recalcula por (total - pago)/restantes", () => {
    const plan = planLineUpdate({
      existing: existing(4, 4_000, { 1: 1_000 }),
      totalCents: 7_000,
      count: 4,
      firstDueDate: "2026-01-10",
    });
    expect(plan.creates).toEqual([]);
    expect(plan.removes).toEqual([]);
    expect(plan.updates.map((u) => u.id)).toEqual(["i2", "i3", "i4"]);
    expect(plan.updates.map((u) => u.expectedCents)).toEqual([
      2000, 2000, 2000,
    ]);
  });

  it("aumentar a quantidade acrescenta parcelas no fim e redistribui as não pagas", () => {
    const plan = planLineUpdate({
      existing: existing(2, 2_000, { 1: 1_000 }),
      totalCents: 2_000,
      count: 4,
      firstDueDate: "2026-01-10",
    });
    expect(plan.creates.map((c) => c.number)).toEqual([3, 4]);
    expect(plan.creates[0]?.dueDate).toBe("2026-03-10");
    // restante 1.000 em 3 parcelas: 333, 333, 334
    const all = [
      ...plan.updates.map((u) => [u.id, u.expectedCents] as const),
      ...plan.creates.map((c) => [`new${c.number}`, c.expectedCents] as const),
    ];
    expect(all.map(([, v]) => v)).toEqual([333, 333, 334]);
  });

  it("reduzir a quantidade remove as últimas não pagas e recalcula", () => {
    const plan = planLineUpdate({
      existing: existing(5, 5_000, { 1: 1_000 }),
      totalCents: 5_000,
      count: 3,
      firstDueDate: "2026-01-10",
    });
    expect(plan.removes).toEqual(["i5", "i4"]);
    expect(plan.updates.map((u) => [u.id, u.expectedCents])).toEqual([
      ["i2", 2_000],
      ["i3", 2_000],
    ]);
  });

  it("recusa reduzir abaixo do número da última parcela paga", () => {
    expect(() =>
      planLineUpdate({
        existing: existing(5, 5_000, { 1: 1_000, 4: 1_000 }),
        totalCents: 5_000,
        count: 3,
        firstDueDate: "2026-01-10",
      }),
    ).toThrow(InstallmentPlanError);
  });

  it("permite reduzir até o número da última parcela paga", () => {
    const plan = planLineUpdate({
      existing: existing(5, 5_000, { 1: 1_000, 4: 1_000 }),
      totalCents: 5_000,
      count: 4,
      firstDueDate: "2026-01-10",
    });
    expect(plan.removes).toEqual(["i5"]);
  });

  it("mudar a data da 1ª parcela só reajusta os vencimentos das não pagas", () => {
    const plan = planLineUpdate({
      existing: existing(3, 3_000, { 1: 1_000 }),
      totalCents: 3_000,
      count: 3,
      firstDueDate: "2026-02-28",
    });
    expect(plan.updates).toEqual([
      { id: "i2", dueDate: "2026-03-28", expectedCents: 1_000 },
      { id: "i3", dueDate: "2026-04-28", expectedCents: 1_000 },
    ]);
  });

  it("nada muda -> plano vazio", () => {
    const plan = planLineUpdate({
      existing: existing(3, 3_000),
      totalCents: 3_000,
      count: 3,
      firstDueDate: "2026-01-10",
    });
    expect(plan).toEqual({
      updates: [],
      creates: [],
      removes: [],
      warning: null,
    });
  });

  it("total abaixo do já pago: restantes viram 0 com aviso", () => {
    const plan = planLineUpdate({
      existing: existing(3, 3_000, { 1: 1_000, 2: 1_000 }),
      totalCents: 1_500,
      count: 3,
      firstDueDate: "2026-01-10",
    });
    expect(plan.warning).toBe("paid_reached_total");
    expect(plan.updates).toEqual([
      { id: "i3", dueDate: "2026-03-10", expectedCents: 0 },
    ]);
  });
});
