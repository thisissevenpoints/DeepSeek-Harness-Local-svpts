@echo off
setlocal

rem ============================================================
rem  DeepSeek Harness Local svpts 一键停止（托盘应用 + 后台服务）
rem  双击即可；只停后台服务与托盘应用，不影响已打开的前端窗口。
rem  前端随时可用 启动DeepSeek-Harness.bat 重新打开（秒连）。
rem ============================================================

rem 0) 项目根 = 本脚本所在目录（可任意位置部署）
set "ROOT=%~dp0"

rem 1) 优雅路径：写停止标记，应用会在约 5 秒内自行清理退出
if exist "%ROOT%desktop\watchdog.pid" (
    echo [停止] 通知托盘应用退出（等待最多约 10 秒）……
    set /p WD_PID=<"%ROOT%desktop\watchdog.pid"
    type nul > "%ROOT%desktop\watchdog.stop"
    for /l %%i in (1,1,10) do (
        %SystemRoot%\System32\tasklist.exe /FI "PID eq %WD_PID%" >nul 2>nul
        if errorlevel 1 goto :WD_GONE
        %SystemRoot%\System32\PING.EXE -n 2 127.0.0.1 >nul
    )
    echo [提示] 应用未按时退出，强制清理。
    %SystemRoot%\System32\taskkill.exe /F /T /PID %WD_PID% >nul 2>nul
    del /q "%ROOT%desktop\watchdog.stop" >nul 2>nul
)

:WD_GONE
rem 2) 兜底：清理 3180 上的残留实例（外部手动启动 / 孤儿进程）
for /f "tokens=5" %%a in ('%SystemRoot%\System32\netstat.exe -ano ^| %SystemRoot%\System32\findstr.exe ":3180" ^| %SystemRoot%\System32\findstr.exe /C:"LISTENING"') do (
    echo [停止] 清理 3180 残留实例（PID %%a）……
    %SystemRoot%\System32\taskkill.exe /F /T /PID %%a >nul 2>nul
)
echo [完成] 后台服务与托盘应用已停止。
%SystemRoot%\System32\PING.EXE -n 4 127.0.0.1 >nul
exit /b 0
