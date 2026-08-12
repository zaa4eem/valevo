@echo off
chcp 65001 >nul
setlocal EnableExtensions

title VALEVO BUILD + HIDDEN LAUNCHER

echo.
echo ================================
echo  VALEVO BUILD + HIDDEN LAUNCHER
echo ================================
echo.

REM ================================
REM  НАСТРОЙКИ
REM ================================

set "BOT_BUILD_NAME=VALEVO_BOT"
set "TV_BUILD_NAME=VALEVO_TV_BOARD"

set "BOT_EXE=VALEVO_BOT.exe"
set "TV_EXE=VALEVO_TV_BOARD.exe"

set "EXE_DIR=dist"

set "START_VBS=START_VALEVO_HIDDEN.vbs"
set "START_BAT=START_VALEVO_HIDDEN.bat"
set "STOP_BAT=STOP_VALEVO.bat"

REM ================================
REM  ВЫБОР PYTHON
REM ================================

echo [0/7] Ищу Python...

if exist ".venv\Scripts\python.exe" (
    set "PY=.venv\Scripts\python.exe"
    echo Найден Python в .venv
) else (
    where python >nul 2>&1
    if not errorlevel 1 (
        set "PY=python"
        echo Найден системный Python
    ) else (
        where py >nul 2>&1
        if not errorlevel 1 (
            set "PY=py -3"
            echo Найден Python Launcher
        ) else (
            echo.
            echo ❌ Python не найден.
            echo Установи Python или создай .venv.
            pause
            exit /b 1
        )
    )
)

echo Использую: %PY%
echo.

REM ================================
REM  ОСТАНОВКА СТАРЫХ ПРОЦЕССОВ
REM ================================

echo [1/7] Останавливаю старые процессы...

taskkill /IM "%BOT_EXE%" /F >nul 2>&1
taskkill /IM "%TV_EXE%" /F >nul 2>&1

REM Осторожно: python.exe убиваем только если тестировал через python main.py
taskkill /IM python.exe /F >nul 2>&1

echo Готово.
echo.

REM ================================
REM  ПРОВЕРКА ФАЙЛОВ
REM ================================

echo [2/7] Проверяю файлы проекта...

if not exist "main.py" (
    echo ❌ Не найден main.py
    pause
    exit /b 1
)

if not exist "tv_board.py" (
    echo ❌ Не найден tv_board.py
    pause
    exit /b 1
)

echo main.py найден
echo tv_board.py найден
echo.

REM ================================
REM  PYINSTALLER
REM ================================

echo [3/7] Проверяю PyInstaller...

%PY% -m PyInstaller --version >nul 2>&1

if errorlevel 1 (
    echo PyInstaller не найден. Устанавливаю...
    %PY% -m pip install --upgrade pip
    %PY% -m pip install pyinstaller

    %PY% -m PyInstaller --version >nul 2>&1

    if errorlevel 1 (
        echo.
        echo ❌ PyInstaller не установился.
        echo Попробуй вручную:
        echo %PY% -m pip install pyinstaller
        pause
        exit /b 1
    )
)

echo PyInstaller готов.
echo.

REM ================================
REM  ЧИСТКА СТАРОЙ СБОРКИ
REM ================================

echo [4/7] Чищу старую сборку...

if exist "build" rmdir /s /q "build"

if exist "%EXE_DIR%\%BOT_EXE%" del /q "%EXE_DIR%\%BOT_EXE%"
if exist "%EXE_DIR%\%TV_EXE%" del /q "%EXE_DIR%\%TV_EXE%"

echo Готово.
echo.

REM ================================
REM  СБОРКА БОТА
REM ================================

echo [5/7] Собираю EXE бота...

%PY% -m PyInstaller ^
 --onefile ^
 --noconsole ^
 --name "%BOT_BUILD_NAME%" ^
 main.py

if errorlevel 1 (
    echo.
    echo ❌ Ошибка сборки бота.
    pause
    exit /b 1
)

if not exist "%EXE_DIR%\%BOT_EXE%" (
    echo.
    echo ❌ Бот собрался, но файл не найден: %EXE_DIR%\%BOT_EXE%
    pause
    exit /b 1
)

