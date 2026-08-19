# DeepSeek Harness Local svpts

DeepSeek Harness 的本地部署套件：把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek 开源 Agent 框架，MIT，developer preview）包装为 **常驻系统托盘的桌面应用**（看门狗 + 桌面壳合一），配一键启停脚本。

## 项目声明

- 本项目使用 **Cherry Studio + DeepSeek API** 通过 **Vibe Coding** 方式完成；
- 主要目的是**自用**（个人本地部署环境）；
- 基于上述原因，若想要修改或填补漏洞，**推荐自行分叉**，而不是直接在本仓库提报；
- 因为 deepseek-harness 声称可能存在破坏性变更，**把壳套在外面**（外部包装 + 页面注入）比把壳作为插件嵌入其内是更稳健的选择；
- **Linux 和 macOS** 的具体部署与使用**还未测试**，待回到有相关设备的居所时再具体测试。

## 快速开始

### 自举安装（推荐，无需手动 clone）

从仓库页面下载**单个文件** `install.bat`（Windows）或 `install.sh`（Linux/macOS）→ 放到任意目录运行 → 自动 clone 仓库（含子模块）并完成部署。**仓库内不含任何不可审查的二进制文件。**

### 手动安装

```bat
:: 第一步（git 拉取后只需一次，可重复运行）：双击 部署DeepSeek-Harness.bat
::   自动审查 Node/pnpm/git/Ollama，补足 dsh-home/.env、初始化子模块、安装依赖并构建
:: 启动：双击 启动DeepSeek-Harness.bat
:: 停止：托盘右键"退出（停止后台服务）"，或双击 停止DeepSeek-Harness.bat
:: 界面功能按钮区：📁打开会话存档 / 💾备份 / 📤迁移（工作区搬移）/ 🔄备份更新 / 📥恢复 / 🌐局域网
::   （局域网：默认关；开启后手机访问 http://<本机IP>:3280，首次需电脑端确认授权）
::   Linux/macOS：./deploy.sh && ./start.sh（停止 ./stop.sh）
```

## 跨平台

| 平台 | 启动 | 停止 | 部署 |
|---|---|---|---|
| Windows | 启动DeepSeek-Harness.bat | 停止DeepSeek-Harness.bat | 部署DeepSeek-Harness.bat |
| Linux / macOS | `./start.sh` | `./stop.sh` | `./deploy.sh` |

- 首次启动：托盘图标 + 窗口自动打开（loading 页即时反馈，后台就绪后切入真实 UI）
- 关闭窗口 = 回到托盘，后台继续运行；再次双击启动脚本约 2 秒唤起窗口
- 界面右上角 ⏻ 按钮：确认后完全退出（前端 + 后台）
- 后台崩溃由看门狗自动重启（连续失败有退避与放弃保护）

## 主要功能

### 🗂 会话存档（备份 / 恢复 / 迁移）

界面功能栏（或独立菜单 `备份恢复DeepSeek-Harness.bat`）：

| 按钮 | 功能 |
|---|---|
| 📁 打开会话存档 | 直接打开 `dsh-home\sessions` 文件夹（不存在自动创建） |
| 💾 **备份** | 将对话存档打包为 zip（图形化选择保存位置，默认名 `dsh-sessions-时间戳.zip`） |
| 📤 **迁移** | **工作区整体搬移**：选择空目录 → 自动停止后台 → 移动整个 `dsh-home`（会话/设置/配置）→ 记录新位置（`desktop\home-location.json`，重启生效） |
| 🔄 **备份更新** | 将当前对话存档**合并进**既有备份 zip（增量累积，适合定期维护同一份备份） |
| 📥 **恢复** | 从备份 zip 还原对话存档（**当前会话自动改名留底**，可回退） |

**跨机迁移场景**：旧机 💾 备份 → 新机安装 + 📥 恢复 → 会话与设置完整迁移。所有操作均弹**图形化文件对话框**选路径。

### 🌐 局域网转发（手机远程访问）

dsh 官方 CLI **硬性拒绝** `--host 0.0.0.0`（理由：会向网络暴露远程代码执行能力）。本套件通过**壳内转发层**实现局域网访问，harness 本身保持 127.0.0.1 监听、零修改：

