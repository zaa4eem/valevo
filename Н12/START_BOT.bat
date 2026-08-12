@echo off
cd /d %~dp0

start "VALEVO BOT" /D "%~dp0" "%~dp0VALEVO_BOT.exe"

timeout /t 3 >nul

start "VALEVO TV BOARD" /D "%~dp0" "%~dp0VALEVO_TV_BOARD.exe"

timeout /t 5 >nul

start "" "http://127.0.0.1:8010"

exit