import { describe, expect, it } from "vitest";
import {
  computeFinalStretch,
  finalStretchNoticeMonth,
  isFinalStretchInstallment,
} from "../../../apps/api/src/project-finance/final-stretch";

describe("isFinalStretchInstallment", () => {
  it("as 3 últimas parcelas da linha", () => {
    const flags = Array.from({ length: 10 }, (_, i) =>
      isFinalStretchInstallment(i + 1, 10),
    );
    expect(flags).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("linha com 3 parcelas ou menos: todas", () => {
    expect([1, 2, 3].map((n) => isFinalStretchInstallment(n, 3))).toEqual([
      true,
      true,
      true,
    ]);
    expect(isFinalStretchInstallment(1, 1)).toBe(true);
    expect(isFinalStretchInstallment(2, 2)).toBe(true);
  });
});

function project(dueDates: string[], paid: string[] = []) {
  return dueDates.map((dueDate) => ({ dueDate, paid: paid.includes(dueDate) }));
}

describe("computeFinalStretch", () => {
  const ten = Array.from({ length: 10 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    return `2026-${month}-10`;
  });

  it("dispara no vencimento da antepenúltima parcela (3º mês contando do fim)", () => {
    const before = computeFinalStretch(project(ten), "2026-07-31");
    expect(before.active).toBe(false);
    expect(before.referenceDate).toBe("2026-08-10");
    expect(before.alertMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(before.lastDueDate).toBe("2026-10-10");

    expect(computeFinalStretch(project(ten), "2026-08-09").active).toBe(false);
    const on = computeFinalStretch(project(ten), "2026-08-10");
    expect(on.active).toBe(true);
    expect(on.currentMonth).toBe("2026-08");
  });

  it("repete todo mês até o fim (mês corrente muda) e passa do último vencimento se houver pendência", () => {
    expect(computeFinalStretch(project(ten), "2026-09-20").currentMonth).toBe(
      "2026-09",
    );
    const late = computeFinalStretch(project(ten), "2026-12-05");
    expect(late.active).toBe(true);
    expect(late.currentMonth).toBe("2026-12");
  });

  it("termina quando tudo está pago", () => {
    const result = computeFinalStretch(project(ten, ten), "2026-09-20");
    expect(result.active).toBe(false);
    expect(result.currentMonth).toBeNull();
  });

  it("várias linhas: usa os meses distintos do projeto, não uma linha curta", () => {
    const shortLine = ["2026-01-10", "2026-02-10"];
    const longLine = ten;
    const result = computeFinalStretch(
      project([...shortLine, ...longLine]),
      "2026-03-01",
    );
    expect(result.active).toBe(false);
    expect(result.referenceDate).toBe("2026-08-10");
  });

  it("dia diferente dentro do mesmo mês: vale o menor vencimento do mês", () => {
    const result = computeFinalStretch(
      project(["2026-05-10", "2026-06-05", "2026-06-25", "2026-07-15"]),
      "2026-05-09",
    );
    expect(result.referenceDate).toBe("2026-05-10");
    expect(result.active).toBe(false);
    const next = computeFinalStretch(
      project(["2026-05-10", "2026-06-05", "2026-06-25", "2026-07-15"]),
      "2026-05-10",
    );
    expect(next.active).toBe(true);
  });

  it("projeto com menos de 3 meses distintos já está na reta final", () => {
    const result = computeFinalStretch(
      project(["2026-05-10", "2026-06-10"]),
      "2026-05-10",
    );
    expect(result.active).toBe(true);
    expect(result.alertMonths).toEqual(["2026-05", "2026-06"]);
  });

  it("projeto sem parcelas nunca alerta", () => {
    expect(computeFinalStretch([], "2026-05-10")).toEqual({
      active: false,
      referenceDate: null,
      lastDueDate: null,
      alertMonths: [],
      currentMonth: null,
    });
  });
});

describe("finalStretchNoticeMonth (aviso mensal, fuso de Brasília)", () => {
  const monthly = Array.from({ length: 10 }, (_, i) => ({
    dueDate: `2026-${String(i + 1).padStart(2, "0")}-10`,
    paid: false,
  }));
  const at = (local: string) => new Date(`${local}-03:00`);

  it("só a partir das 08:00 do dia do vencimento de referência", () => {
    expect(finalStretchNoticeMonth(monthly, at("2026-08-10T07:59"))).toBeNull();
    expect(finalStretchNoticeMonth(monthly, at("2026-08-10T08:00"))).toBe(
      "2026-08",
    );
  });

  it("usa o fuso de Brasília, não o UTC", () => {
    // 10/08 10:59Z = 07:59 em Brasília: ainda não
    expect(
      finalStretchNoticeMonth(monthly, new Date("2026-08-10T10:59:00Z")),
    ).toBeNull();
    expect(
      finalStretchNoticeMonth(monthly, new Date("2026-08-10T11:00:00Z")),
    ).toBe("2026-08");
    // 01/09 01:00Z ainda é 31/08 em Brasília
    expect(
      finalStretchNoticeMonth(monthly, new Date("2026-09-01T01:00:00Z")),
    ).toBe("2026-08");
  });

  it("depois do horário ainda avisa no mesmo mês (recuperação) e antes do dia não", () => {
    expect(finalStretchNoticeMonth(monthly, at("2026-08-25T15:00"))).toBe(
      "2026-08",
    );
    expect(finalStretchNoticeMonth(monthly, at("2026-09-09T23:00"))).toBeNull();
  });

  it("tudo pago ou sem parcelas: nunca", () => {
    expect(
      finalStretchNoticeMonth(
        monthly.map((item) => ({ ...item, paid: true })),
        at("2026-09-20T12:00"),
      ),
    ).toBeNull();
    expect(finalStretchNoticeMonth([], at("2026-09-20T12:00"))).toBeNull();
  });
});
