#!/usr/bin/env bash
# DeepSeek Harness Local svpts — Linux/macOS 一键部署（等价 Windows 的 部署DeepSeek-Harness.bat）
# git 拉取后的环境审查与补足；可重复运行（已满足的步骤自动跳过）
set -euo pipefail
cd "$(dirname "$0")"

REPO="$PWD/deepseek-harness"
DESKTOP="$PWD/desktop"
HOME_DIR="${DSH_HOME:-$PWD/dsh-home}"

echo "=========================================="
echo "  DeepSeek Harness Local svpts 一键部署"
echo "=========================================="

echo "[1/6] 审查工具链……"
command -v node >/dev/null || { echo "[x] 未找到 node（需 >=22.19 或 >=24）"; exit 1; }
NODE_VER=$(node -v)
NV=${NODE_VER#v}
MAJ=${NV%%.*}; MIN=$(echo "$NV" | cut -d. -f2)
if [ "$MAJ" -lt 22 ] || { [ "$MAJ" -eq 22 ] && [ "$MIN" -lt 19 ]; }; then
  [ "$MAJ" -ge 24 ] || { echo "[x] Node 版本不满足：$NODE_VER（需 >=22.19 或 >=24）"; exit 1; }
fi
echo "  [v] Node.js $NODE_VER"
command -v pnpm >/dev/null || { echo "[x] 未找到 pnpm"; exit 1; }
echo "  [v] pnpm"
command -v git >/dev/null || { echo "[x] 未找到 git"; exit 1; }
echo "  [v] git"

echo "[2/6] 检查 Ollama（可选）……"
if curl -s --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "  [v] Ollama 在线"
else
  echo "  [!] 未检测到 Ollama（仅本地模型需要；云端 Key 可跳过）"
fi

echo "[3/6] 准备 Harness home……"
mkdir -p "$HOME_DIR"
if [ ! -f "$HOME_DIR/.env" ]; then
  echo "OLLAMA_PLACEHOLDER_KEY=ollama" > "$HOME_DIR/.env"
  echo "  [v] 已创建 .env 占位凭证"
else
  echo "  [v] .env 已存在"
fi

echo "[4/6] 初始化子模块……"
if [ ! -d "$REPO/.git" ]; then
  git submodule update --init --recursive
  echo "  [v] 子模块已初始化"
else
  echo "  [v] 子模块已初始化"
fi

echo "[5/6] 依赖与构建……"
if [ ! -d "$REPO/node_modules/.pnpm" ]; then
  (cd "$REPO" && pnpm install)
  echo "  [v] 依赖已安装"
else
  echo "  [v] 依赖已存在"
fi
if [ ! -d "$REPO/apps/web/dist" ]; then
  (cd "$REPO" && pnpm run build)
  echo "  [v] 构建完成"
else
  echo "  [v] 构建产物已存在"
fi

echo "[6/6] 桌面壳依赖（Electron）……"
if [ ! -f "$DESKTOP/node_modules/electron/dist/electron" ]; then
  (cd "$DESKTOP" && npm install)
  echo "  [v] Electron 已就绪"
else
  echo "  [v] Electron 已就绪"
fi

echo "=========================================="
echo "  部署完成！接下来：./start.sh 启动；./stop.sh 停止"
echo "=========================================="
