import { z } from 'zod'
import { normalizeFontName } from '../../../packages/shared/custom-theme.ts'
import { MAX_GOAL_CRITERIA, MAX_GOAL_CRITERION_LENGTH, MAX_GOAL_LENGTH } from '../../../packages/shared/session-goal.ts'
import { ICON_THEMES } from '../../../packages/shared/icon-theme.ts'
import { BROWSER_SEARCH_ENGINE_IDS, type BrowserSearchEngine } from '../../../packages/shared/browser-types.ts'
import { CAPABILITY_IDS } from '../../../packages/shared/capabilities.ts'

export const shellOpenPathSchema = z.object({
  path: z.string().min(1).max(4096),
})

// ── 破甲开关（设置 › Agent › 破甲） ──
export const purgeSetEnabledSchema = z.object({
  enabled: z.boolean(),
})

export const purgeSetModeSchema = z.object({
  mode: z.enum(['strict', 'replace', 'append']),
})

// ── 提示词注入（设置 › Agent › 提示词注入） ──
const promptInjectWorkspaceId = z.string().max(4096).optional()

export const promptInjectTargetSchema = z.object({
  workspaceId: promptInjectWorkspaceId,
})

export const promptInjectSaveSchema = z.object({
  workspaceId: promptInjectWorkspaceId,
  enabled: z.boolean().optional(),
  text: z.string().max(200_000).optional(),
  scope: z.enum(['global', 'project']).optional(),
})

export const promptInjectRestoreBackupSchema = z.object({
  workspaceId: promptInjectWorkspaceId,
  name: z.string().min(1).max(200),
})

export const shellShowItemSchema = z.object({
  path: z.string().min(1).max(4096),
})

export const workspaceFsListDirSchema = z.object({
  workspaceRoot: z.string(),
  path: z.string().optional(),
  includeDotfiles: z.boolean().optional(),
})

export const workspaceFsSearchSchema = z.object({
  workspaceRoot: z.string().min(1),
  query: z.string().max(512),
  maxResults: z.number().int().min(1).max(200).optional(),
  includeIgnored: z.boolean().optional(),
})

export const workspaceFsResolveFileNamesSchema = z.object({
  workspaceRoot: z.string().min(1),
  names: z.array(z.string().min(1).max(512)).min(1).max(20),
})

export const workspaceFsReadTextSchema = z.object({
  workspaceRoot: z.string(),
  path: z.string(),
  maxBytes: z.number().optional(),
})

export const workspaceFsWriteTextSchema = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  content: z.string().max(8_000_000),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})

export const workspaceFsRenameSchema = z.object({
  workspaceRoot: z.string(),
  relativePath: z.string(),
  newName: z.string(),
})

export const workspaceFsCreateSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1),
  isDirectory: z.boolean().optional(),
})

export const workspaceFsCopyFileSchema = z.object({
  workspaceRoot: z.string().min(1),
  sourcePath: z.string().min(1),
  targetDirectory: z.string(),
  sourceIsWorkspaceRelative: z.boolean().optional(),
})

export const workspaceFsClipboardDebugSchema = z.object({
  stage: z.enum([
    'tree-focus', 'tree-select', 'shortcut-keydown', 'copy-keydown', 'copy-captured', 'paste-keydown', 'paste-event',
    'paste-files', 'copy-start', 'copy-complete', 'copy-failed', 'app-blur',
  ]),
  source: z.string().max(500).optional(),
  target: z.string().max(500).optional(),
  detail: z.string().max(1000).optional(),
}).strict()

export const sessionCompactSchema = z.object({
  sessionId: z.string().optional(),
  sessionFile: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1).optional(),
  customInstructions: z.string().optional(),
}).strict()

export const sessionExportSchema = z.object({
  format: z.enum(['json', 'markdown', 'html']).optional(),
  sessionFile: z.string().optional(),
})

export const sessionNavigateTreeSchema = z.object({
  targetId: z.string().min(1),
  sessionFile: z.string().optional(),
  summarize: z.boolean().optional(),
  label: z.string().optional(),
})

export const sessionTreeSchema = z
  .object({
    sessionFile: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1).optional(),
  })
  .strict()

export const sessionGetMessagesSchema = z
  .object({
    sessionFile: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    /** After navigateTree: force branch tip so history matches rewound leaf */
    leafId: z.string().nullable().optional(),
  })
  .strict()

export const sessionNewSchema = z.object({
  workspaceId: z.string().min(1),
})

export const sessionDeleteSchema = z
  .object({
    sessionFile: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
  })
  .strict()

