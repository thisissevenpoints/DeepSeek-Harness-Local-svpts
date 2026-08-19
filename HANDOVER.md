# DeepSeek Harness 本地部署 —— 交接文档

> 最后更新：2026-08-16　|　适用对象：后续接手本环境维护/使用的人（人或 AI）
> 配套文档：`dsh-test\DSH-部署报告.md`（部署过程）、`desktop\README.md`（壳说明）

---

## 1. 项目概述

在 Windows 11 Pro for Workstations（x86_64）上部署了 DeepSeek Harness（`dsh`，DeepSeek 开源 Agent 框架，MIT，当前处于 **developer preview**，破坏性变更随时可能发生），并为它制作了一个 Electron 桌面壳。全部资产位于：

```
<项目根>\
```

**时间线**：

| 阶段 | 内容 |
|---|---|
| 2026-08-16 上午 | 模式 B（源码安装）部署到 C 盘；完成 hello.txt 真实任务往返验收；拉取 qwen3:8b 作为本地默认模型 |
| 2026-08-16 下午 | 应需求整体迁移至 <项目根>\（含 `DSH_HOME` 用户环境变量设置）；迁移后全面整理测试（10 项全部通过） |
| 2026-08-16 晚间 | 制作 Electron 桌面壳（自拉起、自愈、退出清理），烟测通过并交付使用 |
| 2026-08-16 深夜 | 接手后全量回归：headless 往返、Web 全流程、壳烟测（污染环境自愈验证）、会话管道核查、pnpm 版本机制澄清；修复壳启动脚本对 `ELECTRON_RUN_AS_NODE` 的自愈（`desktop\package.json`） |
| 2026-08-16 深夜 | 按需改造为**看门狗架构**：新增 `desktop\watchdog.cjs`（后台唯一 owner、崩溃自动重启、停止信号），壳改纯客户端（关窗不停后台），新增 `停止DeepSeek-Harness.bat`，全链路实测通过 |
| 2026-08-16 深夜 | 修复启动脚本并定版**托盘应用**：看门狗与壳合并为单一常驻托盘 Electron 应用（右键菜单退出/启动壳、second-instance 唤起、loading 页即时反馈）；修复 Electron 空环境变量 node 模式陷阱、window-all-closed 托盘消失、退出竞态等 4 个缺陷 |
| 2026-08-17 | 升级 dsh 至 **v0.1.0-rc.7**（47f943859b→99f6f02fec，111 提交）；因 Windows 动态端口保留段（2993-3092）覆盖原 3080 导致 EACCES，**端口整体迁移 3080→3180**（`--port 3180` 参数 + 全链路改造），烟测通过 |

**当前状态**：所有 dsh/壳进程均已停止（干净的关机状态），Ollama 常驻服务在线。2026-08-16 深夜全量回归全部通过（见 §11）。环境随时可启动使用。

## 2. 目录结构与资产清单

