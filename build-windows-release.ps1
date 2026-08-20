$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'Revo Print Shop V5.14.2 - Windows Release Build'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js tidak ditemukan.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm tidak ditemukan.' }
if (-not (Test-Path .\cloudflared.exe)) { & .\setup-internet-qr.bat; if ($LASTEXITCODE -ne 0) { throw 'Gagal menyiapkan cloudflared.exe.' } }
& npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install gagal.' }
& npx electron-builder --config electron-builder.yml --win nsis portable
if ($LASTEXITCODE -ne 0) { throw 'electron-builder gagal.' }
Write-Host 'Build selesai. File ada di release\'
Get-ChildItem .\release | Select-Object Name, Length
