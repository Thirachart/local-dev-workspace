@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Local Dev Tool MCP - Server Launcher

if exist "%~dp0dist\index.js" (
    cd /d "%~dp0"
) else if exist "%~dp0..\dist\index.js" (
    cd /d "%~dp0.."
) else (
    echo [ERROR] Cannot find dist\index.js.
    pause
    exit /b 1
)

echo ==================================================
echo   Starting Local Dev Tool MCP Server (Windows)
echo   Workspace: %CD%
echo ==================================================

rem Check if node is available
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH. Please install Node.js v18+.
    pause
    exit /b 1
)

rem Free port 4100 if occupied
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4100 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

rem Open Dashboard in browser after slight delay
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4100/logs"

rem Start Server (SSE mode on port 4100)
node dist/index.js --sse --port 4100

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Server exited with error code %ERRORLEVEL%.
    pause
)
