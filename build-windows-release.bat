@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo Revo Print Shop V5.14.2 - Windows Release Build
echo ================================================

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

if not exist cloudflared.exe (
  call setup-internet-qr.bat
  if errorlevel 1 (
    echo.
    echo Gagal menyiapkan cloudflared.exe
    pause
    exit /b 1
  )
)

echo.
echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
  echo npm install gagal.
  pause
  exit /b 1
)

echo.
echo [2/3] Validating electron-builder configuration...
call npx electron-builder --config electron-builder.yml --help >nul
if errorlevel 1 (
  echo Konfigurasi electron-builder gagal divalidasi.
  pause
  exit /b 1
)

echo.
echo [3/3] Building NSIS installer + portable EXE...
if exist release rmdir /s /q release
call npx electron-builder --config electron-builder.yml --win nsis portable
if errorlevel 1 (
  echo electron-builder gagal.
  pause
  exit /b 1
)

echo.
echo ================================================
echo BUILD BERHASIL
echo ================================================
echo Hasil ada di folder release\
dir /b release\
echo.
pause
endlocal