```
<项目根>\
│
├── HANDOVER.md                  # 本文档
├── 启动DeepSeek-Harness.bat      # 一键启动（托盘应用；双击；启动器窗口数秒后自动关闭不常驻；GBK+CRLF 编码约束见 §8-16）
├── 停止DeepSeek-Harness.bat      # 一键停止（托盘应用+后台服务；双击；优雅信号+端口兜底）
├── 部署DeepSeek-Harness.bat      # 一键部署（git 拉取后环境审查与补足：Node/pnpm/git/Ollama 审查、dsh-home/.env 补足、子模块初始化、依赖构建、Electron；幂等可重跑）
├── 备份恢复DeepSeek-Harness.bat + backup-restore.ps1  # 对话存档备份/恢复/更新（PowerShell 内置 Compress-Archive，零依赖；见 §13）
├── install.bat / install.sh  # 自举安装器：单文件下载 → clone（含子模块）→ 自动部署
├── references\          # 设计参考项目（本地拉取；**已加入 .gitignore，永不入库**）
│
├── deepseek-harness\            # dsh 源码仓库（git master，v0.1.0-rc.5）
│   ├── apps\cli\src\bin.ts      # dsh CLI 入口（源模式经 tsx 运行）
│   ├── apps\web\dist\           # Web 前端构建产物（vite 输出，约 12MB）
│   ├── packages\*\*\lib\        # 各 TS 包构建产物（tsc/tsdown 输出）
│   ├── packages\bundle\         # base / headless / web-app 三个内置 bundle（组合定义）
│   ├── tsconfig.json            # 源模式 headless 运行必需（TSX_TSCONFIG_PATH 指向它）
│   ├── node_modules\            # pnpm 依赖（含 .pnpm 虚拟存储链接）
│   └── .git\                    # 完整历史（12k+ commits，升级依赖它）
│
├── dsh-home\                    # Harness home（= 原 ~\.dsh；DSH_HOME 指向此处）
│   ├── settings.yaml            # 用户设置（模型路由、默认模型、UI 引导状态）
│   ├── .env                     # 环境层（目前仅占位凭证，见 §5）
│   ├── .credentials.yaml        # 【未生成】UI 保存 API Key 后创建，只写不回显
│   ├── profiles\
│   │   ├── web\                 # web profile（cordis.yml + cordis.patch.yml + package.json + pnpm-workspace.yaml）
│   │   ├── headless\            # headless profile（同上四件套）
│   │   └── node_modules\        # 符号链接回退目录，【每次启动自动重建】指向仓库
│   ├── sessions\                # 会话持久化（按工作区路径编码分目录，zstd 压缩 JSONL）
│   └── storages\workspace.json  # UI 工作区存储（当前为干净初始化态）
│
├── desktop\                     # 托盘应用（看门狗 + 桌面壳合一，独立 npm 项目）
│   ├── main.cjs                 # 托盘应用主进程（看门狗 + 窗口，详见 §6）
│   ├── tray.png                 # 托盘图标（32x32，node 脚本生成）
│   ├── electron-userdata\       # 单实例锁隔离目录（运行时生成）
│   ├── watchdog.log             # 看门狗运行日志（追加）
│   ├── watchdog.pid / watchdog.stop  # 运行时文件（pid 兜底 / 停止信号，瞬态）
│   ├── package.json             # electron ^37 + ws（探测用）
│   ├── README.md                # 使用说明与故障排查
│   ├── shell.log                # 壳运行日志（每次启动追加）
│   ├── dsh-web.log              # 应用拉起的 dsh 宿主输出
│   └── smoke.png / smoke.txt    # 烟测产物（截图 / 页面诊断 JSON）
│
└── dsh-test\                    # 测试与交付区
    ├── DSH-部署报告.md           # 部署报告（验收记录、命令清单、风险提示）
    ├── no-runtime-context.yml    # 本地小模型 headless 补丁（见 §8-1）
    ├── probe-ws.cjs              # WS 就绪探测工具（复用 desktop 的 ws 依赖，见 §7）
    ├── webtest-web.log           # 2026-08-16 全量回归：Web 模式运行日志
    ├── fulltest-aug16\hello.txt  # 2026-08-16 全量回归 headless 产物（内容 "Hello"）
    ├── hello-workspace-760\hello.txt    # 迁移前验收产物（内容 "Hello"）
    └── roundtrip-3154\hello.txt         # 迁移后整理测试产物（内容 "Hello"）
```

**C 盘已无本项目残留**（原 `~\.dsh`、`~\dev\deepseek-harness`、`~\dsh-test` 均已删除并确认）。

## 3. 环境依赖

| 依赖 | 版本 | 位置/说明 |
|---|---|---|
| Windows | 11 Pro for Workstations 10.0.26200（x86_64） | Git Bash 为主要 shell |
| Node.js | v22.23.2 | Cherry Studio mise shims 提供（`C:\Users\<username>\AppData\Roaming\CherryStudio\Toolchain\mise\shims`），满足仓库 `^22.19 \|\| >=24` 要求 |
| pnpm | 11.7.0（仓库内自动采用） | 全局二进制（`C:\Users\<username>\AppData\Roaming\npm\pnpm`）在仓库外报 10.29.2；**进入仓库后按 `packageManager` 字段自动切换为 11.7.0**（2026-08-16 实测 `pnpm install` 输出 "using pnpm v11.7.0"，lockfile 零改动）。corepack 0.34.6 由 mise shims 提供 |
| git | 2.55.0 | — |
| Ollama | 0.32.13 | 常驻服务，127.0.0.1:11434 |
| Ollama 模型 | 约 17GB | **`C:\OllamaModels`**（用户环境变量 `OLLAMA_MODELS` 指向；用户明确选择不迁移）：qwen3:8b / qwen2.5:7b / qwen2.5:3b / gemma2:9b |
| 显存 | ≤8GB | qwen3:8b（5.2GB）为可跑上限级别 |
| Electron | 37.10.3 | desktop 项目 devDependency |

**用户级环境变量**（迁移时设置）：

| 变量 | 值 | 说明 |
|---|---|---|
| `DSH_HOME` | `<项目根>\dsh-home` | dsh 的 Harness home；新开终端自动生效 |
| `OLLAMA_MODELS` | `C:\OllamaModels` | 部署前已存在，未改动 |

## 4. 网络端点

| 端点 | 用途 |
|---|---|
| `http://127.0.0.1:3180` | dsh Web UI（仅监听本机；官方暂不支持 --host 0.0.0.0） |
| `http://127.0.0.1:3180/api/*` | 宿主 API 前缀（浏览器端 RPC 上行） |
| `ws://127.0.0.1:3180/api/events.mux` | 浏览器端 WebSocket 下行（就绪判据：握手成功或 HTTP 426） |
| `http://127.0.0.1:11434/v1` | Ollama OpenAI 兼容端点（settings.yaml 中 `ollama-local` provider） |

