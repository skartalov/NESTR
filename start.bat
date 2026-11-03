@echo off
cd /d "%~dp0"
title NESTR

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from the Node.js LTS installer first.
  pause
  exit /b 1
)

rem The admin code is only needed the first time, before data\codes.json exists.
if not exist "data\codes.json" (
  if "%ADMIN_CODE%"=="" (
    echo First start: choose the administrator access code.
    set /p ADMIN_CODE=Admin code:
  )
)

rem Open the browser shortly after the server starts.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000"

echo NESTR is running at http://localhost:3000  (close this window to stop it)
node server.js
pause
