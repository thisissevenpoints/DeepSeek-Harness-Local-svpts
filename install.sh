#!/usr/bin/env bash
# DeepSeek Harness Local svpts 自举安装器（Linux/macOS）
# 单个文件即可完成：下载本文件到任意目录 → 运行 → 自动安装缺失依赖 → 自动 clone 仓库（含子模块）→ 自动部署 → 可用
set -euo pipefail

REPO_URL="https://github.com/thisissevenpoints/DeepSeek-Harness-Local-svpts.git"
TARGET_DIR="DeepSeek-Harness-Local-svpts"

# 需要管理员权限时使用 sudo（已是 root 则省略）
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || { echo "[x] 未找到 sudo（自动安装依赖需要管理员权限，或手动安装依赖后重跑）"; exit 1; }
  SUDO="sudo"
fi

# 通过 nvm 安装 node（用户级，免 sudo；其余发行版兜底方案）
install_node_via_nvm() {
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 22
}

echo "=========================================="
echo "  DeepSeek Harness Local svpts 自举安装"
echo "=========================================="

# ---------- 1) 工具链自检（缺失自动安装，一次性全完成） ----------
if ! command -v git >/dev/null; then
  echo "[!] 未找到 git，尝试自动安装……"
  if command -v apt-get >/dev/null; then
    $SUDO apt-get update && $SUDO apt-get install -y git \
      || { echo "[x] git 自动安装失败，请手动安装后重跑"; exit 1; }
  elif command -v dnf >/dev/null; then
    $SUDO dnf install -y git \
      || { echo "[x] git 自动安装失败，请手动安装后重跑"; exit 1; }
  elif command -v pacman >/dev/null; then
    $SUDO pacman -Sy --noconfirm git \
      || { echo "[x] git 自动安装失败，请手动安装后重跑"; exit 1; }
  elif command -v brew >/dev/null; then
    brew install git \
      || { echo "[x] git 自动安装失败，请手动安装后重跑"; exit 1; }
  else
    echo "[x] 无法自动安装 git，请手动安装后重跑"
    exit 1
  fi
  command -v git >/dev/null || { echo "[x] git 安装后仍不可用"; exit 1; }
  echo "[v] git 已自动安装"
fi

if ! command -v node >/dev/null; then
  echo "[!] 未找到 node（需 >=22.19 或 >=24），尝试自动安装……"
  if command -v apt-get >/dev/null; then
    # Debian/Ubuntu：NodeSource 官方源（apt 自带 nodejs 版本过老）
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - \
      && $SUDO apt-get install -y nodejs \
      || { echo "[x] node 自动安装失败，请手动安装后重跑"; exit 1; }
  elif command -v brew >/dev/null; then
    # macOS：Homebrew
    brew install node@22 \
      || { echo "[x] node 自动安装失败，请手动安装后重跑"; exit 1; }
    export PATH="$(brew --prefix node@22)/bin:$PATH"
  else
    # 其余发行版（dnf/pacman 等）与无包管理器环境：nvm 兜底
    install_node_via_nvm || { echo "[x] node 自动安装失败，请手动安装后重跑"; exit 1; }
  fi
  command -v node >/dev/null || { echo "[x] node 安装后仍不可用"; exit 1; }
  echo "[v] node 已自动安装"
fi

if ! command -v pnpm >/dev/null; then
  echo "[!] 未找到 pnpm，尝试自动安装……"
  command -v npm >/dev/null || { echo "[x] 未找到 npm（node 安装异常），请手动处理"; exit 1; }
  npm install -g pnpm || { echo "[x] pnpm 自动安装失败，请手动安装后重跑"; exit 1; }
  # npm 全局 bin 若不在 PATH，补上后重查
  command -v pnpm >/dev/null || export PATH="$(npm config get prefix)/bin:$PATH"
  command -v pnpm >/dev/null || { echo "[x] pnpm 安装后仍不可用（请重启终端后重跑）"; exit 1; }
  echo "[v] pnpm 已自动安装"
fi
echo "[v] git / node / pnpm 就绪"

[ ! -e "$TARGET_DIR" ] || { echo "[x] 目录 $TARGET_DIR 已存在，请移除或换目录运行"; exit 1; }

echo "[1/2] 拉取仓库（含子模块，约 300MB，请耐心等待）……"
git clone --recurse-submodules "$REPO_URL" "$TARGET_DIR"

echo "[2/2] 运行部署脚本（依赖安装 + 构建，约 3-10 分钟）……"
cd "$TARGET_DIR"
./deploy.sh

echo "=========================================="
echo "  安装完成！"
echo "  启动：$TARGET_DIR/start.sh"
echo "  说明：README.md（使用）、HANDOVER.md（运维）"
echo "=========================================="
