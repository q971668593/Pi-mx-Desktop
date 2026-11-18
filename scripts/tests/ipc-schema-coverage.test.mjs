import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * IPC request validation budget.
 *
 * `registerHandler` hands the renderer's JSON straight to the handler; only
 * `registerHandlerWithSchema` validates it with zod. The preload allowlist checks the
 * channel name, not the payload, so an unvalidated handler trusts whatever shape arrives.
 *
 * Handlers that ignore their argument (`() =>`, `(_req) =>`) need no schema and are exempt.
 * The rest are registered here as a budget: it may only go down. When you convert a
 * handler to `registerHandlerWithSchema`, lower MAX_UNVALIDATED_REQUESTS in the same commit.
 */
const MAX_UNVALIDATED_REQUESTS = 99
const root = process.cwd()

function mainSources(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...mainSources(path))
    else if (name.endsWith('.ts') && !name.includes('.test.')) files.push(path)
  }
  return files
}

export function unvalidatedRequestHandlers() {
  const rows = []
  for (const file of mainSources(join(root, 'src/main'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/registerHandler\(\s*'([^']+)'\s*,\s*/g)) {
      const after = source.slice(match.index + match[0].length, match.index + match[0].length + 300).replace(/\r?\n/g, ' ')
      const signature = after.trimStart().match(/^(async\s*)?\(\s*([^)]*)\)/)
      const location = relative(root, file).replaceAll('\\', '/')
      if (!signature) {
        rows.push(`${location}: ${match[1]} (non-literal handler)`)
        continue
      }
      const parameter = (signature[2] ?? '').trim()
      if (parameter === '' || parameter.startsWith('_')) continue
      rows.push(`${location}: ${match[1]}`)
    }
  }
  return rows
}

describe('IPC request schema coverage', () => {
  it(`keeps unvalidated request handlers <= ${MAX_UNVALIDATED_REQUESTS}`, () => {
    const rows = unvalidatedRequestHandlers()
    assert.ok(
      rows.length <= MAX_UNVALIDATED_REQUESTS,
      `${rows.length} handlers take an unvalidated request (budget ${MAX_UNVALIDATED_REQUESTS}).\n` +
        'Wrap new handlers in registerHandlerWithSchema (see src/main/ipc/schemas.ts).\n' +
        rows.join('\n'),
    )
  })
})
