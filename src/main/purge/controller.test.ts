import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
    get resourcesPath() {
      return join(process.cwd(), 'resources')
    },
  },
}))

// 默认 agent 目录走 WSL/config-store 那条链，单测里用桩替掉（真实路径由各用例显式传入）
vi.mock('../agent-dir', () => ({
  resolveActiveAgentDir: () => join(process.cwd(), '.tmp-agent-dir'),
}))

import {
  bundledPurgeCandidates,
  bundledPurgeDir,
  ensurePurgeInstalled,
  getPurgeState,
  importPurgePersona,
  purgeConfigMtime,
  purgePaths,
  setPurgeEnabled,
  setPurgeMode,
  setPurgeSource,
} from './controller'

const tempRoots: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

/** 造一个「安装包资源目录」：扩展 + 人设各一份。 */
function makeBundled(patch = 'BUNDLED_EXTENSION', persona = 'BUNDLED_PERSONA'): string {
  const dir = makeTempDir('pi-purge-bundled-')
  writeFileSync(join(dir, 'pi-app-purge.ts'), patch, 'utf8')
  writeFileSync(join(dir, 'persona.md'), persona, 'utf8')
  return dir
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('bundledPurgeDir', () => {
  it('打包后指向 resources/purge，开发时指向仓库 resources/purge', () => {
    expect(bundledPurgeDir('/app', '/app-res', true)).toBe(join('/app-res', 'purge'))
    expect(bundledPurgeDir('/repo', '/app-res', false)).toBe(join('/repo', 'resources', 'purge'))
  })
})

describe('bundledPurgeCandidates', () => {
  it('先看安装包资源目录，再看 exe 旁边（手工补人设的救命口）', () => {
    const dirs = bundledPurgeCandidates('/app', '/app-res', '/exe/Pi mx.exe', true)
    expect(dirs[0]).toBe(join('/app-res', 'purge'))
    expect(dirs).toContain(join('/exe', 'purge'))
    expect(dirs).toContain(join('/exe', 'resources', 'purge'))
    expect(dirs).toContain('/exe')
  })
})

describe('ensurePurgeInstalled 的兜底查找', () => {
  it('安装包目录没有人设、exe 旁边有：照样能补上（老安装包的救法）', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const resourcesDir = makeTempDir('pi-purge-res-')
    writeFileSync(join(resourcesDir, 'pi-app-purge.ts'), 'EXT', 'utf8')
    const exeDir = makeTempDir('pi-purge-exe-')
    writeFileSync(join(exeDir, 'persona.md'), 'EXE_PERSONA', 'utf8')

    const result = ensurePurgeInstalled({ agentDir, bundledDirs: [resourcesDir, exeDir] })
    const paths = purgePaths(agentDir)

    expect(result.extensionInstalled).toBe(true)
    expect(result.personaInstalled).toBe(true)
    expect(result.bundledPersona).toBe(true)
    expect(readFileSync(paths.personaFile, 'utf8')).toBe('EXE_PERSONA')
  })

  it('哪里都没有人设：如实报告 bundledPersona=false，不假装成功', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const resourcesDir = makeTempDir('pi-purge-res-')
    writeFileSync(join(resourcesDir, 'pi-app-purge.ts'), 'EXT', 'utf8')

    const result = ensurePurgeInstalled({ agentDir, bundledDirs: [resourcesDir] })

    expect(result.extensionInstalled).toBe(true)
    expect(result.personaInstalled).toBe(false)
    expect(result.bundledPersona).toBe(false)
    expect(existsSync(purgePaths(agentDir).personaFile)).toBe(false)
  })
})

