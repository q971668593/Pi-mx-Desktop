import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerPendingQueue } from './composer-pending-queue'
import { useUIStore } from '@renderer/stores/ui-store'

vi.mock('@renderer/lib/composer-queue-flush', () => ({ flushQueuedMessages: vi.fn() }))
vi.mock('react-i18next', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-i18next')>()), useTranslation: () => ({ t: (key: string) => key }) }))

describe('ComposerPendingQueue', () => {
  beforeEach(() => useUIStore.setState({ pendingSteering: [], pendingFollowUp: ['queued message'] }))

  it('restores the queue on request and prevents concurrent send or restore', async () => {
    let finish!: () => void
    const restore = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<ComposerPendingQueue onRestore={restore} />)
    fireEvent.click(screen.getByRole('button', { name: 'composer:queueRestore' }))
    expect(restore).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'composer:queueRestoring' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'composer:queueFlush' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'composer:queueRestore' })).toBeEnabled())
  })
})
