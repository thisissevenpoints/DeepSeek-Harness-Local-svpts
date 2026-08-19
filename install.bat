@echo off
setlocal

rem ============================================================
rem  DeepSeek Harness Local svpts 自举安装器（Windows）
rem  单个文件即可完成：下载本文件到任意目录 → 运行 → 自动
rem  clone 仓库（含子模块）→ 自动部署（依赖+构建）→ 即可使用。
rem  无需手动下载任何二进制安装包（仓库内不含不可审查的二进制）。
rem ============================================================

set "REPO_URL=https://github.com/thisissevenpoints/DeepSeek-Harness-Local-svpts.git"
set "TARGET_DIR=DeepSeek-Harness-Local-svpts"

echo ==========================================
echo   DeepSeek Harness Local svpts 自举安装
echo ==========================================
echo.

rem 1) 工具链自检
%SystemRoot%\System32\where.exe git >nul 2>nul
if errorlevel 1 (
    echo [x] 未找到 git（请先安装 git：https://git-scm.com）
    goto :FAIL
)
%SystemRoot%\System32\where.exe node >nul 2>nul
if errorlevel 1 (
    echo [x] 未找到 node（请先安装 Node.js 22 以上：https://nodejs.org）
    goto :FAIL
)
%SystemRoot%\System32\where.exe pnpm >nul 2>nul
if errorlevel 1 (
    echo [x] 未找到 pnpm（请先安装：npm install -g pnpm）
    goto :FAIL
)
echo [v] git / node / pnpm 就绪

rem 2) 目标目录冲突检查
if exist "%TARGET_DIR%" (
    echo [x] 目录 %TARGET_DIR% 已存在，请先移除或换目录运行本脚本。
    goto :FAIL
)

rem 3) clone 仓库（含 deepseek-harness 子模块）
echo [1/2] 拉取仓库（含子模块，约 300MB，请耐心等待）……
git clone --recurse-submodules "%REPO_URL%" "%TARGET_DIR%"
if errorlevel 1 (
    echo [x] clone 失败（检查网络后重试）
    goto :FAIL
)
echo [v] 仓库已就位

rem 4) 自动部署（环境审查与补足）
echo [2/2] 运行部署脚本（依赖安装 + 构建，约 3-10 分钟）……
cd /d "%TARGET_DIR%"
call deploy-win.bat
if errorlevel 1 (
    echo [x] 部署失败，请查看上方提示。
    goto :FAIL
)

echo ==========================================
echo   安装完成！
echo   启动：双击 %TARGET_DIR%\启动DeepSeek-Harness.bat
echo   说明：README.md（使用）、HANDOVER.md（运维）
echo ==========================================
%SystemRoot%\System32\PING.EXE -n 6 127.0.0.1 >nul
exit /b 0

:FAIL
echo.
echo [x] 安装中止，请按提示处理后重跑本脚本。
%SystemRoot%\System32\PING.EXE -n 6 127.0.0.1 >nul
exit /b 1
