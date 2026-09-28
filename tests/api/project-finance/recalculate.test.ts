import { describe, expect, it } from "vitest";
import {
  distributeCents,
  recalculateInstallments,
} from "../../../apps/api/src/project-finance/recalculate";

const reais = (value: number) => value * 100;

function unpaidList(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => ({
    id: `i${from + index}`,
    number: from + index,
  }));
}

function values(result: ReturnType<typeof recalculateInstallments>) {
  return result.values.map((item) => item.expectedCents);
}

describe("distributeCents", () => {
  it("divide sem resto", () => {
    expect(distributeCents(9000, 3)).toEqual([3000, 3000, 3000]);
  });

  it("10.000 centavos em 3 parcelas: 3333, 3333, 3334 (a última absorve)", () => {
    expect(distributeCents(10_000, 3)).toEqual([3333, 3333, 3334]);
  });

  it("uma parcela leva o valor todo; zero parcelas não gera nada", () => {
    expect(distributeCents(12_345, 1)).toEqual([12_345]);
    expect(distributeCents(500, 0)).toEqual([]);
  });

  it("total menor que a quantidade: só a última recebe centavos", () => {
    expect(distributeCents(2, 5)).toEqual([0, 0, 0, 0, 2]);
  });

  it("recusa valores fracionados ou negativos", () => {
    expect(() => distributeCents(10.5, 3)).toThrow(RangeError);
    expect(() => distributeCents(-1, 3)).toThrow(RangeError);
  });
});