## 5. 配置详解（dsh-home）

### settings.yaml（热生效，无需重启）

```yaml
llm-pi-ai:
  providers:
    ollama-local:
      displayName: Ollama Local
      apiKeyEnv: OLLAMA_PLACEHOLDER_KEY   # 无鉴权本地服务器必需的占位凭证（官方文档要求）
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      models:
        - id: qwen2.5:7b
          name: Qwen2.5 7B (local)
          contextWindow: 32768
        - id: gemma2:9b-instruct-q4_K_M
          name: Gemma2 9B Instruct (local)
          contextWindow: 8192
        - id: qwen3:8b                     # 默认模型
          name: Qwen3 8B (local)
          contextWindow: 32768
agent-default-model:
  provider: ollama-local
  model: qwen3:8b
ui-onboarding:                             # UI 首次打开时由前端写入，勿删
  welcomeNoticeVersion: 2026-08-13.1
```

> `name`/`contextWindow` 为 UI 保存模型设置时写入的展示字段（2026-08-16 全量回归时与实测内容同步）。

- 命名空间 `llm-pi-ai` 与 `agent-default-model` 均为官方 schema；Provider ID（`ollama-local`）**永久不可改**（请求、会话、凭证引用都依赖它），改名 = 新建 provider + 删旧。
- 模型 id 必须与 `ollama list` 输出完全一致。
- 若要加云端模型：在 UI 的 Settings → Models 操作（DeepSeek 卡片填 Key；或 Add custom provider）。

### .env（仅启动时加载；改动需重启进程）

```
OLLAMA_PLACEHOLDER_KEY=ollama
```

仅占位值，**不是真实密钥**。真实密钥禁止写入此处。

### 凭证机制

解析顺序（官方文档）：**进程环境变量 → `$DSH_HOME\.credentials.yaml` → 启动目录 `.env` → `$DSH_HOME\.env`**。UI 保存的 Key 写入 `.credentials.yaml`，页面只显示脱敏描述符、永不回显明文。**不要**把真实 Key 放入任何 `.env` 或日志。

### profiles

- `web` 与 `headless` 首次使用自动初始化；`cordis.patch.yml` 是用户补丁层（可热重载）。
- `profiles\node_modules` 为符号链接回退目录，每次启动由 dsh 自动修复（迁移后已验证指向 D 盘仓库）。
- 本地小模型如需在 Web UI 长期使用，可将 `dsh-test\no-runtime-context.yml` 的内容合并进 `profiles\web\cordis.patch.yml`（见 §8-1）。

## 6. 托盘应用（desktop\，看门狗 + 桌面壳合一）

**生命周期模型（2026-08-16 深夜定版）**：`main.cjs` 是一个**常驻系统托盘的单一 Electron 应用**——既是后台 dsh 服务的唯一 owner（看门狗），又是桌面壳（按需开窗）。关窗 = 回到托盘，后台继续运行；只有托盘右键"退出（停止后台服务）"或停止脚本才停全部。

### 启动（日常推荐）

双击 `启动DeepSeek-Harness.bat`（启动器窗口约 4 秒自动关闭）：
- **首次启动**：托盘图标立即出现 + 应用窗口自动打开（先显示 loading 页即时反馈，后台就绪后切入真实 UI，约 10-30 秒）；
- **已在运行**：通过 Electron 单实例锁的 second-instance 事件直接**唤起窗口**（约 2 秒）。

### 托盘行为

- 左键单击托盘图标：打开/聚焦应用窗口；
- 右键菜单：`打开 DeepSeek Harness` / `退出（停止后台服务）`（显式退出，杀后台+退出托盘）；
- 关闭应用窗口：只销毁窗口、应用驻留托盘，后台继续运行。

### 自绘顶栏 + 功能按钮区（壳注入，不改 DSH 本体；2026-08-17 定版）

**窗口为无边框（`frame: false`）**，由壳注入自绘标题栏与功能区（不修改 `apps/web` 源码，升级 dsh 不受影响）：

- **顶栏**（高 36px，半透明深色，整条可拖拽移动窗口）：
  - 左侧应用名"DeepSeek Harness"；
  - 右侧按钮**自右向左**：`⏻ 完全退出`（确认框后停前后端）、`─ 最小化`、`⛶ 最大化/还原`、`✕ 关闭窗口`（回托盘）；
- **功能按钮区**（顶栏下方一行，2026-08-18 扩展为 4 个）：
  - `📁 打开会话存档` —— 打开 `dsh-home\sessions` 文件夹（不存在则自动创建）；
  - `💾 备份` —— 弹**图形化保存对话框**选路径，将对话存档打包为 zip（默认名 `dsh-sessions-时间戳.zip`，默认位置"文档"）；
  - `📤 迁移` —— **工作区迁移**：弹**图形化目录选择**选空目录，把整个工作区（dsh-home：会话/设置/配置）**搬移过去**（先停后台，搬移后写 `desktop\home-location.json` 记录新位置，重启生效）；
  - `🔄 备份更新` —— 弹**图形化打开对话框**选既有备份 zip，将当前对话存档**合并进**该备份（增量更新/跨机累积）；
  - `📥 恢复` —— 弹**图形化打开对话框**选备份 zip 还原（当前会话自动改名留底可回退）；
  - 执行引擎复用 `backup-restore.ps1`（主进程 `dialog` 选路径 → **异步** PowerShell，不阻塞主进程）；完成弹结果框；全局互斥锁防并发；
