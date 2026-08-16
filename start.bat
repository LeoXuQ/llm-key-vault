@echo off
cd /d %~dp0
set PORT=3210

rem ===== If the service is already running, just open the browser =====
netstat -ano | findstr /r ":%PORT%.*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [OK] Service is already running. Opening browser...
  start "" "http://127.0.0.1:%PORT%"
  exit /b 0
)

echo ================================================
echo   LLM API Key Vault is starting...
echo   URL: http://127.0.0.1:%PORT%
echo   Keep this window open (closing it stops the service)
echo ================================================

rem ===== Open browser after 2 seconds (separate mini window) =====
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%"

node server.js
echo.
echo Service stopped.
pause
