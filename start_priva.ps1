# PRIVA — one-command launch: backend + ngrok tunnel (webhook self-register) + Electron app
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $root
$appDir = Join-Path $repo "priva-app"
$backendDir = $root
$port = 8766
$tunnel = ""

Write-Host "== PRIVA launcher =="

# 1. Backend
function Test-Health {
    try { return (Invoke-RestMethod -Uri "http://localhost:$port/health" -TimeoutSec 3).status -eq "ok" } catch { return $false }
}
if (Test-Health) {
    Write-Host "[1/4] backend already running on :$port"
} else {
    Write-Host "[1/4] starting backend on :$port ..."
    Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory $backendDir -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Health) { break }
    }
    if (-not (Test-Health)) { Write-Error "backend failed to start"; exit 1 }
    Write-Host "      backend up"
}

# 2. ngrok tunnel + webhook registration
function Get-TunnelUrl {
    try {
        $j = (Invoke-WebRequest -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 3 -UseBasicParsing).Content | ConvertFrom-Json
        $t = $j.tunnels | Where-Object { $_.public_url -match "https" } | Select-Object -First 1
        if ($t) { return $t.public_url }
    } catch {}
    return ""
}
$tunnel = Get-TunnelUrl
if ($tunnel) {
    Write-Host "[2/4] tunnel already up: $tunnel"
} else {
    Write-Host "[2/4] starting ngrok tunnel ..."
    Start-Process -FilePath "ngrok" -ArgumentList "http $port" -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $tunnel = Get-TunnelUrl
        if ($tunnel) { break }
    }
    if (-not $tunnel) { Write-Warning "      ngrok not available - phone replies won't work (app mirror still OK)"; $tunnel = "" }
    else { Write-Host "      tunnel: $tunnel" }
}

if ($tunnel) {
    $webhook = "$tunnel/priva/webhook"
    $envLine = Get-Content (Join-Path $root ".env") | Where-Object { $_ -match "^PRIVA_WEBHOOK_URL=" }
    if ($envLine -notlike "*$webhook*") {
        Write-Host "      webhook URL changed -> registering with Linq..."
        python -X utf8 -c "
import os, httpx
key = ''
for line in open(os.path.join(r'$root', '.env'), encoding='utf-8'):
    if line.startswith('LINQ_API_KEY='):
        key = line.strip().split('=', 1)[1]
base = 'https://api.linqapp.com/api/partner/v3'
h = {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
subs = httpx.get(f'{base}/webhook-subscriptions', headers=h).json().get('subscriptions', [])
sub = next((s for s in subs if 'message.received' in (s.get('subscribed_events') or [])), None)
body = {
    'target_url': '$webhook?version=2026-02-03',
    'subscribed_events': ['message.received', 'message.delivered', 'message.failed'],
    'phone_numbers': ['+12134768016'],
}
if sub:
    r = httpx.patch(f'{base}/webhook-subscriptions/{sub[\"id\"]}', headers=h, json=body)
else:
    r = httpx.post(f'{base}/webhook-subscriptions', headers=h, json=body)
print('      linq webhook:', r.status_code, r.text[:120])
lines = open(os.path.join(r'$root', '.env'), encoding='utf-8').read().splitlines()
for i, l in enumerate(lines):
    if l.startswith('PRIVA_WEBHOOK_URL='):
        lines[i] = f'PRIVA_WEBHOOK_URL=$webhook'
        break
open(os.path.join(r'$root', '.env'), 'w', encoding='utf-8').write(chr(10).join(lines))
"
    } else {
        Write-Host "      webhook URL unchanged ($webhook)"
    }
}

# 3. Watchdog (keeps backend + tunnel alive during a recording)
$wdRunning = Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "watchdog" }
if ($wdRunning) {
    Write-Host "[3/4] watchdog already running"
} else {
    Write-Host "[3/4] starting watchdog ..."
    Start-Process -FilePath "python" -ArgumentList "scripts/watchdog.py" -WorkingDirectory $root -WindowStyle Hidden
}

# 4. Electron app
Write-Host "[4/4] starting Electron app ..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev > vite.log 2>&1" -WorkingDirectory $appDir
Write-Host "== PRIVA is up: app window + backend :$port + tunnel $tunnel =="
