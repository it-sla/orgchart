# Run once from an administrator PowerShell. This only permits the local subnet.
param([string]$LanAddress, [int]$Port = 8010)
$ErrorActionPreference = 'Stop'
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new($taskIdentity)
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows requires an administrator PowerShell to add the LAN firewall rule.'
}
if (-not $LanAddress) {
    $taskNetwork = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1
    if (-not $taskNetwork) { throw 'No LAN connection found.' }
    $LanAddress = $taskNetwork.IPv4Address.IPAddress | Select-Object -First 1
}
$taskAddress = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress
$taskRuleName = "OrganizationChart-LAN-$Port"
$taskExistingRule = Get-NetFirewallRule -Name $taskRuleName -ErrorAction SilentlyContinue
if ($taskExistingRule) {
    Set-NetFirewallRule -Name $taskRuleName -Enabled True -Direction Inbound -Action Allow -Profile Private,Domain -InterfaceAlias $taskAddress.InterfaceAlias
    $taskExistingRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
    $taskExistingRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress $LanAddress -RemoteAddress LocalSubnet
} else {
    New-NetFirewallRule -Name $taskRuleName -DisplayName "Organization Chart LAN (TCP $Port)" -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress $LanAddress -RemoteAddress LocalSubnet -InterfaceAlias $taskAddress.InterfaceAlias -Profile Private,Domain
}
Write-Host "LAN access allowed: http://${LanAddress}:$Port/ (local subnet only)."