export const sessionPrepareSchema = z.object({
  sessionFile: z.string().min(1),
  bind: z.boolean().optional(),
})

/** 目标条：按会话（sessionFile）读写的 app 私有状态。 */
const goalSessionFileSchema = z.string().trim().min(1).max(4096)

export const sessionGoalGetSchema = z
  .object({
    sessionFile: goalSessionFileSchema,
  })
  .strict()

export const sessionGoalSetSchema = z
  .object({
    sessionFile: goalSessionFileSchema,
    goal: z.string().trim().min(1).max(MAX_GOAL_LENGTH),
    /** 省略 = 保留现有验收项（只改目标文本）。 */
    criteria: z
      .array(z.string().max(MAX_GOAL_CRITERION_LENGTH))
      .max(MAX_GOAL_CRITERIA * 2)
      .optional(),
  })
  .strict()

export const sessionGoalToggleCriterionSchema = z
  .object({
    sessionFile: goalSessionFileSchema,
    index: z.number().int().min(0).max(MAX_GOAL_CRITERIA - 1),
  })
  .strict()

export const sessionGoalMarkDoneSchema = z
  .object({
    sessionFile: goalSessionFileSchema,
    /** 1 起的验收项序号，与 `GOAL-PROGRESS: 1,3` 的约定一致。 */
    indices: z.array(z.number().int().min(1).max(MAX_GOAL_CRITERIA)).max(MAX_GOAL_CRITERIA),
    expectedUpdatedAt: z.number().int().nonnegative().optional(),
  })
  .strict()

export const sessionGoalClearSchema = z
  .object({
    sessionFile: goalSessionFileSchema,
  })
  .strict()

export const contextPreviewSchema = z
  .object({
    sessionFile: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
  })
  .strict()

export const workspaceOpenSchema = z.object({
  path: z.string().min(1),
  awaitWorker: z.boolean().optional(),
})

export const workspaceSandboxDeleteSchema = z.object({
  path: z.string().min(1),
})

export const promptTextSchema = z.object({
  text: z.string(),
  sessionFile: z.string().optional(),
  /** Session capabilities switched on in the composer; omitted = the session's stored switches. */
  capabilities: z.array(z.enum(CAPABILITY_IDS)).max(8).optional(),
})

/** 立即发送排队消息：只带会话与已开启的能力，队列内容留在 Worker 里。 */
export const promptFlushQueueSchema = z.object({
  sessionFile: z.string().optional(),
  capabilities: z.array(z.enum(CAPABILITY_IDS)).max(8).optional(),
})

/** 侧栏隐藏项目（可一次隐藏一个仓库组里的多个工作副本）。 */
export const projectHideSchema = z.object({
  paths: z.array(z.string().min(1)).max(200).optional(),
  path: z.string().min(1).optional(),
})

/** A Tools-menu switch: push the new set to the session's live worker right away. */
export const capabilityApplySchema = z.object({
  sessionFile: z.string().optional(),
  capabilities: z.array(z.enum(CAPABILITY_IDS)).max(8),
})

const CLIPBOARD_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export const clipboardWriteTempImageSchema = z
  .object({
    data: z.string().min(1),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']),
  })
  .superRefine((req, ctx) => {
    const bytes = Buffer.from(req.data, 'base64')
    if (bytes.length > CLIPBOARD_IMAGE_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image too large', path: ['data'] })
    }
  })

export const clipboardReadTempImageSchema = z.object({
  path: z.string().min(1),
})

export const dialogSaveImageSchema = z.object({
  path: z.string().min(1),
  workspaceRoot: z.string().optional(),
  suggestedName: z.string().min(1).max(255).optional(),
  data: z.string().min(1).max(30_000_000).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']).optional(),
})

export const piSettingsSetSchema = z.object({
  patch: z.record(z.unknown()),
})

export const shellReadImagePreviewSchema = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})

export const reviewMutationSchema = z.object({
  cwd: z.string().optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        hunkPatches: z.array(z.string()),
      }),
    )
    .optional(),
})

export const sdkInstallSchema = z.object({
  version: z.string().min(1),
})

const hexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
const fontNameSchema = z
  .string()
  .max(80)
  .refine((value) => normalizeFontName(value) === value, 'invalid local font name')