- **让出空间而非覆盖**：注入后量取两栏实际高度（约 83px），给页面 body 加等量 `padding-top`，内容从两栏下方开始、零遮挡（烟测几何验证 `overlap:false`）。
- 通知机制：**console 标记分派**（页面 `console.log('DSH_DESKTOP_*')` → 壳 `console-message` 必然送达，主通道）+ 自定义协议导航兜底（仅退出按钮保留双通道、带去重）。
- 页面每次加载（含自动重载循环）后自动重新注入；loading/错误页（data:）不注入；
4. 冒烟诊断含 `quitBtn` 字段（注入成功与否）。

### 看门狗逻辑（内嵌于 main.cjs）

1. 3180 无服务：`cmd /c pnpm dsh web` 拉起（cwd=仓库根，注入 `DSH_HOME`）；
2. 健康巡检每 5 秒；**任何 HTTP 响应（含启动期 404）即视为存活**；
3. **宕机判定以子进程存活为准**（无固定宽限时间）：进程活着就视为"启动中/运行中"绝不误杀（dsh 冷启动随负载波动 10-30 秒）；进程死亡且端口不通才重启；进程存活但 3 分钟不监听视为卡死强制重启；
4. 崩溃自动重启；连续 4 次真正不可达进入"放弃重启但持续监测"状态（后台恢复后自动复位，不再永久死锁）；
5. 清理双保险：taskkill 进程树 + 按 3180 监听 PID 兜底（防 tree-kill 漏杀孙进程占端口）；
6. 3180 已有外部实例：仅监控不接管也不杀；外部实例退出后自动拉起自己的实例；
7. 停止信号：`watchdog.stop` 文件出现 → 置 quitting 标志（杜绝退出竞态）→ 清理自己拉起的实例 → 退出；`watchdog.pid` 写本进程 pid（停止脚本兜底用）；
8. 单实例锁：`userData` 隔离到 `desktop\electron-userdata`（避免与其它未打包 Electron 应用共用锁），second-instance 唤起窗口。

### 窗口加载逻辑

1. 窗口先显示 loading 页（即时反馈）→ 等待 3180 就绪（最长 90 秒，超时显示内嵌错误页含排查指引）；
2. `ws` 包握手探测 `/api/events.mux`（open 或 426 均视为就绪）；
3. 加载真实 UI；检测到页面 "Failed to load plugins" 时自动等待并重载（最多 7 次，总时限约 2 分钟）。

### 停止

方式一：托盘右键"退出（停止后台服务）"；方式二：双击 `停止DeepSeek-Harness.bat`（写停止标记走优雅路径 + 3180 监听 PID 兜底清理，幂等）。

### 烟测（无人值守验证）

```bat
set DSH_DESKTOP_SMOKE=1
cd /d <项目根>
启动DeepSeek-Harness.bat
```

启动后自动输出 `smoke.png`（截图）、`smoke.txt`（页面诊断：标题/URL/UA/正文摘要/fetch 与 WS 状态），随后停掉后台并退出（干净状态）。**升级 dsh 后建议先跑一次烟测。**

### 诊断日志

- `watchdog.log`：看门狗巡检/拉起/重启/停止全过程；
- `shell.log`：壳等待/探测/加载/退出过程；
- `dsh-web.log`：应用拉起的 dsh 宿主输出（注意 stdout 重定向到文件时有块缓冲，监听行可能延迟出现，不影响服务）。

### 测试钩子（环境变量）

`DSH_DESKTOP_SMOKE=1`（烟测，诊断含 overlay/titlebarBtns/openSessionsBtn 字段）、`DSH_DESKTOP_AUTOQUIT=1`（加载后仅退出不停后台）、`DSH_DESKTOP_CLOSEWIN=1`（加载后关窗留托盘）、`DSH_DESKTOP_AUTOCLICKQUIT=1`（自动点击退出按钮，配合 `DSH_DESKTOP_NOQUITCONFIRM=1` 跳过确认框）、`DSH_DESKTOP_AUTOCLICKOPEN=1`（自动点击"打开会话存档"按钮验证打开文件夹链路）、`DSH_DESKTOP_USERDATA=<路径>`（并行测试实例独立锁，不打扰运行中的会话）。

### 已知限制（MVP）

无开机自启、无更新检查、无打包；`npm start` 直启时需后台已运行（或经启动脚本带起）。

