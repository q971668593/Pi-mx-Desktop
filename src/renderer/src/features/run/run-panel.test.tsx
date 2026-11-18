import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunPanel } from './run-panel'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@renderer/features/composer/use-composer-metrics', () => ({
  useComposerMetrics: () => ({}),
}))

const RUN_ID = 'run-1'

function failedTool(id: string, message: string, runId = RUN_ID): TimelineItem {
  return {
    id,
    type: 'tool-call',
    toolName: 'bash',
    toolPhase: 'end',
    toolOutput: message,
    isError: true,
    runId,
    timestamp: 1,
  }
}

function seed(items: TimelineItem[]): void {
  act(() => {
    useUIStore.setState({
      timelineItems: items,
      runState: {
        ...useUIStore.getState().runState,
        status: 'idle',
        errorCount: 1,
        lastRunId: RUN_ID,
        activeRunId: undefined,
      },
    })
  })
}

beforeEach(() => {
  seed([])
})

afterEach(cleanup)

describe('run panel tool errors', () => {
  it('keeps the list live after it is expanded (no frozen snapshot)', () => {
    seed([failedTool('t1', 'Error: first failure')])
    render(<RunPanel />)

    fireEvent.click(screen.getByText('run:tokenError'))
    expect(screen.getByText('Error: first failure')).toBeTruthy()

    // 展开后新失败的 tool 必须立刻出现：之前在 render 里直接 getState()，列表会停在展开那一刻。
    act(() => {
      useUIStore.setState({ timelineItems: [...useUIStore.getState().timelineItems, failedTool('t2', 'Error: later failure')] })
    })
    expect(screen.getByText('Error: later failure')).toBeTruthy()
  })

  it('only lists tool failures that belong to the run that reported errorCount', () => {
    seed([failedTool('old', 'Error: previous run', 'run-0'), failedTool('now', 'Error: this run')])
    render(<RunPanel />)
    fireEvent.click(screen.getByText('run:tokenError'))

    expect(screen.getByText('Error: this run')).toBeTruthy()
    expect(screen.queryByText('Error: previous run')).toBeNull()
  })
})
