@echo off
setlocal
set "QZ_EXE=%ProgramFiles%\QZ Tray\qz-tray.exe"
if exist "%QZ_EXE%" (
  echo QZ Tray sudah terpasang.
  exit /b 0
)
if exist "%ProgramFiles(x86)%\QZ Tray\qz-tray.exe" (
  echo QZ Tray sudah terpasang.
  exit /b 0
)
echo QZ Tray belum terpasang.
echo Membuka halaman download resmi QZ Tray...
start "" "https://qz.io/download/?os=windows"
echo.
echo Install QZ Tray lalu jalankan ulang install-and-run.bat.
pause
exit /b 2