## 7. 常用运维命令速查

```bat
:: —— 启动 ——
:: 方式零：双击 <项目根>\启动DeepSeek-Harness.bat（推荐日常使用）
::   首次启动：托盘图标 + 窗口自动打开（loading 页即时反馈）；已在运行：约 2 秒唤起窗口
:: 方式一：桌面壳（npm start；需后台已运行：托盘应用或手动方式二）
cd /d <项目根>\desktop && npm start
:: 方式二：纯 Web（前台常驻；Ctrl+C 停止；托盘应用在跑时会被当作外部实例监控）
cd /d <项目根>\deepseek-harness && pnpm dsh web

:: —— 停止 ——
:: 方式零：托盘右键"退出（停止后台服务）"，或双击 <项目根>\停止DeepSeek-Harness.bat（优雅信号+端口兜底，幂等）
:: 手工兜底：
netstat -ano | findstr :3180      :: 找到 LISTENING 的 PID
taskkill /F /PID <pid>            :: 强制停止（Ctrl+C/SIGTERM 为优雅停止，5 秒排空）
:: 注意：taskkill 不带 /F 对 node 控制台进程无效（报"只能强制终止"）；脚本化场景一律 /F + 干净重启
:: WS 就绪探测工具：node dsh-test\probe-ws.cjs（open 或 HTTP_426 视为就绪，同壳逻辑）

:: —— 升级 ——
cd /d <项目根>\deepseek-harness
git pull && pnpm install && pnpm run build

:: —— 验证 ——
curl -sI http://127.0.0.1:3180                                :: 期望 200
cd /d <项目根>\desktop && set DSH_DESKTOP_SMOKE=1 && npm start   :: 全链路烟测

:: —— 单次任务（headless，本地小模型需附加补丁）——
:: 注意：源模式必须在仓库外 cwd 启动，并设置 TSX_TSCONFIG_PATH；
:: tsx loader 路径通过 require.resolve 动态获取，--import 需要 file:/// URL。
```

### headless 完整配方（Git Bash）

```bash
TSX_LOADER=$(cd /d/alpha/DeepSeek-Harness-Local/deepseek-harness && node -p "require.resolve('tsx/esm')")
TSX_URL="file:///$(cygpath -m "$TSX_LOADER")"
cd <你的工作目录> && \
DSH_HOME='<项目根>\dsh-home' \
TSX_TSCONFIG_PATH="D:/alpha/DeepSeek-Harness-Local/deepseek-harness/tsconfig.json" \
node --import "$TSX_URL" \
  "D:/alpha/DeepSeek-Harness-Local/deepseek-harness/apps/cli/src/bin.ts" \
  --profile headless \
  --patch "D:/alpha/DeepSeek-Harness-Local/dsh-test/no-runtime-context.yml" \
  "<任务文本>"
```

退出码 0 = turn 正常 completed；任务文本即工作区根 = 启动时的 cwd（受 workspace-write 沙箱限制）。

## 8. 已排问题与踩坑记录（重要！）

