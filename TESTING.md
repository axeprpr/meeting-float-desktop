# Testing Notes

## Basic Checks

- Start the app with `npm run dev` or `npm start`
- Verify microphone permission prompt appears
- Verify tray minimize and restore
- Verify settings save and reload
- Verify mock flow can generate transcript, summaries, and minutes
- Verify history sessions can be reopened
- Verify minutes window opens correctly

## Build Check

```bash
npm run build
```

## Packaging Check

```bash
npm run pack
```

```bash
npm run dist:win
```

## Current Limits

- Real-time STT requires a reachable FunASR-compatible WebSocket endpoint
- LLM summary/minutes/title features require a reachable OpenAI-compatible endpoint
- Windows distribution now uses `electron-builder`
