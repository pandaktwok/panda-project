import { describe, expect, it } from "vitest";
import {
  diffIsoDays,
  formatBasisPoints,
  formatCents,
  formatCentsPlain,
  formatIsoDate,
  formatIsoDayMonth,
  parseMoneyToCents,
} from "./money";

describe("parseMoneyToCents", () => {
  it.each([
    ["6.900,00", 690000],
    ["R$ 6.900,00", 690000],
    ["6900", 690000],
    ["6900,5", 690050],
    ["6.900", 690000],
    ["0,05", 5],
    [",5", 50],
    ["1.234.567,89", 123456789],
    ["12.5", 1250],
  ])("lê %s como %i centavos", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "1,2,3", "1,234", "12,345", "-5", "1.2.3,4.5"])(
    "recusa %j",
    (input) => {
      expect(parseMoneyToCents(input)).toBeNull();
    },
  );

  it("não perde centavos por causa de ponto flutuante", () => {
    expect(parseMoneyToCents("0,29")).toBe(29);
    expect(parseMoneyToCents("1.005,10")).toBe(100510);
  });
});

describe("formatação", () => {
  it("mostra R$ pt-BR", () => {
    expect(formatCents(656000)).toBe("R$ 6.560,00");
    expect(formatCents(5)).toBe("R$ 0,05");
    expect(formatCents(0)).toBe("R$ 0,00");
  });

  it("formata sem símbolo para campos de edição", () => {
    expect(formatCentsPlain(690000)).toBe("6.900,00");
  });

  it("pontos-base viram porcentagem com uma casa, para baixo", () => {
    expect(formatBasisPoints(0)).toBe("0,0%");
    expect(formatBasisPoints(7949)).toBe("79,4%");
    expect(formatBasisPoints(10000)).toBe("100,0%");
    expect(formatBasisPoints(12550)).toBe("125,5%");
  });

  it("datas em dd/mm/aaaa e dd/mm", () => {
    expect(formatIsoDate("2026-09-05")).toBe("05/09/2026");
    expect(formatIsoDayMonth("2026-09-05")).toBe("05/09");
    expect(formatIsoDate("lixo")).toBe("lixo");
  });

  it("diferença entre datas puras em dias", () => {
    expect(diffIsoDays("2026-09-05", "2026-09-24")).toBe(19);
    expect(diffIsoDays("2026-02-28", "2026-03-01")).toBe(1);
  });
});
