import { describe, expect, it } from 'vitest'
import { decideShellOpenAction, isExecutableShellTarget } from './shell-open-safety'

describe('shell open safety', () => {
  it.each([
    '/home/user/reports/实验 报告.pdf',
    '/home/user/reports/archive.tar.gz',
    '/home/user/projects/.gitignore',
    'C:\\Users\\me\\Desktop\\notes.txt',
    'C:\\Users\\me\\Desktop\\photo.PNG',
    'C:\\Users\\me\\Desktop\\folder',
  ])('opens a document target: %s', (path) => {
    expect(isExecutableShellTarget(path)).toBe(false)
    expect(decideShellOpenAction(path)).toBe('open')
  })

  it.each([
    'C:\\Users\\me\\Downloads\\setup.exe',
    'C:\\Users\\me\\Downloads\\SETUP.EXE',
    'C:\\Users\\me\\Downloads\\setup.exe.',
    'C:\\Users\\me\\Downloads\\setup.exe   ',
    'C:\\Users\\me\\Downloads\\build.bat',
    'C:\\Users\\me\\Downloads\\install.ps1',
    'C:\\Users\\me\\Downloads\\payload.js',
    'C:\\Users\\me\\Downloads\\shortcut.lnk',
    'C:\\Users\\me\\Downloads\\payload.msi',
    '/home/user/bin/run.sh',
    '/home/user/bin/deploy.appref-ms',
    '/home/user/Downloads/Evil.AppImage',
    '/Applications/Evil.app',
  ])('reveals an executable target instead of launching it: %s', (path) => {
    expect(isExecutableShellTarget(path)).toBe(true)
    expect(decideShellOpenAction(path)).toBe('reveal')
  })

  it('ignores trailing separators and dotted names', () => {
    expect(isExecutableShellTarget('C:\\Users\\me\\Downloads\\setup.exe\\')).toBe(true)
    expect(isExecutableShellTarget('/home/user/.profile')).toBe(false)
    expect(isExecutableShellTarget('/home/user/script.js.map')).toBe(false)
    expect(isExecutableShellTarget('')).toBe(false)
  })
})
