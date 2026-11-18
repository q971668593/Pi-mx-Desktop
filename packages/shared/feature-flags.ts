/**
 * 特性开关注册表（参考 opencode 的 packages/schema/src/config/flag.ts）
 *
 * 目的不是「多一个开关」，而是给实验性能力一个**统一账本**：
 *  - 有哪些开关（`FLAG_REGISTRY`，每条都写清用途）
 *  - 默认值（dev 默认开 / release 默认关；`OPT_IN_ONLY` 任何构建都必须显式开启）
 *  - 旧名兼容（`FLAG_ALIASES`，改名时不必同时改所有配置）
 *  - 退场纪律：**功能转正 = 删掉注册表条目 + 删掉所有读取点**，不留长期开关
 *
 * 读取入口统一走 `isFlagEnabled()`；不要在业务代码里直接读 `process.env.PI_FLAGS`。
 */
/** 解析上下文：显式传入 env 与 isDev，保持纯函数（主进程用 `!app.isPackaged` 作为 isDev）。 */
export interface FeatureFlagContext {
  env?: Record<string, string | undefined>
  isDev?: boolean
}

/**
 * 开关清单。key 用下划线小写；说明必须是「用户能看懂的一句话」。
 * 每条都应对应方案里的一个具体交付项，禁止登记「以后可能有用」的空开关。
 */
export const FLAG_REGISTRY = {
  ipc_contract_generation: 'IPC 通道白名单与契约文档改由主进程注册点生成（对应方案 T1）',
  structure_boundaries: '结构边界门禁（renderer 不直连主进程等，对应方案 T2）',
  plugin_manager: '插件管理界面：搜索 / 安装 / 卸载（对应路线图 G2 第一段）',
  plugin_config_form: '插件图形化配置表单（对应路线图 G2 第二段）',
  session_tree_diff: '会话树分支并排 diff（对应路线图 G3）',
  multi_session_panel: '多会话并行 + 子任务面板（对应路线图 G4）',
  theme_json_presets: 'JSON 主题预设与 Schema 校验（对应方案 T8）',
} as const satisfies Record<string, string>

export type FeatureFlag = keyof typeof FLAG_REGISTRY

/** 任何构建（含 dev）都必须显式开启：默认关闭，只能通过 PI_FLAGS / 配置打开。 */
export const OPT_IN_ONLY: ReadonlySet<FeatureFlag> = new Set<FeatureFlag>([])

/** 改名后仍可用的旧 key（旧名 → 新名）。 */
export const FLAG_ALIASES = {} as const satisfies Record<string, FeatureFlag>

/** `PI_FLAGS=all` 的保留词：开启其余全部开关（不含 opt-in-only）。 */
export const FLAG_WILDCARD = 'all'

export interface ParsedFlags {
  enabled: FeatureFlag[]
  disabled: FeatureFlag[]
  unknown: string[]
}

export interface ResolvedFlags {
  flags: Map<FeatureFlag, boolean>
  unknown: string[]
}

const ALL_FLAGS = Object.keys(FLAG_REGISTRY) as FeatureFlag[]

function isFeatureFlag(value: string): value is FeatureFlag {
  return Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, value)
}

/** 旧名 → 新名；未知返回 null。 */
export function canonicalFlag(name: string): FeatureFlag | null {
  const trimmed = name.trim()
  if (isFeatureFlag(trimmed)) return trimmed
  const alias = (FLAG_ALIASES as Record<string, FeatureFlag>)[trimmed]
  return alias ?? null
}

/** 解析 `PI_FLAGS`：支持 `a,b`、`all`、`-b`（强制关）、`all,-b`。 */
export function parseFlags(raw: string | undefined): ParsedFlags {
  const enabled = new Set<FeatureFlag>()
  const disabled = new Set<FeatureFlag>()
  const unknown: string[] = []
  if (!raw) return { enabled: [], disabled: [], unknown }

  for (const token of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (token === FLAG_WILDCARD) {
      for (const flag of ALL_FLAGS) if (!OPT_IN_ONLY.has(flag)) enabled.add(flag)
      continue
    }
    const negated = token.startsWith('-')
    const name = canonicalFlag(negated ? token.slice(1) : token)
    if (!name) {
      unknown.push(token)
      continue
    }
    if (negated) {
      disabled.add(name)
      enabled.delete(name)
      continue
    }
    enabled.add(name)
    disabled.delete(name)
  }

  return { enabled: [...enabled], disabled: [...disabled], unknown }
}

/**
 * 计算每个开关的最终值。
 *
 * 优先级（后者覆盖前者）：dev/release 默认值 → `PI_FLAGS` 的开启项 → `PI_FLAGS` 的 `-name`。
 * `OPT_IN_ONLY` 的开关即使 dev 默认也是关，必须显式出现在 `PI_FLAGS` 里。
 */
export function resolveFlags(context: FeatureFlagContext = {}): ResolvedFlags {
  const env = context.env ?? {}
  const isDev = context.isDev ?? false
  const parsed = parseFlags(env.PI_FLAGS)
  const flags = new Map<FeatureFlag, boolean>()

  for (const flag of ALL_FLAGS) {
    const devDefault = isDev && !OPT_IN_ONLY.has(flag)
    flags.set(flag, devDefault)
  }
  for (const flag of parsed.enabled) flags.set(flag, true)
  for (const flag of parsed.disabled) flags.set(flag, false)

  return { flags, unknown: parsed.unknown }
}

export function isFlagEnabled(flag: FeatureFlag, context: FeatureFlagContext = {}): boolean {
  return resolveFlags(context).flags.get(flag) ?? false
}

/** 供设置页 / 诊断页展示：稳定顺序 + 人类可读说明。 */
export function describeFlags(context: FeatureFlagContext = {}): Array<{
  flag: FeatureFlag
  description: string
  enabled: boolean
  optInOnly: boolean
}> {
  const resolved = resolveFlags(context)
  return ALL_FLAGS.map((flag) => ({
    flag,
    description: FLAG_REGISTRY[flag],
    enabled: resolved.flags.get(flag) ?? false,
    optInOnly: OPT_IN_ONLY.has(flag),
  }))
}

/** 代码里按字符串开启开关时用；拼错立即抛错，避免「开关写了但不生效」的静默失败。 */
export function assertKnownFlag(name: string): FeatureFlag {
  const flag = canonicalFlag(name)
  if (!flag) throw new Error(`未知特性开关：${name}（请先在 FLAG_REGISTRY 登记）`)
  return flag
}
