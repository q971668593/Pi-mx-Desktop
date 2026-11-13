import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Image as ImageIcon, Sparkles } from "@renderer/components/icons"
import { ImageLightbox } from "@renderer/components/ui/image-lightbox"
import { ipcClient } from "@renderer/lib/ipc-client"
import { useUIStore } from "@renderer/stores/ui-store"
import { contextMenuItemClass, contextMenuPanelClass, useDismissContextMenu } from "@renderer/features/workspace/context-menu-shared"
import { findChatImageRefs, type ChatImageRef } from "@shared/chat-image-paths"

type ImageTarget = { path: string; name: string; x: number; y: number }

function fileName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path
}

const IMAGE_GEN_NAME_PATTERN =
  /(magpie_image|image_gen|imagegen|generate_image|generation_result|image_generation|create_image|text_to_image|edit_image)/i

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === "object") return value as Record<string, unknown>
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return null
}

export function isImageGenerationTool(toolName?: string, toolArgs?: unknown, toolDetails?: unknown): boolean {
  if (toolName && IMAGE_GEN_NAME_PATTERN.test(toolName)) return true
  const argsObj = parseObject(toolArgs)
  if (argsObj) {
    const server = String(argsObj.server ?? argsObj.mcpServer ?? argsObj.tool ?? "")
    if (server && IMAGE_GEN_NAME_PATTERN.test(server)) return true
  }
  const detailsObj = parseObject(toolDetails)
  if (detailsObj) {
    const server = String(detailsObj.server ?? detailsObj.mcpServer ?? detailsObj.toolName ?? detailsObj.name ?? "")
    if (server && IMAGE_GEN_NAME_PATTERN.test(server)) return true
  }
  return false
}

export function extractImagePrompt(toolArgs?: unknown): string {
  const obj = parseObject(toolArgs)
  if (!obj) return ""
  const raw = obj.prompt ?? obj.instruction ?? obj.description ?? obj.query
  return typeof raw === "string" ? raw.trim() : ""
}