describe("recalculateInstallments", () => {
  it("caso do dono: total 65.600, 8 parcelas pagas somando 52.820 -> 9 e 10 valem 6.390 cada", () => {
    const result = recalculateInstallments({
      lineTotalCents: reais(65_600),
      paidTotalCents: reais(52_820),
      installmentsCount: 10,
      paidCount: 8,
      unpaid: unpaidList(9, 10),
    });
    expect(values(result)).toEqual([6_390_00, 6_390_00]);
    expect(result.remainingCents).toBe(12_780_00);
    expect(result.warning).toBeNull();
  });

  it("divisão que não fecha: a última absorve a diferença e a soma bate", () => {
    const result = recalculateInstallments({
      lineTotalCents: 10_000,
      paidTotalCents: 0,
      installmentsCount: 3,
      paidCount: 0,
      unpaid: unpaidList(1, 3),
    });
    expect(values(result)).toEqual([3333, 3333, 3334]);
  });

  it("pagar exatamente o previsto não muda nada", () => {
    // 10 parcelas de 6.560; 1ª paga exatamente 6.560.
    const result = recalculateInstallments({
      lineTotalCents: reais(65_600),
      paidTotalCents: reais(6_560),
      installmentsCount: 10,
      paidCount: 1,
      unpaid: unpaidList(2, 10),
    });
    expect(new Set(values(result))).toEqual(new Set([reais(6_560)]));
    expect(result.values).toHaveLength(9);
  });

  it("pagar a menos aumenta as restantes", () => {
    const result = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(50), // previsto era 100
      installmentsCount: 10,
      paidCount: 1,
      unpaid: unpaidList(2, 10),
    });
    // (1000 - 50) / 9 = 105,555... -> 10555 centavos, a última leva o resto.
    expect(values(result).slice(0, 8)).toEqual(Array(8).fill(10_555));
    expect(values(result)[8]).toBe(10_560);
    expect(values(result)[0]).toBeGreaterThan(reais(100));
  });

  it("pagar a mais diminui as restantes", () => {
    const result = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(150),
      installmentsCount: 10,
      paidCount: 1,
      unpaid: unpaidList(2, 10),
    });
    expect(values(result)[0]).toBeLessThan(reais(100));
  });

  it("pagar a última parcela: as restantes (anteriores) absorvem a diferença", () => {
    // Só a parcela 10 foi paga (a 500,00, previsto 100,00). Restam 1..9.
    const result = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(500),
      installmentsCount: 10,
      paidCount: 1,
      unpaid: unpaidList(1, 9),
    });
    expect(result.values.reduce((s, v) => s + v.expectedCents, 0)).toBe(
      reais(500),
    );
    expect(result.values.map((v) => v.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("pagamento fora de ordem: usa a contagem de pagas, não a posição", () => {
    // Parcela 5 paga (R$ 200,00) num total de 1.000,00 em 5 parcelas.
    const outOfOrder = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(200),
      installmentsCount: 5,
      paidCount: 1,
      unpaid: [
        { id: "a", number: 1 },
        { id: "b", number: 2 },
        { id: "c", number: 3 },
        { id: "d", number: 4 },
      ],
    });
    expect(values(outOfOrder)).toEqual(Array(4).fill(reais(200)));
    // Mesma conta se a paga fosse a 1ª: só a contagem importa.
    const inOrder = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(200),
      installmentsCount: 5,
      paidCount: 1,
      unpaid: [
        { id: "b", number: 2 },
        { id: "c", number: 3 },
        { id: "d", number: 4 },
        { id: "e", number: 5 },
      ],
    });
    expect(values(inOrder)).toEqual(values(outOfOrder));
  });

  it("a parcela de maior número absorve o resto, mesmo com a lista fora de ordem", () => {
    const result = recalculateInstallments({
      lineTotalCents: 10_000,
      paidTotalCents: 0,
      installmentsCount: 3,
      paidCount: 0,
      unpaid: [
        { id: "z", number: 3 },
        { id: "x", number: 1 },
        { id: "y", number: 2 },
      ],
    });
    expect(result.values.find((v) => v.id === "z")?.expectedCents).toBe(3334);
    expect(result.values.find((v) => v.id === "x")?.expectedCents).toBe(3333);
  });

  it("pago >= total: restantes viram 0 e vem aviso (nunca negativo)", () => {
    const exact = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(1_000),
      installmentsCount: 4,
      paidCount: 2,
      unpaid: unpaidList(3, 4),
    });
    expect(values(exact)).toEqual([0, 0]);
    expect(exact.warning).toBe("paid_reached_total");
    expect(exact.remainingCents).toBe(0);

    const over = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(1_300),
      installmentsCount: 4,
      paidCount: 2,
      unpaid: unpaidList(3, 4),
    });
    expect(values(over)).toEqual([0, 0]);
    expect(over.warning).toBe("paid_reached_total");
    expect(over.remainingCents).toBe(0);
  });

  it("linha quitada na última parcela paga exatamente: sem restantes e sem aviso", () => {
    const result = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(1_000),
      installmentsCount: 4,
      paidCount: 4,
      unpaid: [],
    });
    expect(result.values).toEqual([]);
    expect(result.warning).toBeNull();
  });

  it("pago a mais sem parcelas restantes também avisa", () => {
    const result = recalculateInstallments({
      lineTotalCents: reais(1_000),
      paidTotalCents: reais(1_001),
      installmentsCount: 2,
      paidCount: 2,
      unpaid: [],
    });
    expect(result.warning).toBe("paid_reached_total");
  });

  it("recusa contagens inconsistentes e dinheiro fracionado", () => {
    expect(() =>
      recalculateInstallments({
        lineTotalCents: 100,
        paidTotalCents: 0,
        installmentsCount: 3,
        paidCount: 0,
        unpaid: unpaidList(1, 2),
      }),
    ).toThrow(RangeError);
    expect(() =>
      recalculateInstallments({
        lineTotalCents: 100.5,
        paidTotalCents: 0,
        installmentsCount: 1,
        paidCount: 0,
        unpaid: unpaidList(1, 1),
      }),
    ).toThrow(RangeError);
  });

  it("propriedade: a soma de tudo fecha exatamente com o total da linha", () => {
    // Gerador determinístico (LCG) para não depender de biblioteca.
    let seed = 20260924;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let round = 0; round < 500; round += 1) {
      const count = 1 + next(24);
      const total = next(5_000_000_00);
      const paidCount = next(count); // 0..count-1, sempre resta ao menos uma
      // Paga aleatória, mas sem passar do total.
      const paidTotal = paidCount === 0 ? 0 : next(total + 1);
      // Escolhe quais números foram pagos (fora de ordem também).
      const numbers = Array.from({ length: count }, (_, i) => i + 1);
      for (let i = numbers.length - 1; i > 0; i -= 1) {
        const j = next(i + 1);
        [numbers[i], numbers[j]] = [numbers[j] as number, numbers[i] as number];
      }
      const unpaid = numbers
        .slice(paidCount)
        .map((n) => ({ id: `i${n}`, number: n }));
      const result = recalculateInstallments({
        lineTotalCents: total,
        paidTotalCents: paidTotal,
        installmentsCount: count,
        paidCount,
        unpaid,
      });
      const sum = result.values.reduce((s, v) => s + v.expectedCents, 0);
      expect(sum + paidTotal).toBe(total);
      for (const v of result.values) {
        expect(Number.isInteger(v.expectedCents)).toBe(true);
        expect(v.expectedCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
