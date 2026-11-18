export const MAX_TURN_FILE_BYTES = 128 * 1024
export const MAX_TURN_SNAPSHOT_FILES = 16

export type TurnFileSnapshot = {
  path: string
  before: string | null
  after: string
}

export type TurnSnapshot = {
  runId: string
  files: TurnFileSnapshot[]
}
