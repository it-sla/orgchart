param([string]$LanAddress, [int]$Port = 8010, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
if (-not $LanAddress) {
    $taskNetwork = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1
    if (-not $taskNetwork) { throw 'No LAN connection found. Connect to your network or specify -LanAddress.' }
    $LanAddress = $taskNetwork.IPv4Address.IPAddress | Select-Object -First 1
}
if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress -ErrorAction SilentlyContinue)) {
    throw "This PC does not have the address $LanAddress."
}
if (-not $SkipBuild) {
    Push-Location (Join-Path $taskRoot 'frontend')
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
}
Write-Host "Open from devices on your LAN: http://${LanAddress}:$Port/"
Write-Host 'Anyone with network access can manage records; this app currently has no sign-in.'
Write-Host 'If Windows Firewall blocks access, run enable-lan.ps1 from an administrator PowerShell.'
& (Join-Path $taskRoot 'backend/.venv/Scripts/python.exe') -m uvicorn main:app --app-dir (Join-Path $taskRoot 'backend') --host $LanAddress --port $Port
