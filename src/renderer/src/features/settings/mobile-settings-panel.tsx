import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection, Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnCompact, numberInputCls, selectCls } from '@renderer/features/settings/settings-controls'
import { cn } from '@renderer/lib/utils'

type Device = {
  id: string
  name: string
  platform: string
  role: 'viewer' | 'operator'
  createdAt: number
  lastSeenAt?: number
  revokedAt?: number
  fingerprint: string
  online: boolean
}

type RemoteStatus = {
  enabled: boolean
  listening: boolean
  port: number
  error?: string
  endpoints: string[]
  endpointInfo?: { url: string; kind: 'lan' | 'tailscale' | 'overlay' | 'relay' | 'public' }[]
  hostName: string
  hostKeyEphemeral: boolean
  pairing: { link: string; exp: number } | null
  qrSvg?: string
  devices: Device[]
  projects: string[]
  trustedProjects: string[]
  projectInfo?: Record<string, { label?: string; temporary?: boolean }>
  tls: { spki: string; fingerprint: string; notAfter: number; subjectAltNames: string[]; ephemeral: boolean } | null
  publicHosts: string[]
  /** 自建中转：电脑主动连出去，手机从任何网络连进来。 */
  relay: {
    configured: boolean
    configuredUrl: string
    configuredToken: boolean
    url: string
    room: string
    connected: boolean
    latencyMs: number | null
    connections: number
    error?: string
    since: number
    /** 自签证书中转的指纹（base64url sha256 SPKI），手机按这个认证书。 */
    pin?: string
  } | null
}

const POLL_MS = 3000
const projectName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

