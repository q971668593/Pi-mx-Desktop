import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { btnOutline, btnPrimary, selectCls } from './settings-controls'
import { type PiInfo, type SdkStatus } from './pi-settings-shared'

type EnvKind = 'builtin' | 'global'

/**
 * Pi runs either from the app bundle or from npm's global installation.
 */
export function PiSettingsSdkSection({
  info,
  sdkStatus,
  registry,
  envTarget,
  setEnvTarget,
  selectedVersion,
  setSelectedVersion,
  installing,
  switching,
  installOutput,
  onSwitchEnv,
  onInstall,
  onRetryDetect,
  isWslRuntime = false,
}: {
  info: PiInfo | null
  sdkStatus: SdkStatus | null
  registry: { versions: string[]; latest: string | null } | null
  envTarget: EnvKind
  setEnvTarget: (v: EnvKind) => void
  selectedVersion: string
  setSelectedVersion: (v: string) => void
  installing: boolean
  switching: boolean
  installOutput: string[]
  onSwitchEnv: (target: EnvKind) => void
  onInstall: () => void
  onRetryDetect?: () => void
  isWslRuntime?: boolean
}) {
  const { t } = useTranslation()
  const active = sdkStatus?.active?.kind ?? 'builtin'
  const tiles: Array<{ kind: EnvKind; label: string; version?: string; missing: string; disabled: boolean }> = [
    {
      kind: 'builtin',
      label: t('settings:pi.kindBuiltin'),
      version: sdkStatus?.builtinVersion || info?.sdkVersion,
      missing: '—',
      disabled: isWslRuntime,
    },
    {
      kind: 'global',
      label: t('settings:pi.kindGlobal'),
      version: sdkStatus?.globalVersion,
      missing: t('settings:pi.notDetected'),
      disabled: false,
    },
  ]
  const canSwitch = !switching && !installing && envTarget !== active && (envTarget === 'builtin' || !!sdkStatus?.globalVersion)

  return (
    <div className="pi-runtime">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[13.5px] font-medium text-foreground">{t('settings:pi.runtimeVersions')}</div>
          <p className="mt-0.5 text-[12px] leading-[1.55] text-foreground-secondary">{t('settings:pi.runtimeVersionsDesc')}</p>
        </div>
        <span className="text-[11.5px] text-foreground-secondary">
          {registry?.latest
            ? t('settings:pi.registryLatestValue', { version: registry.latest })
            : registry
              ? null
              : t('settings:pi.loadingShort')}
        </span>
      </div>

      <div className="pi-runtime-tiles mt-3" role="radiogroup" aria-label={t('settings:pi.switchEnv')}>
        {tiles.map((tile) => (
          <button
            key={tile.kind}
            type="button"
            role="radio"
            aria-checked={envTarget === tile.kind}
            disabled={tile.disabled || switching || installing}
            data-active={active === tile.kind || undefined}
            data-selected={envTarget === tile.kind || undefined}
            className="pi-runtime-tile"
            onClick={() => setEnvTarget(tile.kind)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-foreground-secondary">{tile.label}</span>
              {active === tile.kind ? <span className="settings-badge">{t('settings:pi.activeBadge')}</span> : null}
            </span>
            <span className={cn('mt-1 block font-mono text-[15px] tabular-nums', tile.version ? 'text-foreground' : 'text-foreground-secondary/70')}>
              {tile.version || tile.missing}
            </span>
          </button>
        ))}
      </div>

      {sdkStatus?.active?.fallbackReason && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {t('settings:pi.fallbackGlobal')}
        </div>
      )}
      {sdkStatus?.workerFallback && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('settings:pi.fallbackWorker')}</div>
      )}
      {isWslRuntime && <div className="mt-2 text-xs text-sky-600 dark:text-sky-400">{t('settings:pi.wslModeHint')}</div>}
      {isWslRuntime && sdkStatus && !sdkStatus.globalVersion && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('settings:pi.wslGlobalNotDetected')}</div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btnOutline} disabled={!canSwitch} onClick={() => onSwitchEnv(envTarget)}>
          {switching ? t('settings:pi.switching') : t('settings:pi.switchTo')}
        </button>
        {!isWslRuntime && envTarget === 'global' && (
          <>
            <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
            <select
              className={cn(selectCls, 'min-w-[9rem]')}
              aria-label={t('settings:pi.globalVersion')}
              value={selectedVersion}
              disabled={installing || !sdkStatus?.npmAvailable}
              onChange={(e) => setSelectedVersion(e.target.value)}
            >
              <option value="">{t('settings:pi.selectVersion')}</option>
              {(registry?.versions || [])
                .slice()
                .reverse()
                .map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === registry?.latest ? ` ${t('settings:pi.latest')}` : ''}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className={btnPrimary}
              disabled={installing || !selectedVersion || !sdkStatus?.npmAvailable || (sdkStatus?.globalVersion === selectedVersion && active === 'global')}
              onClick={onInstall}
            >
              {installing ? t('settings:pi.installing') : sdkStatus?.globalVersion ? t('settings:pi.installGlobalSwitch') : t('settings:pi.installGlobal')}
            </button>
            {!sdkStatus?.npmAvailable && sdkStatus ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[11.5px] text-amber-600 dark:text-amber-400">{t('settings:pi.npmNotDetected')}</span>
                {onRetryDetect ? (
                  <button type="button" className={btnOutline} disabled={installing || switching} onClick={onRetryDetect}>
                    {t('settings:pi.retryDetect')}
                  </button>
                ) : null}
              </span>
            ) : null}
          </>
        )}
      </div>
      {(installing || installOutput.length > 0) && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-[var(--bg-2)] p-2.5 font-mono text-2xs whitespace-pre-wrap text-muted-foreground">
          {installOutput.join('\n')}
          {installing ? '\n…' : ''}
        </pre>
      )}
    </div>
  )
}
