@echo off
setlocal
cd /d "%~dp0"
call setup-qz-tray.bat
if errorlevel 2 exit /b 2
if not exist node_modules (
  echo Menginstall dependency...
  call npm install
  if errorlevel 1 exit /b 1
)
call setup-qz-trust.bat
if errorlevel 1 exit /b 1
call setup-internet-qr.bat
if errorlevel 1 pause & exit /b 1
npm start