echo Бот собран: %EXE_DIR%\%BOT_EXE%
echo.

REM ================================
REM  СБОРКА TV BOARD
REM ================================

echo [6/7] Собираю EXE TV Board...

if exist "static" (
    %PY% -m PyInstaller ^
     --onefile ^
     --noconsole ^
     --name "%TV_BUILD_NAME%" ^
     --add-data "static;static" ^
     tv_board.py
) else (
    %PY% -m PyInstaller ^
     --onefile ^
     --noconsole ^
     --name "%TV_BUILD_NAME%" ^
     tv_board.py
)

if errorlevel 1 (
    echo.
    echo ❌ Ошибка сборки TV Board.
    pause
    exit /b 1
)

if not exist "%EXE_DIR%\%TV_EXE%" (
    echo.
    echo ❌ TV Board собрался, но файл не найден: %EXE_DIR%\%TV_EXE%
    pause
    exit /b 1
)

echo TV Board собран: %EXE_DIR%\%TV_EXE%
echo.

REM ================================
REM  СОЗДАНИЕ СКРЫТЫХ ЗАПУСКАЛОК
REM ================================

echo [7/7] Создаю скрытый запуск...

REM --- START VBS ---
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo Set FSO = CreateObject("Scripting.FileSystemObject"^)
echo.
echo BaseDir = FSO.GetParentFolderName(WScript.ScriptFullName^)
echo WshShell.CurrentDirectory = BaseDir
echo.
echo BotExe = BaseDir ^& "\%EXE_DIR%\%BOT_EXE%"
echo TvExe = BaseDir ^& "\%EXE_DIR%\%TV_EXE%"
echo.
echo If FSO.FileExists(BotExe^) Then
echo     WshShell.Run Chr(34^) ^& BotExe ^& Chr(34^), 0, False
echo End If
echo.
echo WScript.Sleep 2500
echo.
echo If FSO.FileExists(TvExe^) Then
echo     WshShell.Run Chr(34^) ^& TvExe ^& Chr(34^), 0, False
echo End If
) > "%START_VBS%"

REM --- START BAT ---
(
echo @echo off
echo cd /d "%%~dp0"
echo start "" wscript.exe //B "%%~dp0%START_VBS%"
echo exit
) > "%START_BAT%"

REM --- STOP BAT ---
(
echo @echo off
echo chcp 65001 ^>nul
echo echo Останавливаю VALEVO...
echo taskkill /IM "%BOT_EXE%" /F ^>nul 2^>^&1
echo taskkill /IM "%TV_EXE%" /F ^>nul 2^>^&1
echo echo.
echo echo Готово.
echo pause
) > "%STOP_BAT%"

echo.
echo ================================
echo  ГОТОВО
echo ================================
echo.
echo Собрано:
echo - %EXE_DIR%\%BOT_EXE%
echo - %EXE_DIR%\%TV_EXE%
echo.
echo Создано:
echo - %START_VBS%
echo - %START_BAT%
echo - %STOP_BAT%
echo.
echo После запуска бот и TV Board не должны висеть внизу на панели.
echo Они будут видны только в диспетчере задач (это нормально, --noconsole).
echo.

REM ================================
REM  АВТОЗАПУСК + ПРОВЕРКА ПО ЛОГУ
REM ================================

echo Запускаю бота в скрытом режиме...
call "%START_BAT%"

echo Жду запуск (5 сек)...
timeout /t 5 /nobreak >nul

echo.
echo ================================
echo  ПОСЛЕДНИЕ СТРОКИ ЛОГА (logs\bot.log)
echo ================================
if exist "logs\bot.log" (
    powershell -NoProfile -Command "Get-Content -Path 'logs\bot.log' -Tail 8 -Encoding UTF8"
    echo.
    echo Если видишь строку "Бот запущен (сборка от ...)" с текущим временем —
    echo обновление точно применилось и бот работает на новой сборке.
) else (
    echo Лог-файл не найден: logs\bot.log
    echo Проверь .env ^(LOG_DIR/LOG_FILE^) и что бот реально стартовал.
)
echo.
pause