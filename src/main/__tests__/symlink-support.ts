import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Creating a symlink on Windows needs Developer Mode or an elevated shell, so the containment tests
 * that build real symlink fixtures are skipped where the OS refuses. They still run on CI/Linux/macOS.
 */
export const symlinksSupported: boolean = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-symlink-probe-'))
  try {
    writeFileSync(join(dir, 'target.txt'), 'x')
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'))
    return true
  } catch {
    return false
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})()
