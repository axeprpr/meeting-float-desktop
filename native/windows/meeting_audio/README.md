# Windows Native Audio DLL

This folder contains the first scaffold for a Windows-native audio backend.

## Purpose

The target architecture is:

- Sciter JS UI
- native Windows DLL for audio capture and FunASR transport
- no localhost HTTP helper on the steady-state path

## Current Status

What exists now:

- `modules/recorder.js` already prefers a native bridge when `meetingAudioNative` is injected
- this folder contains a Rust `cdylib` scaffold and the intended JSON ABI

What is not implemented yet:

- WASAPI microphone capture
- WebSocket client to FunASR
- event callback bridge into Sciter
- Sciter plugin/host shim that injects `meetingAudioNative`

## Why a Shim Is Still Needed

Sciter JS cannot directly call an arbitrary Windows DLL from application script.
The intended bridge is:

1. `meeting_audio.dll` provides a plain C ABI
2. a thin Sciter-native extension or host shim loads that DLL
3. the shim injects `globalThis.meetingAudioNative`
4. `modules/recorder.js` uses that object instead of the localhost helper

## Expected JS Bridge Contract

The injected object should expose:

- `health(): object|string`
- `probe(configJson: string): object|string`
- `configure(configJson: string): object|string`
- `start(controlJson: string): object|string`
- `pause(): object|string`
- `resume(): object|string`
- `stop(): object|string`
- `setListener(callback: (payload) => void): void`

Event payloads sent through the listener should look like:

```json
{ "type": "status", "status": "recording", "text": "录音开始" }
{ "type": "preview", "text": "实时预览文本" }
{ "type": "final_transcript", "text": "最终转写文本" }
{ "type": "error", "text": "错误信息" }
```

## Next Windows Steps

1. Replace scaffolded `start()` with a real controller state machine
2. Add WASAPI capture on a background thread
3. Convert PCM to the FunASR input format expected by your server
4. Add direct WebSocket transport with explicit proxy bypass policy
5. Add a Sciter plugin shim that creates `meetingAudioNative`
