import { registerDialogHandlers } from './ipc/handlers/dialog'
import { registerWorkspaceFsHandlers } from './ipc/handlers/workspace-fs'
import { registerWorkspaceHandlers } from './ipc/handlers/workspace'
import { registerSessionHandlers } from './ipc/handlers/session'
import { registerPromptHandlers } from './ipc/handlers/prompt'
import { registerSessionGoalHandlers } from './ipc/handlers/session-goal'
import { registerPromptInjectHandlers } from './ipc/handlers/prompt-inject'
import { registerSettingsHandlers } from './ipc/handlers/settings'
import { registerWindowControlHandlers } from './ipc/handlers/window-controls'
import { registerTerminalHandlers } from './ipc/handlers/terminal'
import { registerUsageHandlers } from './ipc/handlers/usage'
import { registerGitBranchHandlers } from './ipc/handlers/git-branches'
import { registerGitBoardHandlers } from './ipc/handlers/git-board'
import { registerBackgroundHandlers } from './ipc/handlers/background'
import { registerModelRuntimeHandlers } from './ipc/handlers/model-runtime'
import { registerModelAuthHandlers } from './ipc/handlers/model-auth'
import { registerExtensionHandlers } from './ipc/handlers/extensions'
import { registerExtensionUiHandlers } from './ipc/handlers/extension-ui'
import { registerAdapterPanelHandlers } from './ipc/handlers/adapter-panels'
import { registerSkillsResourceHandlers } from './ipc/handlers/skills-resources'
import { registerReviewHandlers } from './ipc/handlers/review'
import { registerCommandsSlashHandlers } from './ipc/handlers/commands-slash'
import { registerAsrHandlers } from './ipc/handlers/asr'
import { registerPiSdkHandlers } from './ipc/handlers/pi-sdk'
import { registerRuntimeOnboardingHandlers } from './ipc/handlers/runtime-onboarding'
import { registerWslHandlers } from './ipc/handlers/wsl'
import { registerDesktopChromeHandlers } from './ipc/handlers/desktop-chrome'
import { registerBrowserHandlers } from './ipc/handlers/browser'
import { registerMcpHandlers } from './ipc/handlers/mcp'
import { registerModelRouterHandlers } from './ipc/handlers/model-routers'
import { registerRemoteHandlers } from './ipc/handlers/remote'
import { registerLinkHandlers } from './ipc/handlers/links'
import { registerWorkspaceTaskHandlers } from './ipc/handlers/workspace-tasks'
import { registerTeamBoardHandlers } from './ipc/handlers/team-board'
import { registerImageGenHandlers } from './ipc/handlers/image-gen'
import { registerPurgeHandlers } from './ipc/handlers/purge'
import { registerFeedbackHandlers } from './ipc/handlers/feedback'
import { registerDelegateHandlers } from './ipc/handlers/delegate'
import { registerMagpieQuotaHandlers } from './ipc/handlers/magpie-quotas'

export { registerHandler, sendEvent } from './ipc/registry'

export function registerAllHandlers(): void {
  registerDialogHandlers()
  registerWorkspaceFsHandlers()
  registerWorkspaceHandlers()
  registerWorkspaceTaskHandlers()
  registerTeamBoardHandlers()
  registerImageGenHandlers()
  registerSessionHandlers()
  registerPromptHandlers()
  registerSessionGoalHandlers()
  registerPromptInjectHandlers()
  registerSettingsHandlers()
  registerWindowControlHandlers()
  registerTerminalHandlers()
  registerUsageHandlers()
  registerGitBranchHandlers()
  registerGitBoardHandlers()
  registerBackgroundHandlers()
  registerExtensionUiHandlers()
  registerModelRuntimeHandlers()
  registerModelAuthHandlers()
  registerExtensionHandlers()
  registerAdapterPanelHandlers()
  registerSkillsResourceHandlers()
  registerReviewHandlers()
  registerCommandsSlashHandlers()
  registerAsrHandlers()
  registerPiSdkHandlers()
  registerRuntimeOnboardingHandlers()
  registerMcpHandlers()
  registerModelRouterHandlers()
  registerWslHandlers()
  registerDesktopChromeHandlers()
  registerBrowserHandlers()
  registerRemoteHandlers()
  registerLinkHandlers()
  registerPurgeHandlers()
  registerFeedbackHandlers()
  registerDelegateHandlers()
  registerMagpieQuotaHandlers()
}
