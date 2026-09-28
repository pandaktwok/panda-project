// "Reta final" do Kanban de projetos: se a data final do cronograma
// financeiro (última parcela de todas as linhas) está a 3 meses ou menos de
// hoje. Datas sempre em string "AAAA-MM-DD" (sem Date na aritmética de mês,
// para não deslocar por fuso -- mesma convenção do financeiro).

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Hoje, "AAAA-MM-DD", no fuso local (não usa toISOString: é UTC e pode voltar um dia). */
export function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** iso + months, com o dia "grudado" no último dia do mês de destino quando ele não existe. */
export function addIsoMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
  return `${targetYear}-${pad2(targetMonth)}-${pad2(Math.min(day, daysInTargetMonth))}`;
}

/**
 * true quando o cronograma termina dentro dos próximos 3 meses (e ainda não
 * passou). `today` é injetável para teste; padrão é a data de hoje.
 */
export function isFinanceScheduleNearEnd(
  financeEndDate: string | null,
  today: string = todayIsoDate(),
): boolean {
  if (!financeEndDate) return false;
  if (financeEndDate < today) return false;
  return financeEndDate <= addIsoMonths(today, 3);
}