1. **本地小模型被 runtime-context 尾随消息带偏**：dsh 默认在用户消息后注入 "Current runtime context…" 快照，小模型（qwen3:8b 等）会把它当成本次指令而拒绝行动。解决：headless 用 `--patch no-runtime-context.yml`（关闭 `system-prompt.includeRuntimeContext`）；强模型（DeepSeek 云端）无此问题，Web UI 默认无需改。
2. **qwen3:8b 行为特征**：行动前有约 20 秒长思考；任务措辞要具体（指明工具与参数）；用 `write` 工具时可能误带 `sandbox_permissions`/`justification` 参数导致被拒——在任务里明确"只用 file_path 和 content 两个参数"可提升成功率。
3. **模型能力**：gemma2:9b（旧版）不支持 tools API（Ollama 400）；qwen2.5:7b 工具调用不稳定。均不建议做 agent 模型。
4. **pnpm 仓库跨盘 mv 会失败/极慢**：workspace 大量包级符号链接无法跨盘重建。正确迁移姿势：删 node_modules → 全新 clone（或 robocopy /MT:16）→ 新位置 `pnpm install && pnpm run build`。
5. **会话日志为 zstd 多帧容器**：`node:zlib` 的 `zstdDecompressSync` 只解第一帧；需按 magic `28 B5 2F FD`（0x28B52FFD）扫描逐帧解码。
6. **Windows 保留端口段会 EACCES**：`netsh interface ipv4 show excludedportrange protocol=tcp` 查看保留段；2026-08-17 实测 **2993-3092 段覆盖原 3080**（系统动态预留，重启/服务变化会改变），dsh 用 `--port 3180` 迁移解决。临时服务器用 `listen(0)` 动态端口。
7. **MSYS 的 TaskStop/普通 kill 杀不掉 node/mv 子进程**：按 PID 找进程树（`netstat -ano | findstr :3180`）→ `taskkill //F //PID`（Git Bash 双斜杠）。
8. **本机会话环境设置了 `ELECTRON_RUN_AS_NODE=1`**（来自 CherryStudio 进程环境继承，非注册表/非 .bashrc）：跑任何 Electron 应用前必须 `unset ELECTRON_RUN_AS_NODE`（或在 cmd 里 `set ELECTRON_RUN_AS_NODE=`），否则 Electron 以纯 Node 运行（`require('electron')` 返回 exe 路径字符串，`app` 为 undefined）。**桌面壳的 `npm start` 已内置自愈（2026-08-16 修复，见 §6-2b），污染环境下可正常启动**；`DSH_HOME` 在 CherryStudio 启动前设置，其派生 shell 可能看不到——重启 CherryStudio 或手动 `export` 即可。
9. **Electron 37 API 变更**：`BrowserWindow.setWindowOpenHandler` 已移除 → 用 `win.webContents.setWindowOpenHandler`。
10. **主进程 undici fetch 带 `Upgrade: websocket` 头探测 WS 不稳定**（挂起甚至静默崩溃、留僵尸进程）→ 用 `ws` 包握手探测（open 或 unexpected-response 426 均视为就绪）。
11. **严禁 `taskkill /IM electron.exe` 镜像名级强杀**——会误杀 CherryStudio 等所有 Electron 应用；只按 PID 杀。
12. **headless 源模式依赖 cwd**：tsx 的 tsconfig 发现基于 cwd，必须从仓库外启动并用 `TSX_TSCONFIG_PATH` 锚定仓库 tsconfig；`--import` 的 tsx 路径要用 `file:///` URL 形式（Windows 盘符路径会被 ESM loader 拒绝）。
13. **迁移 .dsh 时先删 `profiles\node_modules`**（纯符号链接目录，启动时自愈），否则 mv 报错。
14. **D 盘小文件 IO 较慢**（疑似机械盘）：大量小文件操作（mv/rmdir 十万级文件）可能耗时 10 分钟以上，优先 robocopy /MT:16、git clone、cmd `rmdir /s /q` 等原生工具。
15. **Web 就绪判据**：curl 200 只代表 webserver 起来；判断浏览器可用还需 WS `/api/events.mux` 握手（壳已内置此逻辑）。
16. **启动 bat 必须保持 GBK+CRLF 编码**：中文 Windows 的 cmd 以 GBK 解析批处理，UTF-8 编码会导致含中文的 `if (...)` 块解析错位（行尾被吞、行碎片被当命令执行），`chcp 65001` 也救不了块内中文。**任何编辑（含 AI 工具的增量编辑）后都必须重新转换**：`iconv -f UTF-8 -t CP936` + `unix2dos`，改完用 `iconv -f CP936 -t UTF-8` 回读验证无乱码再交付；切勿直接存成 UTF-8。
17. **bat 内的外部命令一律写 System32 绝对路径**（`%SystemRoot%\System32\where.exe` 等）：从 Git Bash 等 MSYS 环境调用时，PATH 里的 GNU 工具（where、timeout 等）会劫持同名命令导致参数不兼容。倒计时用 `%SystemRoot%\System32\PING.EXE -n 4 127.0.0.1 >nul`（约 3 秒），不要用 `timeout`（stdin 被重定向时直接报错退出）。
18. **dsh web 冷启动时长随负载波动（实测 10-30 秒）**：健康检查**禁止用固定宽限期**——早期版本用 20 秒宽限，机器慢时依然把启动中的实例误杀成"杀了又起"循环（症状：watchdog.log 反复 `backend unreachable ... restarting`，`[ELIFECYCLE] Command failed with exit code 1` 是被 taskkill 的正常痕迹）。定版方案：**以子进程存活为判据**（进程活着就不杀；死了且端口不通才重启；3 分钟不监听才判卡死），且"任何 HTTP 响应（含 404）即存活"。
19. **进程树清理双保险**：taskkill `/T` 可能漏杀脱离进程树的孙进程（实际监听 3180 的 dsh 节点），必须再按 `netstat` 监听 PID 兜底一次；停止脚本的"清理残留实例"行即使已清理也可能出现（netstat 行滞后，无害）。mise shim 启动的 node 进程会显示两个（shim 包装 + 真实进程），属正常。
20. **Electron 的 ELECTRON_RUN_AS_NODE 陷阱**：值为 `1` **或空字符串**都会进入纯 Node 模式（`app` 为 undefined）！cmd 的 `set "VAR="` 传给子进程时行为不稳定（有时剥除、有时传空串），启动脚本必须用 PowerShell `$env:VAR = $null` **彻底删除**该变量（$null 保证子进程环境无此变量）；MSYS bash 的 `VAR= cmd` 会原样传空串，测试时注意。另外 **必须订阅 `window-all-closed`**，否则 Electron 默认关窗即退出、托盘消失。
21. **退出竞态防护**：应用退出路径（停止信号/托盘菜单/烟测）必须先置 `quitting` 标志再杀后台，否则退出前的最后一个巡检 tick 会把刚杀掉的实例误判为"崩溃"重新拉起，留下孤儿进程。

