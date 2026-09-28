import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSchedule } from "@/lib/finance/schedule";
import { MARK_FILES, makeLine, makeState } from "@/test/finance-fixtures";
import PaymentTable from "./payment-table";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

afterEach(cleanup);

const state = makeState([
  makeLine({
    id: "m",
    supplier: "Mirella",
    total: 6_560_000,
    count: 10,
    paid: 7,
  }),
  makeLine({
    id: "c",
    supplier: "Captador",
    total: 1_200_000,
    count: 1,
    paid: 1,
  }),
]);

function setup(
  overrides: Partial<{
    canManage: boolean;
    canPay: boolean;
    canUndo: boolean;
  }> = {},
) {
  const props = {
    state,
    model: buildSchedule(state, {
      "m-8": { paidCents: 690_000, paidAt: "2026-09-24", ...MARK_FILES },
    }),
    canManage: true,
    canPay: true,
    canUndo: true,
    saving: false,
    onCellClick: vi.fn(),
    onNewLine: vi.fn(),
    onEditLine: vi.fn(),
    onDeleteLine: vi.fn(),
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<PaymentTable {...props} />);
  return props;
}

const cell = (n: number) =>
  screen.getByRole("button", {
    name: new RegExp(`"supplier":"Mirella","number":${n},`),
  });

describe("PaymentTable", () => {
  it("clicar numa parcela pendente avisa a página", () => {
    const props = setup();
    fireEvent.click(cell(9));
    expect(props.onCellClick).toHaveBeenCalledTimes(1);
    expect(props.onCellClick.mock.calls[0][0]).toMatchObject({
      number: 9,
      status: "pending",
    });
  });

  it("sem permissão de pagar a parcela pendente fica travada", () => {
    setup({ canPay: false });
    expect(cell(9)).toBeDisabled();
  });

  it("parcela paga só destrava para quem pode desfazer", () => {
    setup({ canUndo: false });
    expect(cell(1)).toBeDisabled();
    cleanup();
    setup({ canUndo: true });
    expect(cell(1)).toBeEnabled();
  });

  it("botões de gerenciar só aparecem para quem gerencia", () => {
    setup({ canManage: false });
    expect(screen.queryByText("finance:table.newLine")).toBeNull();
    expect(
      screen.queryAllByLabelText(/finance:table.editLineAria/),
    ).toHaveLength(0);
  });

  it("botão de salvar dispara onSave", () => {
    const props = setup();
    fireEvent.click(screen.getByText("finance:save.save"));
    expect(props.onSave).toHaveBeenCalled();
  });

  it("linha com menos parcelas completa a grade sem criar botões", () => {
    setup();
    // 10 parcelas de Mirella + 1 do Captador = 11 botões de parcela
    const cells = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label")?.includes('"number"'));
    expect(cells).toHaveLength(11);
  });
});
