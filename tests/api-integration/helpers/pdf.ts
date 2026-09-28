import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
} from "../../../apps/api/node_modules/pdf-lib";

/** PDF de teste: uma página por texto, cada uma com o texto desenhado. */
export async function makePdf(texts: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = doc.addPage([300, 400]);
    page.drawText(text, { x: 20, y: 200, size: 14, font });
  }
  return doc.save();
}

/** Texto de cada página do PDF (lido dos comandos Tj da própria página). */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    let text = "";
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(decodePDFRawStream(stream).decode()).toString(
        "latin1",
      );
      for (const match of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        text += Buffer.from(match[1] ?? "", "hex").toString("latin1");
      }
      for (const match of decoded.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
        text += match[1] ?? "";
      }
    }
    return text;
  });
}

export async function pageSizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getSize());
}
