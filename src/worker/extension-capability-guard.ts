import type { LoadExtensionsResult, RegisteredTool, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { isComputerCapabilityTool, isWebSearchCapabilityTool } from '@shared/capabilities'

let enabled = { webSearch: false, computer: false }

export function setExtensionCapabilityToolsEnabled(next: { webSearch: boolean; computer: boolean }): void {
  enabled = { ...next }
}

function capabilityForTool(name: string): 'webSearch' | 'computer' | null {
  if (isComputerCapabilityTool(name)) return 'computer'
  if (isWebSearchCapabilityTool(name)) return 'webSearch'
  return null
}

function offReason(capability: 'webSearch' | 'computer'): string {
  return capability === 'computer'
    ? 'Computer control is off for this conversation. Ask the user to enable Computer control in the Tools menu first.'
    : 'Web search is off for this conversation. Ask the user to enable Web search in the Tools menu first.'
}

/**
 * Why this tool call must not run, or null when it may. Capability packages register some of their
 * tools late (pi-agent-computer-use registers every `computer_*` tool in its own `session_start`
 * hook), so wrapping definitions at load time misses them — this check runs per call instead and is
 * the authoritative gate.
 */
export function blockedCapabilityTool(toolName: string): string | null {
  const capability = capabilityForTool(toolName)
  if (!capability || enabled[capability]) return null
  return offReason(capability)
}

function guardTool(registered: RegisteredTool, capability: 'webSearch' | 'computer'): RegisteredTool {
  const definition = registered.definition as ToolDefinition
  const execute = definition.execute.bind(definition)
  return {
    ...registered,
    definition: {
      ...definition,
      async execute(toolCallId, params, signal, onUpdate, context) {
        if (!enabled[capability]) throw new Error(offReason(capability))
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
