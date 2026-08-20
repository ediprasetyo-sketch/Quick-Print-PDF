@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==============================================
echo Revo Print Shop V5.14.2 - QZ Tray Trust Setup
echo ==============================================

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo Setup provisioning membutuhkan Administrator Windows.
  echo Membuka ulang script sebagai Administrator...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

if not exist "node_modules\node-forge" (
  echo node-forge belum terpasang. Menjalankan npm install...
  call npm install
  if errorlevel 1 goto :fail
)

node scripts\qz-local-trust.js
if errorlevel 1 goto :fail

for /f "usebackq delims=" %%P in (`node -e "const os=require('os'),path=require('path'); console.log(path.join(os.homedir(),'AppData','Roaming','revo-print-shop','qz-identity','revo-qz-root.crt'))"`) do set "QZ_ROOT=%%P"
for /f "usebackq delims=" %%P in (`node -e "const os=require('os'),path=require('path'); console.log(path.join(os.homedir(),'AppData','Roaming','revo-print-shop','qz-identity','digital-certificate.txt'))"`) do set "QZ_CERT=%%P"

set "QZ_DIR=%ProgramFiles%\QZ Tray"
set "QZ_EXE=%QZ_DIR%\qz-tray-console.exe"
if not exist "%QZ_EXE%" set "QZ_EXE=%QZ_DIR%\qz-tray.exe"
if not exist "%QZ_EXE%" (
  echo.
  echo QZ Tray belum terpasang di %QZ_DIR%.
  echo Jalankan setup-qz-tray.bat terlebih dahulu.
  goto :fail
)

if not exist "%QZ_ROOT%" (
  echo Root certificate tidak ditemukan.
  goto :fail
)
if not exist "%QZ_CERT%" (
  echo Signing certificate tidak ditemukan.
  goto :fail
)

set "QZ_OVERRIDE=%QZ_DIR%\override.crt"
echo.
echo [1/5] Memasang trusted root QZ Tray...
copy /Y "%QZ_ROOT%" "%QZ_OVERRIDE%" >nul
if errorlevel 1 (
  echo Gagal menyalin override.crt.
  goto :fail
)

echo [2/5] Menambahkan certificate ke allowed.dat sebagai fallback...
taskkill /IM qz-tray.exe /F >nul 2>&1
taskkill /IM qz-tray-console.exe /F >nul 2>&1
"%QZ_EXE%" --allow "%QZ_CERT%" >qz-trust.log 2>&1
if errorlevel 1 echo Peringatan: --allow gagal, tetapi trusted root override tetap dipasang.

set "QZ_PROP=%QZ_DIR%\qz-tray.properties"
if exist "%QZ_PROP%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:QZ_PROP; $line='authcert.override=override.crt'; $txt=Get-Content -LiteralPath $p -Raw -ErrorAction SilentlyContinue; if($null -eq $txt){$txt=''}; $txt=[regex]::Replace($txt,'(?m)^authcert\.override=.*\r?\n?',''); if(-not $txt.EndsWith([Environment]::NewLine)){ $txt += [Environment]::NewLine }; $txt += $line + [Environment]::NewLine; Set-Content -LiteralPath $p -Value $txt -Encoding UTF8"
)

echo [3/5] Trusted root : %QZ_OVERRIDE%
echo [4/5] Restart QZ Tray...
start "" "%QZ_EXE%"

timeout /t 3 /nobreak >nul

echo [5/5] Provisioning selesai.
echo.
echo QZ Tray sekarang menggunakan trusted root Revo Print Shop.
echo Signing certificate: %QZ_CERT%
echo Root certificate:     %QZ_OVERRIDE%
echo.
echo Silakan jalankan Revo Print Shop. Dialog Untrusted website seharusnya tidak muncul.
echo.
exit /b 0

:fail
echo.
echo Gagal menyiapkan QZ Tray provisioning.
echo Lihat qz-trust.log jika tersedia.
pause
exit /b 1
