@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo Revo Print Shop V1.5.5 - Windows Release Build
echo ================================================

echo.
echo [1/3] Checking Node.js and npm...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js tidak ditemukan. Install Node.js LTS terlebih dahulu.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm tidak ditemukan.
  pause
  exit /b 1
)

echo.
echo [2/3] Installing dependencies and validating source...
call npm install
if errorlevel 1 (
  echo npm install gagal.
  pause
  exit /b 1
)

call npx electron-builder --config electron-builder.yml --help >nul
if errorlevel 1 (
  echo Konfigurasi electron-builder gagal divalidasi.
  pause
  exit /b 1
)

node --check main.js
if errorlevel 1 exit /b 1
node --check bootstrap.js
if errorlevel 1 exit /b 1
node --check preload.js
if errorlevel 1 exit /b 1
node --check renderer.js
if errorlevel 1 exit /b 1
node --check print.js
if errorlevel 1 exit /b 1

echo.
echo [3/3] Building NSIS installer + portable EXE...
if exist release rmdir /s /q release
call npx electron-builder --config electron-builder.yml --win nsis portable --publish never
if errorlevel 1 (
  echo electron-builder gagal.
  pause
  exit /b 1
)

echo.
echo ================================================
echo BUILD V1.5.5 BERHASIL
echo ================================================
echo Hasil ada di folder release\
dir /b release\
echo.
pause
endlocal
