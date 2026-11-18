// Session goal the user pinned in the renderer's goal bar (pi Desktop host feature).
//
// Main sends the rendered goal section before each prompt, exactly like the capability sections
// in worker-capabilities.ts. The inline extension puts it into pi's structured prompt sections
// as <goal>…</goal>, so the goal reaches the model every turn without landing in the user's
// message history: pi records section changes as a system message, not as a chat message.

import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  InlineExtension,
} from '@earendil-works/pi-coding-agent'
import { GOAL_SECTION_KEY } from '@shared/session-goal'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'

let goalText: string | null = null

/** `null` / blank removes the section (cleared goal, or a session switch). */
export function setGoalSection(next: unknown): void {
  const text = typeof next === 'string' ? next.trim() : ''
  goalText = text ? text : null
}

export function goalSectionForTest(): string | null {
  return goalText
}

type StartEvent = Pick<BeforeAgentStartEvent, 'systemPrompt'> & {
  systemPromptOptions?: { sections?: Record<string, string> }
}

/**
 * Bring this turn's prompt sections in line with the goal. With structured sections nothing is
 * returned (pi renders the change as a transcript delta); older SDKs get the section appended to
 * this turn's system prompt only.
 */
export function withGoal(event: StartEvent): BeforeAgentStartEventResult | undefined {
  const target = event.systemPromptOptions?.sections
  if (target) {
    if (goalText) target[GOAL_SECTION_KEY] = goalText
    else delete target[GOAL_SECTION_KEY]
    return undefined
  }
  if (!goalText) return undefined
  return { systemPrompt: `${event.systemPrompt}\n\n<${GOAL_SECTION_KEY}>\n${goalText}\n</${GOAL_SECTION_KEY}>` }
}

export const goalExtension: InlineExtension = {
  name: 'pi-desktop-goal',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event) => withGoal(event))
  },
}

export async function handleSetGoal(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  setGoalSection(msg.goal)
  reply({ ok: true, hasGoal: goalText != null })
}
