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
set "TARGET_ABS=%~dp0%TARGET_DIR%"
set "SEP=\"

echo ==========================================
echo   DeepSeek Harness Local svpts 自举安装
echo ==========================================
echo.

rem 1) 工具链自检（缺失自动安装；安装后自动重启本脚本续跑，实现一次性全完成）
%SystemRoot%\System32\where.exe git >nul 2>nul
if errorlevel 1 (
    echo [!] 未找到 git，尝试自动安装……
    winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo [x] git 自动安装失败，请手动安装后重跑：https://git-scm.com
        goto :FAIL
    )
    goto :RESTART
)
%SystemRoot%\System32\where.exe node >nul 2>nul
if errorlevel 1 (
    echo [!] 未找到 node，尝试自动安装（Node.js LTS）……
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo [x] node 自动安装失败，请手动安装后重跑：https://nodejs.org
        goto :FAIL
    )
    goto :RESTART
)
%SystemRoot%\System32\where.exe pnpm >nul 2>nul
if errorlevel 1 (
    echo [!] 未找到 pnpm，尝试自动安装……
    call npm install -g pnpm
    if errorlevel 1 (
        echo [x] pnpm 自动安装失败，请手动安装后重跑：npm install -g pnpm
        goto :FAIL
    )
    goto :RESTART
)
echo [v] git / node / pnpm 就绪

rem 2) 目标目录冲突检查
if exist "%TARGET_ABS%" (
    echo [x] 目录 %TARGET_ABS% 已存在，请先移除或换目录运行本脚本。
    goto :FAIL
)

rem 3) clone 仓库（含 deepseek-harness 子模块）
echo [1/2] 拉取仓库（含子模块，约 300MB，请耐心等待）……
git clone --recurse-submodules "%REPO_URL%" "%TARGET_ABS%"
if errorlevel 1 (
    echo [x] clone 失败（检查网络后重试）
    goto :FAIL
)
echo [v] 仓库已就位

rem 4) 自动部署（环境审查与补足）
echo [2/2] 运行部署脚本（依赖安装 + 构建，约 3-10 分钟）……
cd /d "%TARGET_ABS%"
call "%TARGET_ABS%%SEP%deploy-win.bat"
if errorlevel 1 (
    echo [x] 部署失败，请查看上方提示。
    goto :FAIL
)

echo ==========================================
echo   安装完成！
echo   启动：双击 %TARGET_ABS%%SEP%启动DeepSeek-Harness.bat
echo   说明：README.md（使用）、HANDOVER.md（运维）
echo ==========================================
%SystemRoot%\System32\PING.EXE -n 6 127.0.0.1 >nul
exit /b 0

:FAIL
echo.
echo [x] 安装中止，请按提示处理后重跑本脚本。
%SystemRoot%\System32\PING.EXE -n 6 127.0.0.1 >nul
exit /b 1

rem 自动安装完成：新开 cmd 进程（读取刷新后的 PATH）重跑本脚本
:RESTART
start "" cmd /c "call "%~f0""
exit /b 0
