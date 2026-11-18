import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()

/**
 * 结构边界门禁（对应 doc/TYPE-BOUNDARIES.md 里「已类型化接缝」的**可执行**版本）。
 *
 * 参考 opencode 的两种做法：
 *  - `script/ast-grep/rules/*.yml`：结构规则 + 规则自带测试
 *  - `packages/session-ui/src/import-boundaries.test.ts`：用测试守包边界
 *
 * 这里用 node:test + 正则做「零依赖」版本，覆盖最容易越界的四条线。
 */
const RULES = [
  {
    id: 'renderer-no-electron',
    description: 'renderer 不得直接 import electron（必须经 preload 暴露的 piDesktop）',
    dirs: ['src/renderer/src'],
    pattern: /(?:from\s*|require\(\s*)['"]electron['"]/,
  },
  {
    id: 'renderer-no-main',
    description: 'renderer 不得 import 主进程模块（@main / src/main）',
    dirs: ['src/renderer/src'],
    pattern: /(?:from\s*|require\(\s*)['"](?:@main\/|(?:\.\.\/)+.*\/main\/)/,
  },
  {
    id: 'main-no-renderer',
    description: '主进程不得 import 渲染层模块（@renderer / src/renderer）',
    dirs: ['src/main'],
    pattern: /(?:from\s*|require\(\s*)['"](?:@renderer\/|(?:\.\.\/)+.*\/renderer\/)/,
  },
  {
    id: 'shared-no-electron',
    description: 'packages/shared 必须保持与运行时无关（不得 import electron）',
    dirs: ['packages/shared'],
    pattern: /(?:from\s*|require\(\s*)['"]electron['"]/,
  },
]

const PRELOAD_IPC_RENDERER_RULE = {
  id: 'ipcRenderer-only-in-preload',
  description: 'ipcRenderer 只允许出现在 src/preload（渲染层一律走 piDesktop.invoke）',
  dirs: ['src'],
  pattern: /\bipcRenderer\b/,
  allowFiles: [/^src\/preload\//],
}

function walkFiles(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist' || name === 'out') continue
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walkFiles(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

function collectViolations(rule) {
  const violations = []
  for (const dir of rule.dirs) {
    for (const file of walkFiles(join(root, dir))) {
      const rel = relative(root, file).replaceAll('\\', '/')
      if (rule.allowFiles?.some((allow) => allow.test(rel))) continue
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (rule.pattern.test(lines[index])) violations.push(`${rel}:${index + 1}`)
      }
    }
  }
  return violations
}

describe('structure boundaries', () => {
  for (const rule of RULES) {
    it(rule.id, () => {
      const violations = collectViolations(rule)
      assert.deepEqual(violations, [], `${rule.description}\n违规位置：\n  ${violations.join('\n  ')}`)
    })
  }

  it(PRELOAD_IPC_RENDERER_RULE.id, () => {
    const violations = collectViolations(PRELOAD_IPC_RENDERER_RULE)
    assert.deepEqual(
      violations,
      [],
      `${PRELOAD_IPC_RENDERER_RULE.description}\n违规位置：\n  ${violations.join('\n  ')}`,
    )
  })
})
