@echo off
setlocal
chcp 65001 >nul
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
title XinyunOpen Bot Launcher

echo.
echo ========================================
echo   XinyunOpen Bot One-Click Startup
echo ========================================
echo.

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm not found, installing globally...
    npm i -g pnpm@10.33.0
    if errorlevel 1 (
        echo [ERROR] Failed to install pnpm. Please run: npm i -g pnpm
        pause
        exit /b 1
    )
)

if not exist "node_modules" (
    echo [INFO] First run detected, installing dependencies...
    pnpm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
)

if exist ".env.local" echo [INFO] .env.local detected - API keys will be loaded

echo.
echo [1/3] Starting backend server...
start "XinyunOpen Bot-Backend" /min cmd /c "cd /d ""%PROJECT_DIR%"" && pnpm dev:server"
timeout /t 5 /nobreak >nul

echo [2/3] Starting frontend dev server...
start "XinyunOpen Bot-Frontend" /min cmd /c "cd /d ""%PROJECT_DIR%"" && pnpm dev"
timeout /t 8 /nobreak >nul

echo [3/3] Starting Electron desktop app...
start "XinyunOpen Bot-Desktop" cmd /c "cd /d ""%PROJECT_DIR%"" && pnpm dev:desktop"

echo.
echo [DONE] XinyunOpen Bot has been started
echo Backend: http://127.0.0.1:8799
echo Frontend: http://127.0.0.1:5199
echo.
pause
endlocal
