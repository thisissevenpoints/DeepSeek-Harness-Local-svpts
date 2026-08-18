#!/usr/bin/env bash
# DeepSeek Harness Local svpts — Linux/macOS 停止脚本（等价 Windows 的 停止DeepSeek-Harness.bat）
# 优雅路径：写停止信号 → 应用自清理退出；兜底：按端口清理
set -u
cd "$(dirname "$0")"

STOP_FILE=desktop/watchdog.stop
PID_FILE=desktop/watchdog.pid

if [ -f "$PID_FILE" ]; then
  WD_PID=$(cat "$PID_FILE")
  echo "[停止] 通知应用退出（等待最多 10 秒）……"
  touch "$STOP_FILE"
  for _ in $(seq 1 10); do
    if ! kill -0 "$WD_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$WD_PID" 2>/dev/null; then
    echo "[提示] 应用未按时退出，强制清理。"
    kill -TERM "$WD_PID" 2>/dev/null || true
  fi
  rm -f "$STOP_FILE"
fi

# 兜底：清理 3180 上的残留实例
LPID=$(lsof -t -i :3180 2>/dev/null | head -1)
if [ -n "$LPID" ]; then
  echo "[停止] 清理 3180 残留实例（PID $LPID）……"
  kill -TERM "$LPID" 2>/dev/null || true
fi

echo "[完成] 后台服务与应用已停止。"
