const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/core.js");

test("parseSetupUrl extrai origem e workspace", () => {
  assert.deepEqual(
    core.parseSetupUrl("https://panda.exemplo.com/dashboard/workspace/abc123/project/p1/board"),
    { origin: "https://panda.exemplo.com", workspaceId: "abc123" },
  );
  assert.equal(core.parseSetupUrl("https://panda.exemplo.com/dashboard"), null);
  assert.equal(core.parseSetupUrl("texto solto"), null);
  assert.equal(core.parseSetupUrl("ftp://x/workspace/1"), null);
});

test("formatMoney e datas em pt-BR", () => {
  assert.match(core.formatMoney(350000), /3\.500,00/);
  assert.equal(core.formatDateBR("2026-09-29"), "29/09/2026");
});

test("relativeDay e daysBetween", () => {
  assert.equal(core.daysBetween("2026-09-29", "2026-10-02"), 3);
  assert.equal(core.relativeDay("2026-09-29", "2026-09-29"), "hoje");
  assert.equal(core.relativeDay("2026-09-29", "2026-09-30"), "amanhã");
  assert.equal(core.relativeDay("2026-09-29", "2026-10-04"), "em 5 dias");
  assert.equal(core.relativeDay("2026-09-29", "2026-09-26"), "há 3 dias");
  assert.equal(core.daysBetween("2026-02-28", "2026-03-01"), 1);
});

test("toSaoPauloDay respeita o fuso de Brasília", () => {
  // 01:30 UTC de 30/09 ainda é 22:30 de 29/09 em Brasília.
  assert.equal(core.toSaoPauloDay("2026-09-30T01:30:00.000Z"), "2026-09-29");
  assert.equal(core.toSaoPauloDay("2026-09-30T12:00:00.000Z"), "2026-09-30");
});

test("buildMonthGrid: setembro/2026 começa numa terça e marca hoje", () => {
  const weeks = core.buildMonthGrid(2026, 9, "2026-09-29");
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0][0].iso, "2026-08-30"); // domingo anterior
  assert.equal(weeks[0][2].iso, "2026-09-01"); // 1º de setembro é terça
  assert.equal(weeks[0][0].inMonth, false);
  const today = weeks.flat().find((c) => c.isToday);
  assert.equal(today.iso, "2026-09-29");
  assert.equal(weeks.flat().filter((c) => c.inMonth).length, 30);
});

test("shiftMonth vira o ano", () => {
  assert.deepEqual(core.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(core.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test("indexByDay e buildAgenda", () => {
  const calendar = {
    installments: [
      { id: "a", dueDate: "2026-10-01", status: "pending", supplier: "X" },
      { id: "b", dueDate: "2026-09-10", status: "overdue", supplier: "Y" },
      { id: "c", dueDate: "2026-10-01", status: "paid", supplier: "Z" },
    ],
    tasks: [{ id: "t", dueDate: "2026-10-01T15:00:00.000Z", startDate: null, title: "T" }],
  };
  const index = core.indexByDay(calendar);
  assert.equal(index.get("2026-10-01").installments.length, 2);
  assert.equal(index.get("2026-10-01").tasks.length, 1);
  const agenda = core.buildAgenda(calendar, "2026-09-29");
  assert.equal(agenda.length, 1); // atrasada (passado) e paga ficam fora
  assert.deepEqual(agenda[0].items.map((i) => i.kind), ["payment", "task"]);
});

test("timeAgo", () => {
  assert.equal(core.timeAgo("2026-09-29T12:00:00Z", "2026-09-29T20:00:00Z"), "hoje");
  assert.equal(core.timeAgo("2026-09-27T12:00:00Z", "2026-09-29T20:00:00Z"), "há 2 dias");
});
