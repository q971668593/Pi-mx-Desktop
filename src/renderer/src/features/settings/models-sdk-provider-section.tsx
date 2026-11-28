import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ModelInfo } from '@shared/ipc-contract'
import { ipcClient } from '@renderer/lib/ipc-client'
import { btnOutline } from './settings-controls'

/** Configured SDK accounts live beside models.json providers, not in a provider directory. */
export function ModelsSdkProviderSection({ providerIds, modelsByProvider, onAuthChanged }: {
  providerIds: string[]
  modelsByProvider: Record<string, ModelInfo[]>
  onAuthChanged?: () => void
}) {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <div className="space-y-2" data-testid="configured-sdk-providers">
      {providerIds.map((providerId) => {
        const models = modelsByProvider[providerId] || []
        const auth = models.find((model) => model.auth?.configured)?.auth
        return (
          <details key={providerId} className="settings-card overflow-hidden" data-sdk-provider={providerId}>
            <summary className="cursor-pointer px-4 py-3 text-sm">
              <span className="font-medium">{providerId}</span>
              <span className="ml-3 text-foreground-secondary">{t('models.modelCount', { count: models.length })} · {auth?.type === 'oauth' ? t('models.authTypeOAuth') : t('models.authTypeApiKey')}</span>
            </summary>
            <div className="space-y-2 border-t border-border/60 px-4 py-3">
              {auth?.type === 'oauth' && <button type="button" className={btnOutline} disabled={busy === providerId} onClick={() => {
                setBusy(providerId)
                void ipcClient.invoke('model.auth.logout', { providerId })
                  .then(() => onAuthChanged?.())
                  .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
                  .finally(() => setBusy(null))
              }}>{t('models.authSignOut')}</button>}
              <ul className="grid gap-1 sm:grid-cols-2">
                {models.map((model) => <li key={model.id} className="truncate font-mono text-xs text-foreground-secondary" title={model.id}>{model.id}</li>)}
              </ul>
            </div>
          </details>
        )
      })}
    </div>
  )
}
