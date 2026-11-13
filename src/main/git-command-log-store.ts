import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { app } from 'electron'
import { configureGitCommandLog, type GitCommandLog } from './git-board-parse'

function commandLogFile(): string {
  return resolve(app.getPath('userData'), 'git-command-log.json')
}

export function installGitCommandLogStore(): void {
  configureGitCommandLog({
    load: () => {
      try {
        const parsed = JSON.parse(readFileSync(commandLogFile(), 'utf8')) as unknown
        return Array.isArray(parsed) ? parsed as GitCommandLog[] : []
      } catch {
        return []
      }
    },
    save: (entries) => {
      try {
        mkdirSync(dirname(commandLogFile()), { recursive: true })
        writeFileSync(commandLogFile(), JSON.stringify(entries), 'utf8')
      } catch {
        // A missing log must not block the Git action that produced it.
      }
    },
  })
}
