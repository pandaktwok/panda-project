import { describe, expect, it } from "vitest";
import {
  MARK_FILES,
  makeLine,
  makeState,
  makeTag,
} from "@/test/finance-fixtures";
import {
  basisPoints,
  buildSchedule,
  lastThreeDueDates,
  previewMark,
} from "./schedule";

describe("buildSchedule", () => {
  // Atualização 2: "Total do projeto" passa a ser a soma do VALOR (orçamento)
  // das etiquetas, não a soma dos totais das linhas — por isso cada linha
  // aqui carrega sua própria etiqueta com valueCents igual ao total da linha,
  // reproduzindo o cenário antigo (7.760.000) sob a nova regra.
  const tagMirella = makeTag({
    id: "t-m",
    name: "Mirella",
    valueCents: 6_560_000,
  });
  const tagCaptador = makeTag({
    id: "t-c",
    name: "Captador",
    valueCents: 1_200_000,
  });
  const mirella = makeLine({
    id: "m",
    supplier: "Mirella",
    total: 6_560_000,
    count: 10,
    paid: 7,
    tag: tagMirella,
  });
  const captador = makeLine({
    id: "c",
    supplier: "Captador",
    total: 1_200_000,
    count: 1,
    paid: 1,
    tag: tagCaptador,
  });
  const state = makeState([mirella, captador], [tagMirella, tagCaptador]);

  it("classifica as células: paga, vencida, pendente e vazia", () => {
    const model = buildSchedule(state, {});
    const row = model.rows[0];
    expect(row.cells[0].status).toBe("paid");
    expect(row.cells[7].status).toBe("overdue");
    expect(row.cells[8].status).toBe("pending");
    expect(model.rows[1].cells).toHaveLength(1);
    expect(model.columns).toBe(10);
    expect(model.changes).toBe(0);
  });

  it("sem marcações os totais são os do servidor", () => {
    const model = buildSchedule(state, {});
    // Total do projeto = soma do valor (orçamento) das etiquetas.
    expect(model.totals.projectTotalCents).toBe(7_760_000);
    // linesTotalCents = soma dos totais das linhas (rodapé da coluna
    // "Total da linha"); aqui coincide com projectTotalCents porque cada
    // linha tem uma etiqueta própria com o mesmo valor do seu total.
    expect(model.totals.linesTotalCents).toBe(7_760_000);
    expect(model.totals.paidCents).toBe(7 * 656_000 + 1_200_000);
    expect(model.totals.overdueInstallments).toBe(1);
  });

  it("marcar a parcela 8 com 6.900 recalcula as 2 restantes para 6.390", () => {
    const model = buildSchedule(state, {
      "m-8": { paidCents: 690_000, paidAt: "2026-09-24", ...MARK_FILES },
    });
    const cells = model.rows[0].cells;
    expect(cells[7].status).toBe("unsaved");
    expect(cells[7].amountCents).toBe(690_000);
    expect(cells[8].amountCents).toBe(639_000);
    expect(cells[9].amountCents).toBe(639_000);
    expect(model.changes).toBe(1);
    expect(model.rows[0].paidCents).toBe(7 * 656_000 + 690_000);
  });

  it("primeira parcela em aberto serve de âncora da rolagem", () => {
    expect(buildSchedule(state, {}).firstOpenNumber).toBe(8);
  });

  it("cabeçalho vermelho só nas 3 últimas datas do projeto, não pela linha curta", () => {
    const model = buildSchedule(state, {});
    expect(model.heads.map((h) => h.isFinalStretch)).toEqual([
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
    // a parcela única do Captador continua "final" na própria célula
    expect(model.rows[1].cells[0].isFinalStretch).toBe(true);
  });

  it("as 3 últimas datas do projeto", () => {
    expect(lastThreeDueDates(state)).toEqual([
      "2026-09-05",
      "2026-10-05",
      "2026-11-05",
    ]);
  });
});

describe("previewMark", () => {
  const line = makeLine({
    id: "m",
    supplier: "Mirella",
    total: 6_560_000,
    count: 10,
    paid: 7,
  });
  const state = makeState([line]);

  it("mostra antes, depois e a fórmula", () => {
    const preview = previewMark(state, {}, "m-8", {
      paidCents: 690_000,
      paidAt: "2026-09-24",
      ...MARK_FILES,
    });
    expect(preview).not.toBeNull();
    expect(preview?.before.map((r) => r.cents)).toEqual([656_000, 656_000]);
    expect(preview?.after.map((r) => r.cents)).toEqual([639_000, 639_000]);
    expect(preview?.differenceCents).toBe(34_000);
    expect(preview?.formula.perInstallmentCents).toBe(639_000);
    expect(preview?.formula.paidCount).toBe(8);
  });

  it("pago como previsto: diferença zero e nada muda", () => {
    const preview = previewMark(state, {}, "m-8", {
      paidCents: 656_000,
      paidAt: "2026-09-24",
      ...MARK_FILES,
    });
    expect(preview?.differenceCents).toBe(0);
    expect(preview?.after.map((r) => r.cents)).toEqual([656_000, 656_000]);
  });

  it("devolve null para parcela que não existe", () => {
    expect(
      previewMark(state, {}, "nada", {
        paidCents: 1,
        paidAt: "2026-09-24",
        ...MARK_FILES,
      }),
    ).toBeNull();
  });
});

describe("basisPoints", () => {
  it("é inteiro e arredonda para baixo", () => {
    expect(basisPoints(1, 3)).toBe(3333);
    expect(basisPoints(0, 100)).toBe(0);
    expect(basisPoints(10, 0)).toBe(0);
    expect(basisPoints(125, 100)).toBe(12500);
  });
});
