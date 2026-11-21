import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store: Record<string, unknown> = {}
let userDataDir = ''
let activeKind: 'builtin' | 'global' | 'user' = 'builtin'

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
}))

vi.mock('../config-store', () => ({
  configStore: {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => {
      store[key] = value
    },
  },
}))

vi.mock('../sdk-manager', () => ({
  readSdkStatus: () => ({ active: { kind: activeKind, version: '1.6.0' } }),
  checkNpmAvailable: () => true,
  invalidateSdkManagerCaches: () => {},
}))

import { detectPriorInstall, readOnboarding } from '../runtime-onboarding'

describe('runtime onboarding — 已经装过的机器不再弹窗', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key]
    userDataDir = mkdtempSync(join(tmpdir(), 'pi-onboarding-'))
    activeKind = 'builtin'
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('should_ask_on_a_fresh_machine', () => {
    expect(detectPriorInstall(userDataDir)).toBeNull()
    expect(readOnboarding()).toEqual({ done: false, mode: null })
  })

  it('should_stay_silent_when_the_user_already_picked_a_runtime', () => {
    mkdirSync(join(userDataDir, 'sdk'), { recursive: true })
    writeFileSync(join(userDataDir, 'sdk', 'current.json'), JSON.stringify({ active: 'global' }), 'utf8')

    expect(readOnboarding()).toEqual({ done: true, mode: 'global' })
    // 迁移只做一次：写回配置后不再依赖磁盘探测
    expect(store.runtimeOnboarding).toEqual({ done: true, mode: 'global' })
  })

  it('should_treat_an_isolated_env_choice_as_the_builtin_runtime', () => {
    mkdirSync(join(userDataDir, 'sdk'), { recursive: true })
    writeFileSync(join(userDataDir, 'sdk', 'current.json'), JSON.stringify({ active: 'user' }), 'utf8')

    expect(readOnboarding()).toEqual({ done: true, mode: 'builtin' })
  })

  it('should_stay_silent_when_the_desktop_left_usage_traces_without_a_runtime_record', () => {
    activeKind = 'global'
    writeFileSync(join(userDataDir, 'run-ledger.json'), '{}', 'utf8')

    expect(readOnboarding()).toEqual({ done: true, mode: 'global' })
  })

  it('should_stay_silent_when_projects_were_already_opened', () => {
    store.recentProjects = ['F:/maxv/PI/pi-app']
    expect(readOnboarding()).toEqual({ done: true, mode: 'builtin' })
  })

  it('should_keep_a_recorded_choice_even_if_the_switch_is_now_different', () => {
    store.runtimeOnboarding = { done: true, mode: 'builtin' }
    activeKind = 'global'
    expect(readOnboarding()).toEqual({ done: true, mode: 'builtin' })
    expect(store.runtimeOnboarding).toEqual({ done: true, mode: 'builtin' })
  })
})
