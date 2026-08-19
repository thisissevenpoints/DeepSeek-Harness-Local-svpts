@echo off
setlocal
rem ============================================================
rem  DeepSeek Harness Local svpts 一键部署（ASCII 名入口）
rem  由 部署DeepSeek-Harness.bat / install.bat 调用；
rem  ASCII 文件名确保任何代码页/区域下 call 均可解析。
rem ============================================================
@echo off
setlocal

rem ============================================================
rem  DeepSeek Harness Local svpts 一键部署
rem  git 拉取到本地后的环境审查与补足脚本。
rem  双击即可；可重复运行（已满足的步骤自动跳过）。
rem  完成所有步骤后，即可双击 启动DeepSeek-Harness.bat 使用。
rem  首次运行约需 3-10 分钟（取决于网络与磁盘），请勿关闭窗口。
rem ============================================================

set "ROOT=%~dp0"
set "REPO=%ROOT%deepseek-harness"
set "DESKTOP=%ROOT%desktop"
set "HOME_DIR=%ROOT%dsh-home"

echo ==========================================
echo   DeepSeek Harness Local svpts 一键部署
echo ==========================================
echo.

rem ---------- 1/6 工具链审查 ----------
echo [1/6] 审查工具链（Node / pnpm / git）……

%SystemRoot%\System32\where.exe node >nul 2>nul
if errorlevel 1 (
    echo   [x] 未找到 node.exe（需要 Node.js ^>=22.19 或 ^>=24）
    goto :FAIL
)
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
set "NV=%NODE_VER:~1%"
for /f "tokens=1,2 delims=." %%a in ("%NV%") do set "NMAJ=%%a" & set "NMIN=%%b"
set "NODE_OK="
if %NMAJ% GEQ 24 set "NODE_OK=1"
if %NMAJ% EQU 22 if %NMIN% GEQ 19 set "NODE_OK=1"
if %NMAJ% GTR 22 if %NMAJ% LSS 24 set "NODE_OK=1"
if not defined NODE_OK (
    echo   [x] Node 版本不满足：当前 %NODE_VER%（需要 ^>=22.19 或 ^>=24）
    goto :FAIL
)
echo   [v] Node.js %NODE_VER% 满足要求

%SystemRoot%\System32\where.exe pnpm >nul 2>nul
if errorlevel 1 (
    echo   [x] 未找到 pnpm（安装：npm install -g pnpm）
    goto :FAIL
)
echo   [v] pnpm 已安装

%SystemRoot%\System32\where.exe git >nul 2>nul
if errorlevel 1 (
    echo   [x] 未找到 git
    goto :FAIL
)
echo   [v] git 已安装

echo.

rem ---------- 2/6 Ollama 检查（可选） ----------
echo [2/6] 检查 Ollama 本地模型服务（可选）……
%SystemRoot%\System32\curl.exe -s --max-time 3 http://127.0.0.1:11434/api/version >nul 2>nul
if errorlevel 1 (
    echo   [!] 未检测到 Ollama。仅使用本地模型时需要（安装并启动 Ollama 后重跑本脚本）。
    echo       （若使用 DeepSeek 云端 API Key 可跳过此项）
) else (
    echo   [v] Ollama 在线
)

echo.

rem ---------- 3/6 dsh-home 补足 ----------
echo [3/6] 准备 Harness home（dsh-home）……
if not exist "%HOME_DIR%" (
    mkdir "%HOME_DIR%" >nul 2>nul
    echo   [v] 已创建 dsh-home
) else (
    echo   [v] dsh-home 已存在
)
if not exist "%HOME_DIR%\.env" (
    echo OLLAMA_PLACEHOLDER_KEY=ollama> "%HOME_DIR%\.env"
    echo   [v] 已创建 .env 占位凭证（本地无鉴权服务器所需）
) else (
    echo   [v] .env 已存在
)

echo.

rem ---------- 4/6 子模块初始化 ----------
echo [4/6] 初始化 deepseek-harness 子模块……
rem 判定：子模块目录内无 .git 元数据 = 未初始化
rem 注意 %~dp0 尾部反斜杠会转义引号，git -C 需用 "%ROOT%."
if not exist "%REPO%\.git" (
    echo   正在拉取子模块（deepseek-harness 上游源码，约 200MB）……
    git -C "%ROOT%." submodule update --init --recursive
    if errorlevel 1 (
        echo   [x] 子模块初始化失败（检查网络后重跑）
        goto :FAIL
    )
    echo   [v] 子模块已初始化
) else (
    echo   [v] 子模块已初始化
)

echo.

rem ---------- 5/6 仓库依赖与构建 ----------
echo [5/6] 检查 deepseek-harness 依赖与构建产物……
if not exist "%REPO%\node_modules\.pnpm" (
    echo   安装仓库依赖（pnpm install）……
    cd /d "%REPO%"
    call pnpm install
    if errorlevel 1 (
        rem lefthook postinstall 在 submodule 下已知失败（worktreeConfig 冲突，仅影响开发 hooks）；依赖已装则宽容继续
        if exist "%REPO%\node_modules\.pnpm" (
            echo   [!] pnpm install 部分脚本失败（lefthook hooks 跳过），依赖已就位，继续
        ) else (
            echo   [x] pnpm install 失败
            goto :FAIL
        )
    )
    echo   [v] 依赖已安装
) else (
    echo   [v] 依赖已存在
)
if not exist "%REPO%\apps\web\dist" (
    echo   构建（pnpm run build，约 1-3 分钟）……
    cd /d "%REPO%"
    call pnpm run build
    if errorlevel 1 (
        echo   [x] 构建失败
        goto :FAIL
    )
    echo   [v] 构建完成
) else (
    echo   [v] 构建产物已存在
)

echo.

rem ---------- 6/6 桌面壳依赖 ----------
echo [6/6] 检查桌面壳依赖（Electron）……
if not exist "%DESKTOP%\node_modules\electron\dist\electron.exe" (
    echo   安装桌面壳依赖（Electron 约 120MB，需联网）……
    cd /d "%DESKTOP%"
    call npm install
    if errorlevel 1 (
        echo   [x] 桌面壳依赖安装失败
        goto :FAIL
    )
    echo   [v] Electron 已就绪
) else (
    echo   [v] Electron 已就绪
)

echo.
echo ==========================================
echo   部署完成！接下来：
echo   1) 双击 启动DeepSeek-Harness.bat  启动托盘应用
echo   2) 停止：托盘右键"退出"或双击 停止DeepSeek-Harness.bat
echo   3) 升级 dsh 后建议先跑一次烟测：
echo      set DSH_DESKTOP_SMOKE=1 后双击启动脚本
echo   4) 详细说明见 README.md 与 HANDOVER.md
echo   5) 备份/恢复对话存档：双击 备份恢复DeepSeek-Harness.bat
echo ==========================================
%SystemRoot%\System32\PING.EXE -n 4 127.0.0.1 >nul
exit /b 0

:FAIL
echo.
echo [x] 部署中止：请按上方提示处理后重跑本脚本。
%SystemRoot%\System32\PING.EXE -n 6 127.0.0.1 >nul
exit /b 1
