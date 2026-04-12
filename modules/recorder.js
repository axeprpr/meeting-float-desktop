function parseNativePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return { value: payload };
    }
  }
  return payload;
}

function createXcallNativeBridge() {
  const root = document?.documentElement;
  if (!root || typeof root.xcall !== "function") return null;

  const invoke = (name, payload) => {
    if (payload === undefined) {
      return root.xcall(name);
    }
    return root.xcall(name, payload);
  };

  return {
    health() {
      return invoke("meetingAudioHealth");
    },
    configure(payload) {
      return invoke("meetingAudioConfigure", payload);
    },
    probe(payload) {
      return invoke("meetingAudioProbe", payload);
    },
    start(payload) {
      return invoke("meetingAudioStart", payload);
    },
    pause() {
      return invoke("meetingAudioPause");
    },
    resume() {
      return invoke("meetingAudioResume");
    },
    stop() {
      return invoke("meetingAudioStop");
    },
    setListener() {},
  };
}

function getNativeBridge() {
  const bridge =
    globalThis.meetingAudioNative ||
    globalThis.MeetingAudioNative ||
    globalThis.__MEETING_AUDIO_NATIVE__;

  if (bridge && typeof bridge === "object") {
    return bridge;
  }

  return createXcallNativeBridge();
}

class NativeMeetingRecorder {
  constructor(nativeBridge) {
    this.native = nativeBridge;
    this.running = false;
    this.paused = false;
    this.sttConfig = null;
    this.backend = "native";
    this.onTranscript = null;
    this.onPreview = null;
    this.onEvent = null;
    this.boundListener = (payload) => this.handleNativeEvent(payload);
    this.native.setListener?.(this.boundListener);
  }

  decodeResult(payload) {
    return parseNativePayload(payload);
  }

  async health() {
    const result = this.decodeResult(await this.native.health?.());
    return {
      status: result.status || (this.running ? "recording" : "idle"),
      paused: Boolean(result.paused ?? this.paused),
      last_error: result.last_error || "",
      backend: "native",
    };
  }

  async probe(sttConfig) {
    return this.decodeResult(
      await this.native.probe?.(
        JSON.stringify({
          funasr_url: sttConfig.baseUrl,
          language: sttConfig.language || "zh",
        })
      )
    );
  }

  async configure(sttConfig) {
    this.sttConfig = sttConfig;
    return this.decodeResult(
      await this.native.configure?.(
        JSON.stringify({
          funasr_url: sttConfig.baseUrl,
          language: sttConfig.language || "zh",
        })
      )
    );
  }

  async start(chunkSeconds, onTranscript, onPreview, onEvent) {
    if (!this.sttConfig?.baseUrl) {
      throw new Error("转写服务地址未配置");
    }

    this.onTranscript = onTranscript;
    this.onPreview = onPreview;
    this.onEvent = onEvent;
    await this.configure(this.sttConfig);

    const result = this.decodeResult(
      await this.native.start?.(
        JSON.stringify({
          chunk_seconds: chunkSeconds,
        })
      )
    );

    if (result?.error) {
      throw new Error(result.error);
    }

    this.running = true;
    this.paused = false;
  }

  async pause() {
    const result = this.decodeResult(await this.native.pause?.());
    if (result?.error) {
      throw new Error(result.error);
    }
    this.paused = true;
  }

  async resume() {
    const result = this.decodeResult(await this.native.resume?.());
    if (result?.error) {
      throw new Error(result.error);
    }
    this.paused = false;
    this.running = true;
  }

  async stop() {
    const result = this.decodeResult(await this.native.stop?.());
    if (result?.error) {
      throw new Error(result.error);
    }
    this.running = false;
    this.paused = false;
  }

  isPaused() {
    return this.paused;
  }

  isRunning() {
    return this.running || this.paused;
  }

  async handleNativeEvent(payload) {
    const item = this.decodeResult(payload);
    if (!item?.type) return;

    if (item.type === "preview") {
      this.onPreview?.(item.text || "", item);
      return;
    }

    if (item.type === "final_transcript" && item.text) {
      await this.onTranscript?.(item.text, item);
      return;
    }

    if (item.type === "status") {
      if (item.status === "recording") {
        this.running = true;
        this.paused = false;
      } else if (item.status === "paused") {
        this.running = false;
        this.paused = true;
      } else if (item.status === "idle" || item.status === "stopped") {
        this.running = false;
        this.paused = false;
      }
    }

    if (item.type === "error") {
      this.running = false;
      this.paused = false;
    }

    this.onEvent?.(item);
  }
}

export function createMeetingRecorder() {
  const nativeBridge = getNativeBridge();
  if (!nativeBridge) {
    throw new Error("native recorder bridge is unavailable");
  }
  return new NativeMeetingRecorder(nativeBridge);
}
