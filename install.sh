#!/usr/bin/env bash
# DeepSeek Harness Local svpts 自举安装器（Linux/macOS）
# 单个文件即可完成：下载本文件到任意目录 → 运行 → 自动 clone 仓库（含子模块）→ 自动部署 → 可用
set -euo pipefail

REPO_URL="https://github.com/thisissevenpoints/DeepSeek-Harness-Local-svpts.git"
TARGET_DIR="DeepSeek-Harness-Local-svpts"

echo "=========================================="
echo "  DeepSeek Harness Local svpts 自举安装"
echo "=========================================="

command -v git >/dev/null || { echo "[x] 未找到 git"; exit 1; }
command -v node >/dev/null || { echo "[x] 未找到 node（需 >=22.19 或 >=24）"; exit 1; }
command -v pnpm >/dev/null || { echo "[x] 未找到 pnpm"; exit 1; }
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