const themeVariantSchema = z
  .object({
    preset: z.string().nullable(),
    accent: hexColorSchema,
    surface: hexColorSchema,
    ink: hexColorSchema,
    contrast: z.number().min(0).max(100),
    fontUi: fontNameSchema.nullable(),
    fontCode: fontNameSchema.nullable(),
    translucentSidebar: z.boolean(),
    diffAdded: hexColorSchema.optional(),
    diffRemoved: hexColorSchema.optional(),
    colors: z
      .object({
        sidebar: hexColorSchema.optional(),
        chat: hexColorSchema.optional(),
        userBubble: hexColorSchema.optional(),
        codeBg: hexColorSchema.optional(),
        border: hexColorSchema.optional(),
      })
      .strict()
      .optional(),
    fontDisplay: fontNameSchema.nullable().optional(),
    proseFont: z.enum(['ui', 'display']).optional(),
    chatFontSize: z.number().min(12).max(18).optional(),
    chatLineHeight: z.number().min(1.3).max(2).optional(),
    radius: z.number().min(0).max(16).optional(),
    shadow: z.number().min(0).max(100).optional(),
  })
  .strict()

const paneMaterialSchema = z.enum(['frosted', 'glass', 'clear'])

const backgroundImageSchema = z
  .object({
    file: z.string().regex(/^[a-f0-9]{16,64}\.(png|jpe?g|webp|gif|avif)$/),
    opacity: z.number().min(0.05).max(1),
    blur: z.number().min(0).max(24),
    uiOpacity: z.number().min(0.5).max(1),
    fit: z.enum(['cover', 'contain', 'tile', 'center']),
    position: z.enum(['center', 'top', 'bottom']),
    brightness: z.number().min(0.4).max(1.3).optional(),
    saturation: z.number().min(0).max(1.6).optional(),
    vignette: z.boolean().optional(),
    material: paneMaterialSchema.optional(),
    paneBlur: z.number().min(0).max(40).optional(),
    fullCover: z.boolean().optional(),
    content: z.object({ uiOpacity: z.number().min(0.3).max(1), paneBlur: z.number().min(0).max(40), material: paneMaterialSchema }).strict().optional(),
  })
  .strict()

const settingsValueSchemas: Record<string, z.ZodTypeAny> = {
  theme: z.enum(['light', 'dark', 'system']),
  iconTheme: z.enum(ICON_THEMES),
  customTheme: z
    .object({ light: themeVariantSchema.optional(), dark: themeVariantSchema.optional() })
    .strict()
    .nullable(),
  customCssOverride: z.object({ enabled: z.boolean(), css: z.string() }).strict(),
  background: z
    .object({
      shared: z.boolean(),
      light: backgroundImageSchema.optional(),
      dark: backgroundImageSchema.optional(),
    })
    .strict(),
  language: z.enum(['zh', 'en']),
  currentProject: z.string().nullable(),
  recentProjects: z.array(z.string()),
  imageGen: z
    .object({
      provider: z.enum(['off', 'codex', 'custom']),
      model: z.string().max(120),
      baseUrl: z.string().max(400),
      apiKey: z.string().max(400),
      // size 已不在设置页暴露（每次需求画幅不同）：旧配置里可能没有这个键。
      size: z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']).optional(),
      quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']),
      identity: z.enum(['web', 'codex']),
      outputDir: z.string().max(200),
      promptEnhance: z.enum(['auto', 'off']).optional(),
    })
    .strict(),
  recentProjectsFixedOrder: z.boolean(),
  autoOpenLastProject: z.boolean(),
  builtinBillionContext: z.boolean(),
  autoCheckRegistryUpdates: z.boolean(),
  includePrereleaseUpdates: z.boolean(),
  ignoredUpdateVersion: z.string(),
  alertSoundEnabled: z.boolean(),
  alertSoundPreset: z.enum(['chime', 'drop', 'double', 'rise', 'soft', 'none']),
  alertSoundVolume: z.number().int().min(0).max(200),
  alertNotificationEnabled: z.boolean(),
  alertOnExtensionUi: z.boolean(),
  alertOnRunIdle: z.boolean(),
  alertOnBackgroundRunIdle: z.boolean(),
  alertOnRunFailed: z.boolean(),
  aiActivityGlowEnabled: z.boolean(),
  completionNotificationTimeoutSeconds: z.number().int().min(5).max(60),
  completionNotificationPreview: z.enum(['response', 'fixed']),
  completionNotificationOnlyWhenUnfocused: z.boolean(),
  completionNotificationDndUntil: z.number().nullable(),
  completionNotificationDelivery: z.enum(['auto', 'custom', 'system']),
  maxSessionWorkers: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sessionWorkerIdleTimeoutMinutes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  timelineMaxAutoExpandedTools: z.number().int().min(0).max(50),
  timelineVisibleTurns: z.number().int().min(1).max(200),
  rightPanelPrefs: z.record(z.boolean()),
  rightPanelOrder: z.array(z.string()),
  sessionTitleFollowsLatest: z.boolean(),
  sessionDisplayNames: z.record(z.string()),
  projectDisplayNames: z.record(z.string()),
  hiddenWorktrees: z.array(z.string()),
  extensionOverrides: z.record(z.boolean()),
  skillOverrides: z.record(z.boolean()),
  skillPresentation: z.record(z.object({ alias: z.string().optional(), icon: z.string().optional() }).strict()),
  extensionConfigs: z.record(z.record(z.unknown())),
  panelWidths: z
    .object({ sidebar: z.number(), right: z.number() })
    .nullable(),
  windowBounds: z
    .object({ width: z.number(), height: z.number(), x: z.number().optional(), y: z.number().optional() })
    .nullable(),
  asrConfig: z.record(z.unknown()),
  sessionCapabilities: z.record(z.array(z.enum(CAPABILITY_IDS)).max(8)),
  browserSearchEngine: z.enum(BROWSER_SEARCH_ENGINE_IDS as [BrowserSearchEngine, ...BrowserSearchEngine[]]),
  browserDownloader: z.enum(['auto', 'electron']),
  browserAria2Path: z.string().max(4096),
  browserAgentCdp: z.enum(['auto', 'off']),
  browserDownloadConnections: z.number().int().min(1).max(16),
  agentRuntime: z
    .object({
      mode: z.enum(['host', 'wsl']),
      distro: z.string().nullable(),
    })
    .strict(),
  pluginModel: z
    .object({
      provider: z.string().trim().min(1).max(200),
      modelId: z.string().trim().min(1).max(300),
      thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
    })
    .strict()
    .nullable(),
}

