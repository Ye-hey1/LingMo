'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Cropper, CropperRef, Priority } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import './image-editor.css'
import { Button } from '@/components/ui/button'
import { 
  Bot,
  Check,
  ClipboardPlus,
  Download,
  FileOutput,
  RotateCw, 
  FlipHorizontal, 
  FlipVertical, 
  ZoomIn, 
  ZoomOut,
  Crop,
  Save,
  Undo
} from 'lucide-react'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { writeFile } from '@tauri-apps/plugin-fs'
import { readWorkspaceBinaryFile } from '@/lib/file-binary'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import { Toggle } from '@/components/ui/toggle'
import { ImageFooter } from './image-footer'
import { TooltipButton } from '@/components/tooltip-button'
import NextImage from 'next/image'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import emitter from '@/lib/emitter'
import {
  canvasToBlob,
  createWorkspaceImageAttachment,
  exportImageVariant,
  imageSourceToCanvas,
  type ImageExportFormat,
} from '@/lib/image-editor-actions'

interface ImageEditorProps {
  filePath: string
}

interface CropperLayoutState {
  boundary: {
    width: number
    height: number
  }
  imageSize: {
    width: number
    height: number
  }
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

export function ImageEditor({ filePath }: ImageEditorProps) {
  const cropperRef = useRef<CropperRef>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const cropperContainerRef = useRef<HTMLDivElement>(null)
  const [imageSrc, setImageSrc] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [hasChanges, setHasChanges] = useState(false)
  const [originalImageData, setOriginalImageData] = useState<Uint8Array | null>(null)
  const [cropMode, setCropMode] = useState(false)
  const [imageWidth, setImageWidth] = useState<number>(0)
  const [imageHeight, setImageHeight] = useState<number>(0)
  const [previewScale, setPreviewScale] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [exportQuality, setExportQuality] = useState(0.82)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const { loadFileTree } = useArticleStore()
  const panStartRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const MIN_PREVIEW_SCALE = 0.25
  const MAX_PREVIEW_SCALE = 4
  const PREVIEW_SCALE_STEP = 0.12
  const canPanImage = !cropMode && previewScale > 1
  const zoomLabel = `${Math.round(previewScale * 100)}%`
  const imageName = filePath.split('/').pop() || filePath

  useEffect(() => {
    loadImage()
  }, [filePath])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || loading || !imageSrc) return