/** Settings → 手机连接: gateway switch, pairing QR, paired devices, project whitelist. */
export function MobileSettingsPanel() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [portDraft, setPortDraft] = useState('')
  const [hostDraft, setHostDraft] = useState('')
  const [relayUrlDraft, setRelayUrlDraft] = useState('')
  const [relayTokenDraft, setRelayTokenDraft] = useState('')
  // 自签证书的中转：先探一次指纹，确认后再信任并保存（等于把中转当 TOFU 目标）
  const [probed, setProbed] = useState<{ spki: string; fingerprint: string; subject: string } | null>(null)
  const [relayError, setRelayError] = useState<string | null>(null)
  // 「配置向导」：给别人用的时候，从这里生成一条属于他自己服务器的安装命令
  const [wizardOpen, setWizardOpen] = useState(false)
  const [installToken, setInstallToken] = useState('')
  // 已保存的中转地址回填一次；口令不回读，留空就表示“沿用已保存的”。
  useEffect(() => {
    if (!status?.relay) return
    setRelayUrlDraft((prev) => prev || status.relay!.configuredUrl)
  }, [status?.relay?.configuredUrl])
  const now = useNow(!!status?.pairing)

  const call = useCallback(async (channel: string, request?: unknown) => {
    setBusy(true)
    try {
      const next = (await ipcClient.invoke(channel, request)) as RemoteStatus
      setStatus(next)
      return next
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const load = () =>
      ipcClient
        .invoke('remote.status')
        .then((s) => alive && setStatus(s as RemoteStatus))
        .catch(() => {})
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (status) setPortDraft(String(status.port))
  }, [status?.port])

  const expiresIn = status?.pairing ? Math.max(0, Math.round((status.pairing.exp - now) / 1000)) : 0
  const expired = !!status?.pairing && expiresIn === 0
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }), [i18n.language])
  const ago = (ms?: number) => {
    if (!ms) return t('settings:mobile.never')
    const s = Math.round((ms - Date.now()) / 1000)
    if (s > -60) return t('settings:mobile.justNow')
    if (s > -3600) return rtf.format(Math.round(s / 60), 'minute')
    if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86400), 'day')
  }

  if (!status) return <div className="text-[12.5px] text-foreground-secondary">{t('settings:mobile.loading')}</div>

  const statusLine = status.error
    ? t(status.error === 'port_in_use' ? 'settings:mobile.portInUse' : 'settings:mobile.startFailed', { port: status.port, error: status.error })
    : status.listening
      ? t('settings:mobile.listening', { port: status.port })
      : t('settings:mobile.off')

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={t('settings:mobile.title')} description={t('settings:mobile.description')} />

      <SettingsSection title={t('settings:mobile.connection')}>
        <SettingRow label={t('settings:mobile.enable')} description={statusLine}>
          <Toggle on={status.enabled} disabled={busy} onChange={(v) => void call('remote.setEnabled', { enabled: v })} />
        </SettingRow>
        <SettingRow label={t('settings:mobile.port')} description={t('settings:mobile.portDesc')}>
          <input
            className={numberInputCls}
            inputMode="numeric"
            value={portDraft}
            aria-label={t('settings:mobile.port')}
            onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, ''))}
            onBlur={() => {
              const n = Number(portDraft)
              if (n !== status.port && n >= 1024 && n <= 65535) void call('remote.setPort', { port: n })
              else setPortDraft(String(status.port))
            }}
          />
        </SettingRow>
        <SettingRow label={t('settings:mobile.addresses')} description={status.endpoints.length ? t('settings:mobile.addressesDesc') : t('settings:mobile.noAddress')}>
          <div className="flex flex-col items-end gap-0.5 text-[12px] text-foreground-secondary">
            {(status.endpointInfo ?? status.endpoints.map((url) => ({ url, kind: 'lan' as const }))).map((e) => (
              <span key={e.url} className="flex items-baseline gap-2">
                <span className="text-[11px] text-foreground-tertiary">{t(`settings:mobile.addressKind.${e.kind}`)}</span>
                <span className="font-mono">{e.url.replace(/^ws:\/\//, '')}</span>
              </span>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      {status.listening && (
        <SettingsSection title={t('settings:mobile.pairing')} description={t('settings:mobile.pairingDesc')}>
          <div className="settings-row flex flex-wrap items-center gap-5">
            <div
              className={cn('h-[168px] w-[168px] shrink-0 rounded-md border border-border bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full', expired && 'opacity-25')}
              role="img"
              aria-label={t('settings:mobile.qrLabel')}
              // QR SVG is generated in the main process by the qrcode library from our own pairing link.
              dangerouslySetInnerHTML={{ __html: status.qrSvg ?? '' }}
            />
            <div className="flex min-w-0 flex-col gap-1.5 text-[12.5px] leading-[1.6] text-foreground-secondary">
              <span className="text-[13px] text-foreground">{t('settings:mobile.scanHint')}</span>
              <span className="tabular-nums">
                {status.pairing
                  ? expired
                    ? t('settings:mobile.expired')
                    : t('settings:mobile.expiresIn', { time: `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}` })
                  : t('settings:mobile.noPairing')}
              </span>
              <span>{t('settings:mobile.oneTime')}</span>
              <div className="mt-1 flex gap-1">
                <button type="button" className={btnCompact} disabled={busy} onClick={() => void call('remote.regeneratePairing')}>
                  {t('settings:mobile.regenerate')}
                </button>
                {status.pairing && !expired && (
                  <button type="button" className={btnCompact} onClick={() => void navigator.clipboard.writeText(status.pairing!.link).catch(() => {})}>
                    {t('settings:mobile.copyLink')}
                  </button>
                )}
              </div>
              {status.hostKeyEphemeral && <span className="text-[12px] text-amber-700 dark:text-amber-300">{t('settings:mobile.ephemeralKey')}</span>}
            </div>
          </div>
        </SettingsSection>
      )}

      {/* 广域网：证书指纹 + 公网地址（隧道或端口映射） */}
      <SettingsSection title={t('settings:mobile.wideArea')} description={t('settings:mobile.wideAreaDesc')}>
        <SettingRow
          label={t('settings:mobile.certificate')}
          description={
            status.tls
              ? t('settings:mobile.certificateDesc', {
                  expires: new Date(status.tls.notAfter).toLocaleDateString(i18n.language),
                  names: status.tls.subjectAltNames.length,
                })
              : t('settings:mobile.certificateOff')
          }
        >
          <div className="flex max-w-[22rem] flex-col items-end gap-1">
            <code className="max-w-full truncate font-mono text-[11px] text-foreground-secondary" title={status.tls?.fingerprint}>
              {status.tls?.fingerprint ?? '—'}
            </code>
            <button
              type="button"
              className={btnCompact}
              disabled={busy || !status.listening}
              onClick={() => void call('remote.regenerateTls')}
              title={t('settings:mobile.regenerateTlsHint')}
            >
              {t('settings:mobile.regenerateTls')}
            </button>
          </div>
        </SettingRow>
        <SettingRow label={t('settings:mobile.publicHosts')} description={t('settings:mobile.publicHostsDesc')}>
          <div className="flex max-w-[22rem] flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-1">
              {(status.publicHosts ?? []).map((host) => (
                <span key={host} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-[var(--bg-2)]/50 px-1.5 py-0.5 font-mono text-[11px]">
                  {host}
                  <button
                    type="button"
                    aria-label={t('settings:mobile.removeHost', { host })}
                    className="text-foreground-tertiary hover:text-foreground"
                    onClick={() => void call('remote.setPublicHosts', { hosts: (status.publicHosts ?? []).filter((h) => h !== host) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex w-full items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                const value = hostDraft.trim()
                if (!value) return
                void call('remote.setPublicHosts', { hosts: [...(status.publicHosts ?? []), value] })
                setHostDraft('')
              }}
            >
              <input
                className={cn(numberInputCls, 'w-full text-left font-mono text-[11.5px]')}
                placeholder={t('settings:mobile.publicHostPlaceholder')}
                value={hostDraft}
                onChange={(event) => setHostDraft(event.target.value)}
              />
              <button type="submit" className={btnCompact} disabled={busy || !hostDraft.trim()}>
                {t('settings:mobile.addHost')}
              </button>
            </form>
            <span className="text-[11px] leading-4 text-foreground-tertiary">{t('settings:mobile.tunnelHint')}</span>
          </div>
        </SettingRow>
      </SettingsSection>

      {/* 自建中转：不依赖 cloudflared / frp，手机也不用一直挂 VPN */}
      <SettingsSection title={t('settings:mobile.relay')} description={t('settings:mobile.relayDesc')}>
        <SettingRow label={t('settings:mobile.relayUrl')} description={t('settings:mobile.relayUrlDesc')}>
          <input
            className={cn(numberInputCls, 'w-[15rem] text-left font-mono text-[11.5px]')}
            placeholder="relay.example.com:443"
            aria-label={t('settings:mobile.relayUrl')}
            value={relayUrlDraft}
            onChange={(event) => setRelayUrlDraft(event.target.value)}
          />
        </SettingRow>
        <SettingRow label={t('settings:mobile.relayToken')} description={t('settings:mobile.relayTokenDesc')}>
          <input
            className={cn(numberInputCls, 'w-[15rem] text-left font-mono text-[11.5px]')}
            type="password"
            autoComplete="off"
            aria-label={t('settings:mobile.relayToken')}
            placeholder={status.relay?.configuredToken ? '••••••••（留空沿用）' : '——'}
            value={relayTokenDraft}
            onChange={(event) => setRelayTokenDraft(event.target.value)}
          />
        </SettingRow>
        <SettingRow label={t('settings:mobile.relayWizard')} description={t('settings:mobile.relayWizardDesc')}>
          <button type="button" className={btnCompact} onClick={() => setWizardOpen((open) => !open)}>
            {wizardOpen ? t('settings:mobile.relayWizardHide') : t('settings:mobile.relayWizardShow')}
          </button>
        </SettingRow>
        {wizardOpen
          ? (() => {
              const host = relayUrlDraft.trim().replace(/^wss?:\/\//, '')
              const port = /:(\d+)$/.exec(host)?.[1] ?? '8443'
              const token = installToken
              const command = token
                ? `curl -fsSL https://raw.githubusercontent.com/q971668593/Pi-mx-Desktop/main/scripts/relay/install.sh | bash -s -- --port ${port} --token ${token}`
                : ''
              return (
                <div className="settings-row flex flex-col gap-2 text-[12px] leading-[1.7] text-foreground-secondary">
                  <ol className="ml-4 list-decimal space-y-1">
                    <li>{t('settings:mobile.relayStep1')}</li>
                    <li>{t('settings:mobile.relayStep2')}</li>
                    <li>{t('settings:mobile.relayStep3')}</li>
                  </ol>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={btnCompact}
                      onClick={() => {
                        const bytes = new Uint8Array(24)
                        crypto.getRandomValues(bytes)
                        const next = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
                        setInstallToken(next)
                        setRelayTokenDraft(next)
                      }}
                    >
                      {installToken ? t('settings:mobile.relayTokenRegenerate') : t('settings:mobile.relayTokenGenerate')}
                    </button>
                    <button
                      type="button"
                      className={btnCompact}
                      disabled={!command}
                      onClick={() => void navigator.clipboard.writeText(command).catch(() => {})}
                    >
                      {t('settings:mobile.relayCopyCommand')}
                    </button>
                  </div>
                  <code className="block max-w-full overflow-x-auto whitespace-pre rounded-md border border-border/60 bg-[var(--bg-2)]/50 p-2 font-mono text-[11px]">
                    {command || t('settings:mobile.relayCommandHint')}
                  </code>
                  <span className="text-[11px] leading-4 text-foreground-tertiary">{t('settings:mobile.relayWizardNote')}</span>
                </div>
              )
            })()
          : null}
        <SettingRow
          label={
            status.relay?.connected
              ? t('settings:mobile.relayConnected')
              : status.relay?.configured
                ? t('settings:mobile.relayDisconnected')
                : t('settings:mobile.relaySave')
          }
          description={
            status.relay?.error === 'invalid_url'
              ? t('settings:mobile.relayInvalid')
              : [
                  status.relay?.latencyMs != null ? t('settings:mobile.relayLatency', { ms: status.relay.latencyMs }) : '',
                  status.relay?.connections ? t('settings:mobile.relayClients', { count: status.relay.connections }) : '',
                  status.relay?.room ? t('settings:mobile.relayRoom', { room: status.relay.room }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
          }
        >
          <div className="flex max-w-[22rem] flex-col items-end gap-1.5">
            <div className="flex gap-1">
              <button
                type="button"
                className={btnCompact}
                disabled={busy || !relayUrlDraft.trim() || (!relayTokenDraft.trim() && !status.relay?.configuredToken)}
                onClick={() => void call('remote.setRelay', { url: relayUrlDraft.trim(), token: relayTokenDraft.trim() })}
              >
                {t('settings:mobile.relaySave')}
              </button>
              {status.relay?.configured && (
                <button
                  type="button"
                  className={btnCompact}
                  disabled={busy}
                  onClick={() => {
                    setRelayTokenDraft('')
                    void call('remote.setRelay', { url: '', token: '' })
                  }}
                >
                  {t('settings:mobile.relayRemove')}
                </button>
              )}
            </div>
            {probed ? (
              <div className="flex flex-col items-end gap-1 rounded-md border border-border/60 bg-[var(--bg-2)]/40 px-2 py-1.5">
                <code className="max-w-full truncate font-mono text-[11px] text-foreground-secondary" title={probed.fingerprint}>
                  {probed.fingerprint || probed.spki}
                </code>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={btnCompact}
                    disabled={busy}
                    onClick={() => {
                      void call('remote.setRelay', { url: relayUrlDraft.trim(), token: relayTokenDraft.trim(), pin: probed.spki })
                      setProbed(null)
                    }}
                  >
                    {t('settings:mobile.relayTrust')}
                  </button>
                  <button type="button" className={btnCompact} onClick={() => setProbed(null)}>
                    {t('common:cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {status.relay?.pin ? (
                  <span className="text-[11px] text-foreground-tertiary">{t('settings:mobile.relayPinned', { pin: status.relay.pin.slice(0, 12) })}</span>
                ) : null}
                <button
                  type="button"
                  className={btnCompact}
                  disabled={busy || !relayUrlDraft.trim()}
                  onClick={() => {
                    setBusy(true)
                    ipcClient
                      .invoke('remote.relayProbe', { url: relayUrlDraft.trim() })
                      .then((info) => {
                        const cert = info as { spki: string; fingerprint: string; subject: string } | null
                        setProbed(cert)
                        setRelayError(cert ? null : t('settings:mobile.relayProbeFailed'))
                      })
                      .catch(() => setRelayError(t('settings:mobile.relayProbeFailed')))
                      .finally(() => setBusy(false))
                  }}
                >
                  {t('settings:mobile.relayProbe')}
                </button>
              </div>
            )}
            {relayError ? <span className="text-[11px] text-red-600 dark:text-red-400">{relayError}</span> : null}
            <span className="text-[11px] leading-4 text-foreground-tertiary">{t('settings:mobile.relayHint')}</span>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:mobile.devices')} description={status.devices.length ? undefined : t('settings:mobile.noDevices')}>
        {status.devices.map((d) => (
          <SettingRow
            key={d.id}
            label={d.name}
            description={
              d.revokedAt
                ? t('settings:mobile.revoked')
                : `${d.platform ? `${d.platform} · ` : ''}${d.online ? t('settings:mobile.online') : t('settings:mobile.lastSeen', { time: ago(d.lastSeenAt) })} · ${d.fingerprint}`
            }
          >
            <div className="flex items-center gap-1">
              {!d.revokedAt && (
                <select
                  className={cn(selectCls, 'min-w-0 py-1 text-[12px]')}
                  value={d.role}
                  aria-label={t('settings:mobile.role')}
                  onChange={(e) => void call('remote.setDeviceRole', { id: d.id, role: e.target.value })}
                >
                  <option value="operator">{t('settings:mobile.roleOperator')}</option>
                  <option value="viewer">{t('settings:mobile.roleViewer')}</option>
                </select>
              )}
              <button
                type="button"
                className={btnCompact}
                disabled={busy}
                onClick={() => void call(d.revokedAt ? 'remote.removeDevice' : 'remote.revokeDevice', { id: d.id })}
              >
                {d.revokedAt ? t('settings:mobile.forget') : t('settings:mobile.unpair')}
              </button>
            </div>
          </SettingRow>
        ))}
      </SettingsSection>

      {/* 不再逐个授权项目：手机与电脑同一份项目列表，这里只是只读一览。 */}
      <SettingsSection title={t('settings:mobile.projects')} description={t('settings:mobile.projectsShared')}>
        {status.trustedProjects.length === 0 ? (
          <div className="settings-row text-[12.5px] text-foreground-secondary">{t('settings:mobile.noProjects')}</div>
        ) : (
          <div className="settings-row block">
            <div className="flex flex-wrap gap-1.5 py-1">
              {status.trustedProjects.map((p) => (
                <span
                  key={p}
                  title={p}
                  className="max-w-[15rem] truncate rounded-md border border-border/60 bg-[var(--bg-2)]/50 px-2 py-1 font-mono text-[11.5px] text-foreground-secondary"
                >
                  {projectName(p)}
                </span>
              ))}
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
