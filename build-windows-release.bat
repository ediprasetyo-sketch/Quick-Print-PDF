@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo Revo Print Shop V1.4.1 - Windows Release Build
echo ================================================

echo.
echo [1/4] Checking Node.js and npm...
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
echo [2/4] Cleaning obsolete Cloudflared desktop dependency...
if exist cloudflared.exe (
  echo ERROR: cloudflared.exe masih berada di project desktop.
  echo Hapus file tersebut. V1.4.1 tidak memakai Cloudflared di desktop.
  pause
  exit /b 1
)
if exist setup-internet-qr.bat (
  echo ERROR: setup-internet-qr.bat masih berada di project desktop.
  echo Hapus file tersebut. V1.4.1 tidak memakai Cloudflared di desktop.
  pause
  exit /b 1
)

echo.
echo [3/4] Installing dependencies and validating configuration...
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

node --check bootstrap.js
if errorlevel 1 exit /b 1
node --check preload.js
if errorlevel 1 exit /b 1
node --check renderer.js
if errorlevel 1 exit /b 1

echo.
echo [4/4] Building NSIS installer + portable EXE...
if exist release rmdir /s /q release
call npx electron-builder --config electron-builder.yml --win nsis portable --publish never
if errorlevel 1 (
  echo electron-builder gagal.
  pause
  exit /b 1
)

echo.
echo ================================================
echo BUILD V1.4.1 BERHASIL
echo ================================================
echo Hasil ada di folder release\
dir /b release\
echo.
pause
endlocal
