// One-line agent installers served at /install/agent.ps1 and /install/agent.sh.
// They download the agent (/install/agent.zip, built by scripts/build-site.mjs),
// set up Python + CPU PyTorch, register the agent as a background service that
// survives reboots, and start it. The server URL is filled in; the token comes
// from the environment the user pastes (never from a URL, so it stays out of logs).
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'

export function installRouter(siteDir) {
  const r = express.Router()
  const origin = (req) => `${req.protocol}://${req.get('host')}`
  r.get('/agent.ps1', (req, res) => res.type('text/plain; charset=utf-8').send(windowsScript(origin(req))))
  r.get('/agent.sh', (req, res) => res.type('text/plain; charset=utf-8').send(unixScript(origin(req))))
  r.get('/agent.zip', (req, res) => {
    const zip = siteDir && path.join(siteDir, 'install', 'agent.zip')
    if (!zip || !fs.existsSync(zip)) return res.status(404).type('text/plain').send('Agent package not built on this server')
    res.attachment('cpullm-agent.zip').sendFile(zip)
  })
  return r
}

// The commands the dashboard shows. `token` may be a placeholder.
export function installCommands(server, token, name) {
  const n = name ? ` --name "${name}"` : ''
  return {
    windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CPULLM_SERVER='${server}'; $env:CPULLM_TOKEN='${token}'; $env:CPULLM_NAME='${name || ''}'; irm ${server}/install/agent.ps1 | iex"`,
    linux: `CPULLM_TOKEN='${token}' CPULLM_NAME='${name || ''}' curl -fsSL ${server}/install/agent.sh | bash`,
    manual: `python -m cpullm.agent --server ${server} --token ${token}${n}`,
  }
}

