import { AppStore, buildDefaultSession } from "./modules/store.js";
import { AiClient } from "./modules/api.js";
import { MeetingRecorder } from "./modules/recorder.js";
import * as sys from "@sys";
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
};

const ui = {
  statusLine: $("#statusLine"),
  timerText: $("#timerText"),
  recordDot: $("#recordDot"),
  sessionTitle: $("#sessionTitle"),
  sessionStats: $("#sessionStats"),
  transcriptBox: $("#transcriptBox"),
  summaryBox: $("#summaryBox"),
  minutesBox: $("#minutesBox"),
  startBtn: $("#startBtn"),
  pauseBtn: $("#pauseBtn"),
  stopBtn: $("#stopBtn"),
  manualSummaryBtn: $("#manualSummaryBtn"),
  generateMinutesBtn: $("#generateMinutesBtn"),
  exportMinutesBtn: $("#exportMinutesBtn"),
  toggleConfigBtn: $("#toggleConfigBtn"),
  configBody: $("#configBody"),
  mockConfigBtn: $("#mockConfigBtn"),
  saveConfigBtn: $("#saveConfigBtn"),
  copyTranscriptBtn: $("#copyTranscriptBtn"),
  pinBtn: $("#pinBtn"),
  hideBtn: $("#hideBtn"),
  meetingTitleInput: $("#meetingTitleInput"),
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

function $(selector) {
  return document.querySelector(selector);
}

function setStatus(text) {
  ui.statusLine.textContent = text;
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

function fillConfigForm(config) {
  ui.meetingTitleInput.value = config.meetingTitle;
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
  setStatus("已切换到本地 mock 联调");
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

function saveConfig() {
  state.config = readConfigForm();
  store.saveConfig(state.config);
  debugLog("config:saved");
  setStatus("配置已保存");
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
      '<div class="placeholder">结束会议后自动生成，可再次手动重生成。</div>';
    return;
  }

  ui.minutesBox.innerHTML = `<div class="minutes-content">${escapeHtml(session.minutes)}</div>`;
}

function renderHeader() {
  const session = state.session;
  ui.sessionTitle.textContent = session?.title || "未开始会议";
  ui.sessionStats.textContent = session
    ? `${session.transcript.length} 段转写 · ${session.summaries.length} 次总结`
    : "0 段转写 · 0 次总结";
}

function renderAll() {
  renderHeader();
  renderTranscript();
  renderSummaries();
  renderMinutes();
  updateButtons();
}

function persistSession() {
  if (state.session) {
    debugLog(
      `session:persist id=${state.session.id} transcript=${state.session.transcript.length} summaries=${state.session.summaries.length} minutes=${Boolean(state.session.minutes)}`
    );
    store.saveSession(state.session);
    renderAll();
  }
}

function mockModeEnabled(config) {
  return (
    String(config?.stt?.baseUrl || "").startsWith("mock://") &&
    String(config?.llm?.baseUrl || "").startsWith("mock://")
  );
}

function appendError(message) {
  if (!state.session) return;
  state.session.errors.push({
    time: new Date().toISOString(),
    message,
  });
  ui.transcriptBox.style.background = "#fff7f7";
  ui.transcriptBox.style.color = "#5a1515";
  ui.transcriptBox.style.border = "1dip solid #f0b3b3";
  ui.transcriptBox.textContent = message;
  setStatus(message);
  persistSession();
}

function createTrayIcon() {
  return new Graphics.Image((gfx) => {
    gfx.fillStyle = Graphics.Color.rgb(25, 19, 15);
    gfx.strokeStyle = Graphics.Color.rgb(255, 209, 121);
    gfx.lineWidth = 2;
    gfx.beginPath();
    gfx.arc(16, 16, 13, 0, Math.PI * 2);
    gfx.fill();
    gfx.stroke();
    gfx.fillStyle = Graphics.Color.rgb(228, 103, 70);
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
      setStatus("录音中");
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
  state.isMockMode = mockModeEnabled(state.config);
  state.mediaSupport = detectMediaSupport();
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
    appendError(`启动失败: ${error.message || error}`);
    state.isRecording = false;
    state.session = null;
    setDot("idle");
    renderAll();
    ui.transcriptBox.style.background = "#fff7f7";
    ui.transcriptBox.style.color = "#5a1515";
    ui.transcriptBox.style.border = "1dip solid #f0b3b3";
    ui.transcriptBox.textContent = `启动失败: ${error.message || error}`;
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
  } else {
    if (recorder.isPaused()) {
      recorder.resume();
      setStatus("录音中");
      setDot("live");
    } else {
      recorder.pause();
      setStatus("已暂停");
      setDot("paused");
    }
  }
  updateButtons();
}

async function copyTranscript() {
  if (!state.session) return;
  await Clipboard.writeText(plainTranscript(state.session));
  setStatus("实时记录已复制");
}

async function exportMinutes() {
  if (!state.session?.minutes) return;
  const markdown = store.exportMinutes(state.session);
  await Clipboard.writeText(markdown);
  setStatus("会议纪要已复制到剪贴板");
}

function toggleConfig() {
  ui.configBody.classList.toggle("collapsed");
  ui.toggleConfigBtn.textContent = ui.configBody.classList.contains("collapsed")
    ? "展开"
    : "收起";
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
  ui.transcriptBox.style.background = "#eefcf4";
  ui.transcriptBox.style.color = "#114d2d";
  ui.transcriptBox.style.border = "1dip solid #9ed9b8";
  ui.transcriptBox.textContent = "AUTOTEST BOOT";
  applyMockConfig();
  await startMeeting();
  setTimeout(() => {
    debugLog("autotest:stop-trigger");
    stopMeeting();
  }, 12000);
}

function bindEvents() {
  ui.startBtn.on("click", startMeeting);
  ui.pauseBtn.on("click", togglePause);
  ui.stopBtn.on("click", stopMeeting);
  ui.toggleConfigBtn.on("click", toggleConfig);
  ui.mockConfigBtn.on("click", applyMockConfig);
  ui.saveConfigBtn.on("click", saveConfig);
  ui.copyTranscriptBtn.on("click", copyTranscript);
  ui.manualSummaryBtn.on("click", () => generateSummary(true));
  ui.generateMinutesBtn.on("click", generateMinutes);
  ui.exportMinutesBtn.on("click", exportMinutes);
  ui.pinBtn.on("click", togglePin);
  ui.hideBtn.on("click", hideToTray);

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
  setDot("idle");
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
