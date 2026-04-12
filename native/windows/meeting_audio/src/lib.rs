use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SampleRate, Stream, StreamConfig};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::ffi::{c_char, CStr, CString};
use std::net::TcpStream;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};
use url::Url;

const TARGET_SAMPLE_RATE: u32 = 16_000;
const BYTES_PER_SAMPLE: usize = 2;

static CONTROLLER: Lazy<Mutex<Controller>> = Lazy::new(|| Mutex::new(Controller::default()));

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
struct AudioState {
    status: String,
    paused: bool,
    funasr_url: String,
    last_error: String,
    backend: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
struct RecorderConfig {
    funasr_url: String,
    language: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
struct ControlRequest {
    chunk_seconds: u32,
}

#[derive(Default)]
struct Controller {
    state: AudioState,
    config: RecorderConfig,
    stop_tx: Option<Sender<()>>,
    worker: Option<JoinHandle<Result<(), String>>>,
}

struct CaptureStream {
    _stream: Stream,
}

struct ResamplerState {
    input_rate: u32,
    pending: Vec<f32>,
    cursor: f64,
}

impl ResamplerState {
    fn new(input_rate: u32) -> Self {
        Self {
            input_rate,
            pending: Vec::new(),
            cursor: 0.0,
        }
    }

    fn process(&mut self, mono_samples: &[f32]) -> Vec<i16> {
        if self.input_rate == TARGET_SAMPLE_RATE {
            return mono_samples.iter().copied().map(float_to_i16).collect();
        }

        self.pending.extend_from_slice(mono_samples);
        let mut output = Vec::new();
        let step = self.input_rate as f64 / TARGET_SAMPLE_RATE as f64;

        while self.cursor + 1.0 < self.pending.len() as f64 {
            let index = self.cursor.floor() as usize;
            let frac = (self.cursor - index as f64) as f32;
            let left = self.pending[index];
            let right = self.pending[index + 1];
            output.push(float_to_i16(left + (right - left) * frac));
            self.cursor += step;
        }

        let consumed = self.cursor.floor() as usize;
        if consumed > 0 {
            self.pending.drain(0..consumed);
            self.cursor -= consumed as f64;
        }

        output
    }
}

impl Controller {
    fn health_json(&self) -> *mut c_char {
        json_response(&self.state)
    }

    fn set_error(&mut self, message: impl Into<String>) {
        self.state.last_error = message.into();
        self.state.status = "idle".to_string();
        self.state.paused = false;
        self.state.backend = "native-dll".to_string();
    }
}

fn json_response<T: Serialize>(value: &T) -> *mut c_char {
    let payload =
        serde_json::to_string(value).unwrap_or_else(|_| "{\"error\":\"serialize failed\"}".to_string());
    CString::new(payload).unwrap().into_raw()
}

fn read_json<T: for<'a> Deserialize<'a> + Default>(input: *const c_char) -> T {
    if input.is_null() {
        return T::default();
    }

    let text = unsafe { CStr::from_ptr(input) };
    serde_json::from_str(text.to_str().unwrap_or_default()).unwrap_or_default()
}

fn float_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * i16::MAX as f32) as i16
}

fn encode_pcm(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * BYTES_PER_SAMPLE);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn downmix_to_mono_f32<T>(input: &[T], channels: usize, convert: impl Fn(&T) -> f32) -> Vec<f32> {
    let channel_count = channels.max(1);
    let mut mono = Vec::with_capacity(input.len() / channel_count.max(1));
    for frame in input.chunks(channel_count) {
        let sum = frame.iter().map(&convert).sum::<f32>();
        mono.push(sum / frame.len() as f32);
    }
    mono
}

fn feed_capture<T>(
    input: &[T],
    channels: usize,
    resampler: &Arc<Mutex<ResamplerState>>,
    audio_tx: &SyncSender<Vec<u8>>,
    convert: impl Fn(&T) -> f32,
) {
    if input.is_empty() {
        return;
    }

    let mono = downmix_to_mono_f32(input, channels, convert);
    let bytes = {
        let mut state = resampler.lock().unwrap();
        let pcm = state.process(&mono);
        encode_pcm(&pcm)
    };

    if !bytes.is_empty() {
        let _ = audio_tx.try_send(bytes);
    }
}

fn select_input_config(device: &cpal::Device) -> Result<(StreamConfig, SampleFormat), String> {
    if let Ok(configs) = device.supported_input_configs() {
        for range in configs {
            if range.min_sample_rate().0 <= TARGET_SAMPLE_RATE && range.max_sample_rate().0 >= TARGET_SAMPLE_RATE {
                let sample_format = range.sample_format();
                return Ok((range.with_sample_rate(SampleRate(TARGET_SAMPLE_RATE)).config(), sample_format));
            }
        }
    }

    let fallback = device
        .default_input_config()
        .map_err(|error| format!("default input config failed: {error}"))?;
    Ok((fallback.config(), fallback.sample_format()))
}

