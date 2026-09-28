import { describe, expect, it } from "vitest";
import { detectFileType } from "../../../apps/api/src/project-finance/files/file-type";
import {
  attachmentName,
  folderLabelFor,
  paymentBaseName,
  sanitizeNamePart,
  uniqueFileName,
} from "../../../apps/api/src/project-finance/files/names";

describe("nomes de arquivo", () => {
  it('tira / \\ : * ? " < > | e limita o tamanho', () => {
    expect(sanitizeNamePart('A/B\\C:D*E?F"G<H>I|J')).toBe(
      "A B C D E F G H I J",
    );
    expect(sanitizeNamePart("x".repeat(200))).toHaveLength(80);
    expect(sanitizeNamePart("   ")).toBe("Sem nome");
    expect(sanitizeNamePart("..segredo")).toBe("segredo");
    expect(sanitizeNamePart("a\u0000b\u001fc")).toBe("abc");
  });

  it("Fornecedor - Parcela N", () => {
    expect(paymentBaseName("Mirella Sombrio", 8)).toBe(
      "Mirella Sombrio - Parcela 8",
    );
  });

  it("pasta usa mês e ano do vencimento, sem fuso", () => {
    expect(folderLabelFor(8, "2026-09-05")).toBe("Parcela 8 - 09-2026");
    expect(folderLabelFor(1, "2026-12-31")).toBe("Parcela 1 - 12-2026");
    expect(folderLabelFor(2, "2027-01-01")).toBe("Parcela 2 - 01-2027");
    expect(() => folderLabelFor(1, "05/09/2026")).toThrow();
  });

  it("nome repetido na mesma pasta ganha (2), (3), ignorando maiúsculas", () => {
    const taken = new Set<string>();
    const names = [];
    for (let index = 0; index < 3; index += 1) {
      const name = uniqueFileName("Mirella Sombrio - Parcela 8", "pdf", taken);
      taken.add(name);
      names.push(name);
    }
    expect(names).toEqual([
      "Mirella Sombrio - Parcela 8.pdf",
      "Mirella Sombrio - Parcela 8 (2).pdf",
      "Mirella Sombrio - Parcela 8 (3).pdf",
    ]);
    expect(uniqueFileName("A", "pdf", ["a.PDF"])).toBe("A (2).pdf");
  });

  it("anexo mantém o nome e troca a extensão pela real", () => {
    expect(attachmentName("Projeto aprovado.docx", "pdf")).toBe(
      "Projeto aprovado.pdf",
    );
    expect(attachmentName("foto", "jpg")).toBe("foto.jpg");
  });
});

describe("tipo pelo conteúdo", () => {
  const bytes = (...values: number[]) =>
    new Uint8Array([...values, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("reconhece PDF, JPEG, PNG, WebP e HEIC", () => {
    expect(detectFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("pdf");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(
      detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("png");
    expect(
      detectFileType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe("webp");
    expect(
      detectFileType(
        new Uint8Array([
          0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
        ]),
      ),
    ).toBe("heic");
  });

  it("recusa o resto, mesmo com cara de PDF no nome", () => {
    expect(
      detectFileType(
        new TextEncoder().encode("comprovante.pdf conteúdo texto"),
      ),
    ).toBeNull();
    expect(detectFileType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
