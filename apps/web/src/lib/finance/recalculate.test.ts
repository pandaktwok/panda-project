import { describe, expect, it } from "vitest";
import { distributeCents, recalculateInstallments } from "./recalculate";

const unpaid = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: `i${from + i}`,
    number: from + i,
  }));

describe("distributeCents", () => {
  it("divide igual e a última absorve o resto", () => {
    expect(distributeCents(1000, 3)).toEqual([333, 333, 334]);
    expect(distributeCents(639000 * 2, 2)).toEqual([639000, 639000]);
  });

  it("sem parcelas devolve lista vazia", () => {
    expect(distributeCents(1000, 0)).toEqual([]);
  });

  it("a soma é sempre igual ao total", () => {
    for (const [total, count] of [
      [1, 3],
      [999_999, 7],
      [6_560_000, 10],
    ]) {
      const parts = distributeCents(total, count);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe("recalculateInstallments", () => {
  it("caso obrigatório: total 65.600, 8 pagas = 52.820 → 6.390 cada", () => {
    const result = recalculateInstallments({
      lineTotalCents: 6_560_000,
      paidTotalCents: 5_282_000,
      installmentsCount: 10,
      paidCount: 8,
      unpaid: unpaid(9, 10),
    });
    expect(result.values.map((v) => v.expectedCents)).toEqual([
      639_000, 639_000,
    ]);
    expect(result.remainingCents).toBe(1_278_000);
    expect(result.warning).toBeNull();
  });

  it("pago como previsto não muda as demais", () => {
    const result = recalculateInstallments({
      lineTotalCents: 6_560_000,
      paidTotalCents: 656_000,
      installmentsCount: 10,
      paidCount: 1,
      unpaid: unpaid(2, 10),
    });
    expect(new Set(result.values.map((v) => v.expectedCents))).toEqual(
      new Set([656_000]),
    );
  });

  it("pago acima do total zera o resto e avisa", () => {
    const result = recalculateInstallments({
      lineTotalCents: 100_000,
      paidTotalCents: 120_000,
      installmentsCount: 3,
      paidCount: 1,
      unpaid: unpaid(2, 3),
    });
    expect(result.values.map((v) => v.expectedCents)).toEqual([0, 0]);
    expect(result.warning).toBe("paid_reached_total");
  });

  it("ordena por número mesmo que a lista venha bagunçada", () => {
    const result = recalculateInstallments({
      lineTotalCents: 1000,
      paidTotalCents: 0,
      installmentsCount: 3,
      paidCount: 0,
      unpaid: [
        { id: "c", number: 3 },
        { id: "a", number: 1 },
        { id: "b", number: 2 },
      ],
    });
    expect(result.values.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(result.values.map((v) => v.expectedCents)).toEqual([333, 333, 334]);
  });
});