1. 功能栏点 `🌐 局域网` 开启（**默认关闭**；状态栏可见开关状态与本机 IP）
2. 手机连同一 WiFi，浏览器访问 `http://<本机IP>:3280`（`0.0.0.0:3280` 反向代理 → `127.0.0.1:3180`，HTTP + WebSocket 双转发）
3. 首次访问看到**申请页**（大按钮"申请访问"）→ 电脑端弹确认框（显示申请设备 IP）→ 允许后自动进入
4. **确权持久**：授权记录于 `desktop\lan-auth.json`（已 gitignore），局域网状态不变则无需重复授权
5. **撤销**：删除该文件即全部失效（下次访问重新申请）

**安全边界**：默认拒绝 + 人类确认授权；建议仅在可信 WiFi 使用。

### 🖥 托盘应用（看门狗 + 桌面壳）

- **生命周期**：关窗 = 回到托盘、后台继续运行；托盘右键或界面 ⏻ 按钮 = 完全退出（前端 + 后台）
- **自绘顶栏**（无边框窗口）：`⏻ 完全退出 / ─ 最小化 / ⛶ 最大化-还原 / ✕ 关闭窗口`（自右向左，整条可拖拽移动窗口）
- **底部状态栏**：后端在线状态（每 5 秒探测）+ 端口 3180 + 工作区路径 + 局域网开关 + **本机局域网 IP** + 版本
- **看门狗**：后台崩溃自动重启（连续失败有退避与放弃保护，恢复后自动复位）

## 环境要求

- Windows 10/11 x64；Node.js ≥ 22.19（或 ≥ 24）；pnpm（仓库内按 `packageManager` 自动采用 11.7.0）
- Ollama（默认本地模型 qwen3:8b）或 DeepSeek API Key（UI 内配置）
- 首次使用：`cd desktop && npm install`；在 `dsh-home\` 创建 `.env` 写入 `OLLAMA_PLACEHOLDER_KEY=ollama`（本地无鉴权服务器所需占位凭证）

## 目录结构

```
├── 启动DeepSeek-Harness.bat / 停止DeepSeek-Harness.bat   # 一键启停（GBK+CRLF 编码）
├── 部署DeepSeek-Harness.bat   # 一键部署：拉取后环境审查与补足（幂等，可重复运行）
├── 备份恢复DeepSeek-Harness.bat + backup-restore.ps1      # 对话存档备份/恢复/更新（PowerShell 内置压缩，零依赖）
├── install.bat / install.sh   # 自举安装器（单文件下载即装，见"快速开始"）
├── references\         # 设计参考项目（本地拉取，已被 .gitignore 排除，不入库）
├── desktop\            # 托盘应用（main.cjs 看门狗+窗口、tray.png、package.json）
├── deepseek-harness\   # 上游仓库（git submodule，固定到经过验证的提交）
├── dsh-home\           # Harness home（本机数据，不入库；首次运行自动创建）
├── dsh-test\           # 测试工具与验收产物
└── HANDOVER.md         # 部署与运维交接文档（面向本机环境维护者）
```

## 架构要点

- `desktop/main.cjs`：单一常驻托盘 Electron 应用。看门狗逻辑（后台唯一 owner：健康巡检、子进程存活判据防误杀慢启动、崩溃自动重启、`watchdog.stop` 文件信号停止）+ 窗口逻辑（loading 页 → 真实 UI → 页面注入退出按钮）
- 升级 dsh：`git submodule update --remote` 后按上游要求重装重构建，并跑一次烟测（`set DSH_DESKTOP_SMOKE=1` 后双击启动脚本）
- 详情见 [HANDOVER.md](HANDOVER.md)（含 27 条踩坑记录）与 [desktop/README.md](desktop/README.md)

## 隐私说明

`dsh-home\`（会话记录、设置、凭证）与全部日志均不进入版本库（见 `.gitignore`）。上传前请确认无密钥残留。

## License

本封装层 MIT；上游 deepseek-harness 为 MIT（见其仓库）。