export function windowsScript(server) {
  return `# CPU-LLM agent installer for Windows (run as the user who will own the agent)
# Installs to %LOCALAPPDATA%\\CPU-LLM, registers a logon task, starts the agent.
# Remove:  $env:CPULLM_UNINSTALL='1'; irm ${server}/install/agent.ps1 | iex
# No autostart (run until logout only): set $env:CPULLM_NO_SERVICE='1' before running
$ErrorActionPreference = 'Stop'
$Server = '${server}'
$Home_ = Join-Path $env:LOCALAPPDATA 'CPU-LLM'
$Task = 'CPU-LLM Agent'
if ($env:CPULLM_UNINSTALL) {
  schtasks /End /TN "$Task" 2>$null | Out-Null
  schtasks /Delete /TN "$Task" /F 2>$null | Out-Null
  Get-Process python* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Home_*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $Home_) { Remove-Item -Recurse -Force $Home_ }
  Write-Host 'CPU-LLM agent removed.'; return
}
if (-not $env:CPULLM_TOKEN) { throw 'Set $env:CPULLM_TOKEN to the agent token from the Admin tab first.' }
$Name = if ($env:CPULLM_NAME) { $env:CPULLM_NAME } else { $env:COMPUTERNAME.ToLower() }

Write-Host "==> Python"
$py = Get-Command py -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
if (-not $py) {
  Write-Host 'Python not found; installing Python 3.12 with winget (close and re-run this command if it asks for a restart)'
  winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $py = Get-Command py -ErrorAction SilentlyContinue; if (-not $py) { $py = Get-Command python } }
$pyExe = $py.Source
$ver = & $pyExe -c "import sys; print(sys.version_info >= (3, 10))"
if ($ver.Trim() -ne 'True') { throw "Python 3.10 or newer is required (found $(& $pyExe --version))" }

Write-Host "==> Download agent"
New-Item -ItemType Directory -Force $Home_ | Out-Null
$zip = Join-Path $Home_ 'agent.zip'
Invoke-WebRequest -UseBasicParsing "$Server/install/agent.zip" -OutFile $zip
$src = Join-Path $Home_ 'agent'
if (Test-Path $src) { Remove-Item -Recurse -Force $src }
Expand-Archive $zip -DestinationPath $src -Force
Remove-Item $zip

# GPU: CPULLM_DEVICE=cuda installs the CUDA build of PyTorch (about 3 GB) so runs can use the GPU;
# the default is the CPU build. A GPU the driver sees but torch cannot still shows under Machines.
$Device = if ($env:CPULLM_DEVICE) { $env:CPULLM_DEVICE } else { 'cpu' }
if ($Device -ne 'cuda' -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Write-Host "GPU detected. To run on it, re-run with \`$env:CPULLM_DEVICE='cuda' (installs the CUDA build of PyTorch, about 3 GB)." }
Write-Host "==> Python environment ($(if ($Device -eq 'cuda') { 'CUDA PyTorch; a few GB' } else { 'CPU PyTorch; a few hundred MB' }), first time only)"
$venv = Join-Path $Home_ 'venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\\python.exe'))) { & $pyExe -m venv $venv }
$vpy = Join-Path $venv 'Scripts\\python.exe'
& $vpy -m pip install --quiet --upgrade pip
if ($Device -eq 'cuda') {
  $hasCuda = & $vpy -c "import torch; print(bool(torch.version.cuda))" 2>$null
  if ("$hasCuda".Trim() -ne 'True') { & $vpy -m pip install --quiet --upgrade torch }
} else {
  & $vpy -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
}
& $vpy -m pip install --quiet -r (Join-Path $src 'requirements.txt')

$run = Join-Path $Home_ 'run-agent.cmd'
$LogFile = Join-Path $Home_ 'agent.log'
@"
@echo off
cd /d "$src"
set CPULLM_SERVER=$Server
set CPULLM_TOKEN=$($env:CPULLM_TOKEN)
set CPULLM_AGENT_TOKEN=$($env:CPULLM_TOKEN)
"$vpy" -m cpullm.agent --name "$Name" >> "$LogFile" 2>&1
"@ | Set-Content -Encoding ASCII $run
if ($env:CPULLM_NO_SERVICE) {
  Write-Host "==> Starting agent in the background (no autostart: CPULLM_NO_SERVICE is set)"
  Get-Process python* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Home_*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Process -WindowStyle Hidden -FilePath $run
  Write-Host "CPU-LLM agent '$Name' is running until logout. Open $Server and look under Machines. Log: $LogFile"; return
}
Write-Host "==> Background service (starts at every logon)"
schtasks /End /TN "$Task" 2>$null | Out-Null
schtasks /Delete /TN "$Task" /F 2>$null | Out-Null
$vbs = Join-Path $Home_ 'start-hidden.vbs'
@"
CreateObject("WScript.Shell").Run "cmd /c ""$run""", 0, False
"@ | Set-Content -Encoding ASCII $vbs
$tr = 'wscript.exe //B "' + $vbs + '"'
schtasks /Create /SC ONLOGON /TN "$Task" /TR $tr /RL LIMITED /F | Out-Null
schtasks /Run /TN "$Task" | Out-Null
Write-Host ""
Write-Host "CPU-LLM agent '$Name' is running and will start at every logon."
Write-Host "Open $Server and look under Machines. Log: $LogFile"
`
}

