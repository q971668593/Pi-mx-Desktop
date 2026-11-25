import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ready(): void {
    ipcRenderer.send('notification:ready')
  },
  action(notificationId: string, action: 'open' | 'dismiss' | 'mute'): void {
    ipcRenderer.send('notification:action', { notificationId, action })
  },
  hover(paused: boolean): void {
    ipcRenderer.send('notification:hover', { paused: paused === true })
  },
  /**
   * 卡片自己量到的总高度：主进程据此把悬浮窗撑到刚好装下全文。
   * 不传时窗口回落到单卡默认高度。
   */
  resize(height: number): void {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    ipcRenderer.send('notification:resize', { height: Math.round(height) })
  },
  onFocus(callback: () => void): () => void {
    const handler = (): void => callback()
    ipcRenderer.on('notification:focus', handler)
    return () => ipcRenderer.off('notification:focus', handler)
  },
  onUpdate(callback: (cards: unknown[]) => void): () => void {
    const handler = (_event: unknown, cards: unknown[]): void => callback(cards)
    ipcRenderer.on('notification:update', handler)
    return () => ipcRenderer.off('notification:update', handler)
  },
  /**
   * Play one alert sound; used both for "sound only" mode and together with a card.
   * `volume` is a percent (0–200); undefined means the designed level.
   */
  onSound(callback: (preset: string, volume?: number) => void): () => void {
    const handler = (_event: unknown, payload: { preset?: string; volume?: number }): void => {
      const volume = typeof payload?.volume === 'number' ? payload.volume : undefined
      callback(String(payload?.preset || ''), volume)
    }
    ipcRenderer.on('notification:sound', handler)
    return () => ipcRenderer.off('notification:sound', handler)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('piNotify', api)
} else {
  // @ts-expect-error isolated fallback
  window.piNotify = api
}
