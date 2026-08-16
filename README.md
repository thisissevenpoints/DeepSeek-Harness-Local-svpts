# DeepSeek Harness Local svpts

DeepSeek Harness 的本地部署套件：把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek 开源 Agent 框架，MIT，developer preview）包装为 **常驻系统托盘的桌面应用**（看门狗 + 桌面壳合一），配一键启停脚本。

## 快速开始

```bat
:: 启动：双击 启动DeepSeek-Harness.bat
:: 停止：托盘右键"退出（停止后台服务）"，或双击 停止DeepSeek-Harness.bat
```

- 首次启动：托盘图标 + 窗口自动打开（loading 页即时反馈，后台就绪后切入真实 UI）
- 关闭窗口 = 回到托盘，后台继续运行；再次双击启动脚本约 2 秒唤起窗口
- 界面右上角 ⏻ 按钮：确认后完全退出（前端 + 后台）
- 后台崩溃由看门狗自动重启（连续失败有退避与放弃保护）

## 环境要求

- Windows 10/11 x64；Node.js ≥ 22.19（或 ≥ 24）；pnpm（仓库内按 `packageManager` 自动采用 11.7.0）
- Ollama（默认本地模型 qwen3:8b）或 DeepSeek API Key（UI 内配置）
- 首次使用：`cd desktop && npm install`；在 `dsh-home\` 创建 `.env` 写入 `OLLAMA_PLACEHOLDER_KEY=ollama`（本地无鉴权服务器所需占位凭证）

## 目录结构

```
├── 启动DeepSeek-Harness.bat / 停止DeepSeek-Harness.bat   # 一键启停（GBK+CRLF 编码）
├── desktop\            # 托盘应用（main.cjs 看门狗+窗口、tray.png、package.json）
├── deepseek-harness\   # 上游仓库（git submodule，固定到经过验证的提交）
├── dsh-home\           # Harness home（本机数据，不入库；首次运行自动创建）
├── dsh-test\           # 测试工具与验收产物
└── HANDOVER.md         # 部署与运维交接文档（面向本机环境维护者）
```

## 架构要点

- `desktop/main.cjs`：单一常驻托盘 Electron 应用。看门狗逻辑（后台唯一 owner：健康巡检、子进程存活判据防误杀慢启动、崩溃自动重启、`watchdog.stop` 文件信号停止）+ 窗口逻辑（loading 页 → 真实 UI → 页面注入退出按钮）
- 升级 dsh：`git submodule update --remote` 后按上游要求重装重构建，并跑一次烟测（`set DSH_DESKTOP_SMOKE=1` 后双击启动脚本）
- 详情见 [HANDOVER.md](HANDOVER.md)（含 21 条踩坑记录）与 [desktop/README.md](desktop/README.md)

## 隐私说明

`dsh-home\`（会话记录、设置、凭证）与全部日志均不进入版本库（见 `.gitignore`）。上传前请确认无密钥残留。

## License

本封装层 MIT；上游 deepseek-harness 为 MIT（见其仓库）。
