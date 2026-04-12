import { AppStore, buildDefaultSession } from "./modules/store.js";
import { AiClient } from "./modules/api.js";
import { MeetingRecorder } from "./modules/recorder.js";
import * as env from "@env";
import * as sys from "@sys";

const store = new AppStore();
const api = new AiClient();
const recorder = new MeetingRecorder();

function debugLog(message) {
  globalThis.__mfDebugLog?.(message);
}

const state = {
  config: store.getConfig(),
  session: null,
  isRecording: false,
  isMockMode: false,
  mockPaused: false,
  mockChunkHandle: null,
  mediaSupport: {
    mediaDevices: false,
    getUserMedia: false,
    mediaRecorder: false,
  },
  startedAtMs: 0,
  summaryTranscriptIndex: 0,
  queue: Promise.resolve(),
  timerHandle: null,
  summaryHandle: null,
  alwaysOnTop: false,
  activeView: "overview",
  sessions: store.listSessions(),
  settingsSavedAtLabel: "",
  settingsProbeState: {
    tone: "",
    text: "还没有做连接测试。",
  },
  modelCatalog: {
    stt: [],
    llm: [],
  },
  historyFilter: {
    query: "",
    status: "all",
    sort: "desc",
  },
};

function $(selector) {
  return document.querySelector(selector);
}

const ui = {
  viewButtons: Array.from(document.querySelectorAll(".nav-chip")),
  overviewView: $("#overviewView"),
  liveView: $("#liveView"),
  settingsView: $("#settingsView"),
  statusLine: $("#statusLine"),
  timerText: $("#timerText"),
  recordDot: $("#recordDot"),
  sessionTitle: $("#sessionTitle"),
  sessionStats: $("#sessionStats"),
  sessionStageBadge: $("#sessionStageBadge"),
  modePill: $("#modePill"),
  runtimePill: $("#runtimePill"),
  latestTranscriptPreview: $("#latestTranscriptPreview"),
  latestSummaryPreview: $("#latestSummaryPreview"),
  liveFeedBox: $("#liveFeedBox"),
  minutesPreviewBox: $("#minutesPreviewBox"),
  historyListBox: $("#historyListBox"),
  refreshHistoryBtn: $("#refreshHistoryBtn"),
  historySearchInput: $("#historySearchInput"),
  historyStatusSelect: $("#historyStatusSelect"),
  historySortSelect: $("#historySortSelect"),
  settingsRuntimeState: $("#settingsRuntimeState"),
  settingsSaveState: $("#settingsSaveState"),
  settingsProbeState: $("#settingsProbeState"),
  settingsModelCatalog: $("#settingsModelCatalog"),
  transcriptBox: $("#transcriptBox"),
  summaryBox: $("#summaryBox"),
  minutesBox: $("#minutesBox"),
  startBtn: $("#startBtn"),
  pauseBtn: $("#pauseBtn"),
  stopBtn: $("#stopBtn"),
  manualSummaryBtn: $("#manualSummaryBtn"),
  generateMinutesBtn: $("#generateMinutesBtn"),
  exportMinutesBtn: $("#exportMinutesBtn"),
  testSttBtn: $("#testSttBtn"),
  testLlmBtn: $("#testLlmBtn"),
  testAllBtn: $("#testAllBtn"),
  saveAndTestBtn: $("#saveAndTestBtn"),
  mockConfigBtn: $("#mockConfigBtn"),
  saveConfigBtn: $("#saveConfigBtn"),
  copyTranscriptBtn: $("#copyTranscriptBtn"),
  pinBtn: $("#pinBtn"),
  hideBtn: $("#hideBtn"),
  meetingTitleInput: $("#meetingTitleInput"),
  exportDirInput: $("#exportDirInput"),
  copyExportDirBtn: $("#copyExportDirBtn"),
  sttBaseUrlInput: $("#sttBaseUrlInput"),
  sttApiKeyInput: $("#sttApiKeyInput"),
  sttModelInput: $("#sttModelInput"),
  languageInput: $("#languageInput"),
  llmBaseUrlInput: $("#llmBaseUrlInput"),
  llmApiKeyInput: $("#llmApiKeyInput"),
  llmModelInput: $("#llmModelInput"),
  chunkSecondsInput: $("#chunkSecondsInput"),
  summaryIntervalInput: $("#summaryIntervalInput"),
  systemPromptInput: $("#systemPromptInput"),
  summaryPromptInput: $("#summaryPromptInput"),
  minutesPromptInput: $("#minutesPromptInput"),
};

function setStatus(text) {
  ui.statusLine.textContent = text;
}

