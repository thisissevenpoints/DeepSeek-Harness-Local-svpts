# DeepSeek Harness 托盘应用（看门狗 + 桌面壳，Electron MVP）

把 dsh Web UI（http://127.0.0.1:3180）包进一个 **常驻系统托盘的 Electron 应用**：应用本身同时是后台 dsh 服务的唯一 owner（看门狗）与桌面壳（按需开窗）。

## 生命周期模型

| 动作 | 结果 |
|---|---|
| 双击 `启动DeepSeek-Harness.bat`（项目根） | 首次启动：托盘图标 + 窗口自动打开（loading 页即时反馈）；已在运行：约 2 秒唤起窗口 |
| 关闭应用窗口 | 回到托盘，**后台继续运行**（会话保持） |
| 左键托盘图标 / 右键"打开 DeepSeek Harness" | 打开/聚焦应用窗口 |
| 右键"退出（停止后台服务）" / 双击停止脚本 | 显式退出：停后台 + 退出托盘 |
| 点击界面右上角 ⏻ 按钮 | 确认框（默认取消）→ 完全退出：停后台 + 退出托盘（按钮由壳注入，不改 DSH 前端本体） |
| 后台意外崩溃 | 看门狗自动拉起新实例（连续 4 次失败才放弃，后台恢复自动复位） |

## 组件

- `main.cjs`：托盘应用主进程。看门狗逻辑（健康巡检每 5 秒、**子进程存活判据**不误杀慢启动、崩溃自动重启、`watchdog.stop` 文件信号、`watchdog.pid` 兜底）+ 窗口逻辑（loading 页 → 就绪后真实 UI）；
- `tray.png`：托盘图标；
- `启动DeepSeek-Harness.bat` / `停止DeepSeek-Harness.bat`（项目根）：一键启停（GBK+CRLF 编码，改后需重新转码）。

## 使用

```bat
:: 日常推荐：双击 <项目根>\启动DeepSeek-Harness.bat
:: 停止：托盘右键"退出（停止后台服务）"，或双击 <项目根>\停止DeepSeek-Harness.bat
:: 手工方式（需后台已运行）
cd /d <项目根>\desktop
npm start
```

首次需先安装依赖（下载 Electron 二进制，约 120MB）：

```bat
cd /d <项目根>\desktop
npm install
```

## 冒烟测试

```bat
set DSH_DESKTOP_SMOKE=1
cd /d <项目根>
启动DeepSeek-Harness.bat
```

启动后自动截图 `smoke.png`、抓取页面诊断信息 `smoke.txt`，随后停掉后台并退出（干净状态）。**升级 dsh 后建议先跑一次烟测。**

## 诊断日志

- `watchdog.log`：看门狗巡检/拉起/重启/停止全过程；
- `shell.log`：壳等待/探测/加载/退出过程；
- `dsh-web.log`：应用拉起的 dsh 宿主输出（stdout 重定向到文件时有块缓冲，监听行可能延迟出现，不影响服务）；
- 若页面长期显示 "Failed to load plugins"，壳会自动等待 /api 路由就绪并重载页面（最多 7 次）。

## 故障排查

- **双击启动脚本后托盘图标没出现**：环境变量 `ELECTRON_RUN_AS_NODE` 被设为 `1` **或空字符串**都会导致 Electron 以纯 Node 模式运行（启动脚本已用 `$env:VAR = $null` 彻底删除该变量，一般无需手动处理）。直接运行 `electron .` 时需先 `set ELECTRON_RUN_AS_NODE=`（或 PowerShell 里 `$env:ELECTRON_RUN_AS_NODE = $null`）。
- **窗口一直显示"后台服务启动失败"**：看 `desktop\watchdog.log` 与 `dsh-web.log`；可用停止脚本清理后重试启动。
- **3180 端口被占**：直接复用已有服务（不重复启动）；停止脚本会停掉 3180 上的一切实例（明确停止即停一切）。

## 已知限制（MVP）

- 无开机自启、无更新检查、无打包；
- 仅本地 127.0.0.1，不对外暴露。
