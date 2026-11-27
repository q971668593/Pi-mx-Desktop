export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

export function estTokensFromChars(chars: number): number {
  return Math.round(chars / 4)
}

const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g

/**
 * 估算文本的 Token 数：中文/日韩字符约 0.65 token/字，英文与代码约 0.25 token/字符。
 */
export function estTokensFromText(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK_RE)?.length ?? 0
  const rest = text.length - cjk
  return Math.round(cjk * 0.65 + rest * 0.25)
}