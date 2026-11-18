import { app } from 'electron'
import { RunTaskAiManifest } from './run-task-ai-manifest'

let manifest: RunTaskAiManifest | null = null

/** 进程内单例：userData 下的 run-task-ai-manifest.json。 */
export function getRunTaskAiManifest(): RunTaskAiManifest {
  if (!manifest) manifest = new RunTaskAiManifest(app.getPath('userData'))
  return manifest
}

/** 测试用：替换实例（不影响生产代码路径）。 */
export function resetRunTaskAiManifestForTests(next: RunTaskAiManifest | null): void {
  manifest = next
}
