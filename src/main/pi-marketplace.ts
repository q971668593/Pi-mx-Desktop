import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app, net } from 'electron'
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { resolveActiveAgentDir } from './agent-dir'

export interface MarketplacePackage {
  name: string
  description: string
  author?: string
  type?: string
  source: string
  url: string
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim()
}

export function parseMarketplaceHtml(html: string): MarketplacePackage[] {
  const result: MarketplacePackage[] = []
  const cards = html.match(/<article\b[^>]*data-package-card="true"[\s\S]*?<\/article>/gi) ?? []
  for (const card of cards) {
    const nameMatch = card.match(/data-package-name="([^"]+)"/i)
    const titleMatch = card.match(/class="packages-name"[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)
    const descriptionMatch = card.match(/class="packages-desc"[^>]*>([\s\S]*?)<\/p>/i)
    const authorMatch = card.match(/class="packages-meta"[^>]*>\s*<span>([\s\S]*?)<\/span>/i)
    const typeMatch = card.match(/data-type="([^"]+)"/i)
    const name = stripHtml(titleMatch?.[1] ?? nameMatch?.[1] ?? '')
    // Pi's catalog package IDs are npm names; reject other source forms before exposing an install action.
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) continue
    result.push({
      name,
      description: stripHtml(descriptionMatch?.[1] ?? ''),
      author: stripHtml(authorMatch?.[1] ?? '') || undefined,
      type: typeMatch?.[1],
      source: `npm:${name}`,
      url: `https://pi.dev/packages/${name.split('/').map(encodeURIComponent).join('/')}`,
    })
  }
  return result
}

export async function searchPiMarketplace(query = '', type = 'extension', sort = 'downloads'): Promise<MarketplacePackage[]> {
  const params = new URLSearchParams()
  const normalized = query.trim().slice(0, 120)
  if (normalized) params.set('name', normalized)
  if (['extension', 'skill', 'prompt', 'theme'].includes(type)) params.set('type', type)
  if (['downloads', 'recent', 'name'].includes(sort)) params.set('sort', sort)
  const url = `https://pi.dev/packages${params.size ? `?${params}` : ''}`
  const response = await net.fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } })
  if (!response.ok) throw new Error(`Pi 市场暂时无法访问（HTTP ${response.status}）`)
  const html = await response.text()
  return parseMarketplaceHtml(html)
}

function definitionValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<dt[^>]*>\\s*${escaped}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, 'i'))
  return match?.[1] ? stripHtml(match[1]) : undefined
}

export async function getPiMarketplacePackageDetails(name: string) {
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error('无效的插件名称')
  const url = `https://pi.dev/packages/${name.split('/').map(encodeURIComponent).join('/')}`
  const response = await net.fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } })
  if (!response.ok) throw new Error(`无法读取插件详情（HTTP ${response.status}）`)
  const html = await response.text()
  const links = html.match(/class="packages-detail-links"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ''
  const readme = html.match(/class="rich-text packages-readme"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/i)?.[1] ?? ''
  const paragraphs = [...readme.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 4).map((match) => stripHtml(match[1])).filter(Boolean)
  const securityNote = html.match(/class="packages-security-card"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]
  const installCommand = html.match(/data-copy-text="([^"]*pi install[^"]*)"/i)?.[1]
  return {
    version: definitionValue(html, 'Version'),
    published: definitionValue(html, 'Published'),
    downloads: definitionValue(html, 'Downloads'),
    license: definitionValue(html, 'License'),
    dependencies: definitionValue(html, 'Dependencies'),
    installCommand: installCommand ? decodeHtml(installCommand) : `pi install npm:${name}`,
    npmUrl: links.match(/href="(https:\/\/www\.npmjs\.com\/package\/[^\"]+)"/i)?.[1],
    repositoryUrl: links.match(/href="(https:\/\/github\.com\/[^\"]+)"/i)?.[1],
    securityNote: securityNote ? stripHtml(securityNote) : undefined,
    readmeExcerpt: paragraphs.join('\n\n'),
  }
}

export function listConfiguredPiPackages(): { packages: Array<{ source: string; name: string }>; settingsPath: string } {
  const settingsPath = join(resolveActiveAgentDir(), 'settings.json')
  if (!existsSync(settingsPath)) return { packages: [], settingsPath }
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { packages?: unknown[] }
  const entries = Array.isArray(settings.packages) ? settings.packages : []
  const packages = entries.flatMap((entry) => {
    const source = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object' && 'source' in entry
        ? String((entry as { source: unknown }).source)
        : ''
    if (!source) return []
    return [{ source, name: source.replace(/^npm:/, '').split('/').pop() || source }]
  })
  return { packages, settingsPath }
}

function isSafePackageSource(source: string): boolean {
  return /^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9.*^~+-]+)?$/i.test(source)
    || /^git:github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+(?:@[a-z0-9._/-]+)?$/i.test(source)
}

function runPiPackageCommand(action: 'install' | 'remove', source: string): Promise<void> {
  if (!isSafePackageSource(source) || (action === 'install' && !source.startsWith('npm:'))) {
    return Promise.reject(new Error(action === 'install' ? '目前只支持从 Pi 市场安装 npm 插件' : '不支持此插件来源'))
  }
  const cliPath = join(app.getAppPath(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
  if (!existsSync(cliPath)) return Promise.reject(new Error('找不到 Pi 包管理器'))

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, action, source], {
      cwd: resolveActiveAgentDir(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PI_CODING_AGENT_DIR: resolveActiveAgentDir() },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    const timer = setTimeout(() => child.kill(), 180_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(output.trim() || `Pi ${action} failed (${code ?? 'stopped'})`))
    })
  })
}

export const installPiMarketplacePackage = (source: string): Promise<void> => runPiPackageCommand('install', source)
export const removePiMarketplacePackage = (source: string): Promise<void> => runPiPackageCommand('remove', source)

function createPiPackageManager(cwd: string) {
  const agentDir = resolveActiveAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir)
  return new DefaultPackageManager({ cwd, agentDir, settingsManager })
}

export async function checkPiMarketplaceUpdates(cwd: string) {
  return createPiPackageManager(cwd).checkForAvailableUpdates()
}

export async function updatePiMarketplacePackage(source: string, cwd: string): Promise<void> {
  if (!isSafePackageSource(source)) throw new Error('不支持此插件来源')
  const configured = listConfiguredPiPackages().packages.some((pkg) => pkg.source === source)
  if (!configured) throw new Error('该插件已不在当前 Pi 配置中，请刷新后重试')
  await createPiPackageManager(cwd).update(source)
}
