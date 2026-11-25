import { validateGrowPrdProposal, type GrowPrdProposal } from '@shared/grow-prd-proposal'

export type GrowPrdProposalSegment =
  | { type: 'text'; text: string }
  | { type: 'proposal'; proposal: GrowPrdProposal; raw: string }

/** Parse a complete message snapshot; call again as streaming text grows.
 * Proposals are unconfirmed data. Invalid or incomplete fences remain verbatim text.
 */
export function parseGrowPrdProposals(message: string): GrowPrdProposalSegment[] {
  const segments: GrowPrdProposalSegment[] = []
  const lines = /[^\r\n]*(?:\r\n|\n|\r|$)/g
  let textStart = 0
  let fence: { start: number; contentStart: number; marker: string; proposal: boolean } | undefined

  for (const match of message.matchAll(lines)) {
    const line = match[0]
    if (!line) continue
    const body = line.replace(/\r\n$|[\r\n]$/, '')
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(body)
      if (!opening) continue
      fence = {
        start: match.index,
        contentStart: match.index + line.length,
        marker: opening[1],
        proposal: opening[1][0] === '`' && opening[2].trim() === 'grow-prd-proposal',
      }
      continue
    }

    const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(body)
    if (!closing || closing[1][0] !== fence.marker[0] || closing[1].length < fence.marker.length) continue
    const end = match.index + body.length
    if (fence.proposal) {
      try {
        const parsed: unknown = JSON.parse(message.slice(fence.contentStart, match.index))
        const result = validateGrowPrdProposal(parsed)
        if (result.ok) {
          if (fence.start > textStart) segments.push({ type: 'text', text: message.slice(textStart, fence.start) })
          segments.push({ type: 'proposal', proposal: result.value, raw: message.slice(fence.start, end) })
          textStart = end
        }
      } catch {
        // Preserve malformed JSON exactly as it appeared in the message.
      }
    }
    fence = undefined
  }
  if (textStart < message.length) segments.push({ type: 'text', text: message.slice(textStart) })
  return segments
}
