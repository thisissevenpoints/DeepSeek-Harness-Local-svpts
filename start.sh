#!/usr/bin/env bash
# DeepSeek Harness Local svpts — Linux/macOS 启动脚本（等价 Windows 的 启动DeepSeek-Harness.bat）
# 用法：./start.sh   （首次使用前先跑 ./deploy.sh）
set -euo pipefail
cd "$(dirname "$0")"

export ELECTRON_RUN_AS_NODE=""   # 确保为空（Electron 非 node 模式）
export DSH_HOME="${DSH_HOME:-$PWD/dsh-home}"

# 依赖自检
command -v node >/dev/null || { echo "[错误] 未找到 node（需 >=22.19 或 >=24）"; exit 1; }
command -v pnpm >/dev/null || { echo "[错误] 未找到 pnpm"; exit 1; }
[ -f desktop/node_modules/electron/dist/electron ] || { echo "[错误] 未找到 Electron（先运行 ./deploy.sh）"; exit 1; }

# 若已有实例在跑，仅唤起窗口（Electron 单实例锁自动处理）
nohup desktop/node_modules/electron/dist/electron desktop >/dev/null 2>&1 &
echo "[启动] 托盘图标将出现；应用窗口约 10-30 秒后显示真实界面。"
echo "[提示] 停止：托盘右键退出，或 ./stop.sh"
