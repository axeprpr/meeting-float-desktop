const HELPER_URL = "http://127.0.0.1:17995";

async function parseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("本地录音助手返回了无法识别的数据");
  }
}

export class MeetingRecorder {
  constructor() {
    this.eventCursor = 0;
    this.pollHandle = null;
    this.onTranscript = null;
    this.onPreview = null;
    this.onEvent = null;
    this.running = false;
    this.paused = false;
    this.sttConfig = null;
  }

  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${HELPER_URL}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        ...options,
      });
    } catch (error) {
      throw new Error("本地录音助手未启动");
    }

    const payload = await parseJson(response);
    if (!response.ok) {
      throw new Error(payload.error || "本地录音助手请求失败");
    }
    return payload;
  }

  async health() {
    return this.request("/health");
  }

  async probe(sttConfig) {
    return this.request("/probe", {
      method: "POST",
      body: JSON.stringify({
        funasr_url: sttConfig.baseUrl,
        language: sttConfig.language || "zh",
      }),
    });
  }

  async configure(sttConfig) {
    this.sttConfig = sttConfig;
    return this.request("/config", {
      method: "POST",
      body: JSON.stringify({
        funasr_url: sttConfig.baseUrl,
        language: sttConfig.language || "zh",
      }),
    });
  }

  async start(chunkSeconds, onTranscript, onPreview, onEvent) {
    if (!this.sttConfig?.baseUrl) {
      throw new Error("转写服务地址未配置");
    }

    this.onTranscript = onTranscript;
    this.onPreview = onPreview;
    this.onEvent = onEvent;
    await this.configure(this.sttConfig);
    await this.request("/record/start", {
      method: "POST",
      body: JSON.stringify({ chunk_seconds: chunkSeconds }),
    });
    this.running = true;
    this.paused = false;
    this.startPolling();
  }

  async pause() {
    await this.request("/record/pause", { method: "POST", body: "{}" });
    this.paused = true;
  }

  async resume() {
    await this.request("/record/resume", {
      method: "POST",
      body: JSON.stringify({ chunk_seconds: 0 }),
    });
    this.paused = false;
    this.running = true;
    this.startPolling();
  }

  async stop() {
    if (!this.running && !this.paused) return;
    await this.request("/record/stop", { method: "POST", body: "{}" });
    await this.pollEvents();
    this.stopPolling();
    this.running = false;
    this.paused = false;
  }

  isPaused() {
    return this.paused;
  }

  isRunning() {
    return this.running || this.paused;
  }

  startPolling() {
    this.stopPolling();
    this.pollHandle = setInterval(() => {
      this.pollEvents().catch(() => {});
    }, 300);
    this.pollEvents().catch(() => {});
  }

  stopPolling() {
    clearInterval(this.pollHandle);
    this.pollHandle = null;
  }

  async pollEvents() {
    const payload = await this.request(`/events?since=${this.eventCursor}`);
    this.eventCursor = payload.next_seq || this.eventCursor;
    const events = payload.events || [];

    for (const item of events) {
      if (item.type === "final_transcript" && item.text) {
        await this.onTranscript?.(item.text, item);
      } else if (item.type === "preview") {
        this.onPreview?.(item.text || "", item);
      } else {
        this.onEvent?.(item);
      }
    }
  }
}
