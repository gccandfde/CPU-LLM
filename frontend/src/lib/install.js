// Mirrors server/src/install.js installCommands: the one-line installers the
// dashboard shows. `token` may be a placeholder when the viewer is not admin.
export const TOKEN_PLACEHOLDER = '<AGENT_TOKEN>'

export function installCommands(server, token = TOKEN_PLACEHOLDER, name = '') {
  return {
    windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CPULLM_SERVER='${server}'; $env:CPULLM_TOKEN='${token}'; $env:CPULLM_NAME='${name}'; irm ${server}/install/agent.ps1 | iex"`,
    linux: `CPULLM_TOKEN='${token}' CPULLM_NAME='${name}' curl -fsSL ${server}/install/agent.sh | bash`,
    removeWindows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CPULLM_UNINSTALL='1'; irm ${server}/install/agent.ps1 | iex"`,
    removeLinux: `CPULLM_UNINSTALL=1 curl -fsSL ${server}/install/agent.sh | bash`,
  }
}

export const OS = [['windows', 'Windows'], ['linux', 'Linux / macOS / WSL']]

export function guessOs() {
  return /Windows/i.test(navigator.userAgent) ? 'windows' : 'linux'
}
