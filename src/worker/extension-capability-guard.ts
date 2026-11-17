import type { LoadExtensionsResult, RegisteredTool, ToolDefinition } from '@earendil-works/pi-coding-agent'

let enabled = { webSearch: false, computer: false }

export function setExtensionCapabilityToolsEnabled(next: { webSearch: boolean; computer: boolean }): void {
  enabled = { ...next }
}

function capabilityForTool(name: string): 'webSearch' | 'computer' | null {
  if (/^computer[_-]/i.test(name)) return 'computer'
  if (/^(search|docs_search|web_fetch|web_map|search_|context7_|plan_)/i.test(name)) return 'webSearch'
  return null
}

function guardTool(registered: RegisteredTool, capability: 'webSearch' | 'computer'): RegisteredTool {
  const definition = registered.definition as ToolDefinition
  const execute = definition.execute.bind(definition)
  return {
    ...registered,
    definition: {
      ...definition,
      async execute(toolCallId, params, signal, onUpdate, context) {
        if (!enabled[capability]) {
          throw new Error(capability === 'computer'
            ? 'Computer control is off for this conversation. Ask the user to enable Computer control in the Tools menu first.'
            : 'Web search is off for this conversation. Ask the user to enable Web search in the Tools menu first.')
        }
        return execute(toolCallId, params, signal, onUpdate, context)
      },
    },
  }
}

/** Keep optional third-party capabilities unusable unless the current conversation enabled them. */
export function guardExtensionCapabilityTools(result: LoadExtensionsResult): LoadExtensionsResult {
  let changed = false
  const extensions = result.extensions.map((extension) => {
    let tools: Map<string, RegisteredTool> | null = null
    for (const [name, registered] of extension.tools) {
      const capability = capabilityForTool(name)
      if (!capability) continue
      tools ??= new Map(extension.tools)
      tools.set(name, guardTool(registered, capability))
      changed = true
    }
    return tools ? { ...extension, tools } : extension
  })
  return changed ? { ...result, extensions } : result
}
