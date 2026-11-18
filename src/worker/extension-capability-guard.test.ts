import { afterEach, describe, expect, it } from 'vitest'
import { blockedCapabilityTool, setExtensionCapabilityToolsEnabled } from './extension-capability-guard'

afterEach(() => setExtensionCapabilityToolsEnabled({ webSearch: false, computer: false }))

describe('extension capability guard', () => {
  it('blocks every computer-use tool, including the bare namespace tool and late registrations', () => {
    for (const name of ['computer', 'computer_click', 'computer-read', 'Computer_Open']) {
      expect(blockedCapabilityTool(name)).toMatch(/Computer control is off/)
    }
    setExtensionCapabilityToolsEnabled({ webSearch: false, computer: true })
    for (const name of ['computer', 'computer_click']) expect(blockedCapabilityTool(name)).toBeNull()
  })

  it('gates web-search package tools on their own switch', () => {
    expect(blockedCapabilityTool('search')).toMatch(/Web search is off/)
    expect(blockedCapabilityTool('web_fetch')).toMatch(/Web search is off/)
    setExtensionCapabilityToolsEnabled({ webSearch: true, computer: false })
    expect(blockedCapabilityTool('search')).toBeNull()
    // Turning computer back off never re-enables it
    expect(blockedCapabilityTool('computer_click')).toMatch(/Computer control is off/)
  })

  it('leaves unrelated tools alone', () => {
    for (const name of ['bash', 'read', 'browser_click', 'terminal_write', 'searcher']) {
      expect(blockedCapabilityTool(name)).toBeNull()
    }
  })
})
