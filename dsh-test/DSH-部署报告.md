# DeepSeek Harness (dsh) 本地部署报告

部署日期：2026-08-16　|　部署模式：**模式 B（源码安装）**　|　版本：0.1.0-rc.5（master 分支，developer preview）

> **2026-08-16 迁移记录**：整体迁移至 `<项目根>\`。
> - 源码：`C:\Users\<username>\dev\deepseek-harness` → `<项目根>\deepseek-harness`（全新 clone 后重装重建）
> - Harness home：`C:\Users\<username>\.dsh` → `<项目根>\dsh-home`（已设置用户环境变量 `DSH_HOME` 指向此处）
> - 测试区：`C:\Users\<username>\dsh-test` → `<项目根>\dsh-test`
> - Ollama 模型：按用户选择**留在 `C:\OllamaModels`**（未改动环境变量）

---

## 1. 环境摘要

| 项目 | 值 |
|---|---|
| 操作系统 | Windows 11 Pro for Workstations（10.0.26200.9168，x86_64） |
| Node.js | v22.23.2（满足 ^22.19.0 || >=24 要求；Cherry mise shims 提供） |
| npm | 10.9.8 |
| pnpm | 11.7.0（按仓库 packageManager 字段自动采用） |
| git | 2.55.0.windows.4 |
| Python | 3.10.11 |
| Ollama | 0.32.13（本地模型：qwen3:8b、qwen2.5:7b、qwen2.5:3b、gemma2:9b） |
| 显存 | ≤8GB（用户确认）；内存 96GB（空闲约 39GB）；磁盘 D: 剩余约 305GB |
| 网络 | github.com / registry.npmjs.org 均 HTTP 200 |

## 2. 执行的命令清单与关键输出

源码位置：`<项目根>\deepseek-harness`（官方 README "Run from source" 流程，未做任何改动）

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git   # 成功
cd deepseek-harness
pnpm install   # 成功：Done in 28.7s using pnpm v11.7.0（仅示例 bin 的无关 WARN）
pnpm run build # 成功：tsc host/client + tsdown + Web 前端
pnpm dsh web   # 成功：dsh web: http://127.0.0.1:3080
```

配置（`<项目根>\dsh-home\settings.yaml`，遵循 `llm-pi-ai` 与 `agent-default-model` 官方 schema）：

```yaml
llm-pi-ai:
  providers:
    ollama-local:
      displayName: Ollama Local
      apiKeyEnv: OLLAMA_PLACEHOLDER_KEY   # 无鉴权本地服务器所需的占位凭证（官方文档要求）
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      models:
        - id: qwen3:8b            # 默认模型
        - id: qwen2.5:7b
        - id: gemma2:9b-instruct-q4_K_M
agent-default-model:
  provider: ollama-local
  model: qwen3:8b
```

`<项目根>\dsh-home\.env`：`OLLAMA_PLACEHOLDER_KEY=ollama`（占位值，非真实密钥）。

## 3. 启动 / 停止 / 重启

| 操作 | 命令 |
|---|---|
| 启动 | `cd <项目根>\deepseek-harness && pnpm dsh web` |
| 优雅停止 | 终端内 Ctrl+C（SIGINT，exit 130）或 SIGTERM（exit 0，5 秒排空） |
| 强制停止 | `netstat -ano \| findstr :3080` 找到 PID → `taskkill /F /PID <pid>` |
| 重启 | 停止后重新执行启动命令；settings.yaml 修改热生效（无需重启），但 `.env` 仅启动时加载，改 `.env` 后需重启 |
| 升级 | `cd <项目根>\deepseek-harness && git pull && pnpm install && pnpm run build` 后重启 |

**后台常驻建议**：长期使用建议自己开一个终端窗口运行 `pnpm dsh web`，或通过任务计划程序（schtasks）/NSSM 注册为 Windows 服务实现开机自启（工作目录设为仓库根）。

## 4. 已配置的模型与端点

| Provider | 端点 | 协议 | 模型 |
|---|---|---|---|
| ollama-local | http://127.0.0.1:11434/v1 | openai-completions | qwen3:8b（默认）、qwen2.5:7b、gemma2:9b-instruct-q4_K_M |

