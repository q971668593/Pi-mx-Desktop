/**
 * `shell.openPath` delegates to the desktop's default handler, which on Windows runs
 * executables and script files (WScript / PowerShell / cmd / installers) directly.
 * Agent output and file previews are untrusted input, so a link click must not launch code.
 * Executable-looking targets are therefore revealed in the file manager instead.
 */

const EXECUTABLE_EXTENSIONS = new Set([
  // Windows programs and launchers
  'exe', 'com', 'scr', 'pif', 'lnk', 'appref-ms', 'msi', 'msp', 'mst', 'msix', 'msixbundle', 'appx', 'appxbundle',
  // Windows script hosts and control panels
  'bat', 'cmd', 'hta', 'cpl', 'msc', 'wsf', 'wsh', 'wsc', 'sct', 'shs', 'reg', 'inf',
  'ps1', 'ps1xml', 'psc1', 'pssc', 'cdxml', 'vbs', 'vbe', 'js', 'jse', 'jar',
  // Interpreted scripts whose default handler may execute them
  'py', 'pyw', 'sh', 'bash', 'zsh', 'fish', 'command', 'desktop', 'service', 'tool',
])

/** Trailing dots, spaces and separators are stripped by Windows, so `evil.exe..` still launches `evil.exe`. */
function shellBasename(target: string): string {
  let trimmed = target.trim()
  for (;;) {
    const next = trimmed.replace(/[\s.]+$/u, '').replace(/[\\/]+$/u, '')
    if (next === trimmed) break
    trimmed = next
  }
  const parts = trimmed.split(/[\\/]+/u)
  return (parts.pop() ?? '').toLowerCase()
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1) : ''
}

/** macOS `.app` bundles are directories; AppImage / XDG entries start code on Linux. */
export function isExecutableShellTarget(target: string): boolean {
  const name = shellBasename(target)
  if (!name) return false
  if (name.endsWith('.app') || name.endsWith('.appimage')) return true
  return EXECUTABLE_EXTENSIONS.has(extensionOf(name))
}

export type ShellOpenAction = 'open' | 'reveal'

export function decideShellOpenAction(target: string): ShellOpenAction {
  return isExecutableShellTarget(target) ? 'reveal' : 'open'
}
