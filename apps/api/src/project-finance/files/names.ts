// Nomes de arquivo e de pasta do Financeiro. As pastas são virtuais.

const FORBIDDEN = /[\\/:*?"<>|]/g;

function stripControlChars(value: string) {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/** Tira / \ : * ? " < > | e controles, junta espaços e limita o tamanho. */
export function sanitizeNamePart(value: string, maxLength = 80): string {
  const cleaned = stripControlChars(value.normalize("NFC"))
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Nomes só de pontos ("..") não podem virar arquivo.
    .replace(/^\.+/, "")
    .trim();
  const limited = Array.from(cleaned).slice(0, maxLength).join("").trim();
  return limited || "Sem nome";
}

/** "Mirella Sombrio - Parcela 8" (sem a extensão). */
export function paymentBaseName(supplier: string, installmentNumber: number) {
  return `${sanitizeNamePart(supplier)} - Parcela ${installmentNumber}`;
}

/**
 * "Parcela 8 - 09-2026": número da parcela + mês e ano do VENCIMENTO (data
 * pura AAAA-MM-DD, lida como texto para nenhum fuso poder mudar o mês), mesmo
 * que o pagamento atrase.
 */
export function folderLabelFor(installmentNumber: number, dueDate: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dueDate);
  if (!match) throw new Error(`Invalid due date: ${dueDate}`);
  return `Parcela ${installmentNumber} - ${match[2]}-${match[1]}`;
}

/**
 * Acrescenta " (2)", " (3)"... se já existe arquivo com o mesmo nome na mesma
 * pasta. A comparação ignora maiúsculas/minúsculas, como o Windows faz.
 */
export function uniqueFileName(
  baseName: string,
  extension: string,
  taken: Iterable<string>,
): string {
  const used = new Set(Array.from(taken, (name) => name.toLowerCase()));
  let candidate = `${baseName}.${extension}`;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${baseName} (${counter}).${extension}`;
    counter += 1;
  }
  return candidate;
}

/** Nome de arquivo de um anexo do projeto, mantendo a extensão real. */
export function attachmentName(original: string, extension: string) {
  const withoutExtension = original.replace(/\.[^./\\]{1,10}$/, "");
  return `${sanitizeNamePart(withoutExtension, 120)}.${extension}`;
}
