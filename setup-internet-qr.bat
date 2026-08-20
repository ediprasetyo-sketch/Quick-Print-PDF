@echo off
setlocal
cd /d "%~dp0"
if exist cloudflared.exe (
  echo cloudflared.exe sudah tersedia.
  exit /b 0
)
where cloudflared.exe >nul 2>nul
if %errorlevel%==0 (
  echo cloudflared ditemukan di PATH.
  exit /b 0
)
set "URL=https://github.com/cloudflare/cloudflared/releases/download/2026.7.0/cloudflared-windows-amd64.exe"
set "SHA=b11ee950a12b15604e6b0a0f30a226516adc7aec75de2e3c642b28e50ddef9ea"
echo Mengunduh Cloudflare Tunnel untuk QR Internet gratis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%URL%' -OutFile 'cloudflared.exe'"
if not exist cloudflared.exe (
  echo Gagal mengunduh cloudflared.
  exit /b 1
)
for /f "delims=" %%H in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 'cloudflared.exe').Hash.ToLower()"') do set "ACTUAL=%%H"
if /I not "%ACTUAL%"=="%SHA%" (
  echo SHA256 cloudflared tidak cocok. File dihapus demi keamanan.
  del /q cloudflared.exe >nul 2>nul
  exit /b 1
)
echo Cloudflared berhasil disiapkan.
exit /b 0