export const settingsSetSchema = z
  .object({
    key: z.string().min(1),
    value: z.unknown(),
  })
  .superRefine((req, ctx) => {
    const schema = settingsValueSchemas[req.key]
    if (!schema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unknown settings key', path: ['key'] })
      return
    }
    const parsed = schema.safeParse(req.value)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['value', ...issue.path] })
      }
    }
  })

/* ────────────────────────────────────────────────────────────────────────────
 * 类型校验（历史通道）
 *
 * 下面这些通道是老写法 registerHandler + `async (req) => …`：preload 只校验通道名，
 * 请求体原样进主进程。逐一改成强约束会碰到「有的调用方不带参数」「有的会多带字段」的历史行为，
 * 所以统一用 looseRequest：字段全可选（`undefined` / 缺参都算 `{}`），但**给了就必须是对的类型**，
 * 未知键原样透传（有些通道会把请求体整体转给 Worker）。
 * 这样新调用方传错字段类型会被当场拦下，老调用方行为不变。
 * ──────────────────────────────────────────────────────────────────────────── */
export function looseRequest<T extends z.ZodRawShape>(shape: T) {
  const body = z.object(shape).passthrough()
  type Out = z.infer<typeof body>
  // 输入侧放宽到 unknown（缺参 / undefined 走空对象），输出侧仍是带类型的对象，
  // 这样 handler 里 `req.xxx` 有类型，而老调用方什么都不传也不会被拒。
  const schema = z.preprocess((value) => (value == null ? {} : value), body)
  return schema as unknown as z.ZodSchema<Out>
}

export const sessionListSchema = looseRequest({
  workspaceId: z.string().optional(),
  refresh: z.boolean().optional(),
})

export const sessionOpenSchema = looseRequest({
  sessionId: z.string().optional(),
  sessionFile: z.string().optional(),
})

export const sessionBindSchema = looseRequest({
  sessionFile: z.string().nullable().optional(),
})

export const sessionVisibleSchema = looseRequest({
  sessionFile: z.string().nullable().optional(),
})

export const sessionEphemeralDraftSchema = looseRequest({
  active: z.boolean().optional(),
})

export const sessionBranchAnchorsSchema = looseRequest({
  sessionFile: z.string().optional(),
})

export const rewindCheckpointsSchema = looseRequest({
  sessionId: z.string().optional(),
  sessionFile: z.string().optional(),
})

export const rewindRunCommandSchema = looseRequest({
  text: z.string().optional(),
})

export const sessionForkSchema = looseRequest({
  title: z.string().optional(),
  entryId: z.string().optional(),
  fromMessageId: z.string().optional(),
  sessionFile: z.string().optional(),
  workspaceId: z.string().optional(),
})

export const sessionCloneSchema = looseRequest({
  title: z.string().optional(),
  sessionFile: z.string().optional(),
  workspaceId: z.string().optional(),
})

