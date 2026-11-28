// IPC Contract - Complete typed method signatures for Renderer/Main/Worker

import type { AppEvent } from './app-events'
import type { CompatibilityLevel } from './extension-types'
import type { ModelAuthProjection } from './model-auth-projection'
import type { AdapterCatalog } from '../../src/extension-compat/adapter-schema'
import type { SessionContextPreview } from './session-context-preview'
import type { GrowChoiceKind, GrowQuestionFormat } from './grow-question'
import type { GrowPrdProposal } from './grow-prd-proposal'

// ── Workspace ──
export interface WorkspaceOpenRequest { path?: string; awaitWorker?: boolean }
export interface WorkspaceEnsureWorkerRequest { path: string }
export interface WorkspaceEnsureWorkerResponse { ok: boolean; workspaceId: string; sessionId?: string; model?: string; error?: string }
export interface WorkspaceOpenResponse { workspaceId: string; path: string; name: string }
export interface WorkspaceSwitchRequest { workspaceId: string }
export interface WorkspaceSwitchResponse { workspaceId: string; path: string; name: string }
export interface WorkspaceFsSearchRequest {
  workspaceRoot: string
  query: string
  maxResults?: number
  includeIgnored?: boolean
}
export interface WorkspaceFsSearchEntry {
  path: string
  name: string
  isDirectory: boolean
}
export interface WorkspaceFsSearchResponse {
  ok: boolean
  entries: WorkspaceFsSearchEntry[]
  error?: 'missing_root' | 'outside_workspace' | 'fd_unavailable' | 'search_failed'
}

// ── Session ──
export interface SessionInfo {
  sessionId: string
  parentSessionFile?: string
  interruptedAt?: number
  /** Source session this one was forked/cloned from (listed flat, not nested). */
  forkedFromSessionFile?: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  modelId: string
  status: 'idle' | 'busy' | 'error'
}
export interface SessionListRequest { workspaceId?: string }
export interface SessionListResponse { sessions: SessionInfo[] }
export interface SessionOpenRequest { sessionId: string; sessionFile?: string }
export interface SessionOpenResponse { session: SessionInfo }
export interface SessionNewRequest { workspaceId: string; title?: string; modelId?: string }
export interface SessionNewResponse { session: SessionInfo }
export interface SessionForkRequest {
  sessionId?: string
  sessionFile: string
  entryId?: string
  /** @deprecated use entryId */
  fromMessageId?: string
  title?: string
  position?: 'before' | 'at'
  workspaceId?: string
}
export interface SessionForkResponse {
  cancelled?: boolean
  error?: string
  editorText?: string
  sessionId?: string
  sessionFile?: string
  workspaceId?: string
  session: SessionInfo & { sessionFile?: string; error?: string }
}
export interface SessionCloneRequest {
  sessionId?: string
  sessionFile: string
  title?: string
  workspaceId?: string
}
export interface SessionCloneResponse {
  cancelled?: boolean
  error?: string
  sessionId?: string
  sessionFile?: string
  workspaceId?: string
  session: SessionInfo & { sessionFile?: string; error?: string }
}
export interface SessionForkCandidatesRequest { sessionFile: string }
export interface SessionForkCandidatesResponse {
  messages: Array<{ entryId: string; text: string }>
  error?: string
}
export interface SessionRenameRequest { sessionId: string; title: string }
export interface SessionRenameResponse { session: SessionInfo }
export interface SessionCompactRequest {
  sessionId: string
  sessionFile: string
  workspaceId?: string
  customInstructions?: string
}
export interface SessionCompactResponse { sessionId: string; compacted: boolean; tokensSaved: number; error?: string }
export interface SessionExportRequest { sessionId: string; format: 'json' | 'markdown' | 'html' }
export interface SessionExportResponse { content: string; format: string; filename: string }
export interface ContextPreviewRequest { sessionFile: string; workspaceId: string }
export interface ContextPreviewResponse { preview: SessionContextPreview | null }

// ── Prompt ──
export interface PromptSendRequest { sessionId: string; text: string }
export interface PromptSendResponse { messageId: string }
export interface PromptSteerRequest { sessionId: string; text: string }
export interface PromptSteerResponse { steered: boolean }
export interface PromptFollowUpRequest { sessionId: string; text: string }
export interface PromptFollowUpResponse { messageId: string }
export interface PromptAbortRequest { sessionId: string; sessionFile: string }
export interface PromptAbortResponse { aborted: boolean; ignored?: boolean; reason?: string; noWorker?: boolean }

