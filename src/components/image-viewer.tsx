import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LocalImage } from "./local-image";
import { convertImage } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { getTopDialogPortalContainer } from "@/components/ui/portal-container";

const MIN_SCALE = 1
const MAX_SCALE = 4
const SCALE_STEP = 0.15

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale.toFixed(2))))
}

export function ImageViewer({url, path, imageClassName}: {url: string, path?: string, imageClassName?: string}) {
  const [src, setSrc] = useState('')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [scale, setScale] = useState(1)

  async function init() {
    const res = url.includes('http') ? url : await convertImage(`/${path}/${url}`)
    setSrc(res)
  }

  useEffect(() => {
    setMounted(true)
    init()
  }, [url, path])

  useEffect(() => {
    if (open) {
      setScale(1)
    }
  }, [open, src])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function closePreview(event?: React.MouseEvent | React.PointerEvent) {
    event?.preventDefault()
    event?.stopPropagation()
    setOpen(false)
  }

  function handlePreviewWheel(event: React.WheelEvent) {
    event.preventDefault()
    event.stopPropagation()

    const direction = event.deltaY < 0 ? 1 : -1
    setScale((currentScale) => clampScale(currentScale + direction * SCALE_STEP))
  }

  const portalContainer = mounted ? getTopDialogPortalContainer() ?? document.body : null

  const preview = mounted && open && src ? createPortal(
    <div
      className="fixed inset-0 z-[10060] flex items-center justify-center overflow-hidden bg-black/82 p-4 pointer-events-auto sm:p-6"
      role="dialog"
      aria-modal="true"
      onPointerDown={closePreview}
      onClick={closePreview}
      onWheel={handlePreviewWheel}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="max-h-[82vh] max-w-[92vw] cursor-zoom-out select-none rounded-md bg-white object-contain shadow-2xl transition-transform duration-100 ease-out"
        style={{ transform: `scale(${scale})` }}
        draggable={false}
        onPointerDown={closePreview}
        onClick={closePreview}
        onWheel={handlePreviewWheel}
      />
    </div>,
    portalContainer ?? document.body
  ) : null

  return (
    <>
      <button
        type="button"
        className="block cursor-zoom-in rounded-md p-0"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (src) setOpen(true)
        }}
        aria-label="打开图片预览"
      >
        <LocalImage
          src={url.includes('http') ? url : `/${path}/${url}`}
          alt=""
          className={cn("w-14 h-14 object-cover", imageClassName)}
        />
      </button>
      {preview}
    </>
  )
}
