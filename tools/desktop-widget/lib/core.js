// Funções puras do widget (sem DOM e sem Electron), para poder testar em Node.
// Datas de calendário são sempre "AAAA-MM-DD" no fuso de Brasília.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PandaCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TZ = "America/Sao_Paulo";
  const MONTHS = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;

  /** Extrai endereço do sistema e ID do workspace de um link colado. */
  function parseSetupUrl(input) {
    let url;
    try {
      url = new URL(String(input || "").trim());
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const match = /\/workspace\/([^/?#]+)/.exec(url.pathname);
    if (!match) return null;
    return { origin: url.origin, workspaceId: decodeURIComponent(match[1]) };
  }

  function formatMoney(cents) {
    return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDateBR(day) {
    const [y, m, d] = day.split("-");
    return `${d}/${m}/${y}`;
  }

  function dayNumber(day) {
    const [y, m, d] = day.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }

  /** Dias de `to` menos dias de `from` (positivo = `to` está no futuro). */
  function daysBetween(from, to) {
    return dayNumber(to) - dayNumber(from);
  }

  function relativeDay(today, day) {
    const diff = daysBetween(today, day);
    if (diff === 0) return "hoje";
    if (diff === 1) return "amanhã";
    if (diff === -1) return "ontem";
    if (diff > 1) return `em ${diff} dias`;
    return `há ${-diff} dias`;
  }

  /** "AAAA-MM-DDTHH:MM:SSZ" -> "AAAA-MM-DD" no horário de Brasília. */
  function toSaoPauloDay(dateTime) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(dateTime));
    return parts;
  }

  function timeAgo(dateTime, now) {
    const diff = daysBetween(toSaoPauloDay(dateTime), toSaoPauloDay(now));
    if (diff <= 0) return "hoje";
    if (diff === 1) return "ontem";
    return `há ${diff} dias`;
  }

  /** Grade de 6 semanas (domingo a sábado) para o mês `month` (1-12). */
  function buildMonthGrid(year, month, today) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const cell = new Date(start);
        cell.setUTCDate(start.getUTCDate() + w * 7 + d);
        const day = iso(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
        week.push({
          iso: day,
          day: cell.getUTCDate(),
          inMonth: cell.getUTCMonth() === month - 1,
          isToday: day === today,
        });
      }
      weeks.push(week);
    }
    return weeks;
  }

  function shiftMonth(year, month, delta) {
    const index = year * 12 + (month - 1) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  }

  /** Indexa parcelas e tarefas do calendário por dia. */
  function indexByDay(calendar) {
    const map = new Map();
    const slot = (day) => {
      if (!map.has(day)) map.set(day, { installments: [], tasks: [] });
      return map.get(day);
    };
    for (const item of calendar.installments || []) slot(item.dueDate).installments.push(item);
    for (const task of calendar.tasks || []) {
      const source = task.dueDate || task.startDate;
      if (source) slot(toSaoPauloDay(source)).tasks.push(task);
    }
    return map;
  }

  /** Eventos de hoje em diante, em ordem de data (parcelas antes das tarefas). */
  function buildAgenda(calendar, today, limit = 60) {
    const index = indexByDay(calendar);
    const days = [...index.keys()].filter((d) => d >= today).sort();
    const out = [];
    for (const day of days) {
      const slot = index.get(day);
      const items = [
        ...slot.installments.filter((i) => i.status !== "paid").map((i) => ({ kind: "payment", item: i })),
        ...slot.tasks.map((t) => ({ kind: "task", item: t })),
      ];
      if (items.length) out.push({ day, items });
      if (out.length >= limit) break;
    }
    return out;
  }

  const STATUS_LABELS = {
    "to-do": "A fazer",
    "in-progress": "Em andamento",
    "in-review": "Em revisão",
    done: "Concluído",
    planned: "Planejada",
  };
  const statusLabel = (status) => STATUS_LABELS[status] || status;

  return {
    MONTHS, WEEKDAYS, parseSetupUrl, formatMoney, formatDateBR, daysBetween,
    relativeDay, toSaoPauloDay, timeAgo, buildMonthGrid, shiftMonth,
    indexByDay, buildAgenda, statusLabel,
  };
});
