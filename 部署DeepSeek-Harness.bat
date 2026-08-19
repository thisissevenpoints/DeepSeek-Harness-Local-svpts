@echo off
setlocal

rem ============================================================
rem  DeepSeek Harness Local svpts 一键部署（中文入口）
rem  转发到 deploy-win.bat（ASCII 名，任何代码页下 call 均可解析）
rem ============================================================

call "%~dp0deploy-win.bat"
exit /b %ERRORLEVEL%
