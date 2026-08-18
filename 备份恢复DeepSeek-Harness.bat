@echo off
setlocal

rem ============================================================
rem  DeepSeek Harness 工作区备份 / 恢复 / 更新
rem  备份 = 对话存档（dsh-home\sessions）打包为 zip
rem  恢复 = 从 zip 还原（当前会话自动改名留底，可回退）
rem  更新 = 将当前对话存档合并进既有备份 zip
rem ============================================================

set "ROOT=%~dp0"

:menu
cls
echo ==========================================
echo  DeepSeek Harness 工作区备份 / 恢复 / 更新
echo ==========================================
echo  [1] 备份   将当前对话存档打包为 zip
echo  [2] 恢复   从 zip 还原对话存档（当前会话自动留底）
echo  [3] 更新   将当前对话存档合并进既有备份 zip
echo  [Q] 退出
echo.
choice /c 123Q /m "请选择"
if errorlevel 4 goto :EOF
if errorlevel 3 goto :do_update
if errorlevel 2 goto :do_restore
goto :do_backup

:do_backup
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%backup-restore.ps1" -Action backup
goto :done

:do_restore
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%backup-restore.ps1" -Action restore
goto :done

:do_update
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%backup-restore.ps1" -Action update
goto :done

:done
echo.
echo 操作完成，按任意键返回菜单……
%SystemRoot%\System32\PING.EXE -n 2 127.0.0.1 >nul
goto :menu