- Web UI 默认地址：http://127.0.0.1:3080（仅监听 127.0.0.1，官方暂不支持 --host 0.0.0.0）
- DeepSeek 云端 API：待你在 UI 中填 Key 后即用（Settings → Models 的 DeepSeek 卡片；页面密钥只写不回显）

## 5. 验收标准逐条结果（迁移前已全部通过，迁移后已复验）

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | dsh 进程启动、持续运行、打印地址 | ✅ 通过 | 输出 `dsh web: http://127.0.0.1:3080`；netstat 显示 LISTENING |
| 2 | curl 返回 HTTP 200 | ✅ 通过 | `curl -sI http://127.0.0.1:3080` → `HTTP/1.1 200 OK` |
| 3 | 配置模型并完成真实任务往返（独立临时目录创建 hello.txt 写入 Hello） | ✅ 通过（有本地模型注意事项，见下） | 独立临时目录（现位于 `<项目根>\dsh-test\hello-workspace-760`），agent（qwen3:8b）创建 `hello.txt`，内容精确为 `Hello`（5 字节，已 cat 验证）；headless 运行 exit 0、turn reason=completed。另完成 PONG 纯文本往返验证 |
| 4 | 凭证存储位置与权限 | ✅ 已核实 | 凭证目录 `<项目根>\dsh-home\`（`DSH_HOME` 已设为用户环境变量）。`.credentials.yaml` 在 UI 保存 Key 后生成；settings.yaml/.env 权限 644。部署全程未产生任何真实密钥 |
| 5 | 退出与重启方式 | ✅ 已记录 | 见第 3 节 |

**验收 3 的本地模型注意事项（重要）**：
- 小型本地模型会被 dsh 默认注入的"runtime context"尾随用户消息带偏（把环境说明当成本次指令）。已验证的解决方案：headless 运行时附加补丁 `--patch <项目根>\dsh-test\no-runtime-context.yml`（关闭 `system-prompt` 的 `includeRuntimeContext`）。DeepSeek 云端 API 等强模型无此问题，Web UI 默认配置无需改动；如需在 Web UI 长期使用本地小模型，可将该补丁内容合并进 `<项目根>\dsh-home\profiles\web\cordis.patch.yml`。
- qwen3:8b 会先输出长思考再行动，单步耗时约 20 秒；任务措辞越具体（指明工具与参数）成功率越高。gemma2:9b（旧版）不支持 tools API，qwen2.5:7b 工具调用不稳定，均不建议作为 agent 模型。
- 若你填入 DeepSeek API Key，建议在 Settings → Models 把默认模型切回 DeepSeek（编程 agent 体验最佳）。

## 6. 常用运维命令速查

```sh
# 升级
cd <项目根>\deepseek-harness && git pull && pnpm install && pnpm run build
# 启动（前台，Ctrl+C 停止）
cd <项目根>\deepseek-harness && pnpm dsh web
# 查看监听进程
netstat -ano | findstr :3080
# 单次任务（headless，小模型需附加补丁）
cd <你的工作目录> && TSX_TSCONFIG_PATH="D:/alpha/DeepSeek-Harness-Local/deepseek-harness/tsconfig.json" node --import "<tsx/esm 绝对路径>" "D:/alpha/DeepSeek-Harness-Local/deepseek-harness/apps/cli/src/bin.ts" --profile headless --patch "D:/alpha/DeepSeek-Harness-Local/dsh-test/no-runtime-context.yml" "<任务>"
# 日志与数据
#   会话记录：<项目根>\dsh-home\sessions\（zstd 压缩 JSONL）
#   配置：     <项目根>\dsh-home\settings.yaml（热生效）、.env（启动加载）、profiles\*\cordis.patch.yml
#   Ollama 模型：C:\OllamaModels\（按用户选择未迁移）；日志：C:\Users\<username>\AppData\Local\Ollama\
```

## 7. 风险提示与下一步建议

1. **预览版兼容性**：当前为 developer preview（0.1.0-rc.5），官方明确提示会有破坏性变更；升级后若启动失败，先 `pnpm install && pnpm run build` 重建，仍失败则查 GitHub Discussions。
2. **显存/性能依赖**：qwen3:8b 约 5.2GB，≤8GB 显存可跑但单步约 20 秒；长上下文会额外占用 KV 缓存。显存紧张时可用 qwen2.5:3b（2.2GB）应急，但仅适合简单任务。
3. **网络依赖**：本地模型链路由 Ollama 常驻服务提供（127.0.0.1:11434）；若用 DeepSeek 云端 API 则需外网。Web UI 仅监听 127.0.0.1，官方暂不支持对外暴露。
4. **安全隔离**：dsh 默认会话权限为 `workspace-write`（文件修改限于会话工作区与系统临时目录），headless 无审批通道时按"失败关闭"处理。密钥一律由 UI 写入 `DSH_HOME\.credentials.yaml`（只写不回显），请勿把真实密钥放入 `.env`。当前 `.env` 内仅为占位值。
5. **下一步建议**：
   - 在浏览器打开 http://127.0.0.1:3080 → Settings → Models 填入 DeepSeek API Key（我全程不接触该密钥）；
   - UI 中 "Choose workspace" 选择你要用的项目目录（建议先用 `<项目根>\dsh-test\hello-workspace-760` 试跑）；
   - 编程 agent 日常使用建议切换默认模型到 DeepSeek 云端；本地 qwen3:8b 作为离线备胎；
   - 如需把 dsh 作为常驻后台服务，按第 3 节注册开机自启。

## 8. 迁移后目录总览

```
<项目根>\
├── deepseek-harness\        # 源码仓库（全新 clone + install + build）
├── dsh-home\                # Harness home（DSH_HOME 指向此处）
│   ├── settings.yaml        # 模型路由配置（热生效）
│   ├── .env                 # 占位凭证（非真实密钥）
│   ├── .credentials.yaml    # 保存 API Key 后生成（只写不回显）
│   ├── profiles\            # web / headless 配置
│   ├── sessions\            # 会话持久化记录（含迁移前 C 盘路径命名的历史会话，仅历史数据）
│   └── storages\            # 工作区存储
├── desktop\                 # Electron 桌面壳（自动拉起 dsh web、退出自动清理）
│   ├── main.cjs             # 壳主进程（含烟测模式与诊断日志）
│   ├── shell.log / dsh-web.log  # 运行诊断日志
│   └── README.md            # 壳使用说明
└── dsh-test\                # 验收测试区
    ├── DSH-部署报告.md       # 本报告
    ├── no-runtime-context.yml  # 本地小模型 headless 补丁
    ├── hello-workspace-760\hello.txt   # 迁移前验收产物
    └── roundtrip-3154\hello.txt        # 迁移后全面整理测试产物
