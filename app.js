import { AppStore, buildDefaultSession } from "./modules/store.js";
import { AiClient } from "./modules/api.js";
import { MeetingRecorder } from "./modules/recorder.js";
import * as env from "@env";

const store = new AppStore();
const api = new AiClient();
const recorder = new MeetingRecorder();

function debugLog(message) {
  globalThis.__mfDebugLog?.(message);
}

const state = {
  config: store.getConfig(),
  session: null,
  sessions: store.listSessions(),
  activeView: "overview",
  activeFocusTab: "summary",
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
  settingsSavedAtLabel: "",
  providerProbe: {
    stt: { tone: "", text: "还没有测试 STT。" },
    llm: { tone: "", text: "还没有测试 LLM。" },
  },
};

function $(selector) {
  return document.querySelector(selector);
}

const ui = {
  viewButtons: Array.from(document.querySelectorAll(".nav-chip")),
  focusButtons: Array.from(document.querySelectorAll(".focus-tab")),
  overviewView: $("#overviewView"),
  historyView: $("#historyView"),
  settingsView: $("#settingsView"),
  statusLine: $("#statusLine"),
  timerText: $("#timerText"),
  recordDot: $("#recordDot"),
  sessionTitle: $("#sessionTitle"),
  sessionStats: $("#sessionStats"),
  sessionStageBadge: $("#sessionStageBadge"),
  modePill: $("#modePill"),
  runtimePill: $("#runtimePill"),
  summaryFocusBox: $("#summaryFocusBox"),
  transcriptFocusBox: $("#transcriptFocusBox"),
  minutesPreviewBox: $("#minutesPreviewBox"),
  historyTableBody: $("#historyTableBody"),
  refreshHistoryBtn: $("#refreshHistoryBtn"),
  settingsSaveState: $("#settingsSaveState"),
  sttProbeState: $("#sttProbeState"),
  llmProbeState: $("#llmProbeState"),
  startBtn: $("#startBtn"),
  pauseBtn: $("#pauseBtn"),
  stopBtn: $("#stopBtn"),
  viewMinutesBtn: $("#viewMinutesBtn"),
  minimizeBtn: $("#minimizeBtn"),
  closeBtn: $("#closeBtn"),
  saveConfigBtn: $("#saveConfigBtn"),
  testSttBtn: $("#testSttBtn"),
  testLlmBtn: $("#testLlmBtn"),
  sttBaseUrlInput: $("#sttBaseUrlInput"),
  sttApiKeyInput: $("#sttApiKeyInput"),
  sttModelInput: $("#sttModelInput"),
  languageInput: $("#languageInput"),
  llmBaseUrlInput: $("#llmBaseUrlInput"),
  llmApiKeyInput: $("#llmApiKeyInput"),
  llmModelInput: $("#llmModelInput"),
};

function setStatus(text) {
  ui.statusLine.textContent = text;
}

function setActiveView(view) {
  state.activeView = view;
  const mapping = {
    overview: ui.overviewView,
    history: ui.historyView,
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
    button.classList.toggle("active", button.getAttribute("data-view") === view);
  });
}

function setActiveFocusTab(tab) {
  state.activeFocusTab = tab;
  ui.focusButtons.forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-focus") === tab);
  });
  ui.summaryFocusBox.classList.toggle("hidden", tab !== "summary");
  ui.transcriptFocusBox.classList.toggle("hidden", tab !== "transcript");
}

function detectMediaSupport() {
  return {
    mediaDevices: typeof navigator.mediaDevices !== "undefined",
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    mediaRecorder: typeof globalThis.MediaRecorder === "function",
  };
}

