import { shell, BrowserWindow } from 'electron'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { configStore, type StoreSchema } from '../../config-store'
import { previewAiActivityGlow } from '../../ai-activity-glow'
import { asrConfigForSettingsResponse, loadAsrConfig, saveAsrConfig } from '../../asr-config-store'
import { getMainWindow } from '../../window'
import { invalidateAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { workerManager } from '../../worker-manager'
import { invalidateSdkManagerCaches } from '../../sdk-manager'
import { sessionPreviewProcess } from '../../session-preview-process'
import { registerHandler, registerHandlerWithSchema, sendEvent } from '../registry'
import { alertsSignalSchema, settingsGetSchema } from '../schemas'
import { settingsSetSchema } from '../schemas'
import { remoteTap } from '../../remote/tap'
import { getPythonRuntimeStatus, installLatestPython, openPythonDownloads } from '../../python-runtime'
import { capRecentProjects } from '@shared/recent-projects'
import { uniqueWorkspacePaths } from '@shared/workspace-path'

export function registerSettingsHandlers(): void {
  registerHandler('ipc:python.status', async () => getPythonRuntimeStatus(configStore.get('pythonSetupPromptHandled')))
  registerHandler('ipc:python.dismissSetupPrompt', async () => {
    configStore.set('pythonSetupPromptHandled', true)
    return { ok: true }
  })
  registerHandler('ipc:python.installLatest', async () => {
    configStore.set('pythonSetupPromptHandled', true)
    return installLatestPython()
  })
  registerHandler('ipc:python.openDownloads', async () => {
    await openPythonDownloads()
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:settings.get', settingsGetSchema, async (req) => {
    if (req.key) {
      const key = req.key as keyof StoreSchema
      if (key === 'asrConfig') {
        return { settings: { asrConfig: asrConfigForSettingsResponse(loadAsrConfig()) } }
      }
      return { settings: { [req.key]: configStore.get(key) } }
    }
    const all = { ...configStore.getAll() }
    all.asrConfig = asrConfigForSettingsResponse(loadAsrConfig())
    return { settings: all }
  })

  registerHandlerWithSchema('ipc:settings.set', settingsSetSchema, async (req) => {
    const key = req.key as keyof StoreSchema
    if (key === 'asrConfig') {
      saveAsrConfig(req.value as StoreSchema['asrConfig'])
      return { key: req.key, value: asrConfigForSettingsResponse(loadAsrConfig()) }
    }
    if (key === 'agentRuntime') {
      const current = configStore.get('agentRuntime')
      const next = req.value as StoreSchema['agentRuntime']
      const changed = current?.mode !== next.mode || current?.distro !== next.distro
      if (changed) {
        if (workerManager.hasActiveTurns) throw new Error('AGENT_RUNTIME_BUSY')
        // Capture the distro's environment before switching (async — the UI shows progress): the
        // WSL-aware dir lookups that follow are then served from cache instead of a synchronous
        // wsl.exe call (seconds while the distro VM boots) on the UI thread.
        if (next.mode === 'wsl' && next.distro) {
          const { resolveWslEnv } = await import('../../wsl/wsl-env')
          const env = await resolveWslEnv(next.distro, { force: true })
          if (!env) throw new Error('WSL_ENV_UNAVAILABLE')
        }
        await workerManager.stop()
        sessionPreviewProcess.stop()
      }
      configStore.set(key, next)
      if (changed) {
        invalidateAdapterCatalog()
        invalidateSdkManagerCaches()
        // Switching into WSL: capture that distro's environment and boot its preview now, so the
        // first project open does not wait on it.
        if (next.mode === 'wsl' && next.distro) {
          const distro = next.distro
          void import('../../startup-warmup').then((m) => m.warmWslRuntime(distro))
        }
        for (const win of BrowserWindow.getAllWindows()) {
          sendEvent(win, { type: 'sdk-runtime-changed' })
        }
      }
      return { key: req.key, value: next }
    }
    if (key === 'recentProjects') {
      // 项目列表是用户资产：渲染进程写回来时统一去重 + 按同一上限截断，
      // 免得某个片面的旧列表把项目悄悄冲掉。
      const list = Array.isArray(req.value) ? (req.value as unknown[]) : []
      const value = capRecentProjects(uniqueWorkspacePaths(list.filter((p): p is string => typeof p === 'string' && !!p.trim())))
      configStore.set('recentProjects', value)
      return { key: req.key, value }
    }
    configStore.set(key, req.value as StoreSchema[typeof key])
    if (key === 'sessionCapabilities') remoteTap.settingsChanged('capabilities')
    // 内置上下文压缩扩展是在 worker 建会话时挂上去的：改了开关就把 worker 重启一次，
    // 让「下一个新会话生效」不需要用户自己重启应用。有活回合时不动，自然等下一个 worker。
    if (key === 'builtinBillionContext') {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd && workerManager.isRunning && !workerManager.hasActiveTurns) {
        try {
          await workerManager.stop()
          await workerManager.start(cwd)
        } catch (e) {
          console.warn('[settings] worker restart after builtinBillionContext change failed:', e)
        }
      }
    }
    return { key: req.key, value: req.value }
  })

  registerHandler('ipc:app.checkUpdate', async () => {
    const { checkGitHubReleaseUpdate } = await import('../../github-release-check')

    try {
      const result = await checkGitHubReleaseUpdate()
      // Only a stable enum crosses IPC: the raw attempt detail can carry proxy URLs / credentials.
      if (!result.ok) return { status: 'error', reason: result.errorReason ?? 'unknown' }
      if (!result.hasUpdate || !result.latestVersion) {
        return {
          status: 'up-to-date',
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion ?? result.currentVersion,
        }
      }

      const update: AppUpdateAvailableInfo = {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion.replace(/^v/i, ''),
        releaseUrl: result.releaseUrl,
        releaseNotes: result.releaseNotes,
        downloadUrl: result.downloadUrl,
        downloadName: result.downloadName,
        assets: result.assets,
      }
      const { APP_UPDATE_AVAILABLE_CHANNEL, setPendingAppUpdate } = await import('../../updater')
      setPendingAppUpdate(update)
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(APP_UPDATE_AVAILABLE_CHANNEL, update)
      }
      return { status: 'available', update }
    } catch {
      return { status: 'error', reason: 'unknown' }
    }
  })

  registerHandler('ipc:app.getPendingUpdate', async () => {
    const { getPendingAppUpdate } = await import('../../updater')
    return { update: getPendingAppUpdate() }
  })

  registerHandler('ipc:app.dismissUpdatePrompt', async () => {
    const { clearPendingAppUpdate } = await import('../../updater')
    clearPendingAppUpdate()
    return { ok: true }
  })

  registerHandler('ipc:app.openRelease', async (req) => {
    const slug = (process.env.PI_DESKTOP_GITHUB_REPO || 'q971668593/Pi-mx-Desktop').trim()
    const url = (req.url && String(req.url).trim()) || `https://github.com/${slug}/releases`
    await shell.openExternal(url)
    return { ok: true }
  })

  registerHandler('ipc:app.ignoreUpdateVersion', async (req) => {
    const version = String(req.version || '')
      .trim()
      .replace(/^v/i, '')
    configStore.set('ignoredUpdateVersion', version)
    const { clearPendingAppUpdate } = await import('../../updater')
    clearPendingAppUpdate()
    return { ok: true }
  })

  registerHandler('ipc:app.downloadUpdate', async (req) => {
    const { downloadAndLaunchUpdate } = await import('../../app-update-download')
    return downloadAndLaunchUpdate({
      url: String(req.url || ''),
      fileName: String(req.fileName || 'update.bin'),
    })
  })

  registerHandlerWithSchema('ipc:alerts.signal', alertsSignalSchema, async (req) => {
    const { traceAudio } = await import('../../audio-trace')
    traceAudio('ipc.alerts.signal', {
      kind: req.kind,
      title: req.title,
      body: String(req.body || '').slice(0, 80),
    })
    const { deliverDesktopAlert } = await import('../../desktop-alerts')
    const win = getMainWindow()
    const kind = req.kind === 'run_idle' ? 'run_idle' : 'extension_ui'
    deliverDesktopAlert(win, {
      kind,
      title: String(req.title || 'pi Desktop'),
      body: String(req.body || ''),
      background: req.background === true,
    })
    return { ok: true }
  })

  registerHandler('ipc:alerts.test', async () => {
    const { deliverTestCompletionNotification } = await import('../../completion-notification')
    deliverTestCompletionNotification()
    return { ok: true }
  })

  registerHandler('ipc:aiActivityGlow.preview', async () => {
    await previewAiActivityGlow()
    return { ok: true }
  })
}
