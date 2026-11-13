import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../ui-store'

describe('project panel memory', () => {
  beforeEach(() => {
    localStorage.clear()
    useUIStore.setState({ currentWorkspace: null, activePanel: 'review' })
  })

  it('restores each project panel without resetting when staying in the same project', () => {
    const store = useUIStore.getState()
    store.setWorkspace('C:/project-a')
    store.setActivePanel('files')
    store.setWorkspace('C:/project-b')
    expect(useUIStore.getState().activePanel).toBe('run')
    store.setActivePanel('terminal')
    store.setWorkspace('C:/project-a')
    expect(useUIStore.getState().activePanel).toBe('files')
    store.setWorkspace('C:/project-a')
    expect(useUIStore.getState().activePanel).toBe('files')
    store.setWorkspace('C:/project-b')
    expect(useUIStore.getState().activePanel).toBe('terminal')
  })
})