function mockModeEnabled(config) {
  return (
    String(config?.stt?.baseUrl || "").startsWith("mock://") &&
    String(config?.llm?.baseUrl || "").startsWith("mock://")
  );
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

function compactText(text, max = 30) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function plainTranscript(session) {
  return session.transcript.map((item) => `[${item.timeLabel}] ${item.text}`).join("\n");
}

function fillConfigForm(config) {
  ui.sttBaseUrlInput.value = config.stt.baseUrl;
  ui.sttApiKeyInput.value = config.stt.apiKey;
  ui.sttModelInput.value = config.stt.model;
  ui.languageInput.value = config.stt.language;
  ui.llmBaseUrlInput.value = config.llm.baseUrl;
  ui.llmApiKeyInput.value = config.llm.apiKey;
  ui.llmModelInput.value = config.llm.model;
}

function readConfigForm() {
  return {
    ...state.config,
    stt: {
      ...state.config.stt,
      baseUrl: ui.sttBaseUrlInput.value.trim(),
      apiKey: ui.sttApiKeyInput.value.trim(),
      model: ui.sttModelInput.value.trim(),
      language: ui.languageInput.value.trim() || "zh",
    },
    llm: {
      ...state.config.llm,
      baseUrl: ui.llmBaseUrlInput.value.trim(),
      apiKey: ui.llmApiKeyInput.value.trim(),
      model: ui.llmModelInput.value.trim(),
    },
  };
}

function applyHiddenMockConfig() {
  const config = readConfigForm();
  state.config = {
    ...config,
    stt: {
      ...config.stt,
      baseUrl: "mock://local",
      apiKey: "",
      model: "mock-stt",
    },
    llm: {
      ...config.llm,
      baseUrl: "mock://local",
      apiKey: "",
      model: "mock-llm",
    },
    chunkSeconds: 4,
    summaryIntervalMinutes: 1,
  };
  store.saveConfig(state.config);
  fillConfigForm(state.config);
  renderRuntimeState();
}

function searchParam(name) {
  try {
    const url = new URL(document.URL || location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

function renderRuntimeState() {
  const support = state.mediaSupport;
  const runtimeLabel = `${env.PLATFORM} · media ${support.getUserMedia && support.mediaRecorder ? "ready" : "limited"}`;
  ui.runtimePill.textContent = runtimeLabel;
  ui.modePill.textContent = mockModeEnabled(state.config) ? "Mock 模式" : "标准模式";
}

function renderSaveState() {
  ui.settingsSaveState.textContent = state.settingsSavedAtLabel
    ? `已保存于 ${state.settingsSavedAtLabel}。`
    : "尚未保存本轮修改。";
}

function renderProbeStates() {
  const probeEntries = [
    [ui.sttProbeState, state.providerProbe.stt],
    [ui.llmProbeState, state.providerProbe.llm],
  ];

  probeEntries.forEach(([element, value]) => {
    element.classList.remove("ok");
    element.classList.remove("error");
    if (value.tone) {
      element.classList.add(value.tone);
    }
    element.textContent = value.text;
  });
}

function deriveSessionTitle(session) {
  if (session?.title) return session.title;

  const latestSummary = session?.summaries?.[session.summaries.length - 1]?.content;
  if (latestSummary) {
    const firstLine = latestSummary.split("\n").map((line) => line.trim()).find(Boolean);
    if (firstLine) return compactText(firstLine, 22);
  }

  const firstTranscript = session?.transcript?.[0]?.text;
  if (firstTranscript) return compactText(firstTranscript, 22);

  return "未命名会议";
}

function renderHeader() {
  const session = state.session;
  ui.sessionTitle.textContent = deriveSessionTitle(session || {});
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

function renderSummaryFocus() {
  const summaries = state.session?.summaries || [];
  if (!summaries.length) {
    ui.summaryFocusBox.innerHTML =
      '<div class="placeholder">会议进行后，这里显示阶段性总结。</div>';
    return;
  }

  ui.summaryFocusBox.innerHTML = summaries
    .slice()
    .reverse()
    .map(
      (item, index) => `
        <div class="summary-item">
          <div class="summary-head">阶段总结 ${summaries.length - index} · ${escapeHtml(item.timeLabel)}</div>
          <div>${escapeHtml(item.content)}</div>
        </div>
      `
    )
    .join("");
}

function renderTranscriptFocus() {
  const transcript = state.session?.transcript || [];
  if (!transcript.length) {
    ui.transcriptFocusBox.innerHTML =
      '<div class="placeholder">会议进行后，这里显示最新转写记录。</div>';
    return;
  }

  ui.transcriptFocusBox.innerHTML = transcript
    .slice(-8)
    .reverse()
    .map(
      (item) => `
        <div class="segment">
          <div class="segment-time">${escapeHtml(item.timeLabel)}</div>
          <div>${escapeHtml(item.text)}</div>
        </div>
      `
    )
    .join("");
}

function renderMinutesPreview() {
  const minutes = state.session?.minutes || "";
  if (!minutes) {
    ui.minutesPreviewBox.innerHTML =
      '<div class="placeholder">纪要将在会议结束后生成。</div>';
    return;
  }

  ui.minutesPreviewBox.innerHTML = `<div class="minutes-content">${escapeHtml(minutes)}</div>`;
}

function renderHistory() {
  state.sessions = store
    .listSessions()
    .sort(
      (left, right) =>
        new Date(right.startedAt || 0).getTime() - new Date(left.startedAt || 0).getTime()
    );

  if (!state.sessions.length) {
    ui.historyTableBody.innerHTML =
      '<tr><td colspan="2" class="placeholder-cell">还没有历史会议。</td></tr>';
    return;
  }

  ui.historyTableBody.innerHTML = state.sessions
    .map((item) => {
      const title = deriveSessionTitle(item.data || item);
      const timeLabel = item.startedAt
        ? new Date(item.startedAt).toLocaleString()
        : item.startedAtLabel || "";
      return `
        <tr class="history-row" data-session-id="${escapeHtml(item.id)}">
          <td class="history-title">${escapeHtml(title)}</td>
          <td>${escapeHtml(timeLabel)}</td>
        </tr>
      `;
    })
    .join("");

  Array.from(ui.historyTableBody.querySelectorAll(".history-row")).forEach((row) =>
    row.on("click", () => loadSessionById(row.getAttribute("data-session-id")))
  );
}

function updateButtons() {
  const active = state.isRecording;
  const paused = state.isMockMode ? state.mockPaused : recorder.isPaused();
  ui.startBtn.disabled = active;
  ui.pauseBtn.disabled = !active;
  ui.stopBtn.disabled = !active;
  ui.viewMinutesBtn.disabled = !state.session?.minutes;
  ui.pauseBtn.textContent = paused ? "继续" : "暂停";
}

function renderAll() {
  renderHeader();
  renderSummaryFocus();
  renderTranscriptFocus();
  renderMinutesPreview();
  renderHistory();
  updateButtons();
}

function persistSession() {
  if (!state.session) return;
  state.session.title = deriveSessionTitle(state.session);
  store.saveSession(state.session);
  state.sessions = store.listSessions();
  renderAll();
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

function appendError(message) {
  if (state.session) {
    state.session.errors.push({
      time: new Date().toISOString(),
      message,
    });
  }
  setStatus(message);
  ui.minutesPreviewBox.classList.add("error-box");
  ui.minutesPreviewBox.innerHTML = `<div class="placeholder">${escapeHtml(message)}</div>`;
  persistSession();
}

function clearErrorState() {
  ui.minutesPreviewBox.classList.remove("error-box");
}

async function handleChunk(blob) {
  if (!state.session || !state.isRecording) return;

  state.queue = state.queue.then(async () => {
    try {
      setStatus("正在转写...");
      const text = await api.transcribe(blob, state.config.stt);
      if (!text) return;

      state.session.transcript.push({
        timeLabel: new Date().toLocaleTimeString(),
        text,
      });
      setStatus(state.isMockMode ? "Mock 联调中" : "录音中");
      persistSession();
    } catch (error) {
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
    setStatus("已生成阶段总结");
    persistSession();
  } catch (error) {
    appendError(`总结失败: ${error.message || error}`);
  }
}

async function generateMinutes() {
  const session = state.session;
  if (!session || session.transcript.length === 0) return;

  setStatus("正在生成会议纪要...");
  session.minutes = await api.createMinutes(
    plainTranscript(session),
    state.config.llm,
    state.config.systemPrompt,
    state.config.minutesPrompt
  );
  persistSession();
}

async function generateTitle() {
  const session = state.session;
  if (!session || session.transcript.length === 0) return;

  try {
    const nextTitle = await api.createTitle(
      plainTranscript(session),
      session.minutes,
      state.config.llm,
      state.config.systemPrompt
    );

    if (nextTitle) {
      session.title = compactText(nextTitle.replace(/^["“]|["”]$/g, ""), 28);
    }
  } catch (error) {
    debugLog(`title:error ${error?.stack || error}`);
    session.title = deriveSessionTitle(session);
  }
}

function startMockFeed() {
  clearInterval(state.mockChunkHandle);
  state.mockPaused = false;
  state.mockChunkHandle = setInterval(() => {
    if (!state.isRecording || state.mockPaused) return;
    handleChunk(new Blob([`mock-${Date.now()}`], { type: "audio/webm" }));
  }, Math.max(2000, Number(state.config.chunkSeconds || 4) * 1000));
}

function stopMockFeed() {
  clearInterval(state.mockChunkHandle);
  state.mockChunkHandle = null;
  state.mockPaused = false;
}

async function startMeeting() {
  if (state.isRecording) return;

  saveConfig();
  clearErrorState();
  state.isMockMode = mockModeEnabled(state.config);
  state.mediaSupport = detectMediaSupport();
  renderRuntimeState();

  if (
    !state.isMockMode &&
    (!state.mediaSupport.getUserMedia || !state.mediaSupport.mediaRecorder)
  ) {
    setStatus("当前 runtime 不支持真实录音");
    ui.summaryFocusBox.innerHTML =
      '<div class="placeholder">当前运行时不支持 getUserMedia / MediaRecorder，无法直接启动真实录音。</div>';
    ui.transcriptFocusBox.innerHTML =
      '<div class="placeholder">请在支持媒体 API 的 runtime 下测试，或切到自动联调模式。</div>';
    return;
  }

  state.session = buildDefaultSession("会议进行中");
  state.summaryTranscriptIndex = 0;
  state.startedAtMs = Date.now();
  state.isRecording = true;
  setDot("live");
  setStatus("正在启动录音...");
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
    state.isRecording = false;
    state.session = null;
    setDot("idle");
    appendError(`启动失败: ${error.message || error}`);
  }
}

async function stopMeeting() {
  if (!state.session || !state.isRecording) return;

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

  try {
    await generateMinutes();
    await generateTitle();
    setStatus("会议已结束，纪要已更新");
  } catch (error) {
    appendError(`纪要生成失败: ${error.message || error}`);
  }

  setDot("idle");
  persistSession();
  renderAll();
}

function togglePause() {
  if (!state.session) return;

  if (state.isMockMode) {
    state.mockPaused = !state.mockPaused;
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

async function testProvider(kind) {
  saveConfig();
  const config = kind === "stt" ? state.config.stt : state.config.llm;
  const label = kind === "stt" ? "STT" : "LLM";

  state.providerProbe[kind] = {
    tone: "",
    text: `正在测试 ${label}...`,
  };
  renderProbeStates();

  try {
    const result = await api.probe(config);
    state.providerProbe[kind] = {
      tone: result.modelFound ? "ok" : "",
      text: result.message,
    };
    setStatus(`${label} 连接测试完成`);
  } catch (error) {
    state.providerProbe[kind] = {
      tone: "error",
      text: error.message || String(error),
    };
    setStatus(`${label} 连接测试失败`);
  }

  renderProbeStates();
}

function saveConfig() {
  state.config = readConfigForm();
  store.saveConfig(state.config);
  state.settingsSavedAtLabel = new Date().toLocaleTimeString();
  renderRuntimeState();
  renderSaveState();
  setStatus("配置已保存");
}

function markSettingsDirty() {
  state.settingsSavedAtLabel = "";
  state.providerProbe = {
    stt: { tone: "", text: "配置已变更，请重新测试 STT。" },
    llm: { tone: "", text: "配置已变更，请重新测试 LLM。" },
  };
  renderSaveState();
  renderProbeStates();
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
  setActiveView("overview");
  setStatus(`已载入历史会议：${deriveSessionTitle(state.session)}`);
  renderAll();
}

function openMinutesWindow() {
  if (!state.session?.minutes) return;

  const minutesUrl = new URL("./minutes-window.htm", document.URL).toString();
  const title = deriveSessionTitle(state.session);
  const minutesWindow = new Window({
    url: minutesUrl,
    caption: `${title} - 会议纪要`,
    width: 760,
    height: 840,
    alignment: 5,
    parameters: {
      title,
      minutes: state.session.minutes,
      startedAtLabel: state.session.startedAtLabel,
      endedAtLabel: state.session.endedAtLabel,
    },
  });

  minutesWindow.activate(true);
}

function createTrayIcon() {
  return new Graphics.Image((gfx) => {
    gfx.fillStyle = Graphics.Color.rgb(15, 34, 52);
    gfx.strokeStyle = Graphics.Color.rgb(98, 177, 255);
    gfx.lineWidth = 2;
    gfx.beginPath();
    gfx.arc(16, 16, 13, 0, Math.PI * 2);
    gfx.fill();
    gfx.stroke();
    gfx.fillStyle = Graphics.Color.rgb(31, 182, 137);
    gfx.beginPath();
    gfx.arc(16, 16, 6, 0, Math.PI * 2);
    gfx.fill();
  }, 32, 32);
}

function hideToTray() {
  Window.this.state = Window.WINDOW_HIDDEN;
  setStatus("已最小化到托盘");
}

function restoreFromTray() {
  Window.this.state = Window.WINDOW_SHOWN;
  Window.this.activate(true);
}

function closeApp() {
  try {
    Window.this.trayIcon?.("remove");
  } catch {}
  Window.this.close();
}

function setupTray() {
  try {
    Window.this.trayIcon({
      image: createTrayIcon(),
      text: "Meeting Float",
    });
    Window.this.on("trayiconclick", restoreFromTray);
  } catch (error) {
    debugLog(`tray:error ${error}`);
  }
}

async function maybeRunAutoTest() {
  const enabled =
    searchParam("autotest") === "1" ||
    String(location.hash || "").includes("autotest") ||
    globalThis.__MEETING_FLOAT_AUTOTEST__ === true ||
    String(env.MEETING_FLOAT_AUTOTEST || "") === "1";
  if (!enabled) return;
  applyHiddenMockConfig();
  await startMeeting();
  setTimeout(() => stopMeeting(), 12000);
}

function bindEvents() {
  ui.viewButtons.forEach((button) =>
    button.on("click", () => setActiveView(button.getAttribute("data-view")))
  );
  ui.focusButtons.forEach((button) =>
    button.on("click", () => setActiveFocusTab(button.getAttribute("data-focus")))
  );

  ui.startBtn.on("click", startMeeting);
  ui.pauseBtn.on("click", togglePause);
  ui.stopBtn.on("click", stopMeeting);
  ui.viewMinutesBtn.on("click", openMinutesWindow);
  ui.refreshHistoryBtn.on("click", renderHistory);
  ui.saveConfigBtn.on("click", saveConfig);
  ui.testSttBtn.on("click", () => testProvider("stt"));
  ui.testLlmBtn.on("click", () => testProvider("llm"));
  ui.minimizeBtn.on("click", hideToTray);
  ui.closeBtn.on("click", closeApp);

  [
    ui.sttBaseUrlInput,
    ui.sttApiKeyInput,
    ui.sttModelInput,
    ui.languageInput,
    ui.llmBaseUrlInput,
    ui.llmApiKeyInput,
    ui.llmModelInput,
  ].forEach((element) => element.on("change", markSettingsDirty));

  document.on("closerequest", function () {
    try {
      Window.this.trayIcon?.("remove");
    } catch {}
    return true;
  });
}

function bootstrap() {
  debugLog("bootstrap:app-bootstrap");
  state.mediaSupport = detectMediaSupport();
  fillConfigForm(state.config);
  bindEvents();
  setupTray();
  setActiveView("overview");
  setActiveFocusTab("summary");
  setDot("idle");
  renderRuntimeState();
  renderSaveState();
  renderProbeStates();
  syncTimer();
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
