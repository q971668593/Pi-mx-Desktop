import { ALERT_SOUND_BASE_GAIN, ALERT_SOUND_TONES } from '@shared/alert-sound'
import { NOTIFICATION_CARD_MAX_HEIGHT, NOTIFICATION_STACK_GAP } from './completion-notification-geometry'

/**
 * Sandboxed notification host. No nodeIntegration; talks only via preload action ids.
 *
 * 卡片默认**展开**：正文不再裁成两行，卡片按正文长度自己长高（上限 NOTIFICATION_CARD_MAX_HEIGHT），
 * 渲染完把量到的高度报回主进程，窗口跟着长高。用户仍然可以点「收起」把长正文折回两行。
 */
export function notificationHostPageHtml(): string {
  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'none'" />
  <title>pi Desktop</title>
  <style>
    :root {
      color-scheme: light dark;
      --surface: #f7f8fa;
      --surface-hover: #fcfcfd;
      --fg: #171a21;
      --muted: #5d6473;
      --subtle: #7a8291;
      --line: #dde0e6;
      --accent: #58658f;
      --accent-hover: #4d597f;
      --accent-fg: #f7f8fb;
      --danger: #c9294f;
      --shadow: 0 10px 28px rgb(24 29 41 / 16%);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --surface: #20232b;
        --surface-hover: #252932;
        --fg: #eceef2;
        --muted: #b0b6c3;
        --subtle: #8c95a5;
        --line: #353a46;
        --accent: #9aa6d1;
        --accent-hover: #aeb8dc;
        --accent-fg: #171a21;
        --danger: #ff6b8b;
        --shadow: 0 12px 30px rgb(0 0 0 / 30%);
      }
    }
    html, body {
      margin: 0;
      background: transparent;
      color: var(--fg);
      font: 13px/1.45 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
      user-select: none;
    }
    #stack { display: flex; flex-direction: column; gap: ${NOTIFICATION_STACK_GAP}px; padding-top: 4px; }
    .card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: ${NOTIFICATION_CARD_MAX_HEIGHT}px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      padding: 11px 12px 10px;
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateY(8px) scale(.985);
      animation: card-in 180ms cubic-bezier(.22,1,.36,1) forwards;
      transition: transform 120ms ease, opacity 120ms ease;
    }
    .card:hover { transform: translateY(-1px); background: var(--surface-hover); }
    .project {
      overflow: hidden;
      color: var(--subtle);
      font-size: 11px;
      letter-spacing: .025em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .title {
      overflow: hidden;
      font-size: 14px;
      font-weight: 650;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      color: var(--muted);
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-y: auto;
    }
    /* 只有用户主动收起时才回到两行裁切；默认状态一律完整展示。 */
    .card.collapsed .body {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .meta {
      overflow: hidden;
      color: var(--subtle);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta.failed { color: var(--danger); }
    .actions { display: flex; gap: 6px; margin-top: auto; }
    button {
      min-height: 30px;
      min-width: 30px;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 0 10px;
      font: inherit;
      font-weight: 550;
      cursor: pointer;
      transition: transform 100ms ease, opacity 100ms ease;
    }
    button:hover { opacity: .9; }
    button:active { transform: scale(.98); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .open { flex: 1; background: var(--accent); color: var(--accent-fg); }
    .open:hover { background: var(--accent-hover); }
    .ghost { border-color: var(--line); background: transparent; color: var(--muted); }
    .fold { border-color: transparent; background: transparent; color: var(--subtle); font-size: 11px; padding: 0 6px; min-height: 22px; }
    .fold:hover { color: var(--fg); }
    @keyframes card-in { to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; opacity: 1; transform: none; transition: none; }
      button { transition: none; }
    }
  </style>
</head>
<body>
  <div id="stack"></div>
  <script>
    const api = window.piNotify
    const stack = document.getElementById('stack')
    const TONES = ${JSON.stringify(ALERT_SOUND_TONES)}
    /**
     * 展开/收起是用户的临时选择，不写盘：新卡片默认展开。
     * 折叠态记在 collapsed 里，重渲染（例如又来一张卡）时保持一致。
     */
    const collapsed = new Set()
    let audioCtx = null
    function context() {
      if (audioCtx) return audioCtx
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return null
      audioCtx = new Ctx()
      return audioCtx
    }
    /** Same tones as the app (settings preview uses the identical table). */
    function play(preset, volume) {
      const tones = TONES[preset]
      const ctx = context()
      if (!tones || !ctx) return
      const level = typeof volume === 'number' && isFinite(volume) ? Math.min(200, Math.max(0, Math.round(volume))) : 100
      const factor = (level / 100) * ${ALERT_SOUND_BASE_GAIN}
      if (factor <= 0) return
      if (ctx.state === 'suspended') void ctx.resume()
      const start = ctx.currentTime
      for (const tone of tones) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = tone.w || 'sine'
        osc.frequency.value = tone.f
        const t0 = start + tone.t
        const peak = (tone.g || 0.08) * factor
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.d)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + tone.d + 0.02)
      }
    }
    /** 把量到的总高度报回主进程：窗口只在需要时变高，底部永远贴边。 */
    function reportSize() {
      const height = Math.ceil(stack.getBoundingClientRect().height + 8)
      if (typeof api.resize === 'function') api.resize(height)
    }
    function render(cards) {
      stack.replaceChildren()
      for (const card of cards) {
        if (!card || !card.copy) continue
        const el = document.createElement('article')
        el.className = 'card'
        if (collapsed.has(card.notificationId)) el.classList.add('collapsed')
        el.dataset.id = card.notificationId
        const failed = card.outcome === 'failed'
        el.innerHTML =
          '<div class="project"></div><div class="title"></div><div class="body"></div><div class="meta"></div><div class="actions"></div>'
        el.querySelector('.project').textContent = card.copy.projectLabel
        el.querySelector('.title').textContent = card.copy.title
        const body = el.querySelector('.body')
        body.textContent = card.copy.body
        const meta = el.querySelector('.meta')
        meta.textContent = card.copy.meta
        if (failed) meta.classList.add('failed')
        const actions = el.querySelector('.actions')
        const open = document.createElement('button')
        open.className = 'open'
        open.textContent = card.copy.openLabel
        open.addEventListener('click', () => api.action(card.notificationId, 'open'))
        const dismiss = document.createElement('button')
        dismiss.className = 'ghost'
        dismiss.textContent = card.copy.dismissLabel
        dismiss.addEventListener('click', () => {
          collapsed.delete(card.notificationId)
          api.action(card.notificationId, 'dismiss')
        })
        const mute = document.createElement('button')
        mute.className = 'ghost'
        mute.textContent = card.copy.muteLabel
        mute.addEventListener('click', () => {
          collapsed.delete(card.notificationId)
          api.action(card.notificationId, 'mute')
        })
        actions.append(dismiss, mute, open)
        // 正文长到撑满卡片时才出现「收起/展开」；默认是展开状态。
        if ((card.copy.body || '').length > 90) {
          const fold = document.createElement('button')
          fold.className = 'fold'
          const paint = () => {
            const isCollapsed = el.classList.contains('collapsed')
            fold.textContent = isCollapsed ? '展开' : '收起'
            fold.setAttribute('aria-expanded', String(!isCollapsed))
          }
          fold.addEventListener('click', () => {
            const next = !el.classList.contains('collapsed')
            el.classList.toggle('collapsed', next)
            if (next) collapsed.add(card.notificationId)
            else collapsed.delete(card.notificationId)
            paint()
            reportSize()
          })
          paint()
          actions.insertBefore(fold, dismiss)
        }
        el.addEventListener('mouseenter', () => api.hover(true))
        el.addEventListener('mouseleave', () => api.hover(false))
        stack.append(el)
      }
      // 字体与图片都要等一帧才稳定；先画完再量高度，避免窗口尺寸跳动。
      requestAnimationFrame(() => requestAnimationFrame(reportSize))
    }
    api.onFocus(() => stack.querySelector('.card:last-child .open')?.focus())
    api.onSound((preset, volume) => play(preset, volume))
    api.onUpdate(render)
    api.ready()
  </script>
</body>
</html>`
}
