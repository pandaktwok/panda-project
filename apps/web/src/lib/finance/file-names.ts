// Nomes que a tela MOSTRA antes de salvar o pagamento. Quem decide o nome real
// (e o sufixo " (2)" quando repete) é a API; aqui é só a prévia.

const FORBIDDEN = /[\\/:*?"<>|]/g;

function clean(value: string): string {
  const cleaned = Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.slice(0, 80).trim();
}

/** "Parcela 8 - 09-2026": mês e ano do VENCIMENTO, lidos do texto (sem fuso). */
export function parcelFolderLabel(
  number: number,
  dueDate: string | null,
): string {
  const match = dueDate ? /^(\d{4})-(\d{2})-\d{2}$/.exec(dueDate) : null;
  return match
    ? `Parcela ${number} - ${match[2]}-${match[1]}`
    : `Parcela ${number}`;
}

export function paymentPdfName(supplier: string, number: number): string {
  return `${clean(supplier) || "Sem nome"} - Parcela ${number}.pdf`;
}

export function financeFolderPath(
  projectName: string,
  number: number,
  dueDate: string | null,
): string {
  return `${clean(projectName) || "Projeto"} / Financeiro / ${parcelFolderLabel(number, dueDate)} /`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
