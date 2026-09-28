import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeLine, makeState, makeTag } from "@/test/finance-fixtures";
import LineDialog from "./line-dialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

const state = makeState([]);

function setup(line: ReturnType<typeof makeLine> | null = null) {
  const onSubmit = vi.fn();
  render(
    <LineDialog
      open
      onClose={vi.fn()}
      state={state}
      line={line}
      saving={false}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

function fill(supplier: string, amount: string, months: string) {
  fireEvent.change(screen.getByLabelText("finance:lineDialog.supplier"), {
    target: { value: supplier },
  });
  fireEvent.change(screen.getByLabelText("finance:lineDialog.each"), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByLabelText("finance:lineDialog.months"), {
    target: { value: months },
  });
  fireEvent.change(screen.getByLabelText("finance:lineDialog.firstDue"), {
    target: { value: "2026-10-05" },
  });
}

afterEach(cleanup);

describe("LineDialog: valor de cada parcela", () => {
  it("o total da linha é o valor da parcela vezes a quantidade de meses", async () => {
    const { onSubmit } = setup();
    fill("Fornecedor", "3.500,00", "10");
    const preview = await screen.findByTestId("line-preview");
    expect(preview.textContent).toContain("3.500,00");
    expect(preview.textContent).toContain("35.000,00");
    fireEvent.click(screen.getByText("finance:common.save"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      totalCents: 3_500_000,
      installmentsCount: 10,
    });
  });

  it("ao editar, parte do total atual dividido pelas parcelas", () => {
    const line = makeLine({
      id: "l1",
      supplier: "Mirella",
      total: 350_000,
      count: 10,
      paid: 0,
    });
    setup(line);
    const input = screen.getByLabelText(
      "finance:lineDialog.each",
    ) as HTMLInputElement;
    expect(input.value).toBe("350,00");
  });
});

describe("LineDialog: linha automática (Atualização 3)", () => {
  it("desmarcando o valor fixo, mostra data final e calcula os meses entre as datas", async () => {
    const tag = makeTag({
      id: "t1",
      name: "Luz e água",
      valueCents: 4_000_000,
    });
    const stateWithTag = makeState([], [tag]);
    const onSubmit = vi.fn();
    render(
      <LineDialog
        open
        onClose={vi.fn()}
        state={stateWithTag}
        line={null}
        saving={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("finance:lineDialog.supplier"), {
      target: { value: "Luz e água" },
    });
    fireEvent.click(screen.getByText("finance:lineDialog.isFixedAmount"));

    // Sem tag selecionada ainda: sem tag não é permitido salvar (a linha
    // automática precisa de uma tag para ratear a sobra do orçamento).
    expect(
      (screen.getByText("finance:common.save") as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("finance:lineDialog.firstDue"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.change(screen.getByLabelText("finance:lineDialog.finalDue"), {
      target: { value: "2026-11-01" },
    });

    // Fev a nov/2026, inclusive: 10 meses.
    const preview = await screen.findByTestId("line-preview");
    expect(preview.textContent).toContain("10");
  });
});