function setActiveView(view) {
  state.activeView = view;
  const mapping = {
    overview: ui.overviewView,
    live: ui.liveView,
    settings: ui.settingsView,
  };

  Object.entries(mapping).forEach(([key, element]) => {
    if (!element) return;
    if (key === view) {
      element.classList.remove("hidden");
    } else {
      element.classList.add("hidden");
    }
  });

  ui.viewButtons.forEach((button) => {
    if (button.getAttribute("data-view") === view) {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  });
}

function detectMediaSupport() {
  return {
    mediaDevices: typeof navigator.mediaDevices !== "undefined",
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    mediaRecorder: typeof globalThis.MediaRecorder === "function",
  };
}

function setDot(mode) {
  ui.recordDot.className = `record-dot ${mode}`;
}

function setStage(mode, text) {
  ui.sessionStageBadge.className = `stage-badge ${mode}`;
  ui.sessionStageBadge.textContent = text;
}

function nowLabel() {
  return new Date().toLocaleString();
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTranscript(session) {
  return session.transcript.map((item) => `[${item.timeLabel}] ${item.text}`).join("\n");
}

function sanitizeFileName(name) {
  return String(name || "meeting")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function getExportDir() {
  const configured = String(state.config.exportDir || "").trim();
  if (configured) return configured;
  const home = env.HOME || env.USERPROFILE || env.HOMEDIR || "/tmp";
  return `${home}/meeting-float-exports`;
}

function getSessionDataDir() {
  const home = env.HOME || env.USERPROFILE || env.HOMEDIR || "/tmp";
  return `${home}/meeting-float-data/sessions`;
}

function ensureDir(path) {
  try {
    sys.fs.$mkdir(path);
  } catch {}
}

function writeTextFile(filePath, text) {
  const output = sys.fs.openSync(filePath, "w");
  output.writeSync(new TextEncoder().encode(text));
  output.closeSync();
}

function exportSessionToFile(session) {
  const exportDir = getExportDir();
  const title = sanitizeFileName(session.title || session.id || "meeting");
  const stamp = sanitizeFileName(session.id || new Date().toISOString());
  const markdownPath = `${exportDir}/${title}-${stamp}.md`;
  const jsonPath = `${exportDir}/${title}-${stamp}.json`;

  ensureDir(exportDir);
  writeTextFile(markdownPath, store.exportMinutes(session));
  writeTextFile(jsonPath, JSON.stringify(session, null, 2));

  return {
    markdownPath,
    jsonPath,
  };
}

function persistSessionSnapshot(session) {
  const sessionDir = getSessionDataDir();
  ensureDir(`${env.HOME || env.USERPROFILE || env.HOMEDIR || "/tmp"}/meeting-float-data`);
  ensureDir(sessionDir);
  writeTextFile(`${sessionDir}/${sanitizeFileName(session.id)}.json`, JSON.stringify(session, null, 2));
}

function fillConfigForm(config) {
  ui.meetingTitleInput.value = config.meetingTitle;
  ui.exportDirInput.value = config.exportDir || "";
  ui.sttBaseUrlInput.value = config.stt.baseUrl;
  ui.sttApiKeyInput.value = config.stt.apiKey;
  ui.sttModelInput.value = config.stt.model;
  ui.languageInput.value = config.stt.language;
  ui.llmBaseUrlInput.value = config.llm.baseUrl;
  ui.llmApiKeyInput.value = config.llm.apiKey;
  ui.llmModelInput.value = config.llm.model;
  ui.chunkSecondsInput.value = String(config.chunkSeconds);
  ui.summaryIntervalInput.value = String(config.summaryIntervalMinutes);
  ui.systemPromptInput.value = config.systemPrompt;
  ui.summaryPromptInput.value = config.summaryPrompt;
  ui.minutesPromptInput.value = config.minutesPrompt;
}

function searchParam(name) {
  try {
    const url = new URL(document.URL || location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

function readConfigForm() {
  return {
    meetingTitle: ui.meetingTitleInput.value.trim(),
    exportDir: ui.exportDirInput.value.trim(),
    stt: {
      baseUrl: ui.sttBaseUrlInput.value.trim(),
      apiKey: ui.sttApiKeyInput.value.trim(),
      model: ui.sttModelInput.value.trim(),
      language: ui.languageInput.value.trim() || "zh",
    },
    llm: {
      baseUrl: ui.llmBaseUrlInput.value.trim(),
      apiKey: ui.llmApiKeyInput.value.trim(),
      model: ui.llmModelInput.value.trim(),
    },
    chunkSeconds: Number(ui.chunkSecondsInput.value || 20),
    summaryIntervalMinutes: Number(ui.summaryIntervalInput.value || 10),
    systemPrompt: ui.systemPromptInput.value.trim(),
    summaryPrompt: ui.summaryPromptInput.value.trim(),
    minutesPrompt: ui.minutesPromptInput.value.trim(),
  };
}

function mockModeEnabled(config) {
  return (
    String(config?.stt?.baseUrl || "").startsWith("mock://") &&
    String(config?.llm?.baseUrl || "").startsWith("mock://")
  );
}

function renderRuntimeState() {
  const support = state.mediaSupport;
  const runtimeLabel = `${env.PLATFORM} · mediaDevices ${support.mediaDevices ? "yes" : "no"} · getUserMedia ${support.getUserMedia ? "yes" : "no"} · MediaRecorder ${support.mediaRecorder ? "yes" : "no"}`;
  ui.runtimePill.textContent = runtimeLabel;
  ui.modePill.textContent = mockModeEnabled(state.config) ? "Mock 模式" : "标准模式";
  ui.settingsRuntimeState.textContent = mockModeEnabled(state.config)
    ? `${runtimeLabel}\n当前配置已切到 mock，可直接做转写、总结、纪要联调。`
    : `${runtimeLabel}\n如果当前运行时不带录音 API，真实录音需要宿主桥接。`;
}

function applyMockConfig() {
  const current = readConfigForm();
  const config = {
    ...current,
    stt: {
      ...current.stt,
      baseUrl: "mock://local",
      apiKey: "",
      model: "mock-stt",
    },
    llm: {
      ...current.llm,
      baseUrl: "mock://local",
      apiKey: "",
      model: "mock-llm",
    },
    chunkSeconds: 4,
    summaryIntervalMinutes: 1,
  };

  state.config = config;
  fillConfigForm(config);
  store.saveConfig(config);
  renderRuntimeState();
  setStatus("已切换到本地 mock 联调");
}

function saveConfig() {
  state.config = readConfigForm();
  store.saveConfig(state.config);
  state.settingsSavedAtLabel = new Date().toLocaleTimeString();
  renderRuntimeState();
  debugLog("config:saved");
  setStatus("配置已保存");
  renderSaveState();
}

function updateButtons() {
  const active = state.isRecording;
  const paused = state.isMockMode ? state.mockPaused : recorder.isPaused();
  ui.startBtn.disabled = active;
  ui.pauseBtn.disabled = !active;
  ui.stopBtn.disabled = !active;
  ui.manualSummaryBtn.disabled = !active;
  ui.generateMinutesBtn.disabled = !state.session?.transcript?.length;
  ui.exportMinutesBtn.disabled = !state.session?.minutes;
  ui.pauseBtn.textContent = paused ? "继续" : "暂停";
}

function renderTranscript() {
  const session = state.session;
  if (!session || session.transcript.length === 0) {
    ui.transcriptBox.innerHTML =
      '<div class="placeholder">会议开始后，这里会持续出现转写结果。</div>';
    return;
  }

  ui.transcriptBox.innerHTML = session.transcript
    .map(
      (item) => `
        <div class="segment">
          <div class="segment-time">${escapeHtml(item.timeLabel)}</div>
          <div class="segment-text">${escapeHtml(item.text)}</div>
        </div>
      `
    )
    .join("");
}

function renderSummaries() {
  const session = state.session;
  if (!session || session.summaries.length === 0) {
    ui.summaryBox.innerHTML =
      '<div class="placeholder">总结会按设定间隔自动生成。</div>';
    return;
  }

  ui.summaryBox.innerHTML = session.summaries
    .map(
      (item, index) => `
        <div class="summary-item">
          <div class="summary-head">第 ${index + 1} 次 · ${escapeHtml(item.timeLabel)}</div>
          <div>${escapeHtml(item.content)}</div>
        </div>
      `
    )
    .join("");
}

function renderMinutes() {
  const session = state.session;
  if (!session || !session.minutes) {
    ui.minutesBox.innerHTML =
      '<div class="placeholder">这里显示完整纪要正文。</div>';
    return;
  }

  ui.minutesBox.innerHTML = `<div class="minutes-content">${escapeHtml(session.minutes)}</div>`;
}

function renderLiveFeed() {
  const session = state.session;
  const feed = [];

  if (session?.minutes) {
    feed.push({
      type: "minutes",
      title: "会议纪要",
      timeLabel: session.endedAtLabel || "刚刚",
      content: session.minutes,
    });
  }

  if (session?.summaries?.length) {
    const latestSummary = session.summaries[session.summaries.length - 1];
    feed.push({
      type: "summary",
      title: "阶段总结",
      timeLabel: latestSummary.timeLabel,
      content: latestSummary.content,
    });
  }

  if (session?.transcript?.length) {
    const latestTranscript = session.transcript[session.transcript.length - 1];
    feed.push({
      type: "transcript",
      title: "实时转写",
      timeLabel: latestTranscript.timeLabel,
      content: latestTranscript.text,
    });
  }

  if (feed.length === 0) {
    ui.liveFeedBox.innerHTML =
      '<div class="placeholder">会议开始后，这里显示最新转写与总结动态。</div>';
    return;
  }

  ui.liveFeedBox.innerHTML = feed
    .map(
      (item) => `
        <div class="feed-item">
          <div class="feed-tag ${item.type}">${escapeHtml(item.title)}</div>
          <div class="feed-meta">${escapeHtml(item.timeLabel)}</div>
          <div class="feed-body">${escapeHtml(item.content)}</div>
        </div>
      `
    )
    .join("");
}

function renderOverview() {
  const session = state.session;
  const latestTranscript = session?.transcript?.[session.transcript.length - 1];
  const latestSummary = session?.summaries?.[session.summaries.length - 1];

  ui.latestTranscriptPreview.textContent = latestTranscript
    ? latestTranscript.text
    : "等待第一段转写";
  ui.latestSummaryPreview.textContent = latestSummary
    ? latestSummary.content
    : "还没有总结";

  if (!session?.minutes) {
    ui.minutesPreviewBox.innerHTML =
      '<div class="placeholder">结束会议后自动生成，也可以手动重生成。</div>';
  } else {
    ui.minutesPreviewBox.innerHTML = `<div class="minutes-content">${escapeHtml(session.minutes)}</div>`;
  }

  renderLiveFeed();
  renderHistory();
}

function renderHistory() {
  state.sessions = store.listSessions();
  const filtered = state.sessions
    .filter((item) => {
      if (state.historyFilter.status !== "all" && item.status !== state.historyFilter.status) {
        return false;
      }

      if (!state.historyFilter.query) return true;

      const haystack = [
        item.title,
        item.data?.minutes,
        ...(item.data?.transcript || []).map((entry) => entry.text),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

      return haystack.includes(state.historyFilter.query.toLowerCase());
    })
    .sort((left, right) => {
      if (state.historyFilter.sort === "title") {
        return String(left.title || "").localeCompare(String(right.title || ""));
      }

      const leftTime = new Date(left.startedAt || 0).getTime();
      const rightTime = new Date(right.startedAt || 0).getTime();
      return state.historyFilter.sort === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });

  if (!filtered.length) {
    ui.historyListBox.innerHTML = '<div class="placeholder">还没有历史会议。</div>';
    return;
  }

  ui.historyListBox.innerHTML = filtered
    .map((item) => {
      const preview =
        item.data?.minutes ||
        item.data?.summaries?.[item.data.summaries.length - 1]?.content ||
        item.data?.transcript?.[0]?.text ||
        "暂无内容";

      return `
        <div class="history-item">
          <div class="history-top">
            <div class="history-title">${escapeHtml(item.title || "未命名会议")}</div>
          </div>
          <div class="history-meta">
            ${escapeHtml(item.startedAt || "")} · ${escapeHtml(item.status || "unknown")} · ${item.transcriptCount} 段转写 / ${item.summaryCount} 次总结
          </div>
          <div class="history-preview">${escapeHtml(String(preview).slice(0, 140))}</div>
          <div class="history-actions">
            <button class="ghost compact history-open-btn" data-session-id="${escapeHtml(item.id)}">查看</button>
            <button class="ghost compact history-rename-btn" data-session-id="${escapeHtml(item.id)}">重命名</button>
            <button class="ghost compact history-export-btn" data-session-id="${escapeHtml(item.id)}">导出</button>
            <button class="ghost compact history-delete-btn" data-session-id="${escapeHtml(item.id)}">删除</button>
          </div>
        </div>
      `;
    })
    .join("");

  Array.from(ui.historyListBox.querySelectorAll(".history-open-btn")).forEach((button) =>
    button.on("click", () => loadSessionById(button.getAttribute("data-session-id")))
  );
  Array.from(ui.historyListBox.querySelectorAll(".history-rename-btn")).forEach((button) =>
    button.on("click", () => renameHistorySession(button.getAttribute("data-session-id")))
  );
  Array.from(ui.historyListBox.querySelectorAll(".history-export-btn")).forEach((button) =>
    button.on("click", () => exportHistorySession(button.getAttribute("data-session-id")))
  );
  Array.from(ui.historyListBox.querySelectorAll(".history-delete-btn")).forEach((button) =>
    button.on("click", () => deleteHistorySession(button.getAttribute("data-session-id")))
  );
}

function renderSaveState() {
  ui.settingsSaveState.textContent = state.settingsSavedAtLabel
    ? `已保存于 ${state.settingsSavedAtLabel}。`
    : "尚未保存本轮修改。";
}

function renderProbeState() {
  ui.settingsProbeState.classList.remove("ok");
  ui.settingsProbeState.classList.remove("error");
  if (state.settingsProbeState.tone) {
    ui.settingsProbeState.classList.add(state.settingsProbeState.tone);
  }
  ui.settingsProbeState.textContent = state.settingsProbeState.text;
}

function renderModelCatalog() {
  const entries = [
    ...state.modelCatalog.stt.slice(0, 6).map((model) => `STT · ${model}`),
    ...state.modelCatalog.llm.slice(0, 6).map((model) => `LLM · ${model}`),
  ];

  if (!entries.length) {
    ui.settingsModelCatalog.innerHTML =
      '<div class="placeholder">连接成功后，这里会显示可见模型。</div>';
    return;
  }

  ui.settingsModelCatalog.innerHTML = entries
    .map((item) => `<div class="model-chip">${escapeHtml(item)}</div>`)
    .join("");
}

function renderHeader() {
  const session = state.session;
  ui.sessionTitle.textContent = session?.title || "未开始会议";
  ui.sessionStats.textContent = session
    ? `${session.transcript.length} 段转写 · ${session.summaries.length} 次总结`
    : "0 段转写 · 0 次总结";

  if (!session) {
    setStage("idle", "待命中");
  } else if (!state.isRecording) {
    setStage("idle", "会议已结束");
  } else if (state.isMockMode ? state.mockPaused : recorder.isPaused()) {
    setStage("paused", "已暂停");
  } else {
    setStage("live", state.isMockMode ? "Mock 进行中" : "实时记录中");
  }
}

function renderAll() {
  renderHeader();
  renderTranscript();
  renderSummaries();
  renderMinutes();
  renderOverview();
  updateButtons();
}

function persistSession() {
  if (state.session) {
    debugLog(
      `session:persist id=${state.session.id} transcript=${state.session.transcript.length} summaries=${state.session.summaries.length} minutes=${Boolean(state.session.minutes)}`
    );
    store.saveSession(state.session);
    persistSessionSnapshot(state.session);
  }
  state.sessions = store.listSessions();
  renderAll();
}

function loadSessionById(sessionId) {
  const found = store.getSession(sessionId);
  if (!found?.data) return;

  state.session = found.data;
  state.isRecording = false;
  state.isMockMode = false;
  state.mockPaused = false;
  state.summaryTranscriptIndex = state.session.transcript.length;
  state.startedAtMs = state.session.startedAt ? new Date(state.session.startedAt).getTime() : Date.now();
  stopTimerLoop();
  stopSummaryLoop();
  setDot("idle");
  setStatus(`已载入历史会议：${state.session.title}`);
  setActiveView("live");
  renderAll();
}

async function exportHistorySession(sessionId) {
  const found = store.getSession(sessionId);
  if (!found?.data) return;

  const files = exportSessionToFile(found.data);
  setStatus(`历史会议已导出：${files.markdownPath} / ${files.jsonPath}`);
}

async function copyExportDir() {
  await Clipboard.writeText(getExportDir());
  setStatus(`导出目录已复制：${getExportDir()}`);
}

function renameHistorySession(sessionId) {
  const found = store.getSession(sessionId);
  if (!found) return;

  const nextTitle = prompt("输入新的会议标题", found.title || "未命名会议");
  if (!nextTitle) return;

  const renamed = store.renameSession(sessionId, nextTitle.trim());
  if (!renamed) return;

  if (state.session?.id === sessionId) {
    state.session.title = renamed.title;
  }
  setStatus(`已重命名为：${renamed.title}`);
  renderAll();
}

function deleteHistorySession(sessionId) {
  const found = store.getSession(sessionId);
  if (!found) return;
  const confirmed = confirm(`确认删除会议“${found.title || "未命名会议"}”吗？`);
  if (!confirmed) return;

  store.deleteSession(sessionId);
  if (state.session?.id === sessionId && !state.isRecording) {
    state.session = null;
    stopTimerLoop();
    stopSummaryLoop();
    setDot("idle");
  }
  setStatus(`已删除历史会议：${found.title || "未命名会议"}`);
  renderAll();
}

function clearErrorState() {
  ui.transcriptBox.style.background = "";
  ui.transcriptBox.style.color = "";
  ui.transcriptBox.style.border = "";
  ui.liveFeedBox.classList.remove("error-box");
}

function appendError(message) {
  if (state.session) {
    state.session.errors.push({
      time: new Date().toISOString(),
      message,
    });
  }
  ui.transcriptBox.style.background = "#fff7f7";
  ui.transcriptBox.style.color = "#5a1515";
  ui.transcriptBox.style.border = "1dip solid #f0b3b3";
  ui.transcriptBox.textContent = message;
  ui.liveFeedBox.classList.add("error-box");
  ui.liveFeedBox.textContent = message;
  setStatus(message);
  persistSession();
}

function createTrayIcon() {
  return new Graphics.Image((gfx) => {
    gfx.fillStyle = Graphics.Color.rgb(16, 23, 32);
    gfx.strokeStyle = Graphics.Color.rgb(255, 212, 126);
    gfx.lineWidth = 2;
    gfx.beginPath();
    gfx.arc(16, 16, 13, 0, Math.PI * 2);
    gfx.fill();
    gfx.stroke();
    gfx.fillStyle = Graphics.Color.rgb(249, 115, 82);
    gfx.beginPath();
    gfx.arc(16, 16, 6, 0, Math.PI * 2);
    gfx.fill();
  }, 32, 32);
}

function syncTimer() {
  if (!state.session) {
    ui.timerText.textContent = "00:00:00";
    return;
  }

  ui.timerText.textContent = formatElapsed(Date.now() - state.startedAtMs);
}

function startTimerLoop() {
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(syncTimer, 1000);
  syncTimer();
}

function stopTimerLoop() {
  clearInterval(state.timerHandle);
  state.timerHandle = null;
}

async function handleChunk(blob) {
  if (!state.session || !state.isRecording) return;

  state.queue = state.queue.then(async () => {
    try {
      debugLog(`chunk:received size=${blob.size}`);
      setStatus("正在转写...");
      const text = await api.transcribe(blob, state.config.stt);
      if (!text) return;

      state.session.transcript.push({
        timeLabel: new Date().toLocaleTimeString(),
        text,
      });
      debugLog(`chunk:transcribed text=${text.slice(0, 24)}`);
      setStatus(state.isMockMode ? "Mock 联调中" : "录音中");
      persistSession();
    } catch (error) {
      debugLog(`chunk:error ${error?.stack || error}`);
      appendError(`转写失败: ${error.message || error}`);
    }
  });

  await state.queue;
}

async function generateSummary(force = false) {
  const session = state.session;
  if (!session) return;

  const newItems = session.transcript.slice(state.summaryTranscriptIndex);
  if (!force && newItems.length === 0) return;
  if (newItems.length === 0) return;

  try {
    debugLog(`summary:start force=${force} newItems=${newItems.length}`);
    setStatus("正在生成阶段总结...");
    const content = await api.summarize(
      newItems.map((item) => `[${item.timeLabel}] ${item.text}`).join("\n"),
      state.config.llm,
      state.config.systemPrompt,
      state.config.summaryPrompt
    );

    session.summaries.push({
      timeLabel: new Date().toLocaleTimeString(),
      content,
    });
    state.summaryTranscriptIndex = session.transcript.length;
    debugLog("summary:done");
    setStatus("已生成阶段总结");
    persistSession();
  } catch (error) {
    debugLog(`summary:error ${error?.stack || error}`);
    appendError(`总结失败: ${error.message || error}`);
  }
}

async function generateMinutes() {
  const session = state.session;
  if (!session || session.transcript.length === 0) return;

  try {
    debugLog(`minutes:start transcript=${session.transcript.length}`);
    setStatus("正在生成会议纪要...");
    session.minutes = await api.createMinutes(
      plainTranscript(session),
      state.config.llm,
      state.config.systemPrompt,
      state.config.minutesPrompt
    );
    debugLog("minutes:done");
    setStatus("会议纪要已生成");
    persistSession();
  } catch (error) {
    debugLog(`minutes:error ${error?.stack || error}`);
    appendError(`纪要生成失败: ${error.message || error}`);
  }
}

function startSummaryLoop() {
  clearInterval(state.summaryHandle);
  state.summaryHandle = setInterval(() => {
    if (!state.session) return;
    if (state.isMockMode ? state.mockPaused : recorder.isPaused()) return;
    const intervalMs = state.config.summaryIntervalMinutes * 60 * 1000;
    const elapsed = Date.now() - state.startedAtMs;
    if (elapsed > 0 && elapsed % intervalMs < 15000) {
      generateSummary(false);
    }
  }, 15000);
}

function stopSummaryLoop() {
  clearInterval(state.summaryHandle);
  state.summaryHandle = null;
}

function startMockFeed() {
  clearInterval(state.mockChunkHandle);
  state.mockPaused = false;
  debugLog("mock:feed-start");
  state.mockChunkHandle = setInterval(() => {
    if (!state.isRecording || state.mockPaused) return;
    handleChunk(new Blob([`mock-${Date.now()}`], { type: "audio/webm" }));
  }, Math.max(2000, Number(state.config.chunkSeconds || 4) * 1000));
}

function stopMockFeed() {
  clearInterval(state.mockChunkHandle);
  state.mockChunkHandle = null;
  state.mockPaused = false;
  debugLog("mock:feed-stop");
}

async function startMeeting() {
  if (state.isRecording) return;

  saveConfig();
  clearErrorState();
  state.isMockMode = mockModeEnabled(state.config);
  state.mediaSupport = detectMediaSupport();
  renderRuntimeState();
  debugLog(`meeting:start mock=${state.isMockMode}`);

  if (
    !state.isMockMode &&
    (!state.mediaSupport.getUserMedia || !state.mediaSupport.mediaRecorder)
  ) {
    ui.transcriptBox.style.background = "#fff7f7";
    ui.transcriptBox.style.color = "#5a1515";
    ui.transcriptBox.style.border = "1dip solid #f0b3b3";
    ui.transcriptBox.textContent =
      "当前 Sciter runtime 不支持 getUserMedia / MediaRecorder，真实录音链路无法启动。请改用带媒体能力的 runtime，或接本地录音桥接。";
    ui.liveFeedBox.classList.add("error-box");
    ui.liveFeedBox.textContent =
      "当前运行时不支持真实录音，建议切到 Mock 模式先压流程，或接入本地录音桥接。";
    setStatus("当前 runtime 不支持真实录音");
    renderAll();
    return;
  }

  state.session = buildDefaultSession(
    state.config.meetingTitle || ui.meetingTitleInput.value.trim()
  );
  state.summaryTranscriptIndex = 0;
  state.startedAtMs = Date.now();
  state.isRecording = true;
  setStatus("正在启动录音...");
  setDot("live");
  persistSession();

  try {
    if (state.isMockMode) {
      startMockFeed();
    } else {
      await recorder.start(state.config.chunkSeconds, handleChunk);
    }
    startTimerLoop();
    startSummaryLoop();
    setStatus(state.isMockMode ? "Mock 联调中" : "录音中");
    renderAll();
  } catch (error) {
    debugLog(`meeting:start-error ${error?.stack || error}`);
    state.isRecording = false;
    state.session = null;
    setDot("idle");
    appendError(`启动失败: ${error.message || error}`);
  }
}

async function stopMeeting() {
  if (!state.session || !state.isRecording) return;

  debugLog("meeting:stop");
  setStatus("正在结束会议...");
  stopSummaryLoop();
  stopTimerLoop();
  state.isRecording = false;
  if (state.isMockMode) {
    stopMockFeed();
  } else {
    await recorder.stop();
  }
  await state.queue;
  await generateSummary(false);

  state.session.status = "completed";
  state.session.endedAt = new Date().toISOString();
  state.session.endedAtLabel = nowLabel();

  await generateMinutes();
  setDot("idle");
  persistSession();
  setStatus("会议已结束");
  renderAll();
}

function togglePause() {
  if (!state.session) return;

  if (state.isMockMode) {
    state.mockPaused = !state.mockPaused;
    debugLog(`meeting:pause mock=${state.mockPaused}`);
    setStatus(state.mockPaused ? "Mock 已暂停" : "Mock 联调中");
    setDot(state.mockPaused ? "paused" : "live");
  } else if (recorder.isPaused()) {
    recorder.resume();
    setStatus("录音中");
    setDot("live");
  } else {
    recorder.pause();
    setStatus("已暂停");
    setDot("paused");
  }

  renderAll();
}

async function copyTranscript() {
  if (!state.session) return;
  await Clipboard.writeText(plainTranscript(state.session));
  setStatus("实时记录已复制");
}

async function exportMinutes() {
  if (!state.session?.minutes) return;
  const files = exportSessionToFile(state.session);
  setStatus(`会议纪要已导出：${files.markdownPath} / ${files.jsonPath}`);
}

async function testProvider(kind) {
  saveConfig();
  const config = kind === "stt" ? state.config.stt : state.config.llm;
  const label = kind === "stt" ? "STT" : "LLM";

  state.settingsProbeState = {
    tone: "",
    text: `正在测试 ${label} 连接...`,
  };
  renderProbeState();

  try {
    const result = await api.probe(config);
    state.modelCatalog[kind] = result.models || [];
    state.settingsProbeState = {
      tone: result.modelFound ? "ok" : "",
      text: `${label}：${result.message}`,
    };
    setStatus(`${label} 连接测试完成`);
  } catch (error) {
    state.modelCatalog[kind] = [];
    state.settingsProbeState = {
      tone: "error",
      text: `${label}：${error.message || error}`,
    };
    setStatus(`${label} 连接测试失败`);
  }

  renderProbeState();
  renderModelCatalog();
}

async function testAllProviders() {
  await testProvider("stt");
  const first = state.settingsProbeState;
  await testProvider("llm");
  const second = state.settingsProbeState;

  state.settingsProbeState = {
    tone: first.tone === "error" || second.tone === "error" ? "error" : "ok",
    text: `STT：${first.text.replace(/^STT：/, "")}\nLLM：${second.text.replace(/^LLM：/, "")}`,
  };
  renderProbeState();
  setStatus("全部连接测试完成");
}

async function saveAndTestAll() {
  saveConfig();
  await testAllProviders();
}

function togglePin() {
  state.alwaysOnTop = !state.alwaysOnTop;
  Window.this.state = Window.WINDOW_SHOWN;
  Window.this.activate(true);
  Window.this.topmost = state.alwaysOnTop;
  ui.pinBtn.textContent = state.alwaysOnTop ? "取消置顶" : "置顶";
}

function hideToTray() {
  Window.this.state = Window.WINDOW_HIDDEN;
}

function restoreFromTray() {
  Window.this.state = Window.WINDOW_SHOWN;
  Window.this.activate(true);
}

function setupTray() {
  try {
    Window.this.trayIcon({
      image: createTrayIcon(),
      text: "Meeting Float",
    });
    Window.this.on("trayiconclick", restoreFromTray);
  } catch (error) {
    console.log(`tray disabled: ${error}`);
  }
}

async function maybeRunAutoTest() {
  const enabled =
    searchParam("autotest") === "1" ||
    String(location.hash || "").includes("autotest") ||
    globalThis.__MEETING_FLOAT_AUTOTEST__ === true ||
    String(env.MEETING_FLOAT_AUTOTEST || "") === "1";
  if (!enabled) return;

  await runAutoTestSequence();
}

async function runAutoTestSequence() {
  debugLog("autotest:start");
  applyMockConfig();
  setActiveView("overview");
  await startMeeting();
  setTimeout(() => {
    debugLog("autotest:stop-trigger");
    stopMeeting();
  }, 12000);
}

function bindEvents() {
  ui.viewButtons.forEach((button) =>
    button.on("click", () => setActiveView(button.getAttribute("data-view")))
  );
  ui.startBtn.on("click", startMeeting);
  ui.pauseBtn.on("click", togglePause);
  ui.stopBtn.on("click", stopMeeting);
  ui.mockConfigBtn.on("click", applyMockConfig);
  ui.saveConfigBtn.on("click", saveConfig);
  ui.copyTranscriptBtn.on("click", copyTranscript);
  ui.manualSummaryBtn.on("click", () => generateSummary(true));
  ui.generateMinutesBtn.on("click", generateMinutes);
  ui.exportMinutesBtn.on("click", exportMinutes);
  ui.testSttBtn.on("click", () => testProvider("stt"));
  ui.testLlmBtn.on("click", () => testProvider("llm"));
  ui.testAllBtn.on("click", testAllProviders);
  ui.saveAndTestBtn.on("click", saveAndTestAll);
  ui.refreshHistoryBtn.on("click", renderHistory);
  ui.historySearchInput.on("change", () => {
    state.historyFilter.query = ui.historySearchInput.value.trim();
    renderHistory();
  });
  ui.historyStatusSelect.on("change", () => {
    state.historyFilter.status = ui.historyStatusSelect.value;
    renderHistory();
  });
  ui.historySortSelect.on("change", () => {
    state.historyFilter.sort = ui.historySortSelect.value;
    renderHistory();
  });
  ui.pinBtn.on("click", togglePin);
  ui.hideBtn.on("click", hideToTray);
  ui.copyExportDirBtn.on("click", copyExportDir);

  [
    ui.meetingTitleInput,
    ui.exportDirInput,
    ui.sttBaseUrlInput,
    ui.sttApiKeyInput,
    ui.sttModelInput,
    ui.languageInput,
    ui.llmBaseUrlInput,
    ui.llmApiKeyInput,
    ui.llmModelInput,
    ui.chunkSecondsInput,
    ui.summaryIntervalInput,
    ui.systemPromptInput,
    ui.summaryPromptInput,
    ui.minutesPromptInput,
  ].forEach((element) =>
    element.on("change", () => {
      state.settingsSavedAtLabel = "";
      state.settingsProbeState = {
        tone: "",
        text: "配置已变更，请重新测试连接。",
      };
      state.modelCatalog = {
        stt: [],
        llm: [],
      };
      renderSaveState();
      renderProbeState();
      renderModelCatalog();
    })
  );

  document.on("closerequest", function () {
    Window.this.trayIcon?.("remove");
    return true;
  });
}

function bootstrap() {
  debugLog("bootstrap:app-bootstrap");
  state.mediaSupport = detectMediaSupport();
  globalThis.__meetingFloatTest = {
    applyMockConfig,
    startMeeting,
    stopMeeting,
    runAutoTestSequence,
  };
  fillConfigForm(state.config);
  bindEvents();
  setupTray();
  setActiveView("overview");
  setDot("idle");
  renderRuntimeState();
  renderSaveState();
  renderProbeState();
  renderModelCatalog();
  if (!state.mediaSupport.getUserMedia || !state.mediaSupport.mediaRecorder) {
    setStatus(`待命 · ${env.PLATFORM} · 运行时无录音 API`);
  } else {
    setStatus(`待命 · ${env.PLATFORM}`);
  }
  renderAll();
  maybeRunAutoTest();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
