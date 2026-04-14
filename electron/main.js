import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, session } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const iconPath = path.join(__dirname, "..", "assets", "icon.png");

const DEFAULT_CONFIG = {
  meetingTitle: "",
  exportDir: "",
  stt: {
    baseUrl: "ws://f.axe3.cn:22395",
    apiKey: "",
    model: "funasr-2pass",
    language: "zh",
  },
  llm: {
    baseUrl: "",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  chunkSeconds: 20,
  summaryIntervalMinutes: 2.5,
  systemPrompt: "你是一个严谨的会议助手，需要输出清晰、简洁、结构化的中文内容。",
  summaryPrompt:
    "请基于新增会议内容输出阶段性总结，至少包含：当前议题、关键结论、未决事项、后续行动和责任人。",
  minutesPrompt:
    "请将完整会议内容整理成正式会议纪要，至少包含：会议主题、核心结论、决策事项、待办事项、风险与阻塞、下一步安排。",
};

let mainWindow = null;
let minutesWindow = null;
let tray = null;
let pendingMinutesPayload = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getStorePath() {
  return path.join(app.getPath("userData"), "meeting-float-desktop-store.json");
}

function readStore() {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return {
      config: clone(DEFAULT_CONFIG),
      sessions: [],
    };
  }

  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      config: {
        ...clone(DEFAULT_CONFIG),
        ...(parsed.config || {}),
        stt: { ...clone(DEFAULT_CONFIG.stt), ...(parsed.config?.stt || {}) },
        llm: { ...clone(DEFAULT_CONFIG.llm), ...(parsed.config?.llm || {}) },
      },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return {
      config: clone(DEFAULT_CONFIG),
      sessions: [],
    };
  }
}

function writeStore(nextStore) {
  fs.mkdirSync(path.dirname(getStorePath()), { recursive: true });
  fs.writeFileSync(getStorePath(), JSON.stringify(nextStore, null, 2), "utf8");
}

function listSessions() {
  return readStore().sessions;
}

function getBootstrapData() {
  const store = readStore();
  return {
    config: store.config,
    sessions: store.sessions,
    platform: process.platform,
    versions: process.versions,
    autotest:
      process.argv.includes("--autotest") || process.env.MEETING_FLOAT_AUTOTEST === "1",
  };
}

function saveConfig(config) {
  const store = readStore();
  store.config = clone(config);
  writeStore(store);
  return store.config;
}

function saveSession(sessionValue) {
  const store = readStore();
  const summary = {
    id: sessionValue.id,
    title: sessionValue.title,
    startedAt: sessionValue.startedAt,
    endedAt: sessionValue.endedAt,
    status: sessionValue.status,
    transcriptCount: sessionValue.transcript.length,
    summaryCount: sessionValue.summaries.length,
    hasMinutes: Boolean(sessionValue.minutes),
    data: clone(sessionValue),
  };

  const index = store.sessions.findIndex((item) => item.id === sessionValue.id);
  if (index >= 0) {
    store.sessions[index] = summary;
  } else {
    store.sessions.unshift(summary);
  }

  store.sessions = store.sessions
    .sort((left, right) => new Date(right.startedAt || 0) - new Date(left.startedAt || 0))
    .slice(0, 50);

  writeStore(store);
  return summary;
}

function getSession(sessionId) {
  const found = readStore().sessions.find((item) => item.id === sessionId);
  return found ? clone(found) : null;
}

function deleteSession(sessionId) {
  const store = readStore();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((item) => item.id !== sessionId);
  if (store.sessions.length === before) {
    return { ok: false };
  }
  writeStore(store);
  return { ok: true };
}

function createTrayImage() {
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
  }

  return nativeImage.createFromDataURL(
    "data:image/svg+xml;base64," +
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
          <circle cx="16" cy="16" r="13" fill="#0f2234" stroke="#62b1ff" stroke-width="2"/>
          <circle cx="16" cy="16" r="6" fill="#1fb689"/>
        </svg>`
      ).toString("base64")
  );
}

function getRendererUrl(page) {
  if (isDev) {
    return `${process.env.VITE_DEV_SERVER_URL}/${page}`;
  }
  return path.join(__dirname, "..", "dist", page);
}

async function loadWindow(window, page) {
  if (isDev) {
    await window.loadURL(getRendererUrl(page));
  } else {
    await window.loadFile(getRendererUrl(page));
  }
}

function emitMainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("desktop:window-state", {
    isMaximized: mainWindow.isMaximized(),
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 840,
    minHeight: 700,
    show: false,
    frame: false,
    title: "Meeting Float",
    icon: iconPath,
    backgroundColor: "#08131d",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    emitMainWindowState();
  });

  mainWindow.on("maximize", emitMainWindowState);
  mainWindow.on("unmaximize", emitMainWindowState);
  mainWindow.on("restore", emitMainWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadWindow(mainWindow, "index.html");
}

function createMinutesWindow(payload) {
  pendingMinutesPayload = payload;

  if (minutesWindow && !minutesWindow.isDestroyed()) {
    minutesWindow.focus();
    minutesWindow.webContents.send("minutes:payload", payload);
    return;
  }

  minutesWindow = new BrowserWindow({
    width: 760,
    height: 840,
    minWidth: 620,
    minHeight: 640,
    show: false,
    title: `${payload.title || "Meeting Minutes"} - Meeting Float`,
    icon: iconPath,
    backgroundColor: "#08131d",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  minutesWindow.once("ready-to-show", () => {
    minutesWindow.show();
    minutesWindow.webContents.send("minutes:payload", payload);
  });

  minutesWindow.on("closed", () => {
    minutesWindow = null;
  });

  loadWindow(minutesWindow, "minutes.html");
}

function restoreMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function setupTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip("Meeting Float");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Window", click: restoreMainWindow },
      { label: "Quit", click: () => app.quit() },
    ])
  );
  tray.on("click", restoreMainWindow);
}

function registerIpc() {
  ipcMain.handle("desktop:get-bootstrap", () => getBootstrapData());
  ipcMain.handle("desktop:save-config", (_, config) => saveConfig(config));
  ipcMain.handle("desktop:list-sessions", () => listSessions());
  ipcMain.handle("desktop:get-session", (_, sessionId) => getSession(sessionId));
  ipcMain.handle("desktop:save-session", (_, sessionValue) => saveSession(sessionValue));
  ipcMain.handle("desktop:delete-session", (_, sessionId) => deleteSession(sessionId));
  ipcMain.handle("desktop:get-window-state", () => ({
    isMaximized: Boolean(mainWindow?.isMaximized()),
  }));
  ipcMain.handle("desktop:minimize-window", () => {
    mainWindow?.minimize();
    return { ok: true };
  });
  ipcMain.handle("desktop:toggle-maximize", () => {
    if (!mainWindow) {
      return { ok: false, isMaximized: false };
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }

    const state = { ok: true, isMaximized: mainWindow.isMaximized() };
    emitMainWindowState();
    return state;
  });
  ipcMain.handle("desktop:close-window", () => {
    mainWindow?.close();
    return { ok: true };
  });
  ipcMain.handle("desktop:minimize-to-tray", () => {
    mainWindow?.hide();
    return { ok: true };
  });
  ipcMain.handle("desktop:close-app", () => {
    app.quit();
    return { ok: true };
  });
  ipcMain.handle("desktop:open-minutes-window", (_, payload) => {
    createMinutesWindow(payload);
    return { ok: true };
  });
  ipcMain.handle("desktop:get-minutes-payload", () => pendingMinutesPayload);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    callback(permission === "media");
  });

  registerIpc();
  createMainWindow();
  setupTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      restoreMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
