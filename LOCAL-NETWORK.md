# Local network deployment

The app is currently served at http://192.168.101.224:8010/ on this PC's Ethernet
address. Other devices must be on the same reachable local network. The existing
localhost server at http://127.0.0.1:8010/ remains available.

The LAN service binds specifically to the Ethernet IPv4 address, rather than all
interfaces. It serves the built frontend, API, uploads, and existing SQLite data.
Windows already has an enabled inbound TCP rule permitting the Python 3.12
runtime on the active Private network profile. No firewall settings were changed.

There is currently no sign-in or permission system: anyone who can reach this
service can manage employees and departments. Keep the PC powered on. No router
port forwarding or public deployment was configured.

## Restart after a PC restart

Run from PowerShell:

```powershell
& C:\Projects\chart\run.ps1
```

The script builds the frontend, finds a connected LAN interface with an IPv4
gateway, prints the URL, and runs the server. Keep that terminal running. Use
`-SkipBuild` to serve the existing build or `-LanAddress` to select an address.
DHCP may change the address; use the URL printed by the script.

If a future firewall configuration blocks access, `enable-lan.ps1` can be run
from an administrator PowerShell to allow TCP 8010 for the local subnet on the
selected interface, for Private/Domain profiles. Administrator access is needed
for that optional firewall change.

Validation: both listeners were confirmed; HTML and API requests succeeded at
the LAN address; the chart loaded in the browser. Connectivity from a separate
physical device has not been tested.
