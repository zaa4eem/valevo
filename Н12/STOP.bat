@echo off
chcp 65001 >nul
echo Останавливаю VALEVO...
taskkill /IM "VALEVO_BOT.exe" /F >nul 2>&1
taskkill /IM "VALEVO_TV_BOARD.exe" /F >nul 2>&1
echo.
echo Готово.
pause
