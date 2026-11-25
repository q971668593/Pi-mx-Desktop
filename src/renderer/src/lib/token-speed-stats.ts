/**
 * 模型出字速度的滚动平均。
 *
 * 单个 run 的 tok/s 来自「本次输出 token / 本次耗时」，只要碰上这些情况就没有值：
 * 只有工具调用没有正文、provider 没报 usage、刚开机的第一次 run、耗时为 0。
 * 那时界面上只剩一个「—」，看不出快慢。这里把每次结算过的真实速率留成样本，
 * 拿样本平均兜底，界面始终能给出一个大致速度。
 */
const STORAGE_KEY = 'pi-desktop:token-speed-samples'
const MAX_SAMPLES = 30
/** 太短的 run 噪声大（一次工具往返也会算进来），不进入平均。 */
const MIN_DURATION_MS = 400
const MIN_OUTPUT_TOKENS = 8

export type TokenSpeedSample = { at: number; tps: number }

function readSamples(): TokenSpeedSample[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((row) => row as Partial<TokenSpeedSample>)
      .filter((row): row is TokenSpeedSample => typeof row.at === 'number' && typeof row.tps === 'number' && row.tps > 0 && Number.isFinite(row.tps))
  } catch {
    return []
  }
}

let cache: TokenSpeedSample[] | null = null

function samples(): TokenSpeedSample[] {
  if (cache === null) cache = readSamples()
  return cache
}

/** 记一次真实结算的速率；明显不合理的样本（0 或离谱的高）直接丢掉。 */
export function recordTokenSpeedSample(outputTokens: number | undefined, durationMs: number | undefined): void {
  const tokens = outputTokens ?? 0
  const duration = durationMs ?? 0
  if (tokens < MIN_OUTPUT_TOKENS || duration < MIN_DURATION_MS) return
  const tps = tokens * 1000 / duration
  if (!Number.isFinite(tps) || tps <= 0 || tps > 5000) return
  const next = [...samples(), { at: Date.now(), tps }].slice(-MAX_SAMPLES)
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 存不下就只用内存里这一份 */
  }
}

/** 最近样本的平均速率；没有样本时返回 null。 */
export function averageTokenSpeed(): { tps: number; count: number } | null {
  const rows = samples()
  if (rows.length === 0) return null
  const recent = rows.slice(-MAX_SAMPLES)
  const total = recent.reduce((sum, row) => sum + row.tps, 0)
  const tps = total / recent.length
  if (!Number.isFinite(tps) || tps <= 0) return null
  return { tps, count: recent.length }
}

/** 界面上统一用这个格式化。tps 为 null 表示连历史样本都没有（刚开机、没有任何一次结算），
 *  这时返回「—」而不是「0 tok/s」——0 是错误事实，会让用户以为模型卡住了。 */
export function formatTokenSpeed(tps: number | null | undefined, prefix = ''): string {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return '—'
  const rounded = tps >= 100 ? Math.round(tps) : Math.round(tps * 10) / 10
  return `${prefix}${rounded} tok/s`
}
