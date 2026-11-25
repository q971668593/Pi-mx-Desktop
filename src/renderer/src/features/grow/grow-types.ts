/** grow 面板类型：第一版只读镜像 + 跳转，答题在聊天卡片里做 */

import type { GrowNodeView, GrowPanelStateView } from '@shared/ipc-contract'

export interface GrowNode extends GrowNodeView {
  children?: GrowNode[]
}

export const EMPTY_GROW_STATE: GrowPanelStateView = {
  ready: false,
  nodes: [],
  chapters: [],
  pendingCount: 0,
  reviewCount: 0,
}
