@echo off
setlocal

rem ============================================================
rem  DeepSeek Harness Local svpts 一键启动（托盘应用）
rem  双击即可使用；本启动器窗口几秒后自动关闭，不常驻。
rem  首次启动：托盘图标出现 + 应用窗口自动打开（loading 页即时反馈）。
rem  应用已在运行：直接唤起应用窗口（秒开）。
rem  关闭窗口 = 回到托盘，后台继续运行；
rem  彻底停止：托盘右键"退出（停止后台服务）"或双击 停止DeepSeek-Harness.bat。
rem  日志：desktop\watchdog.log、desktop\shell.log、desktop\dsh-web.log
rem ============================================================

rem 0) 项目根 = 本脚本所在目录（可任意位置部署）
set "ROOT=%~dp0"

rem 1) 兜底设置 Harness home（应用内部同样会注入，此处保证控制台环境一致）
if "%DSH_HOME%"=="" set "DSH_HOME=%ROOT%dsh-home"

rem 2) 依赖自检（外部命令全部用 System32 绝对路径，避免被 Git Bash 等工具链同名命令劫持）
%SystemRoot%\System32\where.exe node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 node.exe，请先安装 Node.js 22 以上版本并加入 PATH。
    pause
    exit /b 1
)
%SystemRoot%\System32\where.exe pnpm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 pnpm，请先安装 pnpm。
    pause
    exit /b 1
)
if not exist "%ROOT%desktop\node_modules\electron\dist\electron.exe" (
    echo [错误] 未找到 Electron。请先安装桌面壳依赖：
    echo        cd /d "%ROOT%desktop" ^&^& npm install
    pause
    exit /b 1
)
if not exist "%ROOT%desktop\main.cjs" (
    echo [错误] 未找到应用主程序 desktop\main.cjs，请检查部署完整性。
    pause
    exit /b 1
)

rem 3) 端口占用提示：已有服务时直接复用，不会误杀
%SystemRoot%\System32\netstat.exe -ano | %SystemRoot%\System32\findstr.exe ":3080" | %SystemRoot%\System32\findstr.exe /C:"LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [提示] 检测到 3080 端口已有 dsh 服务在运行，将直接复用。
)

rem 4) 拉起托盘应用（脱离本窗口；已在运行则唤起其窗口），随后本窗口自动关闭
rem    注意：必须用 $env:VAR = $null 彻底删除 ELECTRON_RUN_AS_NODE，
rem    空字符串会被 Electron 误判为纯 Node 模式导致启动失败。
echo [启动] 正在启动 DeepSeek Harness（托盘 + 窗口）……
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -WindowStyle Hidden -Command "$env:ELECTRON_RUN_AS_NODE = $null; Start-Process -FilePath '%ROOT%desktop\node_modules\electron\dist\electron.exe' -ArgumentList '.' -WorkingDirectory '%ROOT%desktop'"
echo [提示] 托盘图标立即出现；应用窗口约 10-30 秒后显示真实界面。
%SystemRoot%\System32\PING.EXE -n 4 127.0.0.1 >nul
exit /b 0
