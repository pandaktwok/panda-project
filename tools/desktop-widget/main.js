const path = require("node:path");
const fs = require("node:fs");
const {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, net, safeStorage, shell,
} = require("electron");

const REFRESH_MS = 5 * 60 * 1000;
let win = null;
let tray = null;
let timer = null;
let quitting = false;

const configFile = () => path.join(app.getPath("userData"), "config.json");

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    let apiKey = null;
    if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, "base64"));
    } else if (raw.apiKeyPlain) {
      apiKey = raw.apiKeyPlain;
    }
    return { ...raw, apiKey };
  } catch {
    return {};
  }
}

function writeConfig(config) {
  const { apiKey, apiKeyEnc, apiKeyPlain, ...rest } = config;
  const out = { ...rest };
  if (apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      out.apiKeyEnc = safeStorage.encryptString(apiKey).toString("base64");
    } else {
      out.apiKeyPlain = apiKey;
    }
  }
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(out, null, 2));
}

const publicConfig = (c) => ({
  origin: c.origin || "",
  apiUrl: c.apiUrl || "",
  workspaceId: c.workspaceId || "",
  hasKey: Boolean(c.apiKey),
  alwaysOnTop: c.alwaysOnTop !== false,
  autoStart: Boolean(c.autoStart),
});

function apiBase(c) {
  const base = (c.apiUrl || c.origin || "").replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

async function fetchSummary() {
  const c = readConfig();
  if (!c.origin || !c.workspaceId || !c.apiKey) {
    return { ok: false, code: "not-configured", message: "Widget ainda não configurado." };
  }
  const url = new URL(`${apiBase(c)}/workspace-calendar/widget-summary`);
  url.searchParams.set("workspaceId", c.workspaceId);
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await net.fetch(url.toString(), {
      headers: { "x-api-key": c.apiKey, accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status === 401) return { ok: false, code: "auth", message: "Chave de API recusada. Crie outra em Configurações > Conta > Desenvolvedor." };
    if (res.status === 403) return { ok: false, code: "forbidden", message: "Essa chave não tem acesso a este workspace." };
    if (res.status === 404) return { ok: false, code: "not-found", message: "O servidor não tem o resumo do widget. Atualize o Panda Project no servidor." };
    if (!res.ok) return { ok: false, code: "http", message: `O servidor respondeu com erro ${res.status}.` };
    return { ok: true, data: await res.json() };
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    return { ok: false, code: "network", message: timedOut ? "O servidor demorou demais para responder." : "Não consegui conectar ao servidor. Confira o endereço e a internet." };
  } finally {
    clearTimeout(abort);
  }
}

function pushRefresh() {
  fetchSummary().then((result) => {
    if (win && !win.isDestroyed()) win.webContents.send("summary:update", result);
  });
}

function applyWindowPrefs() {
  const c = readConfig();
  if (win) win.setAlwaysOnTop(c.alwaysOnTop !== false);
  app.setLoginItemSettings({ openAtLogin: Boolean(c.autoStart) });
}

function createWindow() {
  const c = readConfig();
  const bounds = c.bounds || {};
  win = new BrowserWindow({
    width: bounds.width || 390,
    height: bounds.height || 640,
    x: bounds.x,
    y: bounds.y,
    minWidth: 340,
    minHeight: 420,
    frame: false,
    backgroundColor: "#111418",
    title: "Panda Project",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.setAlwaysOnTop(c.alwaysOnTop !== false);

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    writeConfig({ ...readConfig(), bounds: win.getBounds() });
  };
  win.on("resized", saveBounds);
  win.on("moved", saveBounds);
  // Fechar esconde na bandeja; "Sair" fica no menu da bandeja.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  // Links nunca abrem dentro do widget.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Panda Project");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir widget", click: () => { win.show(); win.focus(); } },
    { label: "Atualizar agora", click: pushRefresh },
    { type: "separator" },
    { label: "Sair", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => { win.isVisible() ? win.hide() : (win.show(), win.focus()); });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    createWindow();
    createTray();
    applyWindowPrefs();
    timer = setInterval(pushRefresh, REFRESH_MS);
  });
  app.on("before-quit", () => { quitting = true; clearInterval(timer); });
}

ipcMain.handle("config:get", () => publicConfig(readConfig()));

ipcMain.handle("config:save", (_event, input) => {
  const current = readConfig();
  const next = { ...current };
  if (typeof input.origin === "string") next.origin = input.origin.trim().replace(/\/+$/, "");
  if (typeof input.apiUrl === "string") next.apiUrl = input.apiUrl.trim();
  if (typeof input.workspaceId === "string") next.workspaceId = input.workspaceId.trim();
  if (typeof input.apiKey === "string" && input.apiKey.trim()) next.apiKey = input.apiKey.trim();
  if (typeof input.alwaysOnTop === "boolean") next.alwaysOnTop = input.alwaysOnTop;
  if (typeof input.autoStart === "boolean") next.autoStart = input.autoStart;
  writeConfig(next);
  applyWindowPrefs();
  return publicConfig(next);
});

ipcMain.handle("config:reset", () => {
  const { bounds } = readConfig();
  writeConfig({ bounds });
  return publicConfig({});
});

ipcMain.handle("summary:fetch", () => fetchSummary());

ipcMain.handle("link:open", (_event, relativePath) => {
  const c = readConfig();
  if (!c.origin || typeof relativePath !== "string" || !relativePath.startsWith("/")) return false;
  shell.openExternal(`${c.origin}${relativePath}`);
  return true;
});

ipcMain.handle("window:minimize", () => win && win.hide());
