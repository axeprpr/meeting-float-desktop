function preferredMimeType() {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  for (const value of options) {
    if (globalThis.MediaRecorder?.isTypeSupported?.(value)) {
      return value;
    }
  }
  return "";
}

export class MeetingRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.onChunk = null;
  }

  async start(chunkSeconds, onChunk) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前 Sciter 运行环境不支持麦克风采集");
    }

    if (!globalThis.MediaRecorder) {
      throw new Error("当前 Sciter 运行环境不支持 MediaRecorder");
    }

    this.onChunk = onChunk;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const mimeType = preferredMimeType();
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream);

    this.recorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size <= 0) return;
      await this.onChunk?.(event.data);
    };

    this.recorder.start(chunkSeconds * 1000);
  }

  pause() {
    if (this.recorder?.state === "recording") {
      this.recorder.pause();
    }
  }

  resume() {
    if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }
  }

  async stop() {
    await new Promise((resolve) => {
      if (!this.recorder) {
        resolve();
        return;
      }

      const recorder = this.recorder;
      recorder.onstop = resolve;
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        resolve();
      }
    });

    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }

  isPaused() {
    return this.recorder?.state === "paused";
  }

  isRunning() {
    return this.recorder?.state === "recording" || this.recorder?.state === "paused";
  }
}