export function unixScript(server) {
  return `#!/usr/bin/env bash
# CPU-LLM agent installer for Linux and macOS. Installs to ~/.cpu-llm and
# starts the agent as a service (systemd --user on Linux, launchd on macOS).
# Remove:  CPULLM_UNINSTALL=1 curl -fsSL ${server}/install/agent.sh | bash
# No autostart (run until logout only): CPULLM_NO_SERVICE=1
set -euo pipefail
SERVER='${server}'
HOME_DIR="$HOME/.cpu-llm"
if [ -n "\${CPULLM_UNINSTALL:-}" ]; then
  systemctl --user disable --now cpullm-agent 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/cpullm-agent.service"
  launchctl unload "$HOME/Library/LaunchAgents/com.cpullm.agent.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.cpullm.agent.plist"
  pkill -f "cpullm.agent" 2>/dev/null || true
  rm -rf "$HOME_DIR"; echo "CPU-LLM agent removed."; exit 0
fi
[ -n "\${CPULLM_TOKEN:-}" ] || { echo "Set CPULLM_TOKEN to the agent token from the Admin tab first." >&2; exit 1; }
NAME="\${CPULLM_NAME:-$(hostname -s 2>/dev/null || hostname)}"

echo "==> Python"
PY=$(command -v python3 || command -v python || true)
[ -n "$PY" ] || { echo "Python 3.10+ is required (Debian/Ubuntu: sudo apt install python3 python3-venv)" >&2; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Python 3.10 or newer is required (found $("$PY" --version))" >&2; exit 1; }

echo "==> Download agent"
mkdir -p "$HOME_DIR"
curl -fsSL "$SERVER/install/agent.zip" -o "$HOME_DIR/agent.zip"
rm -rf "$HOME_DIR/agent"
"$PY" -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$HOME_DIR/agent.zip" "$HOME_DIR/agent"
rm -f "$HOME_DIR/agent.zip"

# GPU: the CUDA build of PyTorch is installed when nvidia-smi is present (CPULLM_DEVICE=cpu forces the
# CPU build, CPULLM_DEVICE=cuda forces CUDA and upgrades a CPU-only torch that is already there).
DEVICE="\${CPULLM_DEVICE:-}"
if [ -z "$DEVICE" ]; then if command -v nvidia-smi >/dev/null 2>&1; then DEVICE=cuda; else DEVICE=cpu; fi; fi
echo "==> Python environment ($([ "$DEVICE" = cuda ] && echo 'CUDA PyTorch; a few GB' || echo 'CPU PyTorch; a few hundred MB'), first time only)"
[ -x "$HOME_DIR/venv/bin/python" ] || "$PY" -m venv "$HOME_DIR/venv" || { echo "python3-venv is missing (Debian/Ubuntu: sudo apt install python3-venv)" >&2; exit 1; }
VPY="$HOME_DIR/venv/bin/python"
"$VPY" -m pip install --quiet --upgrade pip
HAS_CUDA=$("$VPY" -c 'import torch; print(bool(torch.version.cuda))' 2>/dev/null || echo missing)
if [ "$DEVICE" = cuda ]; then
  [ "$HAS_CUDA" = True ] || "$VPY" -m pip install --quiet --upgrade torch
else
  [ "$HAS_CUDA" = missing ] && "$VPY" -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
fi
"$VPY" -m pip install --quiet -r "$HOME_DIR/agent/requirements.txt"

cat > "$HOME_DIR/run-agent.sh" <<EOF
#!/usr/bin/env bash
cd "$HOME_DIR/agent"
export CPULLM_SERVER='$SERVER' CPULLM_TOKEN='$CPULLM_TOKEN' CPULLM_AGENT_TOKEN='$CPULLM_TOKEN'
exec "$VPY" -m cpullm.agent --name "$NAME"
EOF
chmod 700 "$HOME_DIR/run-agent.sh"

if [ -n "\${CPULLM_NO_SERVICE:-}" ]; then
  echo "==> Starting agent in the background (no autostart: CPULLM_NO_SERVICE is set)"
  pkill -f "cpullm.agent" 2>/dev/null || true
  nohup "$HOME_DIR/run-agent.sh" >> "$HOME_DIR/agent.log" 2>&1 &
  echo "CPU-LLM agent '$NAME' is running until logout. Open $SERVER and look under Machines."; exit 0
fi
echo "==> Background service"
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/cpullm-agent.service" <<EOF
[Unit]
Description=CPU-LLM agent
After=network-online.target
[Service]
ExecStart=$HOME_DIR/run-agent.sh
Restart=always
RestartSec=10
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now cpullm-agent
  loginctl enable-linger "$USER" 2>/dev/null || true
  echo "Service: systemctl --user status cpullm-agent"
elif [ "$(uname)" = "Darwin" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$HOME/Library/LaunchAgents/com.cpullm.agent.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.cpullm.agent</string>
<key>ProgramArguments</key><array><string>$HOME_DIR/run-agent.sh</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME_DIR/agent.log</string><key>StandardErrorPath</key><string>$HOME_DIR/agent.log</string>
</dict></plist>
EOF
  launchctl unload "$HOME/Library/LaunchAgents/com.cpullm.agent.plist" 2>/dev/null || true
  launchctl load "$HOME/Library/LaunchAgents/com.cpullm.agent.plist"
else
  pkill -f "cpullm.agent" 2>/dev/null || true
  nohup "$HOME_DIR/run-agent.sh" >> "$HOME_DIR/agent.log" 2>&1 &
  echo "Started in the background (no systemd found; re-run this command after a reboot)."
fi
echo
echo "CPU-LLM agent '$NAME' is running. Open $SERVER and look under Machines."
`
}
