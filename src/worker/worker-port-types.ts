/** Messages from Main → Worker utilityProcess. */
export type WorkerIncomingMessage = {
  type?: string
  requestId?: string
  cwd?: string
  sdkPath?: string | null
  /** 随安装包携带的额外扩展文件（绝对路径），由 pi 的 additionalExtensionPaths 加载。 */
  builtinExtensions?: string[]
  text?: string
  options?: unknown
  sessionFile?: string
  offset?: number
  limit?: number
  targetId?: string
  summarize?: boolean
  customInstructions?: string
  replaceInstructions?: string
  label?: string
  provider?: string
  modelId?: string
  level?: string
  patch?: Record<string, unknown>
  commandName?: string
  argumentPrefix?: string
  [key: string]: unknown
}

export type WorkerCommandRow = {
  id: string
  name: string
  description: string
  category: string
  source?: unknown
}

export type WorkerModelRow = {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
  availableThinkingLevels?: string[]
}
