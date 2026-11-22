import type { Pluggable } from 'unified'
import { KATEX_MACROS } from '@renderer/features/timeline/markdown-math-preprocess'

type RemarkMathPlugin = typeof import('remark-math')['default']
type RehypeKatexPlugin = typeof import('rehype-katex')['default']

export interface LoadedMathPlugins {
  remarkMath: RemarkMathPlugin
  rehypeKatex: RehypeKatexPlugin
}

let cachedMathPlugins: LoadedMathPlugins | null = null
let pendingMathLoad: Promise<LoadedMathPlugins> | null = null

/** Quick check for TeX math delimiters or fenced math blocks before loading KaTeX. */
export function hasMathSyntax(text: string): boolean {
  if (!text) return false
  return /(?<!\\)\$\$|\\\[|\\\(|\$(?=[^\s$])[^$\n]*(?<!\\)\$|\\begin\{|```(?:math|latex|tex)\b/i.test(text)
}

export function getLoadedMathPlugins(): LoadedMathPlugins | null {
  return cachedMathPlugins
}

export function loadMathPlugins(): Promise<LoadedMathPlugins> {
  if (cachedMathPlugins) return Promise.resolve(cachedMathPlugins)
  if (pendingMathLoad) return pendingMathLoad
  pendingMathLoad = Promise.all([
    import('remark-math'),
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
    import('katex/contrib/mhchem/mhchem.js'),
  ])
    .then(([rm, rk]) => {
      cachedMathPlugins = {
        remarkMath: rm.default,
        rehypeKatex: rk.default,
      }
      pendingMathLoad = null
      return cachedMathPlugins
    })
    .catch((err) => {
      pendingMathLoad = null
      throw err
    })
  return pendingMathLoad
}

export function buildRehypePluginsWithMath(mathPlugins: LoadedMathPlugins | null): Pluggable[] {
  if (!mathPlugins) return []
  return [
    [
      mathPlugins.rehypeKatex,
      {
        trust: false,
        // 'warn' 只会刷控制台（中文进公式等），渲染结果不变
        strict: 'ignore',
        macros: KATEX_MACROS,
        output: 'htmlAndMathml',
      },
    ],
  ]
}
