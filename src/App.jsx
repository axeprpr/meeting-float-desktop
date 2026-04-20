import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Pause,
  Play,
  Square,
  Minus,
  Maximize2,
  X,
  Trash2,
  History,
  Settings,
  LayoutDashboard,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.jsx";
import { DesktopStore } from "@/services/desktop-store.js";
import { AiClient } from "@/services/ai-client.js";
import { MeetingRecorder } from "@/services/meeting-recorder.js";
import { DEFAULT_CONFIG } from "@/shared/defaults.js";

const store = new DesktopStore();
const api = new AiClient();
const recorder = new MeetingRecorder();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDefaultSession(title) {
  const now = new Date();
  const id = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  return {
    id,
    title: title || "未命名会议",
    status: "recording",
    startedAt: now.toISOString(),
    startedAtLabel: now.toLocaleString(),
    endedAt: "",
    endedAtLabel: "",
    transcript: [],
    summaries: [],
    minutes: "",
    errors: [],
  };
}

function compactText(text, max = 30) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

const SENTENCE_END_RE = /[。！？!?；;]+(?:["'”’》】）)])?/g;

function normalizeTranscriptText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function mergeTranscriptText(base, incoming) {
  const left = normalizeTranscriptText(base);
  const right = normalizeTranscriptText(incoming);
  if (!right) return left;
  if (!left) return right;
  return `${left} ${right}`;
}

function extractCompletedSentences(text) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) {
    return { complete: [], pending: "" };
  }

  const complete = [];
  let cursor = 0;
  SENTENCE_END_RE.lastIndex = 0;

  for (let match = SENTENCE_END_RE.exec(normalized); match; match = SENTENCE_END_RE.exec(normalized)) {
    const end = match.index + match[0].length;
    const sentence = normalized.slice(cursor, end).trim();
    if (sentence) complete.push(sentence);
    cursor = end;
  }

  return {
    complete,
    pending: normalized.slice(cursor).trim(),
  };
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

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function defaultFunASRUrl() {
  return "ws://f.axe3.cn:22395";
}

function plainTranscript(session) {
  return session.transcript.map((item) => `[${item.timeLabel}] ${item.text}`).join("\n");
}

function mockModeEnabled(config) {
  return (
    String(config?.stt?.baseUrl || "").startsWith("mock://") &&
    String(config?.llm?.baseUrl || "").startsWith("mock://")
  );
}

function sectionTone(isRecording, paused, hasSession, isMockMode) {
  if (!hasSession || !isRecording) {
    return { variant: "secondary", label: hasSession ? "会议已结束" : "待命中" };
  }
  if (paused) return { variant: "warning", label: "已暂停" };
  return { variant: "success", label: isMockMode ? "Mock 录制中" : "实时录制中" };
}

function Field({ label, children }) {
  return (
    <label className="space-y-2">
      <div className="text-sm text-slate-300">{label}</div>
      {children}
    </label>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState("unknown");
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [formConfig, setFormConfig] = useState(DEFAULT_CONFIG);
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeView, setActiveView] = useState("overview");
  const [activeFocusTab, setActiveFocusTab] = useState("transcript");
  const [statusLine, setStatusLine] = useState("待命");
  const [settingsSavedAtLabel, setSettingsSavedAtLabel] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [providerProbe, setProviderProbe] = useState({
    stt: { tone: "", text: "尚未测试语音转写服务。" },
    llm: { tone: "", text: "尚未测试大语言模型服务。" },
  });
  const [mediaSupport, setMediaSupport] = useState({
    helperReady: true,
    message: "浏览器媒体链路待检测",
  });
  const [mediaProbeText, setMediaProbeText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);
  const [mockPaused, setMockPaused] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState(0);
  const [elapsedLabel, setElapsedLabel] = useState("00:00:00");
  const [summaryTranscriptIndex, setSummaryTranscriptIndex] = useState(0);
  const [summaryTask, setSummaryTask] = useState({
    running: false,
    progress: 0,
    text: "",
  });
  const [reportTask, setReportTask] = useState({
    running: false,
    progress: 0,
    text: "",
  });

  const queueRef = useRef(Promise.resolve());
  const timerRef = useRef(null);
  const summaryLoopRef = useRef(null);
  const mockFeedRef = useRef(null);
  const sessionRef = useRef(session);
  const recordingRef = useRef(isRecording);
  const configRef = useRef(config);
  const summaryIndexRef = useRef(summaryTranscriptIndex);
  const mockPausedRef = useRef(mockPaused);
  const isMockModeRef = useRef(isMockMode);
  const pendingTranscriptRef = useRef("");
  const summaryTaskRunningRef = useRef(false);
  const reportTaskRunningRef = useRef(false);
  const summaryProgressTimerRef = useRef(null);
  const reportProgressTimerRef = useRef(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    recordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    summaryIndexRef.current = summaryTranscriptIndex;
  }, [summaryTranscriptIndex]);

  useEffect(() => {
    mockPausedRef.current = mockPaused;
  }, [mockPaused]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    window.meetingDesktop
      ?.getWindowState?.()
      .then((state) => {
        if (!disposed) {
          setIsMaximized(Boolean(state?.isMaximized));
        }
      })
      .catch(() => {});

    if (window.meetingDesktop?.onWindowStateChange) {
      unsubscribe = window.meetingDesktop.onWindowStateChange((state) => {
        setIsMaximized(Boolean(state?.isMaximized));
      });
    }

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    isMockModeRef.current = isMockMode;
  }, [isMockMode]);

  useEffect(() => {
    let disposed = false;

    async function bootstrap() {
      const payload = await store.bootstrap();
      if (disposed) return;

      const nextConfig = {
        ...clone(DEFAULT_CONFIG),
        ...payload.config,
        stt: { ...clone(DEFAULT_CONFIG.stt), ...(payload.config?.stt || {}) },
        llm: { ...clone(DEFAULT_CONFIG.llm), ...(payload.config?.llm || {}) },
      };

      if (!nextConfig.stt.baseUrl) {
        nextConfig.stt.baseUrl = defaultFunASRUrl();
      }

      setPlatform(payload.platform || "unknown");
      setConfig(nextConfig);
      setFormConfig(nextConfig);
      setSessions(payload.sessions || []);
      setStatusLine(`待命 · ${payload.platform || "unknown"}`);
      refreshMediaProbe();
      await refreshBridgeState(nextConfig);
      setReady(true);

      if (payload.autotest) {
        const mockConfig = await applyHiddenMockConfig(nextConfig);
        window.setTimeout(() => {
          startMeeting(mockConfig);
          window.setTimeout(() => stopMeeting(), 12000);
        }, 300);
      }
    }

    bootstrap();

    return () => {
      disposed = true;
      clearInterval(timerRef.current);
      clearInterval(summaryLoopRef.current);
      clearInterval(mockFeedRef.current);
      clearInterval(summaryProgressTimerRef.current);
      clearInterval(reportProgressTimerRef.current);
    };
  }, []);

  function refreshMediaProbe() {
    const lines = [
      `backend: ${recorder.backend || "unknown"}`,
      `navigator: ${typeof navigator}`,
      `mediaDevices: ${typeof navigator?.mediaDevices}`,
      `getUserMedia: ${typeof navigator?.mediaDevices?.getUserMedia}`,
      `AudioContext: ${typeof window.AudioContext}`,
      `WebSocket: ${typeof window.WebSocket}`,
    ];
    setMediaProbeText(lines.join(" | "));
  }

  async function refreshBridgeState(nextConfig = configRef.current) {
    if (mockModeEnabled(nextConfig)) {
      setMediaSupport({
        helperReady: true,
        message: "Mock 模式已启用",
      });
      return;
    }

    try {
      const health = await recorder.health();
      setMediaSupport({
        helperReady: true,
        message:
          health.status === "recording"
            ? "浏览器音频采集链路运行中"
            : "浏览器音频采集链路可用",
      });
    } catch {
      setMediaSupport({
        helperReady: false,
        message: "浏览器音频采集链路不可用",
      });
    }
  }

  function updateForm(path, value) {
    setFormConfig((current) => {
      const next = clone(current);
      const segments = path.split(".");
      let cursor = next;
      for (let index = 0; index < segments.length - 1; index += 1) {
        cursor = cursor[segments[index]];
      }
      cursor[segments[segments.length - 1]] = value;
      return next;
    });
    setSettingsSavedAtLabel("");
    setProviderProbe({
      stt: { tone: "", text: "配置已修改，请重新测试语音转写服务。" },
      llm: { tone: "", text: "配置已修改，请重新测试大语言模型服务。" },
    });
  }

  async function reloadSessions() {
    const items = await store.listSessions();
    setSessions(items);
  }

  async function persistSession(nextSession, options = {}) {
    if (!nextSession) return;
    const activeSessionId = sessionRef.current?.id;
    nextSession.title = deriveSessionTitle(nextSession);
    await store.saveSession(nextSession);
    await reloadSessions();
    const shouldSyncView =
      typeof options.syncView === "boolean" ? options.syncView : activeSessionId === nextSession.id;
    if (!shouldSyncView) return;
    const snapshot = clone(nextSession);
    setSession(snapshot);
    sessionRef.current = snapshot;
  }

  async function saveConfig(nextConfigOverride) {
    const nextConfig = clone(nextConfigOverride || formConfig);
    if (!nextConfig.stt.baseUrl) {
      nextConfig.stt.baseUrl = defaultFunASRUrl();
    }
    await store.saveConfig(nextConfig);
    setConfig(nextConfig);
    setFormConfig(nextConfig);
    configRef.current = nextConfig;
    setSettingsSavedAtLabel(new Date().toLocaleTimeString());
    setStatusLine("配置已保存");
    return nextConfig;
  }

  async function applyHiddenMockConfig(baseConfig = formConfig) {
    const nextConfig = {
      ...clone(baseConfig),
      stt: {
        ...clone(baseConfig.stt),
        baseUrl: "mock://local",
        apiKey: "",
        model: "mock-stt",
      },
      llm: {
        ...clone(baseConfig.llm),
        baseUrl: "mock://local",
        apiKey: "",
        model: "mock-llm",
      },
      chunkSeconds: 4,
      summaryIntervalMinutes: 1,
    };

    await saveConfig(nextConfig);
    await refreshBridgeState(nextConfig);
    return nextConfig;
  }

  function syncTimer(baseStartedAtMs = startedAtMs) {
    if (!sessionRef.current) {
      setElapsedLabel("00:00:00");
      return;
    }
    setElapsedLabel(formatElapsed(Date.now() - baseStartedAtMs));
  }

  function startTimerLoop(baseStartedAtMs) {
    clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => syncTimer(baseStartedAtMs), 1000);
    syncTimer(baseStartedAtMs);
  }

  function stopTimerLoop() {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function startSummaryLoop() {
    clearInterval(summaryLoopRef.current);
    summaryLoopRef.current = window.setInterval(() => {
      const currentSession = sessionRef.current;
      const currentConfig = configRef.current;
      if (!currentSession) return;
      if (isMockModeRef.current ? mockPausedRef.current : recorder.isPaused()) return;

      const intervalMs = Number(currentConfig.summaryIntervalMinutes || 2.5) * 60 * 1000;
      const elapsed = Date.now() - new Date(currentSession.startedAt).getTime();
      if (elapsed > 0 && elapsed % intervalMs < 15000) {
        generateSummary(false);
      }
    }, 15000);
  }

  function stopSummaryLoop() {
    clearInterval(summaryLoopRef.current);
    summaryLoopRef.current = null;
  }

  function createProgressController(kind, initialText) {
    const timerRef = kind === "summary" ? summaryProgressTimerRef : reportProgressTimerRef;
    const setTask = kind === "summary" ? setSummaryTask : setReportTask;

    clearInterval(timerRef.current);
    let progress = 7;
    setTask({
      running: true,
      progress,
      text: initialText,
    });

    timerRef.current = window.setInterval(() => {
      progress = Math.min(94, progress + (progress < 40 ? 8 : progress < 75 ? 4 : 2));
      setTask((current) => {
        if (!current.running) return current;
        return {
          ...current,
          progress,
        };
      });
    }, 450);

    return {
      update(text) {
        setTask((current) => {
          if (!current.running) return current;
          return {
            ...current,
            text,
          };
        });
      },
      complete(text) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setTask((current) => ({
          running: true,
          progress: 100,
          text: text || current.text,
        }));
        window.setTimeout(() => {
          setTask((current) => {
            if (!current.running || current.progress !== 100) return current;
            return { running: false, progress: 0, text: "" };
          });
        }, 900);
      },
      fail(text) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setTask({
          running: false,
          progress: 0,
          text: "",
        });
        if (text) {
          setStatusLine(text);
        }
      },
    };
  }

  function appendError(message) {
    const currentSession = sessionRef.current;
    if (currentSession) {
      currentSession.errors.push({
        time: new Date().toISOString(),
        message,
      });
      persistSession(currentSession);
    }
    setStatusLine(message);
  }

  async function handleTranscript(text) {
    if (!text || !sessionRef.current || !recordingRef.current) return;

    pendingTranscriptRef.current = mergeTranscriptText(pendingTranscriptRef.current, text);
    const { complete, pending } = extractCompletedSentences(pendingTranscriptRef.current);
    pendingTranscriptRef.current = pending;
    if (complete.length === 0) return;

    queueRef.current = queueRef.current.then(async () => {
      const currentSession = sessionRef.current;
      if (!currentSession) return;

      const now = new Date().toLocaleTimeString();
      complete.forEach((sentence) => {
        currentSession.transcript.push({
          timeLabel: now,
          text: sentence,
        });
      });

      setStatusLine(isMockModeRef.current ? "Mock 转写进行中" : "已收到完整句转写");
      await persistSession(currentSession);
    });

    await queueRef.current;
  }

  async function flushPendingTranscript(force = false) {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    const source = pendingTranscriptRef.current;
    if (!source) return;
    const { complete, pending } = extractCompletedSentences(source);
    const ready = force ? [...complete, pending].filter(Boolean) : complete;
    pendingTranscriptRef.current = force ? "" : pending;
    if (ready.length === 0) return;

    queueRef.current = queueRef.current.then(async () => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      const now = new Date().toLocaleTimeString();
      ready.forEach((sentence) => {
        activeSession.transcript.push({
          timeLabel: now,
          text: sentence,
        });
      });

      await persistSession(activeSession);
    });

    await queueRef.current;
  }

  function handleTranscriptPreview() {
    if (recordingRef.current) {
      setStatusLine("语音识别中...");
    }
  }

  function handleRecorderEvent(event) {
    if (!event?.type) return;

    if (event.type === "status" && event.text) {
      setStatusLine(event.text);
      return;
    }

    if (event.type === "error" && event.text) {
      setIsRecording(false);
      recordingRef.current = false;
      stopTimerLoop();
      stopSummaryLoop();
      appendError(event.text);
    }
  }

  async function generateSummary(force = false) {
    const currentSession = sessionRef.current;
    const currentConfig = configRef.current;
    if (!currentSession) return;

    const newItems = currentSession.transcript.slice(summaryIndexRef.current);
    const previousSummary = currentSession.summaries[currentSession.summaries.length - 1]?.content || "";
    if (!force && newItems.length === 0) return;
    if (newItems.length === 0) return;
    if (summaryTaskRunningRef.current) return;

    summaryTaskRunningRef.current = true;
    const progress = createProgressController("summary", "阶段总结任务进行中...");

    try {
      setStatusLine("阶段总结任务已提交，后台处理中...");
      const content = await api.summarize(
        [
          previousSummary ? `上一轮阶段总结：\n${previousSummary}` : "",
          `本轮新增转写：\n${newItems.map((item) => `[${item.timeLabel}] ${item.text}`).join("\n")}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        currentConfig.llm,
        currentConfig.systemPrompt,
        currentConfig.summaryPrompt
      );

      currentSession.summaries.push({
        timeLabel: new Date().toLocaleTimeString(),
        content,
      });
      setSummaryTranscriptIndex(currentSession.transcript.length);
      summaryIndexRef.current = currentSession.transcript.length;
      setStatusLine("阶段总结已更新");
      await persistSession(currentSession);
      progress.complete("阶段总结已完成");
    } catch (error) {
      progress.fail("阶段总结失败");
      appendError(`生成总结失败: ${error.message || error}`);
    } finally {
      summaryTaskRunningRef.current = false;
    }
  }

  async function generateMinutes(targetSession = sessionRef.current, targetConfig = configRef.current) {
    if (!targetSession || targetSession.transcript.length === 0) return;

    targetSession.minutes = await api.createMinutes(
      plainTranscript(targetSession),
      targetConfig.llm,
      targetConfig.systemPrompt,
      targetConfig.minutesPrompt
    );
    await persistSession(targetSession);
  }

  async function generateTitle(targetSession = sessionRef.current, targetConfig = configRef.current) {
    if (!targetSession || targetSession.transcript.length === 0) return;

    try {
      const nextTitle = await api.createTitle(
        plainTranscript(targetSession),
        targetSession.minutes,
        targetConfig.llm,
        targetConfig.systemPrompt
      );

      if (nextTitle) {
        targetSession.title = compactText(nextTitle.replace(/^["'“”]+|["'“”]+$/g, ""), 28);
      }
    } catch {
      targetSession.title = deriveSessionTitle(targetSession);
    }
  }

  function startMockFeed(currentConfig) {
    clearInterval(mockFeedRef.current);
    setMockPaused(false);
    mockPausedRef.current = false;
    mockFeedRef.current = window.setInterval(async () => {
      if (!recordingRef.current || mockPausedRef.current) return;
      const text = await api.transcribe(null, currentConfig.stt);
      await handleTranscript(text);
    }, Math.max(2000, Number(currentConfig.chunkSeconds || 4) * 1000));
  }

  function stopMockFeed() {
    clearInterval(mockFeedRef.current);
    mockFeedRef.current = null;
    setMockPaused(false);
    mockPausedRef.current = false;
  }

  async function startMeeting(preparedConfig) {
    if (recordingRef.current) return;

    const currentConfig = await saveConfig(preparedConfig || formConfig);
    const nextMockMode = mockModeEnabled(currentConfig);
    setIsMockMode(nextMockMode);
    isMockModeRef.current = nextMockMode;
    await refreshBridgeState(currentConfig);

    try {
      if (!nextMockMode) {
        await recorder.configure(currentConfig.stt);
        const probe = await recorder.probe(currentConfig.stt);
        if (probe?.ok === false) {
          throw new Error(probe.message || "stt probe failed");
        }
      }
    } catch (error) {
      appendError(`启动失败: ${error.message || error}`);
      return;
    }

    if (!nextMockMode && !String(currentConfig.stt.baseUrl || "").trim()) {
      setStatusLine("转写服务地址未配置");
      return;
    }

    const nextSession = buildDefaultSession("会议进行中");
    sessionRef.current = nextSession;
    setSession(nextSession);
    setSummaryTranscriptIndex(0);
    summaryIndexRef.current = 0;
    const nextStartedAtMs = Date.now();
    setStartedAtMs(nextStartedAtMs);
    setIsRecording(true);
    recordingRef.current = true;
    setStatusLine("正在启动录音...");
    await persistSession(nextSession);

    try {
      if (nextMockMode) {
        startMockFeed(currentConfig);
      } else {
        await recorder.start(
          currentConfig.chunkSeconds,
          handleTranscript,
          handleTranscriptPreview,
          handleRecorderEvent
        );
      }

      startTimerLoop(nextStartedAtMs);
      startSummaryLoop();
      pendingTranscriptRef.current = "";
      setStatusLine(nextMockMode ? "Mock 会议进行中" : "录音进行中");
    } catch (error) {
      stopTimerLoop();
      stopSummaryLoop();
      setIsRecording(false);
      recordingRef.current = false;
      setSession(null);
      sessionRef.current = null;
      appendError(`启动失败: ${error.message || error}`);
    }
  }

  async function stopMeeting() {
    const currentSession = sessionRef.current;
    if (!currentSession || !recordingRef.current) return;

    setStatusLine("正在结束会议...");
    stopSummaryLoop();
    stopTimerLoop();
    setIsRecording(false);
    recordingRef.current = false;

    if (isMockModeRef.current) {
      stopMockFeed();
    } else {
      await recorder.stop();
    }

    await flushPendingTranscript(true);
    await queueRef.current;
    void generateSummary(false);

    currentSession.status = "completed";
    currentSession.endedAt = new Date().toISOString();
    currentSession.endedAtLabel = new Date().toLocaleString();

    await refreshBridgeState();
    await persistSession(currentSession);
    setStatusLine("会议已结束，正在后台生成报告...");
    void generateReport(currentSession, configRef.current);
  }

  async function generateReport(targetSession = sessionRef.current, targetConfig = configRef.current) {
    if (!targetSession || targetSession.transcript.length === 0) return;
    if (reportTaskRunningRef.current) return;

    reportTaskRunningRef.current = true;
    const progress = createProgressController("report", "会议报告任务进行中...");

    try {
      setStatusLine("会议报告任务已提交，后台处理中...");
      progress.update("正在生成会议纪要...");
      await generateMinutes(targetSession, targetConfig);
      progress.update("正在生成报告标题...");
      await generateTitle(targetSession, targetConfig);
      await persistSession(targetSession);
      progress.complete("会议报告已完成");
      setStatusLine("会议已结束，报告已生成");
    } catch (error) {
      progress.fail("会议报告生成失败");
      appendError(`生成纪要失败: ${error.message || error}`);
    } finally {
      reportTaskRunningRef.current = false;
    }
  }

  async function togglePause() {
    if (!sessionRef.current) return;

    if (isMockModeRef.current) {
      const nextPaused = !mockPausedRef.current;
      setMockPaused(nextPaused);
      mockPausedRef.current = nextPaused;
      setStatusLine(nextPaused ? "Mock 会议已暂停" : "Mock 会议继续进行");
    } else if (recorder.isPaused()) {
      await recorder.resume();
      setStatusLine("录音已恢复");
    } else {
      await recorder.pause();
      setStatusLine("录音已暂停");
    }

    await refreshBridgeState();
  }

  async function testProvider(kind) {
    const currentConfig = await saveConfig(formConfig);
    const targetConfig = kind === "stt" ? currentConfig.stt : currentConfig.llm;
    const label = kind === "stt" ? "语音转写服务" : "大语言模型服务";

    setProviderProbe((current) => ({
      ...current,
      [kind]: {
        tone: "",
        text: `正在测试 ${label}...`,
      },
    }));

    try {
      const result = kind === "stt" ? await recorder.probe(targetConfig) : await api.probe(targetConfig);
      setProviderProbe((current) => ({
        ...current,
        [kind]: {
          tone: result.modelFound ? "ok" : "",
          text: result.message,
        },
      }));
      setStatusLine(`${label} 测试完成`);
    } catch (error) {
      setProviderProbe((current) => ({
        ...current,
        [kind]: {
          tone: "error",
          text: error.message || String(error),
        },
      }));
      setStatusLine(`${label} 测试失败`);
    }
  }

  async function loadSessionById(sessionId) {
    const found = await store.getSession(sessionId);
    if (!found?.data) return;

    const nextSession = found.data;
    setSession(nextSession);
    sessionRef.current = nextSession;
    setIsRecording(false);
    recordingRef.current = false;
    setIsMockMode(false);
    isMockModeRef.current = false;
    setMockPaused(false);
    mockPausedRef.current = false;
    setSummaryTranscriptIndex(nextSession.transcript.length);
    summaryIndexRef.current = nextSession.transcript.length;
    pendingTranscriptRef.current = "";
    const nextStartedAtMs = nextSession.startedAt ? new Date(nextSession.startedAt).getTime() : Date.now();
    setStartedAtMs(nextStartedAtMs);
    stopTimerLoop();
    stopSummaryLoop();
    setActiveView("overview");
    setStatusLine(`已载入历史会话：${deriveSessionTitle(nextSession)}`);
    syncTimer(nextStartedAtMs);
  }

  async function deleteSessionById(sessionId) {
    if (!window.confirm("确认删除这条历史记录吗？此操作不可恢复。")) {
      return;
    }

    const result = await store.deleteSession(sessionId);
    if (!result?.ok) {
      setStatusLine("删除历史记录失败");
      return;
    }

    if (sessionRef.current?.id === sessionId) {
      setSession(null);
      sessionRef.current = null;
      setElapsedLabel("00:00:00");
      setSummaryTranscriptIndex(0);
      summaryIndexRef.current = 0;
      pendingTranscriptRef.current = "";
    }

    await reloadSessions();
    setStatusLine("历史记录已删除");
  }

  async function openMinutesWindow() {
    if (!session?.minutes) return;
    await window.meetingDesktop.openMinutesWindow({
      title: deriveSessionTitle(session),
      minutes: session.minutes,
      startedAtLabel: session.startedAtLabel,
      endedAtLabel: session.endedAtLabel,
    });
  }

  async function runAutotest() {
    const mockConfig = await applyHiddenMockConfig(formConfig);
    await startMeeting(mockConfig);
    window.setTimeout(() => stopMeeting(), 12000);
  }

  async function minimizeWindow() {
    await window.meetingDesktop?.minimizeWindow?.();
  }

  async function toggleMaximize() {
    const next = await window.meetingDesktop?.toggleMaximize?.();
    if (typeof next?.isMaximized === "boolean") {
      setIsMaximized(next.isMaximized);
    }
  }

  async function closeWindow() {
    await window.meetingDesktop?.closeWindow?.();
  }

  const paused = isMockMode ? mockPaused : recorder.isPaused();
  const tone = sectionTone(isRecording, paused, Boolean(session), isMockMode);
  const sessionTitle = deriveSessionTitle(session || {});
  const sessionStats = session
    ? `${session.transcript.length} 段转写 · ${session.summaries.length} 次总结`
    : "0 段转写 · 0 次总结";
  const runtimeLabel = `${platform} · ${mediaSupport.message}`;
  const summaries = session?.summaries || [];
  const transcripts = session?.transcript || [];

  if (!ready) {
    return (
      <main className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          正在启动 React + Electron + shadcn/ui 架构...
        </div>
      </main>
    );
  }

  const sidebarButtons = [
    { key: "overview", label: "\u6982\u89c8", icon: LayoutDashboard },
    { key: "history", label: "\u5386\u53f2\u8bb0\u5f55", icon: History },
    { key: "settings", label: "\u8bbe\u7f6e", icon: Settings },
  ];

  return (
    <main className="flex h-full flex-col overflow-hidden bg-transparent text-slate-50">
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-slate-900/80 bg-slate-950/85 px-3 backdrop-blur"
        style={{ WebkitAppRegion: "drag" }}
        onDoubleClick={toggleMaximize}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-[0.16em] text-slate-100">{"\u91cf\u754c\u667a\u64ce\u4f1a\u8bae\u52a9\u624b"}</div>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" }}>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-md" onClick={minimizeWindow} title={"minimize"}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-md" onClick={toggleMaximize} title={isMaximized ? "restore" : "maximize"}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-md hover:bg-rose-500/90 hover:text-white" onClick={closeWindow} title={"close"}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-[980px] gap-3 p-3">
        <aside className="hidden w-44 shrink-0 lg:flex">
          <div className="flex h-full w-full flex-col rounded-2xl border border-slate-800/70 bg-slate-950/70 p-3">
            <div className="mb-4 border-b border-slate-900/80 pb-3">
              <div className="text-sm font-semibold text-slate-100">{"\u91cf\u754c\u667a\u64ce"}</div>
              <div className="mt-1 text-xs text-slate-500">{"\u4f1a\u8bae\u52a9\u624b\u684c\u9762\u7aef"}</div>
            </div>
            <div className="flex flex-col gap-2">
              {sidebarButtons.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.key}
                    variant={activeView === item.key ? "default" : "ghost"}
                    size="sm"
                    className="justify-start gap-2 rounded-xl px-3"
                    onClick={() => setActiveView(item.key)}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-950/55 p-3">
          <div className="flex flex-wrap gap-2 lg:hidden">
            {sidebarButtons.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={"mobile-" + item.key}
                  variant={activeView === item.key ? "default" : "ghost"}
                  size="sm"
                  className="gap-2 rounded-xl"
                  onClick={() => setActiveView(item.key)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              );
            })}
          </div>

          {activeView === "overview" && (
            <Card className="border-slate-800/80 bg-slate-950/70">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-slate-100">{sessionTitle}</div>
                    <div className="mt-1 text-xs text-slate-500">{runtimeLabel}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 px-4 py-3">
                    <div className="text-2xl font-semibold tabular-nums text-slate-100">{elapsedLabel}</div>
                    <div className="mt-1 text-xs text-slate-500">{sessionStats}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => startMeeting()} disabled={isRecording} className="gap-2 rounded-xl px-3">
                    <Mic className="h-4 w-4" />
                    {"\u5f00\u59cb\u4f1a\u8bae"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={togglePause} disabled={!isRecording} className="gap-2 rounded-xl px-3">
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {paused ? "\u7ee7\u7eed" : "\u6682\u505c"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={stopMeeting} disabled={!isRecording} className="gap-2 rounded-xl px-3">
                    <Square className="h-4 w-4" />
                    {"\u7ed3\u675f\u4f1a\u8bae"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={openMinutesWindow} disabled={!session?.minutes} className="gap-2 rounded-xl px-3">
                    <FileText className="h-4 w-4" />
                    {"\u67e5\u770b\u7eaa\u8981"}
                  </Button>
                </div>
                {summaryTask.running || reportTask.running ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {summaryTask.running ? (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                          <span>阶段总结</span>
                          <span>{Math.round(summaryTask.progress)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-sky-400 transition-all duration-500"
                            style={{ width: `${summaryTask.progress}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">{summaryTask.text}</div>
                      </div>
                    ) : null}
                    {reportTask.running ? (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                          <span>会议报告</span>
                          <span>{Math.round(reportTask.progress)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                            style={{ width: `${reportTask.progress}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">{reportTask.text}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeView === "overview" && (
              <Card className="flex h-full min-h-0 flex-col border-slate-800/80 bg-slate-950/70">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{"\u5b9e\u65f6\u9762\u677f"}</CardTitle>
                  <CardDescription>{"\u53ea\u4fdd\u7559\u5b9e\u65f6\u8f6c\u5199\u4e0e\u9636\u6bb5\u603b\u7ed3\uff0c\u7eaa\u8981\u901a\u8fc7\u5f39\u7a97\u67e5\u770b\u3002"}</CardDescription>
                </CardHeader>
                <CardContent className="min-h-0 flex-1">
                  <Tabs value={activeFocusTab} onValueChange={setActiveFocusTab} className="flex h-full min-h-0 flex-col">
                    <TabsList className="w-fit">
                      <TabsTrigger value="transcript">{"\u5b9e\u65f6\u8f6c\u5199"}</TabsTrigger>
                      <TabsTrigger value="summary">{"\u9636\u6bb5\u603b\u7ed3"}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="transcript" className="mt-3 min-h-0 flex-1">
                      <div className="panel-scroll h-full space-y-3 overflow-auto pr-2">
                        {!transcripts.length ? (
                          <div className="rounded-xl border border-dashed border-slate-800 p-5 text-sm text-slate-400">
                            {"\u4f1a\u8bae\u5f00\u59cb\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u5b9e\u65f6\u8f6c\u5199\u3002"}
                          </div>
                        ) : (
                          <>
                            {transcripts
                              .slice(-12)
                              .reverse()
                              .map((item, index) => (
                                <div key={item.timeLabel + "-" + index} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                                  <div className="mb-2 text-xs text-sky-300">{item.timeLabel}</div>
                                  <div className="text-sm leading-6 text-slate-200">{item.text}</div>
                                </div>
                              ))}
                          </>
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="summary" className="mt-3 min-h-0 flex-1">
                      <div className="panel-scroll h-full space-y-3 overflow-auto pr-2">
                        {!summaries.length ? (
                          <div className="rounded-xl border border-dashed border-slate-800 p-5 text-sm text-slate-400">
                            {"\u4f1a\u8bae\u8fdb\u884c\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u9636\u6bb5\u603b\u7ed3\u3002"}
                          </div>
                        ) : (
                          summaries
                            .slice()
                            .reverse()
                            .map((item, index) => (
                              <div key={item.timeLabel + "-" + index} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                                <div className="mb-2 text-xs text-sky-300">{"\u9636\u6bb5\u603b\u7ed3"} {summaries.length - index} {"\u00b7"} {item.timeLabel}</div>
                                <div className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{item.content}</div>
                              </div>
                            ))
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}

            {activeView === "history" && (
              <Card className="flex h-full min-h-0 flex-col border-slate-800/80 bg-slate-950/70">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-sm">{"\u5386\u53f2\u8bb0\u5f55"}</CardTitle>
                    <CardDescription>{"\u6700\u8fd1 50 \u573a\u4f1a\u8bae\uff0c\u70b9\u51fb\u5373\u53ef\u56de\u770b\u3002"}</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={reloadSessions}>
                    {"\u5237\u65b0"}
                  </Button>
                </CardHeader>
                <CardContent className="panel-scroll min-h-0 flex-1 overflow-auto pr-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{"\u6807\u9898"}</TableHead>
                        <TableHead>{"\u65f6\u95f4"}</TableHead>
                        <TableHead className="w-16 text-right">{"\u64cd\u4f5c"}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!sessions.length ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-slate-400">{"\u8fd8\u6ca1\u6709\u5386\u53f2\u4f1a\u8bae\u3002"}</TableCell>
                        </TableRow>
                      ) : (
                        sessions.map((item) => (
                          <TableRow key={item.id} className="cursor-pointer" onClick={() => loadSessionById(item.id)}>
                            <TableCell>{deriveSessionTitle(item.data || item)}</TableCell>
                            <TableCell>{item.startedAt ? new Date(item.startedAt).toLocaleString() : ""}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-300"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deleteSessionById(item.id);
                                }}
                                title="删除历史记录"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {activeView === "settings" && (
              <Card className="flex h-full min-h-0 flex-col border-slate-800/80 bg-slate-950/70">
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-sm">{"\u8bbe\u7f6e"}</CardTitle>
                    <CardDescription>{settingsSavedAtLabel ? "\u6700\u8fd1\u4fdd\u5b58\u4e8e " + settingsSavedAtLabel : "\u5f53\u524d\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58\u3002"}</CardDescription>
                  </div>
                  <Button size="sm" className="rounded-xl" onClick={() => saveConfig()}>
                    {"\u4fdd\u5b58\u914d\u7f6e"}
                  </Button>
                </CardHeader>
                <CardContent className="min-h-0 flex-1">
                  <Tabs defaultValue="stt" className="flex h-full min-h-0 flex-col">
                    <TabsList className="w-fit">
                      <TabsTrigger value="stt">{"\u8bed\u97f3\u8f6c\u5199"}</TabsTrigger>
                      <TabsTrigger value="llm">{"\u5927\u8bed\u8a00\u6a21\u578b"}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="stt" className="mt-3 min-h-0 flex-1">
                      <div className="panel-scroll h-full space-y-4 overflow-auto pr-2">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium text-slate-100">{"\u8bed\u97f3\u8f6c\u5199\u670d\u52a1"}</div>
                              <div className={"mt-1 text-sm " + (providerProbe.stt.tone === "error" ? "text-rose-300" : providerProbe.stt.tone === "ok" ? "text-emerald-300" : "text-slate-400")}>
                                {providerProbe.stt.text}
                              </div>
                            </div>
                            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => testProvider("stt")}>
                              {"\u6d4b\u8bd5"}
                            </Button>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label={"\u63a5\u53e3\u5730\u5740"}>
                              <Input value={formConfig.stt.baseUrl} onChange={(event) => updateForm("stt.baseUrl", event.target.value)} placeholder={"\u4f8b\u5982\uff1aws://f.axe3.cn:22395"} />
                            </Field>
                            <Field label={"\u6a21\u578b\u540d\u79f0"}>
                              <Input value={formConfig.stt.model} onChange={(event) => updateForm("stt.model", event.target.value)} placeholder={"\u4f8b\u5982\uff1afunasr-2pass"} />
                            </Field>
                            <Field label={"\u63a5\u53e3\u5bc6\u94a5"}>
                              <Input type="password" value={formConfig.stt.apiKey} onChange={(event) => updateForm("stt.apiKey", event.target.value)} placeholder={"\u53ef\u4e3a\u7a7a"} />
                            </Field>
                            <Field label={"\u8bc6\u522b\u8bed\u8a00"}>
                              <Input value={formConfig.stt.language} onChange={(event) => updateForm("stt.language", event.target.value)} placeholder={"\u4f8b\u5982\uff1azh"} />
                            </Field>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                          <div className="font-medium text-slate-100">{"\u5a92\u4f53\u8bca\u65ad"}</div>
                          <div className="mt-2 text-sm text-slate-400">{mediaProbeText}</div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="llm" className="mt-3 min-h-0 flex-1">
                      <div className="panel-scroll h-full space-y-4 overflow-auto pr-2">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium text-slate-100">{"\u5927\u8bed\u8a00\u6a21\u578b\u670d\u52a1"}</div>
                              <div className={"mt-1 text-sm " + (providerProbe.llm.tone === "error" ? "text-rose-300" : providerProbe.llm.tone === "ok" ? "text-emerald-300" : "text-slate-400")}>
                                {providerProbe.llm.text}
                              </div>
                            </div>
                            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => testProvider("llm")}>
                              {"\u6d4b\u8bd5"}
                            </Button>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label={"\u63a5\u53e3\u5730\u5740"}>
                              <Input value={formConfig.llm.baseUrl} onChange={(event) => updateForm("llm.baseUrl", event.target.value)} placeholder="https://api.example.com/v1" />
                            </Field>
                            <Field label={"\u6a21\u578b\u540d\u79f0"}>
                              <Input value={formConfig.llm.model} onChange={(event) => updateForm("llm.model", event.target.value)} placeholder={"\u4f8b\u5982\uff1aMiniMax-M2.5"} />
                            </Field>
                          </div>
                          <div className="mt-4">
                            <Field label={"\u63a5\u53e3\u5bc6\u94a5"}>
                              <Input type="password" value={formConfig.llm.apiKey} onChange={(event) => updateForm("llm.apiKey", event.target.value)} placeholder={"\u53ef\u4e3a\u7a7a"} />
                            </Field>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
