import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  enabled: true,
  runtimeMode: 'host' as 'host' | 'wsl',
}

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
    get resourcesPath() {
      return join(process.cwd(), 'resources')
    },
  },
}))

vi.mock('../config-store', () => ({
  configStore: { get: (key: string) => (key === 'builtinBillionContext' ? state.enabled : undefined) },
}))

vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: () => ({ mode: state.runtimeMode, distro: state.runtimeMode === 'wsl' ? 'Ubuntu' : null }),
}))

import {
  BUILTIN_CONTEXT_PACKAGE_DIR,
  builtinExtensionPathsForWorker,
  bundledContextExtensionDir,
  bundledContextExtensionEntry,
  isBundledContextExtensionAvailable,
} from '../builtin-extensions'

describe('bundled context extension (billion-context)', () => {
  let root = ''

  beforeEach(() => {
    state.enabled = true
    state.runtimeMode = 'host'
    root = mkdtempSync(join(tmpdir(), 'pi-builtin-ext-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function makePackage(withEntry: boolean): string {
    const dir = join(root, BUILTIN_CONTEXT_PACKAGE_DIR)
    mkdirSync(join(dir, 'dist', 'agent'), { recursive: true })
    if (withEntry) writeFileSync(join(dir, 'dist', 'agent', 'billion-context.js'), 'export default () => {}\n', 'utf8')
    return dir
  }

  it('should_point_at_the_bundled_package_in_resources_when_running_from_source', () => {
    expect(bundledContextExtensionDir(join('D:', 'w'), join('D:', 'w', 'resources'), false)).toBe(
      join('D:', 'w', 'resources', BUILTIN_CONTEXT_PACKAGE_DIR),
    )
  })

  it('should_point_at_the_packaged_resources_directory_when_shipped', () => {
    expect(bundledContextExtensionDir(join('C:', 'app'), join('C:', 'app', 'resources'), true)).toBe(
      join('C:', 'app', 'resources', BUILTIN_CONTEXT_PACKAGE_DIR),
    )
  })

  it('should_return_the_manifest_entry_when_the_package_is_present', () => {
    const dir = makePackage(true)
    expect(bundledContextExtensionEntry(root, root, true)).toBe(join(dir, 'dist', 'agent', 'billion-context.js'))
  })

  it('should_return_null_when_the_installer_did_not_ship_the_package', () => {
    makePackage(false)
    expect(bundledContextExtensionEntry(root, root, true)).toBeNull()
  })

  it('should_hand_the_entry_to_the_worker_only_when_the_switch_is_on', () => {
    // 读真实仓库的 resources/billion-context（开发态路径 = process.cwd()/resources）
    const expected = join(process.cwd(), 'resources', BUILTIN_CONTEXT_PACKAGE_DIR, 'dist', 'agent', 'billion-context.js')
    expect(isBundledContextExtensionAvailable()).toBe(true)
    expect(builtinExtensionPathsForWorker()).toEqual([expected])

    state.enabled = false
    expect(builtinExtensionPathsForWorker()).toEqual([])
  })

  it('should_skip_the_extension_inside_wsl_because_the_bundle_lives_on_the_windows_side', () => {
    state.runtimeMode = 'wsl'
    expect(builtinExtensionPathsForWorker()).toEqual([])
  })
})
