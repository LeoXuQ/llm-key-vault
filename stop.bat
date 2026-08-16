@echo off
set PORT=3210
echo Stopping LLM API Key Vault (port %PORT%)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3210.*LISTENING"') do (
  echo Killing PID: %%p
  taskkill /f /pid %%p >nul 2>&1
)
echo Stopped. Double-click start.bat to restart.
pause
