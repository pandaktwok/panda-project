// Reta final (funções puras). A tela (state.finalStretch) e o aviso mensal
// (scheduler/final-stretch-notices.ts) usam a MESMA regra, para nunca discordarem.

import { clockInSaoPaulo, daysInMonth, parseIsoDate } from "./dates";

/** Hora (Brasília) a partir da qual o aviso do dia pode sair. */
export const NOTICE_HOUR = 8;

/** Quantas parcelas finais são destacadas em vermelho. */
export const FINAL_STRETCH_SIZE = 3;

/**
 * Uma parcela é "da reta final" da linha se está entre as 3 últimas dela.
 * Linha com 3 parcelas ou menos: todas são da reta final.
 */
export function isFinalStretchInstallment(
  number: number,
  installmentsCount: number,
): boolean {
  return number > installmentsCount - FINAL_STRETCH_SIZE;
}

export type FinalStretch = {
  /** Reta final ativa hoje: chegou a data de referência e ainda há parcela em aberto. */
  active: boolean;
  /**
   * Data de referência do projeto: o menor vencimento dentro do 3º mês de
   * vencimento contando do fim (antepenúltimo mês do cronograma do projeto).
   * Com menos de 3 meses distintos, é o menor vencimento do projeto.
   */
  referenceDate: string | null;
  /** Maior vencimento do projeto. */
  lastDueDate: string | null;
  /** Os (até) 3 últimos meses de vencimento, "AAAA-MM", em ordem. */
  alertMonths: string[];
  /**
   * "AAAA-MM" do mês corrente enquanto ativo (chave para o aviso mensal não
   * repetir no mesmo mês); null se inativo.
   */
  currentMonth: string | null;
};

/**
 * Regra do projeto: o projeto "chega às três últimas parcelas" na data de
 * vencimento da antepenúltima parcela do seu cronograma, olhando os MESES de
 * vencimento distintos de todas as linhas (uma linha curta não dispara o
 * alerta sozinha no começo do projeto). O aviso vale em todo mês a partir daí
 * e só termina quando todas as parcelas estiverem pagas (mesmo passando do
 * último vencimento, se houver parcela atrasada).
 */
export function computeFinalStretch(
  installments: ReadonlyArray<{ dueDate: string; paid: boolean }>,
  asOf: string,
): FinalStretch {
  if (installments.length === 0) {
    return {
      active: false,
      referenceDate: null,
      lastDueDate: null,
      alertMonths: [],
      currentMonth: null,
    };
  }
  const months = [
    ...new Set(installments.map((item) => item.dueDate.slice(0, 7))),
  ].sort();
  const alertMonths = months.slice(-FINAL_STRETCH_SIZE);
  const firstAlertMonth = alertMonths[0] as string;
  const dates = installments.map((item) => item.dueDate).sort();
  const referenceDate = dates.find((date) => date.startsWith(firstAlertMonth));
  const lastDueDate = dates[dates.length - 1] as string;
  const hasOpen = installments.some((item) => !item.paid);
  const active =
    hasOpen && referenceDate !== undefined && asOf >= referenceDate;
  return {
    active,
    referenceDate: referenceDate ?? null,
    lastDueDate,
    alertMonths,
    currentMonth: active ? asOf.slice(0, 7) : null,
  };
}

/**
 * Aviso mensal: ok = está na hora de avisar neste mês (fuso de Brasília).
 *
 * Regra: enquanto a reta final está ativa, sai UM aviso por mês, no dia do mês
 * do vencimento de referência (preso ao último dia dos meses curtos), a partir
 * das 08:00. Se o job só rodar depois disso, ainda avisa naquele mês (o
 * controle por AAAA-MM garante que não duplica). Devolve o mês "AAAA-MM".
 */
export function finalStretchNoticeMonth(
  installments: ReadonlyArray<{ dueDate: string; paid: boolean }>,
  now: Date,
): string | null {
  const clock = clockInSaoPaulo(now);
  const stretch = computeFinalStretch(installments, clock.date);
  if (!stretch.active || !stretch.referenceDate || !stretch.currentMonth) {
    return null;
  }
  const reference = parseIsoDate(stretch.referenceDate);
  const today = parseIsoDate(clock.date);
  if (!reference || !today) return null;
  const noticeDay = Math.min(
    reference.day,
    daysInMonth(today.year, today.month),
  );
  const reached =
    today.day > noticeDay ||
    (today.day === noticeDay && clock.hour >= NOTICE_HOUR);
  return reached ? stretch.currentMonth : null;
}
