import {
  degrees,
  EncryptedPDFError,
  PDFDocument,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { FinanceFileError } from "./errors";
import type { DetectedFileType } from "./file-type";

// A4 em pontos (1/72 de polegada) e margem de 28 pt para a imagem não colar
// na borda do papel.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 28;
const MAX_PAGES_PER_FILE = 300;
const MAX_PNG_PIXELS = 60_000_000;

export type MergePart = { bytes: Uint8Array; type: DetectedFileType };

/**
 * Orientação EXIF de um JPEG (1 a 8), 1 quando não existe. Fotos tiradas em
 * pé no celular vêm "deitadas" com orientação 6 ou 8; sem isso a página sairia
 * de lado no PDF.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const at = (index: number) => bytes[index] ?? 0;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (at(offset) !== 0xff) return 1;
    const marker = at(offset + 1);
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = (at(offset + 2) << 8) | at(offset + 3);
    if (marker === 0xe1 && length >= 16) {
      const start = offset + 4;
      const isExif =
        at(start) === 0x45 &&
        at(start + 1) === 0x78 &&
        at(start + 2) === 0x69 &&
        at(start + 3) === 0x66;
      if (!isExif) return 1;
      const tiff = start + 6;
      const little = at(tiff) === 0x49;
      const u16 = (position: number) =>
        little
          ? at(position) | (at(position + 1) << 8)
          : (at(position) << 8) | at(position + 1);
      const u32 = (position: number) =>
        little
          ? (at(position) |
              (at(position + 1) << 8) |
              (at(position + 2) << 16) |
              (at(position + 3) << 24)) >>>
            0
          : ((at(position) << 24) |
              (at(position + 1) << 16) |
              (at(position + 2) << 8) |
              at(position + 3)) >>>
            0;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const entries = u16(ifd);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

function drawImagePage(
  doc: PDFDocument,
  image: PDFImage,
  orientation: number,
): PDFPage {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const turned = orientation === 6 || orientation === 8;
  const shownWidth = turned ? image.height : image.width;
  const shownHeight = turned ? image.width : image.height;
  const scale = Math.min(
    (A4_WIDTH - 2 * MARGIN) / shownWidth,
    (A4_HEIGHT - 2 * MARGIN) / shownHeight,
  );
  const boxWidth = shownWidth * scale;
  const boxHeight = shownHeight * scale;
  const left = (A4_WIDTH - boxWidth) / 2;
  const bottom = (A4_HEIGHT - boxHeight) / 2;
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;

  if (orientation === 6) {
    page.drawImage(image, {
      x: left,
      y: bottom + boxHeight,
      width: drawnWidth,
      height: drawnHeight,
      rotate: degrees(-90),
    });
  } else if (orientation === 8) {
    page.drawImage(image, {
      x: left + boxWidth,
      y: bottom,
      width: drawnWidth,
      height: drawnHeight,
      rotate: degrees(90),
    });
  } else if (orientation === 3) {
    page.drawImage(image, {
      x: left + boxWidth,
      y: bottom + boxHeight,
      width: drawnWidth,
      height: drawnHeight,
      rotate: degrees(180),
    });
  } else {
    page.drawImage(image, {
      x: left,
      y: bottom,
      width: drawnWidth,
      height: drawnHeight,
    });
  }
  return page;
}

async function appendPdf(target: PDFDocument, bytes: Uint8Array) {
  let source: PDFDocument;
  let count: number;
  try {
    source = await PDFDocument.load(bytes);
    // Arquivo sem catálogo de páginas carrega "bem" e só falha aqui.
    count = source.getPageCount();
  } catch (error) {
    // pdf-lib avisa com uma mensagem ("... is encrypted"); o tipo do erro varia.
    if (
      error instanceof EncryptedPDFError ||
      (error instanceof Error && /encrypted/i.test(error.message))
    ) {
      throw new FinanceFileError(
        422,
        "PDF_ENCRYPTED",
        "The PDF is protected by a password. Remove the protection and send it again.",
      );
    }
    throw new FinanceFileError(
      422,
      "PDF_CORRUPT",
      "The PDF is damaged or could not be read. Save it again as a PDF and send it again.",
    );
  }
  if (count === 0) {
    throw new FinanceFileError(422, "PDF_CORRUPT", "The PDF has no pages.");
  }
  if (count > MAX_PAGES_PER_FILE) {
    throw new FinanceFileError(
      413,
      "FILE_TOO_LARGE",
      `The PDF has more than ${MAX_PAGES_PER_FILE} pages.`,
    );
  }
  try {
    const pages = await target.copyPages(source, source.getPageIndices());
    for (const page of pages) target.addPage(page);
  } catch {
    throw new FinanceFileError(
      422,
      "PDF_CORRUPT",
      "The PDF is damaged or could not be read. Save it again as a PDF and send it again.",
    );
  }
}

async function appendImage(
  target: PDFDocument,
  part: MergePart & { type: "jpeg" | "png" },
) {
  try {
    if (part.type === "png") {
      const view = new DataView(
        part.bytes.buffer,
        part.bytes.byteOffset,
        part.bytes.byteLength,
      );
      if (part.bytes.byteLength >= 24) {
        const pixels = view.getUint32(16) * view.getUint32(20);
        if (pixels > MAX_PNG_PIXELS) {
          throw new FinanceFileError(
            413,
            "FILE_TOO_LARGE",
            "The image has too many pixels. Reduce its size and send it again.",
          );
        }
      }
      drawImagePage(target, await target.embedPng(part.bytes), 1);
      return;
    }
    drawImagePage(
      target,
      await target.embedJpg(part.bytes),
      readJpegOrientation(part.bytes),
    );
  } catch (error) {
    if (error instanceof FinanceFileError) throw error;
    throw new FinanceFileError(
      422,
      "IMAGE_CORRUPT",
      "The image is damaged or could not be read.",
    );
  }
}

/**
 * Junta os arquivos na ORDEM recebida (comprovante primeiro, nota fiscal
 * depois) num PDF único. Cada JPG/PNG vira uma página A4 sem distorcer.
 */
export async function mergeToSinglePdf(
  parts: MergePart[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer("Panda Project");
  doc.setCreator("Panda Project");
  for (const part of parts) {
    if (part.type === "pdf") {
      await appendPdf(doc, part.bytes);
    } else if (part.type === "jpeg" || part.type === "png") {
      await appendImage(doc, { ...part, type: part.type });
    } else {
      throw new FinanceFileError(
        415,
        "FILE_NEEDS_CONVERSION",
        "This image format cannot be merged. Convert it to PDF, JPG or PNG and send it again.",
      );
    }
  }
  return doc.save();
}
