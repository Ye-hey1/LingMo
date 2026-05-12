"use client"

import { Button } from "@/components/ui/button"
import { AtSign, X, FolderOpen, Trash2, FileText } from "lucide-react"
import { type LinkedResource, isLinkedFolder } from "@/lib/files"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'

interface FileLinkProps {
  onFileLinkClick: () => void
  disabled?: boolean
}

export function FileLink({ onFileLinkClick, disabled = false }: FileLinkProps) {
  const t = useTranslations('record.chat.input.fileLink')

  return (
    <div>
      <TooltipButton
        icon={<AtSign className="size-4" />}
        tooltipText={t('tooltip')}
        size="icon"
        side="bottom"
        onClick={onFileLinkClick}
        disabled={disabled}
      />
    </div>
  )
}

interface LinkedResourceDisplayProps {
  linkedResource?: LinkedResource | null
  linkedResources?: LinkedResource[]
  onFileRemove?: () => void
  onResourceRemove?: (resource: LinkedResource) => void
  onClearAll?: () => void
  showHeader?: boolean
  compact?: boolean
}

export function LinkedFileDisplay({
  linkedResource,
  linkedResources,
  onFileRemove,
  onResourceRemove,
  onClearAll,
  showHeader = true,
  compact = false,
}: LinkedResourceDisplayProps) {
  const resources = linkedResources?.length
    ? linkedResources
    : linkedResource
      ? [linkedResource]
      : []

  if (resources.length === 0) return null

  const removeResource = (resource: LinkedResource) => {
    if (onResourceRemove) {
      onResourceRemove(resource)
      return
    }

    onFileRemove?.()
  }

  if (compact) {
    const first = resources[0]
    const firstLabel = first.relativePath || first.name || first.path
    const isFolder = isLinkedFolder(first)

    return (
      <div
        className="flex h-6 min-w-0 items-center gap-1 rounded-md border border-border/55 bg-background/80 px-1.5 text-[10px] text-muted-foreground"
        title={firstLabel}
      >
        {isFolder ? (
          <FolderOpen className="size-3 shrink-0 opacity-70" />
        ) : (
          <FileText className="size-3 shrink-0 opacity-70" />
        )}
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground/85">{firstLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (onClearAll) {
              onClearAll()
              return
            }
            removeResource(first)
          }}
          className="-mr-1 size-4.5 shrink-0 rounded-full p-0 opacity-50 transition-opacity hover:bg-background/80 hover:opacity-100"
          title="移除"
        >
          <X className="size-2.5" />
        </Button>
      </div>
    )
  }

  const resourceList = (
    <div className="max-h-[92px] space-y-0.5 overflow-y-auto pr-0.5">
      {resources.map((resource) => {
        const isFolder = isLinkedFolder(resource)
        const resourceKey = resource.relativePath || resource.path || resource.name
        const displayLabel = resource.relativePath || resource.name || resourceKey

        return (
          <div
            key={resourceKey}
            className="group/resource flex h-6.5 min-w-0 items-center gap-1 rounded-md border border-border/55 bg-background/80 px-1.5 text-xs text-muted-foreground transition-colors hover:bg-background"
            title={resource.relativePath || resource.path || resource.name}
          >
            {isFolder ? (
              <FolderOpen className="size-3 shrink-0 opacity-70" />
            ) : (
              <FileText className="size-3 shrink-0 opacity-70" />
            )}
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground/85">{displayLabel}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeResource(resource)}
              className="-mr-1 size-4.5 shrink-0 rounded-full p-0 opacity-40 transition-opacity hover:bg-background/80 hover:opacity-100 group-hover/resource:opacity-85"
              title="移除"
            >
              <X className="size-2.5" />
            </Button>
          </div>
        )
      })}
    </div>
  )

  if (!showHeader) {
    return resourceList
  }

  return (
    <div className="mx-1 mt-1 rounded-md border border-border/60 bg-muted/20 px-1.5 py-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <AtSign className="size-3.5 shrink-0" />
          <span className="truncate">已附加 {resources.length} 项</span>
        </div>
        {resources.length > 1 && onClearAll && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-background/80"
            title="清空"
          >
            <Trash2 className="size-3" />
            清空
          </Button>
        )}
      </div>

      {resourceList}
    </div>
  )
}
