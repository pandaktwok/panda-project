import { describe, expect, it } from "vitest";
import {
  financeFolderPath,
  formatFileSize,
  parcelFolderLabel,
  paymentPdfName,
} from "./file-names";

describe("nomes mostrados antes de salvar", () => {
  it("pasta usa mês e ano do vencimento, sem virar de dia por fuso", () => {
    expect(parcelFolderLabel(8, "2026-09-05")).toBe("Parcela 8 - 09-2026");
    expect(parcelFolderLabel(1, "2026-12-31")).toBe("Parcela 1 - 12-2026");
    expect(parcelFolderLabel(3, null)).toBe("Parcela 3");
  });

  it("Fornecedor - Parcela N.pdf, sem caracteres proibidos", () => {
    expect(paymentPdfName("Mirella Sombrio", 8)).toBe(
      "Mirella Sombrio - Parcela 8.pdf",
    );
    expect(paymentPdfName("A/B:C", 2)).toBe("A B C - Parcela 2.pdf");
    expect(paymentPdfName("  ", 2)).toBe("Sem nome - Parcela 2.pdf");
  });

  it("caminho completo e tamanhos", () => {
    expect(financeFolderPath("Meu Projeto", 8, "2026-09-05")).toBe(
      "Meu Projeto / Financeiro / Parcela 8 - 09-2026 /",
    );
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_572_864)).toBe("1,5 MB");
  });
});
