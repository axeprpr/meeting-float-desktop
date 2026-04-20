# Meeting Float Desktop

Electron + React desktop meeting assistant with tray support, configurable STT/LLM backends, periodic summaries, and meeting minutes generation.

## Current Architecture

- `Electron` main process for window management, tray, persistence, and child windows
- `React` renderer for the main window and minutes window
- `shadcn/ui` component structure on top of Tailwind CSS
- Browser audio capture in renderer, with direct WebSocket transport to FunASR-compatible STT
- OpenAI-compatible LLM endpoints for summaries, minutes, and title generation

## Main Features

- Floating desktop window with tray minimize
- Start, pause, resume, and stop meeting recording
- Sentence-level transcript rendering
- Periodic summary generation
- Asynchronous summary/report generation with progress feedback
- Session history persistence
- Mock mode and local autotest flow

## Project Structure

- `electron/`: Electron main process and preload bridge
- `src/`: React renderer, UI components, services, shared defaults
- `index.html`: main renderer entry
- `minutes.html`: minutes window entry
- `vite.config.js`: Vite build config

## Local Development

Install dependencies:

```bash
npm install
```

Run development mode:

```bash
npm run dev
```

Build renderer:

```bash
npm run build
```

Build distributable Electron packages for Windows:

```bash
npm run dist:win
```

## OSS Downloads

Release assets are mirrored to OSS by GitHub Actions on each `v*` tag.

- Latest channel `latest.yml`: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/latest/latest.yml`
- Version channel example (`v0.2.0`) setup: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/Meeting.Float.Desktop-0.2.0-setup.exe`
- Version channel example (`v0.2.0`) portable: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/Meeting.Float.Desktop-0.2.0-portable.exe`
- Version channel example (`v0.2.0`) blockmap: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/Meeting.Float.Desktop-0.2.0-setup.exe.blockmap`
- Version channel example (`v0.2.0`) metadata: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/latest.yml`

Required repository secrets for OSS upload:

- `ALIYUN_OSS_ENDPOINT`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_PREFIX` (optional, e.g. `claw`)

Create an unpacked app directory only:

```bash
npm run pack
```

Run Electron directly:

```bash
npm start
```

## Notes

- The old Sciter, Go helper, Rust audio, and legacy NSIS packaging chain has been removed.
- Current persistence is file-based through the Electron main process store.
- Real recording depends on microphone permission and an available FunASR-compatible WebSocket service.
- Electron distribution is now handled by `electron-builder`, with Windows `nsis` and `portable` targets.
