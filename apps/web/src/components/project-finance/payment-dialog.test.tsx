import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FinanceFileRequestError,
  uploadFinanceFile,
} from "@/fetchers/project-finance/files";
import { buildSchedule } from "@/lib/finance/schedule";
import { makeLine, makeState } from "@/test/finance-fixtures";
import PaymentDialog from "./payment-dialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/fetchers/project-finance/files", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/project-finance/files")
  >()),
  uploadFinanceFile: vi.fn(),
}));

const upload = vi.mocked(uploadFinanceFile);

const state = makeState([
  makeLine({
    id: "m",
    supplier: "Mirella Sombrio",
    total: 6_560_000,
    count: 10,
    paid: 7,
  }),
]);
const model = buildSchedule(state, {});
const row = model.rows[0];
const cell = row.cells[7];

function setup() {
  const onConfirm = vi.fn();
  render(
    <PaymentDialog
      open
      onClose={vi.fn()}
      state={state}
      marks={{}}
      cell={cell}
      row={row}
      projectId="p1"
      projectName="Projeto Teste"
      onConfirm={onConfirm}
      onRemoveMark={vi.fn()}
    />,
  );
  return { onConfirm };
}

function pick(purpose: "receipt" | "invoice", name = "arquivo.pdf") {
  const input = screen.getByTestId(`finance-file-${purpose}`);
  fireEvent.change(input, {
    target: {
      files: [new File(["%PDF-1.4"], name, { type: "application/pdf" })],
    },
  });
}

beforeEach(() => {
  upload.mockReset();
});
afterEach(cleanup);

describe("PaymentDialog: comprovante + NF", () => {
  it("só habilita confirmar com os dois arquivos", async () => {
    upload.mockImplementation(async (_project, purpose, file) => ({
      id: `asset-${purpose}`,
      filename: file.name,
      mimeType: "application/pdf",
      size: 8,
      purpose,
    }));
    const { onConfirm } = setup();
    const confirm = screen.getByRole("button", {
      name: "finance:payment.confirm",
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    pick("receipt", "comprovante.pdf");
    await screen.findByText("comprovante.pdf");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    pick("invoice", "nf.pdf");
    await screen.findByText("nf.pdf");
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [installmentId, mark] = onConfirm.mock.calls[0];
    expect(installmentId).toBe(cell.installmentId);
    expect(mark.receipts[0].assetId).toBe("asset-receipt");
    expect(mark.invoices[0].assetId).toBe("asset-invoice");
    expect(upload).toHaveBeenCalledWith("p1", "receipt", expect.any(File));
    expect(upload).toHaveBeenCalledWith("p1", "invoice", expect.any(File));
  });

  it("mostra o nome final do PDF e a pasta antes de confirmar", () => {
    setup();
    expect(
      screen.getByText(/Mirella Sombrio - Parcela 8\.pdf/, { exact: false })
        .textContent,
    ).toContain("Mirella Sombrio - Parcela 8.pdf");
    expect(
      screen.getByText(/Projeto Teste \/ Financeiro \/ Parcela 8 - /, {
        exact: false,
      }).textContent,
    ).toContain("Projeto Teste / Financeiro / Parcela 8 - ");
  });

  it("aceita vários comprovantes e notas fiscais nomeados (Atualização 3)", async () => {
    upload.mockImplementation(async (_project, purpose, file) => ({
      id: `asset-${purpose}-${file.name}`,
      filename: file.name,
      mimeType: "application/pdf",
      size: 8,
      purpose,
    }));
    const { onConfirm } = setup();

    pick("receipt", "luz-salao.pdf");
    await screen.findByText("luz-salao.pdf");
    pick("receipt", "agua.pdf");
    await screen.findByText("agua.pdf");
    pick("invoice", "nf.pdf");
    await screen.findByText("nf.pdf");

    const confirm = screen.getByRole("button", {
      name: "finance:payment.confirm",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [, mark] = onConfirm.mock.calls[0];
    expect(mark.receipts).toHaveLength(2);
    expect(mark.receipts[0].name).toBe("luz-salao.pdf");
    expect(mark.receipts[1].name).toBe("agua.pdf");
    expect(mark.invoices).toHaveLength(1);
  });

  it("permite remover um anexo antes de salvar", async () => {
    upload.mockImplementation(async (_project, purpose, file) => ({
      id: `asset-${purpose}-${file.name}`,
      filename: file.name,
      mimeType: "application/pdf",
      size: 8,
      purpose,
    }));
    setup();
    pick("receipt", "comprovante.pdf");
    await screen.findByText("comprovante.pdf");
    const removeButtons = await screen.findAllByRole("button", {
      name: /finance:payment.fileRemove/,
    });
    fireEvent.click(removeButtons[0]);
    await waitFor(() =>
      expect(screen.queryByText("comprovante.pdf")).toBeNull(),
    );
  });

  it("erro da API vira mensagem por código e não deixa confirmar", async () => {
    upload.mockRejectedValue(
      new FinanceFileRequestError(422, "encrypted", "PDF_ENCRYPTED"),
    );
    setup();
    pick("receipt");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("finance:files.errors.PDF_ENCRYPTED");
    expect(
      (
        screen.getByRole("button", {
          name: "finance:payment.confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