fn build_capture_stream(audio_tx: SyncSender<Vec<u8>>) -> Result<CaptureStream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no input device available".to_string())?;
    let (config, sample_format) = select_input_config(&device)?;
    let channels = config.channels as usize;
    let resampler = Arc::new(Mutex::new(ResamplerState::new(config.sample_rate.0)));
    let error_handler = |error| eprintln!("capture stream error: {error}");

    let stream = match sample_format {
        SampleFormat::I16 => {
            let tx = audio_tx.clone();
            let state = Arc::clone(&resampler);
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        feed_capture(data, channels, &state, &tx, |sample| *sample as f32 / i16::MAX as f32)
                    },
                    error_handler,
                    None,
                )
                .map_err(|error| format!("build input stream failed: {error}"))?
        }
        SampleFormat::U16 => {
            let tx = audio_tx.clone();
            let state = Arc::clone(&resampler);
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        feed_capture(data, channels, &state, &tx, |sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                    },
                    error_handler,
                    None,
                )
                .map_err(|error| format!("build input stream failed: {error}"))?
        }
        SampleFormat::F32 => {
            let tx = audio_tx;
            let state = Arc::clone(&resampler);
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _| feed_capture(data, channels, &state, &tx, |sample| *sample),
                    error_handler,
                    None,
                )
                .map_err(|error| format!("build input stream failed: {error}"))?
        }
        other => return Err(format!("unsupported sample format: {other:?}")),
    };

    stream
        .play()
        .map_err(|error| format!("start input stream failed: {error}"))?;

    Ok(CaptureStream { _stream: stream })
}

fn send_ws_config(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>, is_speaking: bool) -> Result<(), String> {
    let config = json!({
        "mode": "2pass",
        "chunk_size": [8, 8, 4],
        "chunk_interval": 10,
        "encoder_chunk_look_back": 4,
        "decoder_chunk_look_back": 0,
        "audio_fs": TARGET_SAMPLE_RATE,
        "wav_name": "meeting-audio-native",
        "is_speaking": is_speaking,
        "itn": true
    });

    socket
        .send(Message::Text(config.to_string().into()))
        .map_err(|error| format!("websocket init failed: {error}"))
}

fn set_socket_timeouts(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>) {
    if let MaybeTlsStream::Plain(stream) = socket.get_mut() {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(50)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    }
}

fn read_ws_messages(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>) -> Result<(), String> {
    loop {
        match socket.read() {
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Ok(());
            }
            Err(tungstenite::Error::ConnectionClosed) | Err(tungstenite::Error::AlreadyClosed) => {
                return Ok(());
            }
            Err(error) => return Err(format!("websocket read failed: {error}")),
        }
    }
}

fn connect_ws(raw_url: &str) -> Result<(), String> {
    let url = Url::parse(raw_url).map_err(|error| format!("invalid websocket url: {error}"))?;
    let (mut socket, _) = connect(url.as_str()).map_err(|error| format!("websocket connect failed: {error}"))?;
    send_ws_config(&mut socket, true)?;
    socket
        .close(None)
        .map_err(|error| format!("websocket close failed: {error}"))?;
    Ok(())
}

fn worker_loop(
    url: String,
    chunk_bytes: usize,
    startup_tx: SyncSender<Result<(), String>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("invalid websocket url: {error}"))?;
    let (mut socket, _) =
        connect(parsed.as_str()).map_err(|error| format!("websocket connect failed: {error}"))?;
    set_socket_timeouts(&mut socket);
    send_ws_config(&mut socket, true)?;

    let (audio_tx, audio_rx) = mpsc::sync_channel::<Vec<u8>>(64);
    let _capture = build_capture_stream(audio_tx)?;
    let _ = startup_tx.send(Ok(()));

    let mut buffer = Vec::new();
    loop {
        if stop_rx.try_recv().is_ok() {
            if !buffer.is_empty() {
                let packet = std::mem::take(&mut buffer);
                let _ = socket.send(Message::Binary(packet.into()));
            }
            let _ = socket.send(Message::Text("{\"is_speaking\":false}".into()));
            thread::sleep(Duration::from_millis(300));
            let _ = socket.close(None);
            return Ok(());
        }

        match audio_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(data) => {
                buffer.extend_from_slice(&data);
                while buffer.len() >= chunk_bytes {
                    let packet = buffer.drain(..chunk_bytes).collect::<Vec<u8>>();
                    socket
                        .send(Message::Binary(packet.into()))
                        .map_err(|error| format!("websocket send failed: {error}"))?;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("audio capture stream disconnected".to_string()),
        }

        read_ws_messages(&mut socket)?;
    }
}

