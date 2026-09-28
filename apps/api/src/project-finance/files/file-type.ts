// Tipo pelo CONTEÚDO (bytes iniciais), nunca pela extensão nem pelo
// Content-Type que o navegador informou.

export type DetectedFileType = "pdf" | "jpeg" | "png" | "webp" | "heic";

export const FILE_TYPE_INFO: Record<
  DetectedFileType,
  { mime: string; extension: string }
> = {
  pdf: { mime: "application/pdf", extension: "pdf" },
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  png: { mime: "image/png", extension: "png" },
  webp: { mime: "image/webp", extension: "webp" },
  heic: { mime: "image/heic", extension: "heic" },
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (bytes.byteLength < 12) return null;
  // %PDF- pode vir depois de até 1 KB de lixo, mas nunca aceitamos isso: o
  // leitor de PDF já recusa e o arquivo seria enganoso.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  // RIFF????WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  // ????ftyp + marca de HEIC/HEIF
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (
      ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(
        brand,
      )
    ) {
      return "heic";
    }
  }
  return null;
}

/** Tipos que a junção em PDF único consegue transformar em página. */
export function isMergeable(type: DetectedFileType | null): boolean {
  return type === "pdf" || type === "jpeg" || type === "png";
}
