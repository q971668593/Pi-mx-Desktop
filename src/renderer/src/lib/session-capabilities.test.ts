import { describe, expect, it } from 'vitest'
import {
  DRAFT_CAPABILITY_KEY,
  adoptDraftCapabilities,
  capabilitiesFor,
  currentSessionCapabilities,
  onCapabilityKeyChange,
  setSessionCapability,
  toggleCapabilityIn,
  useSessionCapabilitiesStore,
} from './session-capabilities'
import { projectBrowserSessionKey } from '@shared/browser-types'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import { useUIStore } from '@renderer/stores/ui-store'

describe('session capabilities', () => {
  it('starts from the built-in browser and keeps an explicit "all off"', () => {
    // Nothing stored yet: the conversation runs the built-in browser.
    expect(capabilitiesFor({}, '/a.jsonl')).toEqual(['browser', 'web-search'])
    let byKey = toggleCapabilityIn({}, '/a.jsonl', 'pi-ui', true)
    byKey = toggleCapabilityIn(byKey, '/a.jsonl', 'pi-ui', true)
    expect(byKey).toEqual({ '/a.jsonl': ['browser', 'web-search', 'pi-ui'] })
    // Turning everything off is remembered, not treated as "never touched".
    expect(toggleCapabilityIn(byKey, '/a.jsonl', 'browser', false)).toEqual({ '/a.jsonl': ['web-search', 'pi-ui'] })
    expect(toggleCapabilityIn({ '/a.jsonl': ['pi-ui'] }, '/a.jsonl', 'pi-ui', false)).toEqual({ '/a.jsonl': [] })
    expect(capabilitiesFor({ '/a.jsonl': [] }, '/a.jsonl')).toEqual([])
    expect(capabilitiesFor({ '/a.jsonl': ['pi-ui'] }, '/a.jsonl')).toEqual(['pi-ui'])
    expect(capabilitiesFor({}, '/b.jsonl')).toEqual(['browser', 'web-search'])
  })

  it('moves draft switches to the new session once, including an explicit off', () => {
    const byKey = { [DRAFT_CAPABILITY_KEY]: ['pi-ui' as const] }
    expect(adoptDraftCapabilities(byKey, '/new.jsonl')).toEqual({ '/new.jsonl': ['pi-ui'] })
    expect(adoptDraftCapabilities({ ...byKey, '/new.jsonl': ['browser' as const] }, '/new.jsonl')).toBeNull()
    expect(adoptDraftCapabilities({}, '/new.jsonl')).toBeNull()
    // A draft where the browser was switched off keeps that choice for its session.
    expect(adoptDraftCapabilities({ [DRAFT_CAPABILITY_KEY]: [] }, '/off.jsonl')).toEqual({ '/off.jsonl': [] })
  })

  it('keeps draft switches only for the session the draft just became', () => {
    useUIStore.setState({ historySessionFile: null })
    useSessionCapabilitiesStore.setState({ byKey: { [DRAFT_CAPABILITY_KEY]: ['pi-ui'] } })
    // Switching to an unrelated session drops the draft switches.
    onCapabilityKeyChange(DRAFT_CAPABILITY_KEY, '/other.jsonl', Date.now() + 60_000)
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({})

    useSessionCapabilitiesStore.setState({ byKey: { [DRAFT_CAPABILITY_KEY]: ['pi-ui'] } })
    expect(currentSessionCapabilities()).toEqual(['pi-ui'])
    onCapabilityKeyChange(DRAFT_CAPABILITY_KEY, '/new.jsonl')
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({ '/new.jsonl': ['pi-ui'] })
  })

  it('hands draft switches to the session file created while sending', () => {
    useSessionCapabilitiesStore.setState({ byKey: { [DRAFT_CAPABILITY_KEY]: ['browser'] } })
    useUIStore.setState({ historySessionFile: '/created-on-send.jsonl' })
    expect(currentSessionCapabilities()).toEqual(['browser'])
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({ '/created-on-send.jsonl': ['browser'] })
    useUIStore.setState({ historySessionFile: null })
  })

  it('a new conversation carries the built-in browser without any switch being touched', () => {
    useSessionCapabilitiesStore.setState({ byKey: {} })
    useUIStore.setState({ currentWorkspace: 'F:\\proj\\demo', historySessionFile: '/fresh.jsonl' })
    expect(currentSessionCapabilities()).toEqual(['browser', 'web-search'])
    useUIStore.setState({ currentWorkspace: null, historySessionFile: null })
  })

  it('auto-attaches built-in browser capability when the project already has tabs, unless the switch was turned off', () => {
    useSessionCapabilitiesStore.setState({ byKey: {} })
    useUIStore.setState({ currentWorkspace: 'F:\\proj\\demo', historySessionFile: '/with-tab.jsonl' })
    const projectKey = projectBrowserSessionKey('F:\\proj\\demo')
    useBrowserStore.setState({
      tabs: {
        t1: {
          tabId: 't1',
          engine: 'electron',
          profileId: 'default-electron',
          url: 'https://example.com',
          title: 'Example',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          openedBy: { sessionKey: projectKey },
        },
      },
      order: ['t1'],
      activeTabId: 't1',
    })
    // Untouched sessions follow the project's tabs.
    expect(currentSessionCapabilities()).toEqual(['browser', 'web-search'])
    useUIStore.setState({ historySessionFile: '/other-conversation.jsonl' })
    expect(currentSessionCapabilities()).toEqual(['browser', 'web-search'])

    // Explicit off for the current conversation is respected even though tabs are open
    setSessionCapability('/other-conversation.jsonl', 'browser', false)
    expect(currentSessionCapabilities()).toEqual(['web-search'])
    // …and a different conversation of the same project still has it on
    useUIStore.setState({ historySessionFile: '/third.jsonl' })
    expect(currentSessionCapabilities()).toEqual(['browser', 'web-search'])

    useBrowserStore.setState({ tabs: {}, order: [], activeTabId: null })
    useUIStore.setState({ currentWorkspace: null })
    useUIStore.setState({ historySessionFile: null })
  })
})