export function ChatImageGeneratingCard({ prompt }: { prompt?: string }) {
  const { t } = useTranslation("timeline")
  return (
    <div
      className="chat-image-generating-card relative mt-2 w-full max-w-[260px] overflow-hidden rounded-xl border border-border/50 p-4 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="chat-image-generating-sweep pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex min-h-[150px] flex-col items-center justify-center gap-2.5 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/50 bg-background/70 text-primary shadow-sm backdrop-blur-sm">
          <Sparkles className="h-4 w-4 animate-pulse" />
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
          <ImageIcon className="h-3.5 w-3.5 text-primary/80" />
          <span>{t("image.generating")}</span>
        </div>
        {prompt ? (
          <p className="line-clamp-2 max-w-[210px] text-[11px] leading-relaxed text-muted-foreground">
            {prompt}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function ChatImageGallery({ text }: { text: string }) {
  const images = useMemo(() => findChatImageRefs(text), [text])
  if (!images.length) return null
  return <div className="mt-2 flex flex-wrap gap-2">{images.map((image) => <ChatImageCard key={image.path} image={image} />)}</div>
}

function ChatImageCard({ image }: { image: ChatImageRef }) {
  const { t } = useTranslation("timeline")
  const workspace = useUIStore((state) => state.currentWorkspace)
  const [src, setSrc] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [menu, setMenu] = useState<ImageTarget | null>(null)
  const [studio, setStudio] = useState(false)
  const { path } = image
  const name = image.name || fileName(path)

  useEffect(() => {
    let active = true
    if (!workspace) return
    void ipcClient.invoke("shell.readImagePreview", { workspaceRoot: workspace, path }).then((result) => {
      if (active && result?.ok && result.dataUrl) setSrc(result.dataUrl)
    }).catch(() => undefined)
    return () => { active = false }
  }, [path, workspace])

  const copy = async () => {
    const result = await ipcClient.invoke("clipboard.copyImageFile", { path, workspaceRoot: workspace || undefined })
    if (!result?.ok) throw new Error(result?.error || "copy_failed")
    toast.success(t("image.copied"))
  }
  const save = async () => {
    const result = await ipcClient.invoke("dialog:saveImage", { path, workspaceRoot: workspace || undefined, suggestedName: name })
    if (!result?.ok) throw new Error(result?.error || "save_failed")
    if (!result.canceled) toast.success(t("image.saved"))
  }
  const addToChat = async () => {
    window.dispatchEvent(
      new CustomEvent("pi-desktop:composer-attach-files", {
        detail: { files: [{ path, name, kind: "image", dataUrl: src || undefined }] },
      }),
    )
    toast.success(t("image.addedToChat"))
  }
  const run = (action: () => Promise<void>) => {
    setMenu(null)
    void action().catch(() => toast.error(t("image.actionFailed")))
  }

  return (
    <>
      <button type="button" className="group relative block overflow-hidden rounded-lg border border-border/50 bg-muted/30" title={t("image.open")} aria-label={t("image.openNamed", { name })} onClick={() => src && setPreview(true)} onContextMenu={(event) => { event.preventDefault(); setMenu({ path, name, x: event.clientX, y: event.clientY }) }}>
        {src ? <img src={src} alt={name} className="block max-h-64 max-w-full object-contain" draggable={false} /> : <span className="block max-w-72 px-3 py-6 text-left text-xs text-muted-foreground">{name}</span>}
      </button>
      {preview && src ? (
        <ImageLightbox
          src={src}
          alt={name}
          onClose={() => setPreview(false)}
          actions={{
            onCopy: () => run(copy),
            onSaveAs: () => run(save),
            onAddToChat: () => run(addToChat),
            onAnnotate: () => {
              setPreview(false)
              setStudio(true)
            },
          }}
        />
      ) : null}
      <ImageActionMenu menu={menu} onClose={() => setMenu(null)} onCopy={() => run(copy)} onSave={() => run(save)} onAddToChat={() => run(addToChat)} onAnnotate={() => { setMenu(null); setStudio(true) }} />
      {studio ? <ImageAnnotationStudio path={path} name={name} src={src} onClose={() => setStudio(false)} /> : null}
    </>
  )
}

function ImageActionMenu({ menu, onClose, onCopy, onSave, onAddToChat, onAnnotate }: { menu: ImageTarget | null; onClose: () => void; onCopy: () => void; onSave: () => void; onAddToChat: () => void; onAnnotate: () => void }) {
  const { t } = useTranslation("timeline")
  const ref = useRef<HTMLDivElement>(null)
  useDismissContextMenu(!!menu, ref, onClose)
  if (!menu) return null
  return createPortal(
    <div ref={ref} className={contextMenuPanelClass} style={{ left: menu.x, top: menu.y }} role="menu">
      <button type="button" className={contextMenuItemClass} onClick={onCopy}>{t("image.copy")}</button>
      <button type="button" className={contextMenuItemClass} onClick={onSave}>{t("image.saveAs")}</button>
      <button type="button" className={contextMenuItemClass} onClick={onAddToChat}>{t("image.addToChat")}</button>
      <button type="button" className={contextMenuItemClass} onClick={onAnnotate}>{t("image.annotate")}</button>
    </div>,
    document.body,
  )
}

function ImageAnnotationStudio({ path, name, src, onClose }: { path: string; name: string; src: string | null; onClose: () => void }) {
  const { t } = useTranslation("timeline")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const changed = useRef(false)
  const [color, setColor] = useState("#ff3b30")
  const [size, setSize] = useState(6)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!src || !canvasRef.current) return
    const image = new Image()
    image.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext("2d")?.drawImage(image, 0, 0)
    }
    image.src = src
  }, [src])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const box = canvas.getBoundingClientRect()
    return { x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height }
  }
  const stroke = (event: React.PointerEvent<HTMLCanvasElement>, start = false) => {
    const at = point(event)
    const context = canvasRef.current?.getContext("2d")
    if (!at || !context) return
    context.strokeStyle = color
    context.fillStyle = color
    context.lineWidth = size * 2
    context.lineCap = "round"
    context.lineJoin = "round"
    context.beginPath()
    if (start || !lastPoint.current) {
      context.arc(at.x, at.y, size, 0, Math.PI * 2)
      context.fill()
    } else {
      context.moveTo(lastPoint.current.x, lastPoint.current.y)
      context.lineTo(at.x, at.y)
      context.stroke()
    }
    lastPoint.current = at
    changed.current = true
  }
  const stop = () => {
    drawing.current = false
    lastPoint.current = null
  }
  const close = () => { if (!changed.current || window.confirm(t("image.discardAnnotation"))) onClose() }
  const save = async () => {
    const data = canvasRef.current?.toDataURL("image/png").split(",")[1]
    if (!data) return
    const result = await ipcClient.invoke("dialog:saveImage", { path, data, mimeType: "image/png", suggestedName: `annotated-${name.replace(/\.[^.]+$/, "")}.png` })
    if (!result?.ok || result.canceled) return
    toast.success(t("image.saved"))
  }
  const add = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setBusy(true)
    try {
      const data = canvas.toDataURL("image/png").split(",")[1] || ""
      const saved = await ipcClient.invoke("clipboard.writeTempImage", { data, mimeType: "image/png" })
      window.dispatchEvent(new CustomEvent("pi-desktop:composer-attach-files", { detail: { text: t("image.annotationPrompt", { path }), files: [{ path: saved.path, name: `annotated-${name.replace(/\.[^.]+$/, "")}.png`, kind: "image", dataUrl: canvas.toDataURL("image/png") }] } }))
      onClose()
    } catch {
      toast.error(t("image.actionFailed"))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="electron-no-drag fixed inset-0 z-[620] flex items-center justify-center bg-black/65 p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-5xl flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-2xl">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>{t("image.color")}<input className="ml-2" type="color" value={color} aria-label={t("image.color")} onChange={(event) => setColor(event.target.value)} /></label>
          <label>{t("image.brush")}<input className="ml-2 align-middle" type="range" min={2} max={48} value={size} aria-label={t("image.brush")} onChange={(event) => setSize(Number(event.target.value))} /></label>
          <div className="ml-auto flex gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-1.5" onClick={close}>{t("image.close")}</button>
            <button type="button" className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50" disabled={!src} onClick={() => void save()}>{t("image.saveAs")}</button>
            <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={!src || busy} onClick={() => void add()}>{busy ? t("image.adding") : t("image.addToChat")}</button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto">{src ? <canvas ref={canvasRef} className="mx-auto max-h-[72vh] max-w-full cursor-crosshair touch-none" onPointerDown={(event) => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); stroke(event, true) }} onPointerMove={(event) => { if (drawing.current) stroke(event) }} onPointerUp={stop} onPointerCancel={stop} /> : <p className="p-8 text-center text-sm text-muted-foreground">{t("image.loading")}</p>}</div>
      </div>
    </div>,
    document.body,
  )
}
