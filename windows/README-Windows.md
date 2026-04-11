# Windows 打包

## 目录结构

- `windows/installer.nsi`: NSIS 安装脚本
- `windows/build-win-dist.sh`: 在当前 Linux 机器上组装 Windows 分发目录
- `dist/win-x64/`: Windows 可分发目录

## 先组装分发目录

```bash
cd /root/meeting-float-sciter
./windows/build-win-dist.sh
```

这会下载官方 Sciter Windows x64 runtime，并生成：

- `dist/win-x64/`
- `dist/meeting-float-sciter-v0.1.0-win-x64.zip`

## 构建 NSIS 安装包

如果本机有 `makensis`：

```bash
cd /root/meeting-float-sciter/windows
makensis installer.nsi
```

输出：

- `dist/Meeting-Float-0.1.0-Setup.exe`

## Windows 运行入口

- `start.bat`
- `autotest.bat`

## 当前说明

- 这是 Windows x64 测试包
- 默认携带 Sciter `scapp.exe` / `sciter.dll`
- 真实录音链路仍待接宿主录音桥接
- `autotest.bat` 可用于快速验证 mock 流程
