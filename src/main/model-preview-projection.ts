import type { ModelEntry } from './active-sdk-models-core'

/**
 * Plain-data projection of an SDK model when it crosses the preview-process boundary.
 *
 * The runtime model objects may carry non-cloneable members, so only plain fields may travel.
 * `reasoning` / `thinkingLevelMap` **must** survive: the composer derives a model's thinking
 * levels from them (`modelThinkingLevels()` in `@shared/model-thinking-levels`). Dropping them
 * made every model look non-reasoning, so a model the session had not run yet offered nothing
 * but `off` until the worker's first run reported the session's real levels.
 */
export function projectModelForPreview(model: ModelEntry): ModelEntry {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    contextWindow: model.contextWindow,
    maxOutput: model.maxOutput,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined,
    available: model.available,
    managedBy: model.managedBy,
    auth: model.auth ? JSON.parse(JSON.stringify(model.auth)) : undefined,
  }
}
