const DEFAULT_CONFIG = {
  meetingTitle: "",
  exportDir: "",
  stt: {
    baseUrl: "",
    apiKey: "",
    model: "whisper-1",
    language: "zh",
  },
  llm: {
    baseUrl: "",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  chunkSeconds: 20,
  summaryIntervalMinutes: 10,
  systemPrompt:
    "你是一个严谨的会议助手，需要输出清晰、简洁、结构化的中文内容。",
  summaryPrompt:
    "请基于新增会议内容，输出阶段性总结，包含：当前议题、关键结论、未决事项、需要跟进的人和动作。",
  minutesPrompt:
    "请将完整会议内容整理成正式会议纪要，包含：会议主题、核心结论、决策事项、待办事项、风险与阻塞、下一步安排。",
};

const KEY_CONFIG = "meeting-float:config";
const KEY_SESSIONS = "meeting-float:sessions";
const memoryStore = {};

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStore[key] ?? null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryStore[key] = value;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadJson(key, fallback) {
  const raw = safeGet(key);
  if (!raw) return clone(fallback);

  try {
    return JSON.parse(raw);
  } catch {
    return clone(fallback);
  }
}

function saveJson(key, value) {
  safeSet(key, JSON.stringify(value));
}

export class AppStore {
  constructor() {
    this.config = loadJson(KEY_CONFIG, DEFAULT_CONFIG);
    this.sessions = loadJson(KEY_SESSIONS, []);
  }

  getConfig() {
    return clone(this.config);
  }

  saveConfig(config) {
    this.config = clone(config);
    saveJson(KEY_CONFIG, this.config);
  }

  listSessions() {
    return clone(this.sessions);
  }

  getSession(sessionId) {
    const found = this.sessions.find((item) => item.id === sessionId);
    return found ? clone(found) : null;
  }

  saveSession(session) {
    const summary = this.buildSessionSummary(session);

    const index = this.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      this.sessions[index] = summary;
    } else {
      this.sessions.unshift(summary);
    }

    this.sessions = this.sessions.slice(0, 50);
    saveJson(KEY_SESSIONS, this.sessions);
  }

  renameSession(sessionId, title) {
    const index = this.sessions.findIndex((item) => item.id === sessionId);
    if (index < 0) return null;

    this.sessions[index].title = title;
    if (this.sessions[index].data) {
      this.sessions[index].data.title = title;
    }
    saveJson(KEY_SESSIONS, this.sessions);
    return clone(this.sessions[index]);
  }

  deleteSession(sessionId) {
    const index = this.sessions.findIndex((item) => item.id === sessionId);
    if (index < 0) return false;

    this.sessions.splice(index, 1);
    saveJson(KEY_SESSIONS, this.sessions);
    return true;
  }

  exportMinutes(session) {
    return this.buildMarkdown(session);
  }

  buildSessionSummary(session) {
    return {
      id: session.id,
      title: session.title,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      transcriptCount: session.transcript.length,
      summaryCount: session.summaries.length,
      hasMinutes: Boolean(session.minutes),
      data: clone(session),
    };
  }

  buildMarkdown(session) {
    const transcriptLines = session.transcript
      .map((segment) => `- [${segment.timeLabel}] ${segment.text}`)
      .join("\n");

    const summaryLines = session.summaries
      .map(
        (item, index) =>
          `### 阶段总结 ${index + 1} (${item.timeLabel})\n${item.content}`
      )
      .join("\n\n");

    return [
      `# ${session.title || "未命名会议"}`,
      "",
      `- 开始时间: ${session.startedAtLabel}`,
      `- 结束时间: ${session.endedAtLabel || "进行中"}`,
      `- 状态: ${session.status}`,
      "",
      "## 实时记录",
      transcriptLines || "- 暂无转写内容",
      "",
      "## 阶段总结",
      summaryLines || "暂无阶段总结",
      "",
      "## 会议纪要",
      session.minutes || "暂无会议纪要",
      "",
    ].join("\n");
  }
}

export function buildDefaultSession(title) {
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
