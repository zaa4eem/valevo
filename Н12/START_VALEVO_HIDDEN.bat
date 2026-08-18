@echo off
cd /d "%~dp0"
start "" wscript.exe //B "%~dp0START_VALEVO_HIDDEN.vbs"
exit