// ── Model ──
export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
  availableThinkingLevels?: string[]
  managedBy?: 'active-sdk'
  auth?: ModelAuthProjection
}
export interface ModelListRequest {
  workspaceId?: string
  /** catalog=active Pi SDK 完整目录（默认模型等）；available=已配置鉴权（Composer）；settings=无网络完整目录及脱敏鉴权状态 */
  scope?: 'catalog' | 'available' | 'settings'
}
export interface ModelListResponse { models: ModelInfo[] }
export type ModelReloadRequest = Record<string, never>
export interface ModelReloadResponse { ok: boolean; models: ModelInfo[]; error?: string }
export interface ModelSetRequest {
  sessionId: string
  sessionFile?: string
  provider?: string
  modelId: string
}
export interface ModelSetResponse { modelId: string; thinkingLevel?: string; availableThinkingLevels?: string[] }
export interface ModelCycleRequest { sessionId: string; direction?: 'next' | 'prev' }
export interface ModelCycleResponse { modelId: string; thinkingLevel: string }

export type PiModelsApiType = string

export interface PiModelsModelConfig {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null>
  baseUrl?: string
  headers?: Record<string, unknown>
  cost?: Record<string, unknown>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

export interface PiModelsProviderConfig {
  name?: string
  baseUrl?: string
  api?: PiModelsApiType
  apiKey?: string
  authHeader?: boolean
  headers?: Record<string, unknown>
  compat?: Record<string, unknown>
  oauth?: string
  models?: PiModelsModelConfig[]
  modelOverrides?: Record<string, unknown>
  [key: string]: unknown
}

export interface PiModelsConfigPayload {
  providers: Record<string, PiModelsProviderConfig>
  [key: string]: unknown
}

export interface PiModelsGetRequest {}
export interface PiModelsGetResponse {
  path: string
  config: PiModelsConfigPayload
  parseError?: string
  schemaError?: string
  warnings?: string[]
}

export interface PiModelsSetRequest { config: PiModelsConfigPayload }
export interface PiModelsSetResponse { ok: boolean; path: string; error?: string }

export interface PiModelsFetchRequest {
  baseUrl: string
  apiKey?: string
  authHeader?: boolean
}
export interface PiModelsFetchResponse {
  ok: boolean
  ids?: string[]
  error?: string
}

// ── Magpie 剩余额度（网关本地 http://127.0.0.1:3425，读 models.json 的 providers.magpie） ──
export interface MagpieQuotaWindow {
  name: string
  usedPercent: number
  remainingPercent: number
  resetsAt?: string
}
export interface MagpieQuotaEntry {
  provider: string
  user?: string
  plan?: string
  balance?: number | string
  windows: MagpieQuotaWindow[]
}
export interface MagpieQuotasResponse {
  ok: boolean
  data?: MagpieQuotaEntry[]
  cached?: boolean
  error?: string
}
export interface MagpieStatuslineResponse {
  ok: boolean
  text?: string
  error?: string
}

// ── ThinkingLevel ──
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface ThinkingLevelSetRequest {
  sessionId: string
  sessionFile?: string
  level: ThinkingLevel
}
export interface ThinkingLevelSetResponse { level: string }

// ── Commands ──
export interface CommandInfo {
  id: string
  name: string
  description: string
  category: 'skill' | 'prompt' | 'extension' | 'builtin'
}
export interface CommandsListRequest { sessionId?: string }
export interface CommandsListResponse { commands: CommandInfo[] }

// ── Review ──
export interface ReviewGetDiffRequest {
  sessionId: string
  scope: 'turn' | 'session' | 'git'
  turnId?: string
}
export interface ReviewGitDiffPayload {
  raw: string
  stagedRaw?: string
  status: string
  scope: string
  branch?: string
  log?: string
  isRepo?: boolean
  message?: string
}
export interface ReviewGetDiffResponse { diff: ReviewGitDiffPayload }

export interface ReviewStageHunksRequest {
  cwd: string
  files: { path: string; hunkPatches: string[] }[]
}
export interface ReviewStageHunksResponse { ok: boolean; error?: string }


// ── Extensions ──
export interface ExtensionInfo {
  id: string
  name: string
  version?: string
  description?: string
  enabled: boolean
  compatibility: CompatibilityLevel
  source: 'global' | 'project' | 'package'
  packageSource?: string
  registeredTools: string[]
  registeredCommands: string[]
  loadError?: string
  capabilitySource?: 'static' | 'runtime'
  runtimeLoaded?: boolean
  piSync?: boolean
  piEnabled?: boolean
  inSettingsPackages?: boolean
  workerLoadHint?: string
}
export interface ExtensionsListRequest { workspaceId?: string }
export interface ExtensionsListResponse { extensions: ExtensionInfo[] }
export interface ExtensionMarketplacePackage { name: string; description: string; author?: string; type?: string; source: string; url: string }
export interface ExtensionsMarketplaceSearchRequest { query?: string; type?: string; sort?: string }
export interface ExtensionsMarketplaceSearchResponse { packages: ExtensionMarketplacePackage[]; error?: string }
export interface ExtensionsPackageDetailsRequest { name: string }
export interface ExtensionsPackageDetailsResponse { details?: { version?: string; published?: string; downloads?: string; license?: string; dependencies?: string; installCommand?: string; npmUrl?: string; repositoryUrl?: string; securityNote?: string; readmeExcerpt?: string }; error?: string }
export interface ExtensionsTranslateRequest { text: string; targetLanguage: 'Chinese' | 'English' }
export interface ExtensionsTranslateResponse { ok: boolean; text?: string; error?: 'plugin_model_missing' | 'plugin_model_unavailable' | 'plugin_model_failed' | 'invalid_text' }
export interface ExtensionsPackagesResponse { packages: Array<{ source: string; name: string }>; settingsPath: string; error?: string }
export interface ExtensionsPackageMutationRequest { source: string }
export interface ExtensionsPackageMutationResponse { ok: boolean; source?: string; error?: string; warning?: string }
export interface ExtensionsInstallCapabilityPackageRequest { capability: 'web-search' | 'computer' }
export interface ExtensionsInstallCapabilityPackageResponse { ok: boolean; added?: boolean; updated?: boolean; entry?: string; error?: string; warning?: string }
export interface PythonRuntimeStatusResponse { supported: boolean; installed: boolean; version?: string; path?: string; prompt: boolean; error?: string }
export interface ExtensionsSetEnabledRequest { extensionId: string; enabled: boolean }
export interface ExtensionsSetEnabledResponse { ok: boolean; extensionId: string; enabled: boolean; error?: string; needsWorkerReload?: boolean }

// ── Registry ──
export interface RegistryRefreshRequest { force?: boolean }
export interface RegistryRefreshResponse { refreshed: boolean; count: number; version?: string }

// ── Settings ──
export interface SettingsGetRequest { key?: string }
export interface SettingsGetResponse { settings: Record<string, unknown> }
export interface SettingsSetRequest { key: string; value: unknown }
export interface SettingsSetResponse { key: string; value: unknown }

// ── App update (GitHub Releases) ──
export interface AppCheckUpdateRequest {}
export type AppCheckUpdateResponse = import('./app-update').AppUpdateCheckResult
export interface AppOpenReleaseRequest { url?: string }
export interface AppOpenReleaseResponse { ok: boolean }
export interface AppGetPendingUpdateRequest {}
export interface AppGetPendingUpdateResponse {
  update: import('./app-update').AppUpdateAvailableInfo | null
}
export interface AppDismissUpdatePromptRequest {}
export interface AppDismissUpdatePromptResponse { ok: boolean }
export interface AppIgnoreUpdateVersionRequest { version: string }
export interface AppIgnoreUpdateVersionResponse { ok: boolean }
export interface AppDownloadUpdateRequest {
  url: string
  fileName?: string
}
export interface AppDownloadUpdateResponse {
  ok: boolean
  path?: string
  error?: string
}

// ── Purge（破甲开关：接管 pi 的系统提示词） ──
export type PurgeMode = 'strict' | 'replace' | 'append'
export interface PurgeState {
  enabled: boolean
  mode: PurgeMode
  /** 人设文件绝对路径；空字符串 = 默认 <agentDir>/purge/persona.md */
  source: string
  configFile: string
  extensionFile: string
  extensionInstalled: boolean
  personaFile: string
  personaExists: boolean
  personaChars: number
  /** 安装包里是否带了人设 */
  bundledPersona: boolean
  /** 实际找到的安装包人设文件；空串 = 没找到 */
  bundledPersonaFile: string
  /** 首选查找目录（安装包资源目录），用来解释「为什么找不到」 */
  bundledDir: string
  error?: string
}
export interface PurgeGetStateRequest {}
export type PurgeGetStateResponse = PurgeState
export interface PurgeSetEnabledRequest { enabled: boolean }
export type PurgeSetEnabledResponse = PurgeState
export interface PurgeSetModeRequest { mode: PurgeMode }
export type PurgeSetModeResponse = PurgeState
export interface PurgeReinstallRequest {}
export interface PurgeReinstallResponse extends PurgeState { personaInstalled?: boolean }
export interface PurgeChoosePersonaRequest {}
export type PurgeChoosePersonaResponse = PurgeState

// ── Events ──
export interface EventsSubscribeRequest { channels?: string[] }
export interface EventsSubscribeResponse { subscriptionId: string }

// ── IPC Method Map ──
export interface IpcMethodMap {
  'adapters.json.catalog': { request: { workspaceId?: string; refresh?: boolean }; response: AdapterCatalog }
  'adapters.catalog': { request: { workspaceId?: string; refresh?: boolean }; response: { adapters: Array<{ id: string; pluginId: string; displayName: string; adapterJson?: AdapterCatalog['adapters'][number] }>; errors?: AdapterCatalog['errors'] } }
  'adapter.config.get': { request: { adapterId: string; workspaceId?: string }; response: { view: Record<string, unknown> } }
  'adapter.config.set': { request: { adapterId: string; workspaceId?: string; patch: Record<string, unknown> }; response: { view: Record<string, unknown> } }
  'adapter.action.run': { request: { adapterId: string; actionId: string; workspaceId?: string }; response: { ok: boolean; lines?: string[]; error?: string } }
  'adapter.field.options': { request: { adapterId: string; fieldKey: string; workspaceId?: string }; response: { options: string[]; error?: string } }
  'adapter.sidePanel.getState': { request: { adapterId: string; workspaceId: string }; response: { ok: boolean; state?: unknown; error?: string } }
  'workspace.open': { request: WorkspaceOpenRequest; response: WorkspaceOpenResponse }
  'workspace.ensureWorker': { request: WorkspaceEnsureWorkerRequest; response: WorkspaceEnsureWorkerResponse }
  'workspace.switch': { request: WorkspaceSwitchRequest; response: WorkspaceSwitchResponse }
  'workspace.fs.search': { request: WorkspaceFsSearchRequest; response: WorkspaceFsSearchResponse }
  'workspace.fs.resolveFileNames': { request: { workspaceRoot: string; names: string[] }; response: { ok: boolean; error?: string; matches?: Record<string, string[]> } }
  'session.list': { request: SessionListRequest; response: SessionListResponse }
  'session.open': { request: SessionOpenRequest; response: SessionOpenResponse }
  'session.new': { request: SessionNewRequest; response: SessionNewResponse }
  'session.fork': { request: SessionForkRequest; response: SessionForkResponse }
  'session.forkCandidates': { request: SessionForkCandidatesRequest; response: SessionForkCandidatesResponse }
  'session.clone': { request: SessionCloneRequest; response: SessionCloneResponse }
  'session.rename': { request: SessionRenameRequest; response: SessionRenameResponse }
  'session.compact': { request: SessionCompactRequest; response: SessionCompactResponse }
  'session.export': { request: SessionExportRequest; response: SessionExportResponse }
  'context.preview': { request: ContextPreviewRequest; response: ContextPreviewResponse }
  'prompt.send': { request: PromptSendRequest; response: PromptSendResponse }
  'prompt.steer': { request: PromptSteerRequest; response: PromptSteerResponse }
  'prompt.followUp': { request: PromptFollowUpRequest; response: PromptFollowUpResponse }
  'prompt.abort': { request: PromptAbortRequest; response: PromptAbortResponse }
  'model.list': { request: ModelListRequest; response: ModelListResponse }
  'model.reload': { request: ModelReloadRequest; response: ModelReloadResponse }
  'model.set': { request: ModelSetRequest; response: ModelSetResponse }
  'model.cycle': { request: ModelCycleRequest; response: ModelCycleResponse }
  'pi.models.get': { request: PiModelsGetRequest; response: PiModelsGetResponse }
  'pi.models.set': { request: PiModelsSetRequest; response: PiModelsSetResponse }
  'pi.models.fetch': { request: PiModelsFetchRequest; response: PiModelsFetchResponse }
  'magpie.quotas': { request: Record<string, never>; response: MagpieQuotasResponse }
  'magpie.statusline': { request: Record<string, never>; response: MagpieStatuslineResponse }
  'thinkingLevel.set': { request: ThinkingLevelSetRequest; response: ThinkingLevelSetResponse }
  'commands.list': { request: CommandsListRequest; response: CommandsListResponse }
  'review.getDiff': { request: ReviewGetDiffRequest; response: ReviewGetDiffResponse }
  'review.stageHunks': { request: ReviewStageHunksRequest; response: ReviewStageHunksResponse }
  'review.unstageHunks': { request: ReviewStageHunksRequest; response: ReviewStageHunksResponse }
  'extensions.list': { request: ExtensionsListRequest; response: ExtensionsListResponse }
  'extensions.marketplaceSearch': { request: ExtensionsMarketplaceSearchRequest; response: ExtensionsMarketplaceSearchResponse }
  'extensions.packageDetails': { request: ExtensionsPackageDetailsRequest; response: ExtensionsPackageDetailsResponse }
  'extensions.translate': { request: ExtensionsTranslateRequest; response: ExtensionsTranslateResponse }
  'extensions.packages': { request: {}; response: ExtensionsPackagesResponse }
  'extensions.installPackage': { request: ExtensionsPackageMutationRequest; response: ExtensionsPackageMutationResponse }
  'extensions.removePackage': { request: ExtensionsPackageMutationRequest; response: ExtensionsPackageMutationResponse }
  'extensions.installCapabilityPackage': { request: ExtensionsInstallCapabilityPackageRequest; response: ExtensionsInstallCapabilityPackageResponse }
  'python.status': { request: {}; response: PythonRuntimeStatusResponse }
  'python.dismissSetupPrompt': { request: {}; response: { ok: boolean } }
  'python.installLatest': { request: {}; response: PythonRuntimeStatusResponse }
  'python.openDownloads': { request: {}; response: { ok: boolean } }
  'sdk.installGlobalCli': { request: { version: string }; response: { ok: boolean; active?: { kind: 'global'; version: string }; error?: string } }
  'extensions.setEnabled': { request: ExtensionsSetEnabledRequest; response: ExtensionsSetEnabledResponse }
  'registry.refresh': { request: RegistryRefreshRequest; response: RegistryRefreshResponse }
  'settings.get': { request: SettingsGetRequest; response: SettingsGetResponse }
  'settings.set': { request: SettingsSetRequest; response: SettingsSetResponse }
  'purge.getState': { request: PurgeGetStateRequest; response: PurgeGetStateResponse }
  'purge.setEnabled': { request: PurgeSetEnabledRequest; response: PurgeSetEnabledResponse }
  'purge.setMode': { request: PurgeSetModeRequest; response: PurgeSetModeResponse }
  'purge.reinstall': { request: PurgeReinstallRequest; response: PurgeReinstallResponse }
  'purge.choosePersona': { request: PurgeChoosePersonaRequest; response: PurgeChoosePersonaResponse }
  'app.checkUpdate': { request: AppCheckUpdateRequest; response: AppCheckUpdateResponse }
  'app.getPendingUpdate': {
    request: AppGetPendingUpdateRequest
    response: AppGetPendingUpdateResponse
  }
  'app.dismissUpdatePrompt': {
    request: AppDismissUpdatePromptRequest
    response: AppDismissUpdatePromptResponse
  }
  'app.openRelease': { request: AppOpenReleaseRequest; response: AppOpenReleaseResponse }
  'app.ignoreUpdateVersion': {
    request: AppIgnoreUpdateVersionRequest
    response: AppIgnoreUpdateVersionResponse
  }
  'app.downloadUpdate': {
    request: AppDownloadUpdateRequest
    response: AppDownloadUpdateResponse
  }
  'grow-prd.projectPreview': { request: GrowPrdProjectIdentity & { proposal: GrowPrdProposal }; response: GrowPrdProjectResponse<GrowPrdProjectPreview> }
  'grow-prd.projectConfirm': { request: GrowPrdProjectIdentity & { previewId: string; confirmed: true }; response: GrowPrdProjectResponse<GrowPrdProjectTransaction> }
  'grow-prd.projectListIncomplete': { request: GrowPrdProjectIdentity; response: GrowPrdProjectResponse<Array<{ operationId: string; state: string }>> }
  'grow-prd.projectRecover': { request: GrowPrdProjectIdentity & { operationId: string; confirmed: true }; response: GrowPrdProjectResponse<GrowPrdProjectTransaction> }
  'grow-prd.projectContext': { request: { workspaceId: string }; response: GrowPrdProjectResponse<GrowPrdProjectContext> }
  'events.subscribe': { request: EventsSubscribeRequest; response: EventsSubscribeResponse; stream: AppEvent }
}

export interface GrowPrdProjectIdentity { workspaceId: string; sessionFile: string; treeSessionId: string }
export type GrowPrdProjectResponse<T> = { ok: true; data: T } | { ok: false; error: string; message: string }
export interface GrowPrdProjectPreview {
  previewId: string
  hashes: { prd: { before: string; after: string }; tree: { before: string; after: string } }
  candidate: { sessionId: string; reason: string; newTreeJson: string; changes: Array<{ nodeId: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>; affectedNodeIds: string[]; comparison: { prd: { before: string; after: string }; tree: { before: string; after: string } } }
}
export interface GrowPrdProjectContext { prdHash: string; prdExists: boolean; trees: Array<{ sessionId: string; revision: number }> }
export interface GrowPrdProjectTransaction { version: 1; operationId: string; treeSessionId: string; prd: { oldHash: string; newHash: string }; tree: { oldHash: string; newHash: string }; state: 'prepared' | 'prd-written' | 'tree-written' | 'committed' }

// ── Grow（需求树 grow-me）：会话 + 轮次问答 + 果子转看板 ──
export type GrowNodeStatus = 'pending' | 'answered' | 'needs_review' | 'deferred'
export interface GrowNodeView extends GrowQuestionFormat { id: string; question: string; status: GrowNodeStatus; round?: number; answer?: string; selectedOptions?: string[]; depends_on?: string[]; chapter_id?: string }
export interface GrowChapterView { id: string; title: string; ready: boolean }
export interface GrowPanelStateView {
  ready: boolean; sessionId?: string; revision?: number; currentRound?: number
  nodes: GrowNodeView[]; chapters: GrowChapterView[]
  pendingCount: number; reviewCount: number; docFile?: string | null; requirement?: string; planStale?: boolean
}
export interface GrowGetStateRequest { workspaceId: string; sessionId?: string }
export interface GrowGetStateResponse { ok: boolean; state?: GrowPanelStateView; error?: string }
export interface GrowBeginPlanRequest { workspaceId: string; sessionId: string }
export interface GrowFinishPlanRequest extends GrowBeginPlanRequest { expectedRevision: number }
export interface GrowPlanResponse { ok: boolean; revision?: number; error?: string }
export interface GrowStartSessionRequest { workspaceId: string; requirement?: string }
export interface GrowStartSessionResponse { ok: boolean; sessionId?: string; revision?: number; error?: string }
export interface GrowQuestionInput extends GrowQuestionFormat { id: string; question: string; rationale?: string; depends_on?: string[]; chapter_id?: string }
export interface GrowPutQuestionsRequest { workspaceId: string; sessionId: string; round: number; questions: GrowQuestionInput[]; expectedRevision?: number }
export interface GrowPutQuestionsResponse { ok: boolean; revision?: number; count?: number; error?: string }
export interface GrowSubmitAnswerRequest { workspaceId: string; sessionId: string; nodeId: string; action: 'confirm' | 'defer' | 'unclear' | 'answer' | 'select'; text?: string; selectedOptions?: string[]; publishedFormat?: { kind: GrowChoiceKind; options: string[] } }
export interface GrowSubmitAnswerResponse { ok: boolean; revision?: number; node?: GrowNodeView; error?: string }
export interface GrowConvertToTeamRequest { workspaceId: string; role?: string; sessionId?: string }
export interface GrowConvertToTeamResponse { ok: boolean; created?: Array<{ id: string; title: string }>; error?: string }

// ── Type helpers ──
export type IpcMethodName = keyof IpcMethodMap
export type IpcRequest<M extends IpcMethodName> = IpcMethodMap[M]['request']
export type IpcResponse<M extends IpcMethodName> = IpcMethodMap[M]['response']

export function ipcChannel<M extends IpcMethodName>(method: M): string {
  return `ipc:${method}`
}

export interface IpcInvoker {
  invoke<M extends IpcMethodName>(method: M, request: IpcRequest<M>): Promise<IpcResponse<M>>
}

export interface IpcHandler<M extends IpcMethodName> {
  (request: IpcRequest<M>): Promise<IpcResponse<M>>
}

export const EVENTS_CHANNEL = 'ipc:events'
