// Datas de calendário do Financeiro: sempre "AAAA-MM-DD", sem fuso e sem Date
// na aritmética de meses (evita deslocamentos por horário de verão/UTC).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const FINANCE_TIME_ZONE = "America/Sao_Paulo";

export type CalendarDate = { year: number; month: number; day: number };

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseIsoDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function formatIsoDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Soma meses mantendo o dia de vencimento ORIGINAL da primeira parcela e
 * prendendo-o ao último dia dos meses curtos: 31/01 -> 28/02 (29 em bissexto)
 * -> 31/03. Como sempre parte da data inicial, o dia nunca "escorrega".
 */
export function addMonthsClamped(firstDate: string, months: number): string {
  const parsed = parseIsoDate(firstDate);
  if (!parsed) throw new Error(`Invalid ISO date: ${firstDate}`);
  if (!Number.isInteger(months) || months < 0) {
    throw new Error(`Invalid month offset: ${months}`);
  }
  const index = parsed.year * 12 + (parsed.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return formatIsoDate({ year, month, day });
}

/**
 * Quantidade de parcelas de uma linha automática (Atualização 3): diferença
 * de meses entre a 1ª e a última parcela, contando os dois meses (inclusive).
 * Ex.: janeiro a março = 3. `finalDate` anterior a `firstDate` é inválido.
 */
export function monthsBetweenInclusive(
  firstDate: string,
  finalDate: string,
): number {
  const first = parseIsoDate(firstDate);
  const final = parseIsoDate(finalDate);
  if (!first) throw new Error(`Invalid ISO date: ${firstDate}`);
  if (!final) throw new Error(`Invalid ISO date: ${finalDate}`);
  const months =
    final.year * 12 +
    (final.month - 1) -
    (first.year * 12 + (first.month - 1)) +
    1;
  if (months < 1) {
    throw new Error("finalDate must not be before firstDate's month");
  }
  return months;
}

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FINANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Data (AAAA-MM-DD) e hora cheia (0-23) no fuso de Brasília. */
export function clockInSaoPaulo(now: Date = new Date()): {
  date: string;
  hour: number;
} {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: FINANCE_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return { date: todayInSaoPaulo(now), hour: Number(hour) };
}

/**
 * "Hoje" do Financeiro. A variável FINANCE_TODAY=AAAA-MM-DD permite testar e
 * simular datas sem mexer no relógio; valor inválido é ignorado.
 */
export function getFinanceToday(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): string {
  const override = env.FINANCE_TODAY?.trim();
  if (override && isValidIsoDate(override)) return override;
  return todayInSaoPaulo(now);
}
