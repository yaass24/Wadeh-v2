@echo off
chcp 65001 >nul
title WADEH demo server
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080"
node server.js
pause
