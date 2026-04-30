@echo off
chcp 65001 >nul
cd /d %~dp0

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

echo Starting OP PRO on http://localhost:5000
node server.js
