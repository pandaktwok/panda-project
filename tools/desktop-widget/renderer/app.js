(function () {
  const core = window.PandaCore;
  const $ = (id) => document.getElementById(id);
  const content = $("content");
  const banner = $("banner");
  const footer = $("footer");

  const state = {
    config: null,
    view: "resumo",
    calMode: "grade",
    cursor: null, // { year, month }
    selectedDay: null,
    summary: null,
    lastOk: null,
    showSettings: false,
  };

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  const projectPath = (id) => `/dashboard/workspace/${encodeURIComponent(state.config.workspaceId)}/project/${encodeURIComponent(id)}`;
  const taskPath = (projectId, taskId) => `${projectPath(projectId)}/task/${encodeURIComponent(taskId)}`;

  function weekdayLong(day) {
    const [y, m, d] = day.split("-").map(Number);
    const text = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ---------- Resumo ----------
  function paymentRow(item, today) {
    const late = item.status === "overdue";
    return `<div class="row" data-open="${esc(projectPath(item.projectId))}">
      <div><div class="title">${esc(item.supplier)}</div><div class="sub">${esc(item.projectName)}</div></div>
      <div class="right"><div class="${late ? "red" : ""}">${core.formatMoney(item.expectedCents)}</div>
      <div class="sub ${late ? "red" : ""}">${core.formatDateBR(item.dueDate)} · ${core.relativeDay(today, item.dueDate)}</div></div></div>`;
  }

  function renderResumo(s) {
    const shown = 5;
    const overdue = s.overdue.items.slice(0, shown);
    const moreOverdue = s.overdue.count - overdue.length;
    const next = s.nextInstallment;

    const nextCard = `<section class="card"><h2>Próximo pagamento</h2>${
      next ? paymentRow(next, s.today) : '<div class="empty">Nenhum pagamento agendado.</div>'
    }</section>`;

    const overdueCard = `<section class="card"><h2>Pagamentos atrasados
      <span class="badge ${s.overdue.count ? "red" : ""}">${s.overdue.count}</span></h2>${
      s.overdue.count
        ? `<div class="big red">${core.formatMoney(s.overdue.totalCents)}</div>${overdue.map((i) => paymentRow(i, s.today)).join("")}${
            moreOverdue > 0 ? `<div class="more">+ ${moreOverdue} atrasado(s) no sistema</div>` : ""
          }`
        : '<div class="empty green">Tudo em dia. 🎉</div>'
    }</section>`;

    const projectsCard = `<section class="card"><h2>Projetos dos últimos 3 meses
      <span class="badge">${s.recentProjects.length}</span></h2>${
      s.recentProjects.length
        ? s.recentProjects.map((p) => `<div class="row" data-open="${esc(projectPath(p.id))}">
            <div><div class="title">${esc(p.name)}</div>${p.projectLabel ? `<div class="sub">${esc(p.projectLabel.name)}</div>` : ""}</div>
            <div class="right sub">${core.formatDateBR(core.toSaoPauloDay(p.createdAt))}</div></div>`).join("")
        : '<div class="empty">Nenhum projeto novo neste período.</div>'
    }</section>`;

    const tasksCard = `<section class="card"><h2>Tarefas novas · 7 dias
      <span class="badge">${s.newTasks.length}</span></h2>${
      s.newTasks.length
        ? s.newTasks.map((t) => `<div class="row" data-open="${esc(taskPath(t.projectId, t.id))}">
            <div><div class="title">${esc(t.title)}</div><div class="sub">${esc(t.projectName)} · ${esc(core.statusLabel(t.status))}</div></div>
            <div class="right sub">${core.timeAgo(t.createdAt, new Date().toISOString())}</div></div>`).join("")
        : '<div class="empty">Nenhuma tarefa nova.</div>'
    }</section>`;

    content.innerHTML = nextCard + overdueCard + projectsCard + tasksCard;
  }

  // ---------- Calendário ----------
  function calendarItems(day, index, today) {
    const slot = index.get(day) || { installments: [], tasks: [] };
    const pays = slot.installments.map((i) => `<div class="row" data-open="${esc(projectPath(i.projectId))}">
        <div><div class="title">💰 ${esc(i.supplier)}</div><div class="sub">${esc(i.projectName)}</div></div>
        <div class="right"><div>${core.formatMoney(i.expectedCents)}</div>
        <div class="sub ${i.status === "overdue" ? "red" : i.status === "paid" ? "green" : "amber"}">${
          i.status === "paid" ? "Pago" : i.status === "overdue" ? "Atrasado" : "A pagar"}</div></div></div>`);
    const tasks = slot.tasks.map((t) => `<div class="row" data-open="${esc(taskPath(t.projectId, t.id))}">
        <div><div class="title">✅ ${esc(t.title)}</div><div class="sub">${esc(t.projectName)}</div></div>
        <div class="right sub">${esc(core.statusLabel(t.status))}</div></div>`);
    return pays.concat(tasks);
  }

  function renderCalendario(s) {
    if (!state.cursor) {
      const [y, m] = s.today.split("-").map(Number);
      state.cursor = { year: y, month: m };
    }
    if (!state.selectedDay) state.selectedDay = s.today;
    const index = core.indexByDay(s.calendar);
    const head = `<div class="cal-head">
      <button class="icon-btn" data-nav="-1" aria-label="Mês anterior">‹</button>
      <div class="month">${core.MONTHS[state.cursor.month - 1]} ${state.cursor.year}</div>
      <button class="icon-btn" data-nav="1" aria-label="Próximo mês">›</button>
      <div class="seg"><button data-mode="grade" class="${state.calMode === "grade" ? "on" : ""}">Grade</button><button data-mode="lista" class="${state.calMode === "lista" ? "on" : ""}">Lista</button></div>
    </div>`;

    if (state.calMode === "lista") {
      const agenda = core.buildAgenda(s.calendar, s.today);
      const body = agenda.length
        ? agenda.map(({ day, items }) => `<div class="agenda-day">${esc(weekdayLong(day))} · ${core.relativeDay(s.today, day)}</div>${
            calendarItems(day, index, s.today).join("")}`).join("")
        : '<div class="empty">Nada agendado pelos próximos meses.</div>';
      content.innerHTML = head + body;
      return;
    }

    const weeks = core.buildMonthGrid(state.cursor.year, state.cursor.month, s.today);
    const dow = core.WEEKDAYS.map((d) => `<div class="dow">${d}</div>`).join("");
    const cells = weeks.flat().map((cell) => {
      const slot = index.get(cell.iso);
      const dots = [];
      if (slot) {
        if (slot.installments.some((i) => i.status === "overdue")) dots.push("late");
        if (slot.installments.some((i) => i.status === "pending")) dots.push("pay");
        if (slot.installments.length && slot.installments.every((i) => i.status === "paid")) dots.push("paid");
        if (slot.tasks.length) dots.push("task");
      }
      return `<button class="cell ${cell.inMonth ? "" : "out"} ${cell.isToday ? "today" : ""} ${cell.iso === state.selectedDay ? "sel" : ""}" data-day="${cell.iso}">
        ${cell.day}<span class="dots">${dots.map((d) => `<i class="dot ${d}"></i>`).join("")}</span></button>`;
    }).join("");
    const legend = `<div class="legend"><span class="amber">A pagar</span><span class="red">Atrasado</span><span class="green">Pago</span><span class="blue">Tarefa</span></div>`;
    const items = calendarItems(state.selectedDay, index, s.today);
    content.innerHTML = `${head}<div class="grid">${dow}${cells}</div>${legend}
      <div class="daytitle">${esc(weekdayLong(state.selectedDay))}</div>${
      items.length ? items.join("") : '<div class="empty">Nada neste dia.</div>'}`;
  }

  // ---------- Configuração ----------
  function renderSetup(message) {
    const c = state.config;
    const configured = c.origin && c.workspaceId && c.hasKey;
    content.innerHTML = `<div class="setup">
      <h3>${configured ? "Configurações" : "Conectar ao Panda Project"}</h3>
      <label for="f-link">Cole o endereço de qualquer página do seu Panda Project</label>
      <input id="f-link" type="text" placeholder="https://.../dashboard/workspace/…/project/…" value="${configured ? esc(`${c.origin}/dashboard/workspace/${c.workspaceId}`) : ""}" />
      <div class="hint">Copie da barra do navegador enquanto estiver dentro do seu workspace.</div>
      <label for="f-key">Chave de API</label>
      <input id="f-key" type="password" placeholder="${configured ? "•••••••• (deixe vazio para manter)" : "Cole a chave aqui"}" />
      <div class="hint">Crie em Configurações › Conta › Desenvolvedor. Ela fica guardada só neste computador.</div>
      <label class="check"><input id="f-top" type="checkbox" ${c.alwaysOnTop ? "checked" : ""}/> Manter sempre visível (acima das outras janelas)</label>
      <label class="check"><input id="f-auto" type="checkbox" ${c.autoStart ? "checked" : ""}/> Abrir junto com o Windows</label>
      <div id="setup-err" class="err">${esc(message || "")}</div>
      <button class="btn" id="f-save">Salvar e conectar</button>
      ${configured ? '<button class="btn ghost" id="f-cancel">Voltar</button><button class="btn ghost" id="f-reset">Desconectar</button>' : ""}
    </div>`;
  }

  async function saveSetup() {
    const err = $("setup-err");
    const parsed = core.parseSetupUrl($("f-link").value);
    if (!parsed) { err.textContent = "Endereço inválido: preciso de um link que contenha /workspace/…"; return; }
    const key = $("f-key").value.trim();
    if (!key && !state.config.hasKey) { err.textContent = "Cole a chave de API."; return; }
    state.config = await window.panda.saveConfig({
      origin: parsed.origin, workspaceId: parsed.workspaceId, apiKey: key,
      alwaysOnTop: $("f-top").checked, autoStart: $("f-auto").checked,
    });
    state.showSettings = false;
    await refresh();
  }

  // ---------- Fluxo ----------
  function paint() {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    $("tabs").hidden = state.showSettings || !state.summary;
    const configured = state.config && state.config.origin && state.config.workspaceId && state.config.hasKey;
    if (!configured || state.showSettings) { renderSetup(); return; }
    if (!state.summary) { content.innerHTML = '<div class="empty">Carregando…</div>'; return; }
    (state.view === "resumo" ? renderResumo : renderCalendario)(state.summary);
    footer.textContent = state.lastOk ? `Atualizado às ${state.lastOk.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  }

  function applyResult(result) {
    $("btn-refresh").classList.remove("spin");
    if (result.ok) {
      state.summary = result.data;
      state.lastOk = new Date();
      banner.hidden = true;
    } else if (result.code !== "not-configured") {
      banner.hidden = false;
      banner.textContent = state.summary ? `${result.message} Mostrando os últimos dados.` : result.message;
    }
    paint();
  }

  async function refresh() {
    $("btn-refresh").classList.add("spin");
    applyResult(await window.panda.fetchSummary());
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-view],[data-nav],[data-mode],[data-day],[data-open],#f-save,#f-cancel,#f-reset");
    if (!target) return;
    if (target.dataset.view) { state.view = target.dataset.view; paint(); }
    else if (target.dataset.nav) {
      state.cursor = core.shiftMonth(state.cursor.year, state.cursor.month, Number(target.dataset.nav)); paint();
    } else if (target.dataset.mode) { state.calMode = target.dataset.mode; paint(); }
    else if (target.dataset.day) { state.selectedDay = target.dataset.day; paint(); }
    else if (target.dataset.open) { window.panda.openLink(target.dataset.open); }
    else if (target.id === "f-save") { await saveSetup(); }
    else if (target.id === "f-cancel") { state.showSettings = false; paint(); }
    else if (target.id === "f-reset") {
      state.config = await window.panda.resetConfig(); state.summary = null; state.showSettings = false; banner.hidden = true; paint();
    }
  });

  $("btn-refresh").addEventListener("click", refresh);
  $("btn-settings").addEventListener("click", () => { state.showSettings = !state.showSettings; paint(); });
  $("btn-hide").addEventListener("click", () => window.panda.hide());

  (async function init() {
    state.config = await window.panda.getConfig();
    window.panda.onSummary(applyResult);
    paint();
    if (state.config.origin && state.config.hasKey) await refresh();
  })();
})();
