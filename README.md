# Meeting Float

English

Meeting Float is a lightweight cross-platform meeting assistant built with Sciter JS.
It is designed as a small floating desktop window with tray support, configurable STT/LLM backends, periodic summaries, and meeting minutes generation.

Current status:

- Floating Sciter desktop UI
- Mock flow for transcript, summary, and minutes
- Configurable OpenAI-compatible STT / LLM endpoints
- Windows packaging assets and NSIS installer script
- Windows portable package and installer build path

Current limitations:

- Real recording is not finished yet
- The current tested Sciter runtime on Linux does not expose `getUserMedia` or `MediaRecorder`
- Export currently copies minutes to clipboard instead of writing a file
- Session persistence currently uses `localStorage` with in-memory fallback

Project structure:

- `index.htm`: main app entry
- `autotest.htm`: mock autotest entry
- `app.js`: app controller
- `app.css`: UI styles
- `modules/`: storage, recorder, API clients
- `windows/installer.nsi`: NSIS installer
- `windows/build-win-dist.sh`: Windows distribution builder

Run locally:

```bash
./start.sh
```

Run mock autotest:

```bash
./autotest.sh
```

Build Windows distribution:

```bash
./windows/build-win-dist.sh
```

Build Windows distribution with a specific version:

```bash
APP_VERSION=0.1.1 ./windows/build-win-dist.sh
```

Build NSIS installer:

```bash
cd windows
makensis installer.nsi
```

GitHub Actions:

- Push to `main` will build the Windows portable package and NSIS installer, then upload them as workflow artifacts.
- Tag like `v0.1.0` will also publish those artifacts to a GitHub Release.
- Tag version must match `package.json` version.

Chinese

Meeting Float 是一个基于 Sciter JS 的轻量会议助手，目标形态是小型悬浮窗桌面程序，支持托盘、可配置语音转文字模型、可配置大语言模型、阶段性总结和会议纪要生成。

当前进度：

- 已完成悬浮窗界面
- 已完成 mock 联调流程
- 已完成 OpenAI 兼容 STT / LLM 接口配置
- 已补齐 Windows 打包脚本
- 已补齐 NSIS 安装脚本

当前限制：

- 真实录音链路还没有完成
- 当前在 Linux 上实测的 Sciter runtime 不提供 `getUserMedia` 和 `MediaRecorder`
- 纪要导出目前是复制到剪贴板，不是写文件
- 会话持久化目前使用 `localStorage`，并带内存兜底

目录说明：

- `index.htm`：正式入口
- `autotest.htm`：mock 自动联调入口
- `app.js`：主流程控制
- `app.css`：界面样式
- `modules/`：存储、录音、模型接口
- `windows/installer.nsi`：NSIS 安装脚本
- `windows/build-win-dist.sh`：Windows 分发目录构建脚本

本地运行：

```bash
./start.sh
```

本地 mock 联调：

```bash
./autotest.sh
```

构建 Windows 分发目录：

```bash
./windows/build-win-dist.sh
```

按指定版本构建 Windows 分发目录：

```bash
APP_VERSION=0.1.1 ./windows/build-win-dist.sh
```

构建 NSIS 安装包：

```bash
cd windows
makensis installer.nsi
```

GitHub Actions：

- 推送到 `main` 会自动构建 Windows 便携包和 NSIS 安装包，并上传为 workflow artifacts。
- 打 `v0.1.0` 这类 tag 时，还会自动发布到 GitHub Release。
- tag 版本必须与 `package.json` 里的版本一致。