#[no_mangle]
pub extern "system" fn meeting_audio_health() -> *mut c_char {
    CONTROLLER.lock().unwrap().health_json()
}

#[no_mangle]
pub extern "system" fn meeting_audio_configure(config_json: *const c_char) -> *mut c_char {
    let config: RecorderConfig = read_json(config_json);
    let mut controller = CONTROLLER.lock().unwrap();
    controller.config = config.clone();
    controller.state.funasr_url = config.funasr_url;
    controller.state.backend = "native-dll".to_string();
    controller.state.last_error.clear();
    json_response(&controller.state)
}

#[no_mangle]
pub extern "system" fn meeting_audio_probe(config_json: *const c_char) -> *mut c_char {
    let config: RecorderConfig = read_json(config_json);
    let target = if config.funasr_url.is_empty() {
        let controller = CONTROLLER.lock().unwrap();
        controller.config.funasr_url.clone()
    } else {
        config.funasr_url
    };

    match connect_ws(&target) {
        Ok(()) => json_response(&json!({
            "ok": true,
            "backend": "native-dll",
            "message": "websocket probe ok"
        })),
        Err(error) => json_response(&json!({
            "ok": false,
            "backend": "native-dll",
            "message": error
        })),
    }
}

#[no_mangle]
pub extern "system" fn meeting_audio_start(control_json: *const c_char) -> *mut c_char {
    let control: ControlRequest = read_json(control_json);
    let mut controller = CONTROLLER.lock().unwrap();

    if controller.state.status == "recording" {
        return json_response(&json!({
            "ok": true,
            "status": controller.state.status,
            "backend": "native-dll"
        }));
    }

    if controller.config.funasr_url.is_empty() {
        controller.set_error("funasr_url is not configured");
        return json_response(&json!({
            "error": controller.state.last_error,
            "status": controller.state.status,
            "backend": "native-dll"
        }));
    }

    let chunk_seconds = control.chunk_seconds.max(1) as usize;
    let chunk_bytes = TARGET_SAMPLE_RATE as usize * BYTES_PER_SAMPLE * chunk_seconds;
    let (stop_tx, stop_rx) = mpsc::channel();
    let (startup_tx, startup_rx) = mpsc::sync_channel(1);
    let url = controller.config.funasr_url.clone();

    let handle = thread::spawn(move || worker_loop(url, chunk_bytes, startup_tx, stop_rx));
    match startup_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => {
            controller.state.status = "recording".to_string();
            controller.state.paused = false;
            controller.state.last_error.clear();
            controller.state.backend = "native-dll".to_string();
            controller.stop_tx = Some(stop_tx);
            controller.worker = Some(handle);

            json_response(&json!({
                "ok": true,
                "status": controller.state.status,
                "backend": "native-dll",
                "chunk_bytes": chunk_bytes
            }))
        }
        Ok(Err(error)) => {
            let _ = handle.join();
            controller.set_error(error);
            json_response(&json!({
                "error": controller.state.last_error,
                "status": controller.state.status,
                "backend": "native-dll"
            }))
        }
        Err(_) => {
            let _ = stop_tx.send(());
            let _ = handle.join();
            controller.set_error("startup timed out");
            json_response(&json!({
                "error": controller.state.last_error,
                "status": controller.state.status,
                "backend": "native-dll"
            }))
        }
    }
}

#[no_mangle]
pub extern "system" fn meeting_audio_pause() -> *mut c_char {
    let mut controller = CONTROLLER.lock().unwrap();
    controller.state.paused = true;
    controller.state.status = "paused".to_string();
    json_response(&json!({
        "ok": true,
        "status": controller.state.status,
        "backend": "native-dll"
    }))
}

#[no_mangle]
pub extern "system" fn meeting_audio_resume() -> *mut c_char {
    let mut controller = CONTROLLER.lock().unwrap();
    controller.state.paused = false;
    controller.state.status = "recording".to_string();
    json_response(&json!({
        "ok": true,
        "status": controller.state.status,
        "backend": "native-dll"
    }))
}

#[no_mangle]
pub extern "system" fn meeting_audio_stop() -> *mut c_char {
    let mut controller = CONTROLLER.lock().unwrap();

    if let Some(tx) = controller.stop_tx.take() {
        let _ = tx.send(());
    }

    if let Some(handle) = controller.worker.take() {
        match handle.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => controller.set_error(error),
            Err(_) => controller.set_error("worker thread panicked"),
        }
    }

    controller.state.status = "idle".to_string();
    controller.state.paused = false;
    json_response(&json!({
        "ok": true,
        "status": controller.state.status,
        "last_error": controller.state.last_error,
        "backend": "native-dll"
    }))
}

#[no_mangle]
pub extern "system" fn meeting_audio_free_string(value: *mut c_char) {
    if value.is_null() {
        return;
    }

    unsafe {
        let _ = CString::from_raw(value);
    }
}
