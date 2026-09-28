// Dinheiro sempre em centavos inteiros. Na tela: R$ pt-BR (Intl.NumberFormat).
// Datas ISO (AAAA-MM-DD) são tratadas como datas puras, sem fuso.

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const plain = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 656000 -> "R$ 6.560,00" (o espaço é o normal, para quebrar de forma previsível). */
export function formatCents(cents: number): string {
  return brl.format(cents / 100).replace(/ /g, " ");
}

/** 656000 -> "6.560,00" (sem símbolo, para campos de edição). */
export function formatCentsPlain(cents: number): string {
  return plain.format(cents / 100);
}

/**
 * Lê o que a pessoa digitou ("R$ 6.900,00", "6900", "6900,5", "6.900") e
 * devolve centavos inteiros, sem passar por números decimais. Devolve null se
 * não der para entender.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!cleaned || !/^[\d.,]+$/.test(cleaned)) return null;

  let integerPart: string;
  let fractionPart = "";

  const lastComma = cleaned.lastIndexOf(",");
  if (lastComma >= 0) {
    integerPart = cleaned.slice(0, lastComma).replace(/\./g, "");
    fractionPart = cleaned.slice(lastComma + 1);
    if (fractionPart.includes(".")) return null;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    integerPart = cleaned.replace(/\./g, "");
  } else if (cleaned.includes(".")) {
    const lastDot = cleaned.lastIndexOf(".");
    integerPart = cleaned.slice(0, lastDot).replace(/\./g, "");
    fractionPart = cleaned.slice(lastDot + 1);
  } else {
    integerPart = cleaned;
  }

  if (integerPart === "") integerPart = "0";
  if (!/^\d+$/.test(integerPart) || !/^\d{0,2}$/.test(fractionPart)) {
    return null;
  }

  const cents = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 1234 pontos-base (10000 = 100%) -> "12,3%" (uma casa, para baixo). */
export function formatBasisPoints(basisPoints: number): string {
  const tenths = Math.floor(basisPoints / 10);
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return `${whole},${decimal}%`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-09-05" -> "05/09/2026". */
export function formatIsoDate(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** "2026-09-05" -> "05/09". */
export function formatIsoDayMonth(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}`;
}

/** Diferença em dias inteiros entre duas datas puras (b - a). */
export function diffIsoDays(a: string, b: string): number {
  const pa = ISO_DATE.exec(a);
  const pb = ISO_DATE.exec(b);
  if (!pa || !pb) return 0;
  const da = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const db = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((db - da) / 86_400_000);
}
