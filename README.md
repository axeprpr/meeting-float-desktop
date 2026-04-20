# Meeting Float Desktop

中文说明见：[README.zh-CN.md](./README.zh-CN.md)

## OSS Downloads

Release assets are mirrored to OSS by GitHub Actions on each `v*` tag.
New builds use lowercase kebab-case artifact names.

- Latest channel `latest.yml`: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/latest/latest.yml`
- Version channel example (`v0.2.0`) setup: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/meeting-float-desktop-0.2.0-setup.exe`
- Version channel example (`v0.2.0`) portable: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/meeting-float-desktop-0.2.0-portable.exe`
- Version channel example (`v0.2.0`) blockmap: `https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/meeting-float-desktop-0.2.0-setup.exe.blockmap`
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