    const updateViewportSize = () => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateViewportSize()
    const observer = new ResizeObserver(updateViewportSize)
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [loading, imageSrc])

  async function loadImage() {
    if (!filePath) return
    
    try {
      setLoading(true)
      const imageData = await readWorkspaceBinaryFile(filePath)
      
      setOriginalImageData(imageData)
      
      const blob = new Blob([imageData as unknown as BlobPart])
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(false)
      setPreviewScale(1)
      setPanOffset({ x: 0, y: 0 })
      
      // 加载图片尺寸
      const img = new Image()
      img.onload = () => {
        setImageWidth(img.naturalWidth)
        setImageHeight(img.naturalHeight)
      }
      img.src = url
    } catch (error) {
      console.error('Failed to load image:', error)
      toast({
        title: '加载图片失败',
        description: String(error),
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const applyImageTransform = async (transformFn: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, img: HTMLImageElement) => void) => {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = imageSrc
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('图片加载失败'))
      })

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      transformFn(canvas, ctx, img)

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
        }, 'image/png')
      })

      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(true)
      setPreviewScale(1)
      setPanOffset({ x: 0, y: 0 })
      
      // 更新图片尺寸
      setImageWidth(canvas.width)
      setImageHeight(canvas.height)
    } catch (error) {
      console.error('Failed to transform image:', error)
    }
  }

  const handleRotate = () => {
    applyImageTransform((canvas, ctx, img) => {
      canvas.width = img.height
      canvas.height = img.width
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(90 * Math.PI / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
    })
  }

  const handleFlipHorizontal = () => {
    applyImageTransform((canvas, ctx, img) => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)
    })
  }

  const handleFlipVertical = () => {
    applyImageTransform((canvas, ctx, img) => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.translate(0, canvas.height)
      ctx.scale(1, -1)
      ctx.drawImage(img, 0, 0)
    })
  }

  const handleZoomIn = () => {
    if (cropMode && cropperRef.current) {
      cropperRef.current.zoomImage(1.2)
      return
    }

    setPreviewScale((scale) => Math.min(MAX_PREVIEW_SCALE, Number((scale + PREVIEW_SCALE_STEP).toFixed(2))))
  }

  const handleZoomOut = () => {
    if (cropMode && cropperRef.current) {
      cropperRef.current.zoomImage(0.8)
      return
    }

    setPreviewScale((scale) => Math.max(MIN_PREVIEW_SCALE, Number((scale - PREVIEW_SCALE_STEP).toFixed(2))))
  }

  const handleFitToWindow = () => {
    setPreviewScale(1)
    setPanOffset({ x: 0, y: 0 })
  }

  const handleActualSize = () => {
    setPreviewScale(1)
    setPanOffset({ x: 0, y: 0 })
  }

  const handleReset = () => {
    if (originalImageData) {
      const blob = new Blob([originalImageData as unknown as BlobPart])
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(false)
      setCropMode(false)
      setPreviewScale(1)
      setPanOffset({ x: 0, y: 0 })
    }
  }

  const handleSave = async () => {
    try {
      let blob: Blob

      if (cropperRef.current) {
        // 如果在裁切模式，从 Cropper 获取图片
        const canvas = cropperRef.current.getCanvas()
        if (!canvas) return

        blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => {
            if (b) resolve(b)
          }, 'image/png')
        })
      } else {
        // 非裁切模式，直接从 imageSrc 获取图片数据
        const response = await fetch(imageSrc)
        blob = await response.blob()
      }

      const arrayBuffer = await blob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)

      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)

      if (workspace.isCustom) {
        await writeFile(pathOptions.path, uint8Array)
      } else {
        await writeFile(pathOptions.path, uint8Array, { baseDir: pathOptions.baseDir })
      }

      setOriginalImageData(uint8Array)
      setHasChanges(false)
      setCropMode(false)
      
      await loadFileTree()

      toast({
        title: '保存成功',
        description: '图片已保存'
      })
    } catch (error) {
      console.error('Failed to save image:', error)
      toast({
        title: '保存失败',
        description: String(error),
        variant: 'destructive'
      })
    }
  }

  const handleCropComplete = async () => {
    if (!cropMode || !cropperRef.current) return
    
    try {
      // 获取裁切后的图片
      const canvas = cropperRef.current.getCanvas()
      if (!canvas) return

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
        }, 'image/png')
      })

      // 更新图片显示
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      
      // 更新图片尺寸
      const img = new Image()
      img.onload = () => {
        setImageWidth(img.naturalWidth)
        setImageHeight(img.naturalHeight)
      }
      img.src = url
      
      setHasChanges(true)
      setCropMode(false)
      setPreviewScale(1)
      setPanOffset({ x: 0, y: 0 })
    } catch (error) {
      console.error('Failed to crop image:', error)
    }
  }

  const getCurrentImageBlob = async (format: ImageExportFormat = 'png', quality = exportQuality) => {
    const canvas = cropMode && cropperRef.current?.getCanvas()
      ? cropperRef.current.getCanvas()
      : await imageSourceToCanvas(imageSrc)

    if (!canvas) {
      throw new Error('无法读取当前图片')
    }

    return canvasToBlob(canvas, format, quality)
  }

  const handleSendToAi = async () => {
    try {
      const attachment = await createWorkspaceImageAttachment(filePath)
      emitter.emit('chat-attach-image', {
        ...attachment,
        prompt: `请分析这张图片：${imageName}`,
      })
      toast({
        title: '已发送到 AI 输入框',
        description: imageName,
      })
    } catch (error) {
      toast({
        title: '发送图片失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const handleInsertToMarkdown = () => {
    emitter.emit('editor-insert-markdown-image', { imagePath: filePath })
  }

  const handleCopyImage = async () => {
    try {
      const blob = await getCurrentImageBlob('png')
      const ClipboardItemCtor = window.ClipboardItem
      if (!navigator.clipboard || !ClipboardItemCtor) {
        throw new Error('当前环境不支持复制图片')
      }

      await navigator.clipboard.write([
        new ClipboardItemCtor({
          [blob.type]: blob,
        }),
      ])
      toast({ title: '已复制图片' })
    } catch (error) {
      toast({
        title: '复制图片失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const handleExportVariant = async (format: ImageExportFormat, suffix: string) => {
    try {
      const result = await exportImageVariant({
        src: imageSrc,
        originalPath: filePath,
        format,
        quality: exportQuality,
        suffix,
      })
      await loadFileTree({ skipRemoteSync: true })
      toast({
        title: '已导出图片',
        description: `${result.targetPath} · ${formatFileSize(result.size)}`,
      })
    } catch (error) {
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPanImage || event.button !== 0) return

    panStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panOffset.x,
      originY: panOffset.y,
    }
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStartRef.current
    if (!pan || pan.pointerId !== event.pointerId) return

    setPanOffset({
      x: pan.originX + event.clientX - pan.startX,
      y: pan.originY + event.clientY - pan.startY,
    })
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStartRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    panStartRef.current = null
    setIsPanning(false)
  }

  const handleWheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    const step = event.shiftKey ? 0.05 : PREVIEW_SCALE_STEP
    setPreviewScale((scale) => {
      const nextScale = scale + direction * step
      return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, Number(nextScale.toFixed(2))))
    })
  }

  const previewStyle = useMemo(() => ({
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain' as const,
    imageRendering: 'auto' as const,
    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${previewScale})`,
    transformOrigin: 'center center',
    filter: 'drop-shadow(0 18px 42px rgba(15, 23, 42, 0.16))',
    transition: isPanning ? 'none' : 'transform 120ms ease-out, filter 160ms ease-out',
    cursor: canPanImage ? (isPanning ? 'grabbing' : 'grab') : 'default',
  }), [canPanImage, isPanning, panOffset.x, panOffset.y, previewScale])

  const cropperViewportStyle = (() => {
    if (!imageWidth || !imageHeight || !viewportSize.width || !viewportSize.height) {
      return { width: '100%', height: '100%' }
    }

    const horizontalPadding = 32
    const verticalPadding = 32
    const maxWidth = Math.max(0, viewportSize.width - horizontalPadding)
    const maxHeight = Math.max(0, viewportSize.height - verticalPadding)

    if (!maxWidth || !maxHeight) {
      return { width: '100%', height: '100%' }
    }

    const imageAspectRatio = imageWidth / imageHeight
    const viewportAspectRatio = maxWidth / maxHeight

    if (imageAspectRatio > viewportAspectRatio) {
      return {
        width: `${maxWidth}px`,
        height: `${maxWidth / imageAspectRatio}px`,
      }
    }

    return {
      width: `${maxHeight * imageAspectRatio}px`,
      height: `${maxHeight}px`,
    }
  })()

  const getInitialCropSize = ({ boundary }: CropperLayoutState) => ({
    width: boundary.width * 0.8,
    height: boundary.height * 0.8,
  })

  const getInitialVisibleArea = ({ imageSize }: CropperLayoutState) => ({
    left: 0,
    top: 0,
    width: imageSize.width,
    height: imageSize.height,
  })

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  if (!imageSrc) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <p className="text-muted-foreground">无法加载图片</p>
      </div>
    )
  }

  return (
    <div className="image-editor-shell flex h-full min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="image-editor-toolbar-surface">
        <div className="image-editor-toolbar-scroll">
          <div className="image-editor-toolbar-side image-editor-toolbar-left">
            <div className="image-editor-tool-group">
              <Toggle
                pressed={cropMode}
                onPressedChange={setCropMode}
                aria-label="裁切模式"
                size="sm"
                className="image-editor-icon-button"
              >
                <Crop className="h-4 w-4" />
              </Toggle>
              {cropMode ? (
                <Button className="image-editor-text-button" variant="secondary" size="sm" onClick={handleCropComplete}>
                  <Check className="h-4 w-4" />
                  应用
                </Button>
              ) : null}
              <TooltipButton
                icon={<RotateCw className="h-4 w-4" />}
                tooltipText="旋转"
                onClick={handleRotate}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <TooltipButton
                icon={<FlipHorizontal className="h-4 w-4" />}
                tooltipText="水平翻转"
                onClick={handleFlipHorizontal}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <TooltipButton
                icon={<FlipVertical className="h-4 w-4" />}
                tooltipText="垂直翻转"
                onClick={handleFlipVertical}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
            </div>
          </div>

          <div className="image-editor-toolbar-center">
            <div className="image-editor-tool-group image-editor-zoom-group">
              <TooltipButton
                icon={<ZoomOut className="h-4 w-4" />}
                tooltipText="缩小"
                onClick={handleZoomOut}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <Button className="image-editor-zoom-button" variant="ghost" size="sm" onClick={handleActualSize}>
                {zoomLabel}
              </Button>
              <TooltipButton
                icon={<ZoomIn className="h-4 w-4" />}
                tooltipText="放大"
                onClick={handleZoomIn}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <Button className="image-editor-text-button" variant="ghost" size="sm" onClick={handleFitToWindow}>
                适应
              </Button>
            </div>
          </div>

          <div className="image-editor-toolbar-side image-editor-toolbar-right">
            <div className="image-editor-tool-group">
              <TooltipButton
                icon={<Bot className="h-4 w-4" />}
                tooltipText="发送给 AI 分析"
                onClick={handleSendToAi}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <TooltipButton
                icon={<ClipboardPlus className="h-4 w-4" />}
                tooltipText="插入到 Markdown"
                onClick={handleInsertToMarkdown}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <TooltipButton
                icon={<FileOutput className="h-4 w-4" />}
                tooltipText="复制图片"
                onClick={handleCopyImage}
                size="sm"
                side="bottom"
                buttonClassName="image-editor-icon-button"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="image-editor-text-button" variant="ghost" size="sm">
                    <Download className="h-4 w-4" />
                    导出
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>压缩质量 {Math.round(exportQuality * 100)}%</DropdownMenuLabel>
                  <div className="px-2 py-2">
                    <Slider
                      min={0.35}
                      max={1}
                      step={0.05}
                      value={[exportQuality]}
                      onValueChange={(value) => setExportQuality(value[0] ?? 0.82)}
                    />
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void handleExportVariant('jpeg', 'compressed')}>
                    导出 JPG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleExportVariant('webp', 'compressed')}>
                    导出 WebP
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleExportVariant('png', 'converted')}>
                    导出 PNG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {hasChanges ? (
            <div className="image-editor-tool-group image-editor-save-group">
              <Button className="image-editor-text-button" variant="ghost" size="sm" onClick={handleReset}>
                <Undo className="h-4 w-4" />
                重置
              </Button>
              <Button className="image-editor-save-button" variant="default" size="sm" onClick={handleSave}>
                <Save className="h-4 w-4" />
                保存
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Image Display / Cropper */}
      <div
        ref={viewportRef}
        className="image-editor-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheelZoom}
      >
        {cropMode ? (
          <div 
            ref={cropperContainerRef}
            className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden"
            style={cropperViewportStyle}
            onDoubleClick={handleCropComplete}
          >
            <Cropper
              ref={cropperRef}
              src={imageSrc}
              className="h-full w-full min-h-0 min-w-0"
              defaultSize={getInitialCropSize}
              defaultVisibleArea={getInitialVisibleArea}
              priority={Priority.visibleArea}
              stencilProps={{
                movable: true,
                resizable: true,
                lines: true,
                handlers: true,
              }}
              onChange={() => {
                setHasChanges(true)
              }}
            />
          </div>
        ) : (
            <NextImage 
              src={imageSrc} 
              alt={imageName}
              width={imageWidth}
              height={imageHeight}
              style={previewStyle}
              unoptimized
              draggable={false}
            />
          )}
      </div>

      {/* Footer */}
      <ImageFooter 
        filePath={filePath} 
        imageWidth={imageWidth} 
        imageHeight={imageHeight} 
      />
    </div>
  )
}