```

## 9. Electron 桌面壳（2026-08-16 新增）

- 位置：`<项目根>\desktop\`，启动：`cd desktop && npm start`。
- 行为：检测 3080 无服务时自动在仓库目录拉起 `pnpm dsh web`（带 DSH_HOME），等待 HTTP 200 + `/api/events.mux` WS 握手就绪后打开窗口；页面 boot 失败自动等待并重载（≤7 次）；关闭窗口时 `taskkill /T /F` 清理自己拉起的 dsh 进程树，外部实例不受影响。
- 烟测：`set DSH_DESKTOP_SMOKE=1 && npm start` 自动截图 smoke.png、输出页面诊断 smoke.txt 后退出。已验证：自拉起 → 完整 UI 渲染（含"选择工作区"主界面）→ 退出清理全链路通过。
- 踩坑记录：① 本机会话环境设有 `ELECTRON_RUN_AS_NODE=1`，会导致 Electron 以纯 Node 运行，启动前需清空该变量；② Electron 37 已移除 `BrowserWindow.setWindowOpenHandler`，需用 `win.webContents.setWindowOpenHandler`；③ 主进程用 fetch+Upgrade 头探测 WS 端点不稳定（会挂起/崩溃），已改用 `ws` 包握手探测。
- 已知限制：无托盘、无开机自启；窗口关闭即停 dsh 服务。

> **2026-08-16 迁移后全面整理测试（复验）**：环境变量 `DSH_HOME` 已写入用户注册表；Web 首页与前端资产均 200；Ollama 四个模型在线；仓库工作树干净、构建产物完好；全新独立目录 `roundtrip-3154` 完成 hello.txt 真实任务往返（exit 0）；新会话按 D 盘路径键名正常落盘；profile 符号链接自愈指向 D 盘；配置与存储无 C 盘路径残留；C 盘原三处位置已确认删除。全部检查通过，无遗留问题。
