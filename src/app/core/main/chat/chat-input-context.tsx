"use client"

import * as React from "react"
import { X, File, Folder, ImageIcon, Quote } from "lucide-react"
import type { LinkedResource } from "@/lib/files"
import { isLinkedFolder } from "@/lib/files"
import type { ImageAttachment } from "./image-attachments"
import type { PendingQuote } from "@/stores/chat"

// ============================================================
// Types
// ============================================================

interface ChatInputContextProps {
  hasContext: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  pendingQuote: PendingQuote | null
  onClearQuote: () => void
  linkedResources: LinkedResource[]
  onRemoveResource: (key: string) => void
  onClearAllResources: () => void
  attachedImages: ImageAttachment[]
  onRemoveImage: (id: string) => void
  onClearAllImages: () => void
  onClearAllContexts: () => void
}

// ============================================================
// Helper Functions
// ============================================================

function getLinkedResourceKey(resource: LinkedResource): string {
  return resource.relativePath || resource.path || resource.name
}

function getResourceIcon(resource: LinkedResource) {
  if (isLinkedFolder(resource)) {
    return <Folder className="size-3.5 text-blue-500" />
  }
  return <File className="size-3.5 text-muted-foreground" />
}

// ============================================================
// ChatInputContext Component
// ============================================================

export const ChatInputContext = React.memo(function ChatInputContext({
  hasContext,
  isExpanded,
  onToggleExpand,
  pendingQuote,
  onClearQuote,
  linkedResources,
  onRemoveResource,
  attachedImages,
  onRemoveImage,
  onClearAllContexts,
}: ChatInputContextProps) {
  if (!hasContext) {
    return null
  }

  const linkedCount = linkedResources.length
  const imageCount = attachedImages.length
  const hasQuote = !!pendingQuote

  return (
    <div className="w-full border-t border-border/40">
      {/* 折叠触发器 */}
      <div
        role="button"
        tabIndex={0}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleExpand()
          }
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasQuote && <Quote className="size-3.5 text-amber-500 flex-shrink-0" />}
          {linkedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {linkedCount} 个文件
            </span>
          )}
          {imageCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {imageCount} 张图片
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50"
            onClick={(e) => {
              e.stopPropagation()
              onClearAllContexts()
            }}
          >
            清空
          </button>
        </div>
      </div>

      {/* 展开的详情 */}
      {isExpanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2 max-h-40 overflow-y-auto">
          {/* 引用内容 */}
          {hasQuote && (
            <ContextItem
              type="quote"
              label={pendingQuote.fileName}
              detail={`第 ${pendingQuote.startLine}-${pendingQuote.endLine} 行`}
              onRemove={onClearQuote}
            />
          )}

          {/* 关联文件 */}
          {linkedResources.map((resource) => {
            const key = getLinkedResourceKey(resource)
            return (
              <ContextItem
                key={key}
                type={isLinkedFolder(resource) ? 'folder' : 'file'}
                label={resource.name}
                detail={resource.relativePath}
                icon={getResourceIcon(resource)}
                onRemove={() => onRemoveResource(key)}
              />
            )
          })}

          {/* 图片附件 */}
          {attachedImages.map((image) => (
            <ContextItem
              key={image.id}
              type="image"
              label={image.name || '未命名图片'}
              detail={image.source || undefined}
              icon={<ImageIcon className="size-3.5 text-green-500" />}
              onRemove={() => onRemoveImage(image.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
})
ChatInputContext.displayName = 'ChatInputContext'

// ============================================================
// ContextItem Sub-component
// ============================================================

interface ContextItemProps {
  type: 'quote' | 'file' | 'folder' | 'image'
  label: string
  detail?: string | number | null
  icon?: React.ReactNode
  onRemove: () => void
}

function ContextItem({ type, label, detail, icon, onRemove }: ContextItemProps) {
  const defaultIcon = {
    quote: <Quote className="size-3.5 text-amber-500" />,
    file: <File className="size-3.5 text-muted-foreground" />,
    folder: <Folder className="size-3.5 text-blue-500" />,
    image: <ImageIcon className="size-3.5 text-green-500" />,
  }

  return (
    <div className="flex items-center gap-2 group">
      {icon || defaultIcon[type]}
      <span className="text-xs text-foreground truncate flex-1 min-w-0">
        {label}
      </span>
      {detail && (
        <span className="text-xs text-muted-foreground/60 truncate max-w-[120px]">
          {detail}
        </span>
      )}
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
