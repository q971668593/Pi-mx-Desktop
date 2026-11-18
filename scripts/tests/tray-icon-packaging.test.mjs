import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Windows tray icon packaging contract', () => {
  it('generates the icon before every package path and ships the runtime ICO location', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    const exporterPath = join(root, 'scripts', 'export-app-icon.mjs')

    assert.ok(existsSync(join(root, 'resources', 'icon.svg')), 'icon source SVG must be committed')
    assert.ok(existsSync(exporterPath), 'icon exporter script must be committed')

    const exporter = readFileSync(exporterPath, 'utf8')
    assert.match(
      exporter,
      /const\s+outIco\s*=\s*join\(outDir,\s*['"]icon\.ico['"]\)/,
      'exporter must target build/icon.ico',
    )
    assert.match(
      exporter,
      /const ICO_SIZES = \[[^\]]*16, 24, 32, 48, 64, 128, 256\]/
        ,
      'ICO must multi-size the taskbar sizes (1.0.2 起不再只缩一张 256)',
    )
    assert.match(
      exporter,
      /writeFile\(outIco,\s*pngToIco\(images\)\)/,
      'exporter must write the generated multi-size ICO bytes',
    )
    assert.match(
      pkg.scripts['icon:export'],
      /node scripts\/export-app-icon\.mjs/,
      'icon:export must run the exporter',
    )
    assert.match(pkg.scripts.package, /icon:export\s*&&/, 'generic package must generate app icons first')
    assert.match(pkg.scripts['package:win'], /icon:export\s*&&/, 'Windows package must generate app icons first')
    assert.match(builder, /from:\s*build\/icon\.ico[\s\S]*to:\s*resources\/build\/icon\.ico/)
  })
})
