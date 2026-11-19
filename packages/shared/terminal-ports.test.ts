import { describe, expect, it } from 'vitest'
import { detectListeningPorts, isServerCommand } from './terminal-ports'

describe('detectListeningPorts', () => {
  it('reads the ports a dev server prints', () => {
    const vite = [
      '\u001b[32m  VITE v7.0.0  ready in 402 ms\u001b[0m',
      '',
      '  \u001b[32m➜\u001b[0m  \u001b[1mLocal\u001b[0m:   \u001b[36mhttp://localhost:3019/\u001b[0m',
      '  \u001b[32m➜\u001b[0m  \u001b[1mNetwork\u001b[0m: \u001b[36mhttp://192.168.1.6:3019/\u001b[0m',
    ].join('\n')
    expect(detectListeningPorts(vite)).toEqual([3019])
  })

  it('keeps distinct ports newest last and respects the limit', () => {
    const output = [
      'http://localhost:3000/',
      'Server listening on port 3001',
      'http://127.0.0.1:3002/',
      'http://0.0.0.0:3003/',
      'http://localhost:3004/',
    ].join('\n')
    expect(detectListeningPorts(output)).toEqual([3001, 3002, 3003, 3004])
    expect(detectListeningPorts(output, 2)).toEqual([3003, 3004])
  })

  it('reports the conflicting port from EADDRINUSE output', () => {
    const express = 'Error: listen EADDRINUSE: address already in use :::3019\n    at Server.setupListenHandle'
    expect(detectListeningPorts(express)).toEqual([3019])
    expect(detectListeningPorts('Port 3020 is already in use')).toEqual([3020])
  })

  it('ignores dates, versions and out-of-range numbers', () => {
    expect(detectListeningPorts('started at 2026-11-19T01:03:35.586Z port 999999')).toEqual([])
    expect(detectListeningPorts('v19.4.0 http://localhost:0/')).toEqual([])
    expect(detectListeningPorts('')).toEqual([])
  })
})

describe('isServerCommand', () => {
  it.each([
    ['npm', ['run', 'dev']],
    ['pnpm', ['dev']],
    ['yarn', ['start']],
    ['bun', ['run', 'dev']],
    ['npm', ['run', 'preview']],
    ['vite', []],
    ['next', ['dev']],
    ['npx', ['vite']],
    ['uvicorn', ['app:main']],
    ['python', ['-m', 'http.server', '8000']],
    ['dotnet', ['run']],
    ['mvn', ['spring-boot:run']],
  ])('treats %s %s as a server', (command, args) => {
    expect(isServerCommand(command, args)).toBe(true)
  })

  it.each([
    ['npm', ['test']],
    ['npm', ['run', 'build']],
    ['npx', ['tsc', '--noEmit']],
    ['git', ['status']],
    ['node', ['scripts/seed.mjs']],
    ['npm', []],
  ])('treats %s %s as a one-shot command', (command, args) => {
    expect(isServerCommand(command, args)).toBe(false)
  })

  it('normalizes Windows executable suffixes and case', () => {
    expect(isServerCommand('NPM.CMD', ['run', 'DEV'])).toBe(true)
    expect(isServerCommand('Vite.EXE', [])).toBe(true)
  })
})