describe('ensurePurgeInstalled', () => {
  it('把安装包里的扩展和人设复制进 agent 目录', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const bundledDir = makeBundled()
    const result = ensurePurgeInstalled({ agentDir, bundledDir })
    const paths = purgePaths(agentDir)

    expect(result.extensionInstalled).toBe(true)
    expect(result.personaInstalled).toBe(true)
    expect(readFileSync(paths.extensionFile, 'utf8')).toBe('BUNDLED_EXTENSION')
    expect(readFileSync(paths.personaFile, 'utf8')).toBe('BUNDLED_PERSONA')
  })

  it('人设存在时不覆盖用户改过的内容，扩展始终跟着安装包更新', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const bundledDir = makeBundled('V2_EXTENSION', 'V2_PERSONA')
    const paths = purgePaths(agentDir)
    mkdirSync(join(agentDir, 'purge'), { recursive: true })
    mkdirSync(join(agentDir, 'extensions'), { recursive: true })
    writeFileSync(paths.personaFile, 'MY_OWN_PERSONA', 'utf8')
    writeFileSync(paths.extensionFile, 'OLD_EXTENSION', 'utf8')

    const result = ensurePurgeInstalled({ agentDir, bundledDir })

    expect(result.personaInstalled).toBe(false)
    expect(readFileSync(paths.personaFile, 'utf8')).toBe('MY_OWN_PERSONA')
    expect(readFileSync(paths.extensionFile, 'utf8')).toBe('V2_EXTENSION')
  })

  it('安装包没带人设时不报错，只是 bundledPersona=false', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const bundledDir = makeTempDir('pi-purge-bundled-')
    writeFileSync(join(bundledDir, 'pi-app-purge.ts'), 'EXT', 'utf8')

    const result = ensurePurgeInstalled({ agentDir, bundledDir })

    expect(result.extensionInstalled).toBe(true)
    expect(result.bundledPersona).toBe(false)
    expect(result.error).toBeUndefined()
  })
})

describe('设置页读写 config.json', () => {
  it('没有配置文件时给出默认值（关闭 / strict）', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const state = getPurgeState({ agentDir, bundledDir: makeBundled() })
    expect(state.enabled).toBe(false)
    expect(state.mode).toBe('strict')
    expect(state.extensionInstalled).toBe(false)
    expect(state.personaExists).toBe(false)
    expect(state.error).toBeUndefined()
  })

  it('setEnabled 写盘后立刻能读回，且配置 mtime 变化（扩展靠这个当场生效）', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const options = { agentDir, bundledDir: makeBundled() }
    getPurgeState(options)
    const before = purgeConfigMtime({ agentDir })

    const next = setPurgeEnabled(true, { agentDir })

    expect(next.enabled).toBe(true)
    expect(getPurgeState(options).enabled).toBe(true)
    expect(purgeConfigMtime({ agentDir })).not.toBe(before)
    expect(JSON.parse(readFileSync(purgePaths(agentDir).configFile, 'utf8'))).toMatchObject({
      enabled: true,
      mode: 'strict',
    })
  })

  it('setMode 只认 strict/replace/append，其它值退回 strict', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    expect(setPurgeMode('replace', { agentDir }).mode).toBe('replace')
    expect(setPurgeMode('append', { agentDir }).mode).toBe('append')
    expect(setPurgeMode('bogus', { agentDir }).mode).toBe('strict')
  })

  it('importPersona 写进 agent 目录并把人设来源复位到默认位置', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    setPurgeSource(join(agentDir, 'elsewhere.md'), { agentDir })

    const state = importPurgePersona('MY_PERSONA', { agentDir })
    const paths = purgePaths(agentDir)

    expect(state.source).toBe('')
    expect(state.personaFile).toBe(paths.personaFile)
    expect(state.personaChars).toBe('MY_PERSONA'.length)
    expect(readFileSync(paths.personaFile, 'utf8')).toBe('MY_PERSONA\n')
  })

  it('source 指向外部文件时，状态跟着外部文件走', () => {
    const agentDir = makeTempDir('pi-purge-agent-')
    const external = join(agentDir, 'elsewhere.md')
    writeFileSync(external, 'EXTERNAL', 'utf8')

    const state = setPurgeSource(external, { agentDir })

    expect(state.personaFile).toBe(external)
    expect(state.personaExists).toBe(true)
    expect(state.personaChars).toBe('EXTERNAL'.length)
    expect(existsSync(purgePaths(agentDir).personaFile)).toBe(false)
  })
})
