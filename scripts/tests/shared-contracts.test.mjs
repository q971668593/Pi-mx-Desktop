import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('shared IPC / AppEvent contracts', () => {
  it('ipc-channels list is non-empty and includes session.list', () => {
    const generated = readFileSync(join(root, 'packages/shared/ipc-channels.generated.ts'), 'utf8')
    assert.match(generated, /export const IPC_INVOKE_CHANNELS/)
    assert.match(generated, /ipc:session\.list/)
    const shell = readFileSync(join(root, 'packages/shared/ipc-channels.ts'), 'utf8')
    assert.match(shell, /isAllowedIpcChannel/)
  })

  it('app-event-session guards sdk-install-progress', () => {
    const src = readFileSync(join(root, 'packages/shared/app-event-session.ts'), 'utf8')
    assert.match(src, /sdk-install-progress/)
    assert.match(src, /isSessionScopedAppEvent/)
  })
})