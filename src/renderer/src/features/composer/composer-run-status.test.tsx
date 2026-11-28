import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useRunActivity } from '@renderer/features/run/use-run-activity'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerRunStatus } from './composer-run-status'

const SESSION = '/run-status.jsonl'
const OTHER_SESSION = '/other-status.jsonl'

function RunStatus() {
  const activity = useRunActivity()
  return <ComposerRunStatus activity={activity} />
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
  useUIStore.setState({
    historySessionFile: SESSION,
    workerLiveSnapshot: { sessionId: 'status', sessionFile: SESSION, status: 'running' },
    sessionRuntimeRunning: {},
    runState: { status: 'running', startTime: Date.now() - 3000, thinkingLevel: 'high', toolCount: 0, errorCount: 0 },
    streamingAssistantId: null,
    timelineItems: [],
    retryingSessions: {},
    compactingSessions: {},
    activePanel: 'files',
    rightPanelCollapsed: true,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('composer run status', () => {
  it('shows the live phase, updates elapsed time, and opens the existing Run panel', () => {
    render(<RunStatus />)
    expect(screen.getByText('Waiting for model')).toBeTruthy()
    expect(screen.getByText(/3s elapsed/)).toBeTruthy()

    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText(/5s elapsed/)).toBeTruthy()

    act(() => useUIStore.getState().setRunState({ activeTool: 'bash' }))
    fireEvent.click(screen.getByRole('button', { name: /Running bash/ }))
    expect(useUIStore.getState().activePanel).toBe('run')
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
  })

  it('uses the viewed session retry countdown and hides it when switching sessions', () => {
    useUIStore.setState({
      retryingSessions: {
        [SESSION]: { attempt: 1, maxAttempts: 3, startedAt: Date.now(), delayMs: 5000, errorMessage: '429 Too Many Requests' },
      },
    })
    render(<RunStatus />)
    expect(screen.getByText('Model service rate limit')).toBeTruthy()
    expect(screen.getByText(/Retry in 5s/)).toBeTruthy()

    act(() => {
      useUIStore.setState({ historySessionFile: OTHER_SESSION })
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
