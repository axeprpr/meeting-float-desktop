function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { text: raw };
    }
  }
  return raw;
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate >= inputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index += 1) {
      accum += buffer[index];
      count += 1;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function computeChunkBytes(chunkSize = "8,8,4", chunkInterval = 10) {
  const parts = String(chunkSize).split(",");
  const middle = Number(parts[1] || 8) || 8;
  const ms = Math.max(48, Math.floor((60 * middle) / Math.max(chunkInterval, 1)));
  return Math.floor((16000 * 2 * ms) / 1000);
}

export class MeetingRecorder {
  constructor() {
    this.backend = "electron-media";
    this.running = false;
    this.paused = false;
    this.socket = null;
    this.stream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.bufferQueue = [];
    this.bufferBytes = 0;
    this.chunkBytes = computeChunkBytes();
    this.chunkInterval = 10;
    this.chunkSize = "8,8,4";
    this.sttConfig = null;
    this.onTranscript = null;
    this.onPreview = null;
    this.onEvent = null;
  }

  emitEvent(payload) {
    this.onEvent?.(payload);
  }

  async health() {
    return {
      status: this.running ? "recording" : this.paused ? "paused" : "idle",
      paused: this.paused,
      backend: this.backend,
      last_error: "",
    };
  }

  async probe(sttConfig) {
    if (!sttConfig?.baseUrl) {
      return {
        ok: false,
        modelFound: false,
        message: "未配置转写服务地址",
      };
    }

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(sttConfig.baseUrl, ["binary"]);
      const timer = window.setTimeout(() => {
        socket.close();
        reject(new Error("连接超时"));
      }, 5000);

      socket.onopen = () => {
        clearTimeout(timer);
        socket.close();
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法连接转写服务"));
      };
    });

    return {
      ok: true,
      modelFound: true,
      message: "转写服务连接正常",
    };
  }

  async configure(sttConfig) {
    this.sttConfig = sttConfig;
    return {
      ok: true,
      message: "录音配置已更新",
    };
  }

  isPaused() {
    return this.paused;
  }

  async start(chunkSeconds, onTranscript, onPreview, onEvent) {
    if (!this.sttConfig?.baseUrl) {
      throw new Error("转写服务地址未配置");
    }

    this.onTranscript = onTranscript;
    this.onPreview = onPreview;
    this.onEvent = onEvent;
    this.chunkSeconds = chunkSeconds;
    this.chunkBytes = computeChunkBytes(this.chunkSize, this.chunkInterval);
    this.bufferQueue = [];
    this.bufferBytes = 0;

    await this.openSocket();
    await this.openMedia();

    this.running = true;
    this.paused = false;
    this.emitEvent({ type: "status", status: "recording", text: "录音已开始" });
  }

  async pause() {
    if (!this.running && !this.paused) return;
    await this.stopInternal(false);
    this.running = false;
    this.paused = true;
    this.emitEvent({ type: "status", status: "paused", text: "录音已暂停" });
  }

  async resume() {
    if (!this.paused) return;
    await this.start(this.chunkSeconds, this.onTranscript, this.onPreview, this.onEvent);
  }

  async stop() {
    await this.stopInternal(true);
    this.running = false;
    this.paused = false;
    this.emitEvent({ type: "status", status: "idle", text: "录音已结束" });
  }

  async stopInternal(finalize) {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    if (this.socket) {
      if (finalize && this.bufferBytes > 0) {
        this.flushBuffer(false);
      }
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ is_speaking: false }));
      }
      this.socket.close();
      this.socket = null;
    }

    this.onPreview?.("");
    this.bufferQueue = [];
    this.bufferBytes = 0;
  }

  async openSocket() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.sttConfig.baseUrl, ["binary"]);
      socket.binaryType = "arraybuffer";

      const timer = window.setTimeout(() => {
        socket.close();
        reject(new Error("连接转写服务超时"));
      }, 10000);

      socket.onopen = () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.send(
          JSON.stringify({
            mode: "2pass",
            chunk_size: [8, 8, 4],
            chunk_interval: this.chunkInterval,
            encoder_chunk_look_back: 4,
            decoder_chunk_look_back: 0,
            audio_fs: 16000,
            wav_name: "meeting-assistant",
            is_speaking: true,
            itn: true,
          })
        );
        resolve();
      };

      socket.onmessage = async (event) => {
        const payload = parsePayload(event.data);
        const mode = String(payload.mode || "");
        const text = String(payload.text || "").trim();
        if (!text) return;

        if (mode.includes("offline")) {
          await this.onTranscript?.(text, payload);
          this.onPreview?.("");
          return;
        }

        this.onPreview?.(text, payload);
      };

      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法连接转写服务"));
      };

      socket.onclose = () => {
        if (this.running) {
          this.running = false;
          this.paused = false;
          this.emitEvent({ type: "error", text: "转写服务连接已断开" });
        }
      };
    });
  }

  async openMedia() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

      const channelData = event.inputBuffer.getChannelData(0);
      const resampled = downsampleBuffer(channelData, this.audioContext.sampleRate, 16000);
      const pcmBytes = floatTo16BitPCM(resampled);
      this.enqueueBytes(pcmBytes);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  enqueueBytes(bytes) {
    this.bufferQueue.push(bytes);
    this.bufferBytes += bytes.byteLength;

    while (this.bufferBytes >= this.chunkBytes) {
      this.flushBuffer(true);
    }
  }

  flushBuffer(exactChunk) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.bufferBytes <= 0) {
      return;
    }

    const targetSize = exactChunk ? this.chunkBytes : this.bufferBytes;
    const packet = new Uint8Array(targetSize);
    let offset = 0;

    while (offset < targetSize && this.bufferQueue.length > 0) {
      const current = this.bufferQueue[0];
      const copyLength = Math.min(current.byteLength, targetSize - offset);
      packet.set(current.slice(0, copyLength), offset);
      offset += copyLength;

      if (copyLength === current.byteLength) {
        this.bufferQueue.shift();
      } else {
        this.bufferQueue[0] = current.slice(copyLength);
      }
    }

    this.bufferBytes -= targetSize;
    this.socket.send(packet.buffer);
  }
}
