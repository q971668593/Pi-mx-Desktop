#!/usr/bin/env node
/**
 * One-command self check: every gate CI enforces, run locally in the same order.
 *
 *   npm run selfcheck          typecheck + lint + build + contract tests + full unit suite
 *   npm run selfcheck:quick    same, without the ~3 minute unit suite
 *
 * Exit code 1 when any gate fails; the summary lists every failed step so a red run
 * is actionable without scrolling back through the logs.
 */
import { spawnSync } from 'node:child_process'

const quick = process.argv.includes('--quick')
const color = process.stdout.isTTY && !process.env.NO_COLOR
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s)
const green = (s) => (color ? `\x1b[32m${s}\x1b[0m` : s)
const red = (s) => (color ? `\x1b[31m${s}\x1b[0m` : s)

const steps = [
  ['typecheck', 'tsc -p tsconfig.web.json --noEmit && tsc -p tsconfig.node.json --noEmit'],
  ['lint', 'eslint .'],
  // Contract tests read the built bundles (out/main/index.js, out/preload/index.cjs).
  ['build', 'electron-vite build'],
  ['contract tests', 'node scripts/run-contract-tests.mjs'],
  ...(quick ? [] : [['unit tests', 'vitest run']]),
]

const results = []
for (const [name, command] of steps) {
  process.stdout.write(`\n▶ ${name} ${dim(command)}\n`)
  const started = Date.now()
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
  })
  const ok = result.status === 0
  results.push({ name, ok, ms: Date.now() - started })
  if (!ok) break
}

const failed = results.filter((step) => !step.ok)
const skipped = steps.slice(results.length).map(([name]) => name)
process.stdout.write('\n── self check ─────────────────────────────\n')
for (const step of results) {
  const seconds = `${(step.ms / 1000).toFixed(1)}s`
  process.stdout.write(`${step.ok ? green(' PASS') : red(' FAIL')}  ${step.name.padEnd(16)} ${dim(seconds)}\n`)
}
for (const name of skipped) process.stdout.write(`${red(' SKIP')}  ${name.padEnd(16)} ${dim('(earlier step failed)')}\n`)
if (failed.length) {
  process.stdout.write(red(`\n${failed.length} gate(s) failed: ${failed.map((step) => step.name).join(', ')}\n`))
  process.exit(1)
}
process.stdout.write(green(`\nall gates passed${quick ? ' (quick mode: unit tests skipped)' : ''}\n`))
