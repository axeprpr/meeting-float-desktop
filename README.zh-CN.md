# Meeting Float Desktop（中文说明）

## OSS 下载

每次推送 `v*` 标签后，GitHub Actions 会自动把发布产物同步到 OSS。  
新版本产物文件名使用小写中划线（kebab-case）格式。

- 最新通道 `latest.yml`：`https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/latest/latest.yml`
- 版本示例（`v0.2.0`）安装包：`https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/meeting-float-desktop-0.2.0-setup.exe`
- 版本示例（`v0.2.0`）便携包：`https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/meeting-float-desktop-0.2.0-portable.exe`
- 版本示例（`v0.2.0`）增量描述：`https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/meeting-float-desktop-0.2.0-setup.exe.blockmap`
- 版本示例（`v0.2.0`）元数据：`https://xuyayun.oss-cn-hangzhou.aliyuncs.com/claw/meeting-float-desktop/v0.2.0/latest.yml`

## OSS 上传所需仓库 Secrets

- `ALIYUN_OSS_ENDPOINT`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_PREFIX`（可选，例如 `claw`）

仅生成未安装目录：

```bash
npm run pack
```

直接启动 Electron：

```bash
npm start
```

## 备注

- 旧版 Sciter、Go helper、Rust 音频链路和历史 NSIS 打包流程已移除。
- 当前数据持久化由 Electron 主进程文件存储完成。
- 真实录音依赖麦克风权限和可用的 FunASR WebSocket 服务。
- 当前发行由 `electron-builder` 负责，Windows 目标为 `nsis` 与 `portable`。
