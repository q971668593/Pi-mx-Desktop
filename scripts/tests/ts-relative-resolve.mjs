/**
 * 契约测试专用解析钩子：Node 直接执行 `.ts` 源码时要求**相对导入带扩展名**，
 * 而仓库按 bundler 风格写成 `./session-file-key`。这个钩子只做一件事：
 * 相对路径且无扩展名时，依次尝试 `.ts` / `.tsx` / `/index.ts`。
 *
 * 仅被 scripts/tests/ipc-schema-validation.test.mjs 通过 `module.register` 启用，
 * 不影响其它契约测试与产品代码。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$|\.node$/

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !HAS_EXTENSION.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      const candidate = new URL(base.href + suffix)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }
  }
  return nextResolve(specifier, context)
}
