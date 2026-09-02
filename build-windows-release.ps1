$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host 'Revo Print Shop V1.5.5 - Windows Release Build'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js tidak ditemukan.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm tidak ditemukan.' }

Write-Host '[1/3] Installing dependencies...'
& npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci gagal.' }

Write-Host '[2/3] Validating source...'
node --check main.js
node --check bootstrap.js
node --check preload.js
node --check renderer.js
node --check print.js

Write-Host '[3/3] Building NSIS installer + portable EXE...'
if (Test-Path .\release) { Remove-Item .\release -Recurse -Force }
& npx electron-builder --config electron-builder.yml --win nsis portable --publish never
if ($LASTEXITCODE -ne 0) { throw 'electron-builder gagal.' }

Write-Host 'Build V1.5.5 selesai. File ada di release\'
Get-ChildItem .\release | Select-Object Name, Length