## 9. 数据与日志位置

| 数据 | 位置 |
|---|---|
| 会话记录 | `<项目根>\dsh-home\sessions\--<工作区路径编码>--\session-<uuid>\session.jsonl.zstd` |
| 壳日志 | `desktop\shell.log`、`desktop\watchdog.log`、`desktop\dsh-web.log` |
| dsh 配置 | `dsh-home\settings.yaml`（热生效）、`dsh-home\.env`（启动加载） |
| 凭证 | `dsh-home\.credentials.yaml`（UI 保存 Key 后生成；只写不回显） |
| Ollama 日志 | `C:\Users\<username>\AppData\Local\Ollama\` |
| 烟测产物 | `desktop\smoke.png`、`desktop\smoke.txt` |

## 10. 安全规范（必须遵守）

1. **密钥纪律**：真实 API Key 只由用户在 UI 输入；任何人/程序不得抄录、记录、写入日志或 `.env`。`dsh-home\.env` 目前只有占位值 `OLLAMA_PLACEHOLDER_KEY=ollama`。
2. **进程清理**：只按 PID 杀进程；禁止 `taskkill /IM electron.exe`、`taskkill /IM node.exe` 等镜像名强杀。
3. **测试隔离**：所有 agent 测试仅在新建的独立临时目录进行；dsh 默认权限 `workspace-write`（文件修改限于会话工作区与系统临时目录），headless 无审批通道时按"失败关闭"处理。
4. **网络暴露**：Web 仅监听 127.0.0.1；官方暂不支持 `--host 0.0.0.0`，勿自行对公网暴露。
5. **预览版**：dsh 为 developer preview，升级可能引入破坏性变更（含会话格式）；升级前留意官方 changelog，升级后跑烟测。

## 11. 验收记录（全部实测通过）

| # | 项 | 结果 |
|---|---|---|
| 1 | dsh 启动、持续运行、打印地址 | ✅ |
| 2 | curl HTTP 200 | ✅ |
| 3 | 真实任务往返（独立临时目录创建 hello.txt="Hello"） | ✅ 两轮（迁移前后各一次） |
| 4 | 凭证存储位置与权限核实 | ✅（`.credentials.yaml` 待用户填 Key 后生成） |
| 5 | 退出/重启方式验证 | ✅（含强制停止+干净重启） |
| 6 | 迁移后 10 项全面整理测试 | ✅ 全过 |
| 7 | Electron 壳烟测（自拉起→渲染→清理） | ✅ |
| 8 | 壳关窗清理验证（3180 释放、无残留） | ✅ |
| 9 | 全量回归：headless 真实任务往返（`fulltest-aug16`，hello.txt="Hello"，退出码 0） | ✅ 2026-08-16 深夜 |
| 10 | 全量回归：Web 模式全流程（启动→HTTP 200→WS OPEN→强杀→端口释放→干净重启） | ✅ 2026-08-16 深夜 |
| 11 | 全量回归：壳烟测在污染环境（`ELECTRON_RUN_AS_NODE=1`）下自愈启动→渲染→清理，3180 释放、无 electron 残留 | ✅ 2026-08-16 深夜 |
| 12 | 全量回归：会话日志管道（zstd 魔数 28 b5 2f fd）与 settings.yaml 完整性 | ✅ 2026-08-16 深夜 |
| 13 | pnpm 版本机制核实（仓库内自动采用 11.7.0，`pnpm install` 幂等、lockfile 零改动） | ✅ 2026-08-16 深夜 |
| 14 | 一键启动 bat（双击；启动器约 4 秒自动退出，脱离的后台壳完成全生命周期，3180 释放、零残留） | ✅ 2026-08-16 深夜 |
| 15 | 看门狗冷启动宽限与健康巡检（不再误杀启动中的实例；健康后保持静默） | ✅ 2026-08-16 深夜 |
| 16 | 解耦验证（壳 AUTOQUIT 退出后后台存活、看门狗在岗） | ✅ 2026-08-16 深夜 |
| 17 | 崩溃自动重启（手动杀监听进程，约 18 秒内拉起新实例） | ✅ 2026-08-16 深夜 |
| 18 | 停止脚本全链路（优雅信号自清理 + 端口兜底 + 幂等复跑） | ✅ 2026-08-16 深夜 |
| 19 | 托盘应用烟测（看门狗内嵌：单次 spawn 等健康、烟测后无重启竞态、干净退出） | ✅ 2026-08-16 深夜 |
| 20 | 关窗留托盘解耦（3 进程驻留、后台 200 在线）与 second-instance 唤起窗口（约 2 秒） | ✅ 2026-08-16 深夜 |
| 21 | 完整用户流程回归（启动→关窗→再双击唤起→停止全清） | ✅ 2026-08-16 深夜 |
| 22 | 慢启动不误杀验证（进程存活判据，后台随负载波动 10-30 秒下稳定健康） | ✅ 2026-08-16 深夜 |
| 23 | UI 右上角完全退出按钮（并行烟测注入验证 quitBtn=true、⏻ 渲染、不扰动运行中会话） | ✅ 2026-08-16 深夜 |

## 13. 对话存档备份 / 恢复 / 更新（2026-08-18 新增）

**界面内操作（推荐）**：托盘应用窗口第二排功能按钮区 —— `💾 备份` / `📤 迁移`（工作区搬移，非备份合并）/ `🔄 备份更新` / `📥 恢复`，均弹原生图形化文件对话框选路径，完成弹结果框。

**独立菜单 bat**（`备份恢复DeepSeek-Harness.bat`，PowerShell 内置压缩，零依赖）：

| 操作 | 行为 |
|---|---|
| 备份 | 将 `dsh-home\sessions\` 打包为 zip（弹保存对话框，默认名 `dsh-sessions-时间戳.zip`） |
| 恢复 | 从选中的 zip 还原对话存档；**当前会话先自动改名留底**（`sessions.bak-时间戳`，可手动回退） |
| 更新 | 将当前对话存档**合并进既有备份 zip**（`Compress-Archive -Update`）——迁移场景：备份 → 迁移后改工作区 → 更新同一 zip 增量累积 |

- 命令行直用（自动化）：`powershell -NoProfile -ExecutionPolicy Bypass -File backup-restore.ps1 -Action backup|update|restore -ZipPath <路径>`（带 `-ZipPath` 跳过对话框）。
- 技术要点：`backup-restore.ps1` 为 UTF-8 BOM 编码（PowerShell 5.1/7 均正确识别）；bat 为 GBK+CRLF（同 §8-16 约束）；文件对话框来自 `System.Windows.Forms`（Windows 内置）。
- 建议备份前先停止托盘应用（避免会话写入中的不一致），非强制。

## 14. 跨平台与安卓化评估（2026-08-18）

### Linux / macOS 支持（已代码化，仅 Windows 实测）

- `main.cjs` 平台适配层（`IS_WIN` 分支）：进程终止（Windows taskkill / POSIX `process.kill`+SIGTERM）、端口探测（netstat / `lsof`）、dsh spawn（`cmd /c pnpm` / 直接 spawn + detached 进程组）、AUMID 仅 Windows；
- 脚本：`start.sh` / `stop.sh` / `deploy.sh`（等价 bat 三件套，语法已校验；**POSIX 行为未实测，需在 Linux/macOS 上验证**）；
- 备份/恢复工具（PowerShell ps1）为 Windows 专属；POSIX 平台界面按钮会提示用系统 zip/tar 手动备份。

### 安卓化评估（结论：不建议原生安卓化，推荐远程访问）

| 维度 | 现状 | 安卓化障碍 |
|---|---|---|
| 应用壳 | Electron 托盘应用 | Electron **不支持安卓**；需换 WebView 方案（Capacitor/Cordova 包 web UI） |
| dsh 后端 | Node.js ≥22（TS/ESM） | 安卓可跑（Termux 受限环境），但后台常驻受限（安卓进程管理/电池优化会杀后台） |
| 本地模型 | Ollama + qwen3:8b（5.2GB） | **Ollama 无官方安卓版**，本地推理不可行（显存/功耗） |
| 云端 API | DeepSeek API | ✅ 可行 |
| 网络 | dsh 仅监听 127.0.0.1，官方不支持 --host 0.0.0.0 | 手机无法直连；需隧道（Tailscale/SSH 端口转发）或反向代理暴露 |

**推荐路径**：dsh 部署在 PC/服务器（或云 VPS 配云端 API Key），安卓端用浏览器或 WebView 经 Tailscale/SSH 隧道访问 —— 工作量和收益最优。若官方未来支持 `--host 0.0.0.0`，再配反向代理即可秒级实现手机访问。原生安卓 App（本地跑 dsh + 模型）当前不可行。

## 12. 待办与建议

- [ ] **用户填 DeepSeek API Key**（UI：Settings → Models；填后建议默认模型切回 DeepSeek，编程 agent 体验最佳；本地 qwen3:8b 作离线备胎）
- [ ] 壳增强（可选）：开机自启（schtasks/NSSM）、electron-builder 打包独立 exe（托盘已实现）
- [ ] Ollama 模型迁至 D 盘（可选）：需改 `OLLAMA_MODELS` 环境变量并重启 Ollama
- [ ] 长期维护：`git pull && pnpm install && pnpm run build` 升级 + 烟测验证
- [ ] 若在 Web UI 长期使用本地小模型：把 `no-runtime-context.yml` 补丁合并进 `profiles\web\cordis.patch.yml`

---

*本文档由部署过程全记录整理而成；所有路径、命令、行为均经实测验证。*