export const sessionFileOnlySchema = looseRequest({
  sessionFile: z.string().optional(),
})

export const projectRemoveRecentSchema = looseRequest({
  path: z.string().optional(),
  isRepositoryGroup: z.boolean().optional(),
  groupPaths: z.array(z.string()).max(200).optional(),
  siblingPaths: z.array(z.string()).max(200).optional(),
})

export const projectPathSchema = looseRequest({
  path: z.string().optional(),
})

export const projectRenameSchema = looseRequest({
  path: z.string().optional(),
  name: z.string().optional(),
  isRepositoryGroup: z.boolean().optional(),
})

export const promptAbortSchema = looseRequest({
  sessionFile: z.string().optional(),
})

export const promptDequeueClearQueueSchema = looseRequest({
  abort: z.boolean().optional(),
  currentText: z.string().optional(),
  sessionFile: z.string().optional(),
})

export const workspaceEnsureWorkerSchema = looseRequest({
  path: z.string().optional(),
})

export const workspaceSwitchSchema = looseRequest({
  workspaceId: z.string().min(1),
})

export const workspaceSandboxCreateSchema = looseRequest({
  label: z.string().optional(),
})

export const workspaceSandboxRenameSchema = looseRequest({
  path: z.string().optional(),
  label: z.string().optional(),
})

export const workspaceIsSandboxSchema = looseRequest({
  path: z.string().optional(),
})

export const desktopKillWorkerSchema = looseRequest({
  sessionFile: z.string().optional(),
})

export const desktopSleepBlockSchema = looseRequest({
  on: z.boolean().optional(),
})

export const notificationsMarkSchema = looseRequest({
  id: z.string().optional(),
  unread: z.boolean().optional(),
})

export const terminalProfilesSchema = looseRequest({
  refresh: z.boolean().optional(),
})

export const terminalCreateSchema = looseRequest({
  profileId: z.string().optional(),
  cwd: z.string().optional(),
  workspace: z.string().optional(),
  rawCommand: z.string().max(8000).optional(),
  cols: z.number().optional(),
  rows: z.number().optional(),
})

export const terminalResizeSchema = looseRequest({
  id: z.string().optional(),
  cols: z.number().optional(),
  rows: z.number().optional(),
})

export const terminalKillSchema = looseRequest({
  id: z.string().optional(),
})

export const skillSetEnabledSchema = looseRequest({
  key: z.string().optional(),
  enabled: z.boolean().optional(),
})

export const skillTransferSchema = looseRequest({
  key: z.string().optional(),
  target: z.enum(['project', 'user']).optional(),
  mode: z.enum(['move', 'copy']).optional(),
})

export const resourcePathSchema = looseRequest({
  path: z.string().optional(),
})

export const resourceWriteSchema = looseRequest({
  path: z.string().optional(),
  content: z.string().optional(),
  revisionLabel: z.string().optional(),
})

export const resourceRestoreSchema = looseRequest({
  path: z.string().optional(),
  revisionId: z.string().optional(),
})

export const settingsGetSchema = looseRequest({
  key: z.string().optional(),
})

export const alertsSignalSchema = looseRequest({
  kind: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
})

export const runtimeGetStateSchema = looseRequest({
  workspaceId: z.string().optional(),
  sessionFile: z.string().optional(),
  includeTools: z.boolean().optional(),
})

export const modelListSchema = looseRequest({
  scope: z.enum(['available', 'settings', 'catalog']).optional(),
})

/* 订阅（OAuth）登录：登录流程在主进程跑，界面只回答提问 / 取消 / 退出。 */
export const modelAuthProvidersSchema = looseRequest({})

export const modelAuthLoginSchema = z.object({
  providerId: z.string().min(1),
  type: z.enum(['oauth', 'api_key']).optional(),
})

export const modelAuthAnswerSchema = z.object({
  providerId: z.string().min(1),
  promptId: z.string().min(1),
  value: z.string().optional(),
  cancelled: z.boolean().optional(),
})

export const modelAuthCancelSchema = z.object({
  providerId: z.string().min(1),
})

export const modelSetSchema = looseRequest({
  sessionFile: z.string().optional(),
  provider: z.string().optional(),
  modelId: z.string().optional(),
})

export const thinkingLevelSetSchema = looseRequest({
  sessionFile: z.string().optional(),
  level: z.string().optional(),
})

export const usageSummarySchema = looseRequest({
  days: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
})

export const reviewGetDiffSchema = looseRequest({
  scope: z.string().optional(),
})

export const wslProbeDistroSchema = looseRequest({
  distro: z.string().optional(),
  refresh: z.boolean().optional(),
})
