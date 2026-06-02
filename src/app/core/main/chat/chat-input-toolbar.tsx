"use client"

import * as React from "react"
import { GlobeIcon, Loader2, WandSparkles } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { ChatModeSelect } from "./chat-mode-select"
import { McpButton } from "./mcp-button"
import { RagSwitch } from "./rag-switch"
import { ClipboardMonitor } from "./clipboard-monitor"
import { SkillsPopover } from "./skills-popover"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ============================================================
// Types
// ============================================================

interface ToolbarConfigItem {
  id: string
  enabled: boolean
  order: number
}

interface SortableToolbarItemProps {
  id: string
  loading: boolean
  enhancingPrompt: boolean
  webSearchEnabled: boolean
  onEnhancePrompt: () => void
  onToggleWebSearch: () => void
}

// ============================================================
// SortableToolbarItem
// ============================================================

const SortableToolbarItem = React.memo(function SortableToolbarItem({
  id,
  loading,
  enhancingPrompt,
  webSearchEnabled,
  onEnhancePrompt,
  onToggleWebSearch,
}: SortableToolbarItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const renderToolbarItem = () => {
    switch (id) {
      case 'chatModeSelect':
        return <ChatModeSelect />
      case 'mcpButton':
        return <McpButton />
      case 'ragSwitch':
        return <RagSwitch />
      case 'clipboardMonitor':
        return <ClipboardMonitor />
      case 'skillsPopover':
        return <SkillsPopover />
      case 'promptEnhancer':
        return (
          <TooltipButton
            variant={enhancingPrompt ? "secondary" : "ghost"}
            size="icon"
            icon={enhancingPrompt ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
            tooltipText={enhancingPrompt ? '正在增强提示词...' : '增强提示词'}
            onClick={onEnhancePrompt}
            disabled={loading || enhancingPrompt}
            buttonClassName={enhancingPrompt ? 'bg-primary/10 text-primary' : undefined}
          />
        )
      case 'webSearch':
        return (
          <TooltipButton
            variant={webSearchEnabled ? "secondary" : "ghost"}
            size="icon"
            icon={<GlobeIcon className={webSearchEnabled ? "size-4 text-primary" : "size-4"} />}
            tooltipText={webSearchEnabled ? '已启用 Web 搜索（Tavily）' : '启用 Web 搜索（Tavily）'}
            onClick={onToggleWebSearch}
            disabled={loading}
            buttonClassName={webSearchEnabled ? 'bg-primary/10 text-primary hover:bg-primary/15' : undefined}
          />
        )
      default:
        return null
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="shrink-0 cursor-grab active:cursor-grabbing"
    >
      {renderToolbarItem()}
    </div>
  )
})
SortableToolbarItem.displayName = 'SortableToolbarItem'

// ============================================================
// ChatInputToolbar Props
// ============================================================

interface ChatInputToolbarProps {
  toolbarConfig: ToolbarConfigItem[]
  loading: boolean
  enhancingPrompt: boolean
  webSearchEnabled: boolean
  onEnhancePrompt: () => void
  onToggleWebSearch: () => void
  onReorder: (items: ToolbarConfigItem[]) => void
}

// ============================================================
// ChatInputToolbar Component
// ============================================================

export const ChatInputToolbar = React.memo(function ChatInputToolbar({
  toolbarConfig,
  loading,
  enhancingPrompt,
  webSearchEnabled,
  onEnhancePrompt,
  onToggleWebSearch,
  onReorder,
}: ChatInputToolbarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const enabledItems = React.useMemo(() => {
    return toolbarConfig
      .filter(item => item.enabled && item.id !== 'newChat' && item.id !== 'modelSelect' && item.id !== 'promptSelect')
      .sort((a, b) => a.order - b.order)
  }, [toolbarConfig])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = enabledItems.findIndex((item) => item.id === active.id)
      const newIndex = enabledItems.findIndex((item) => item.id === over.id)

      const reorderedItems = arrayMove(enabledItems, oldIndex, newIndex)
      const allItems = [...toolbarConfig]

      reorderedItems.forEach((item, index) => {
        const globalIndex = allItems.findIndex(i => i.id === item.id)
        if (globalIndex !== -1) {
          allItems[globalIndex] = { ...item, order: enabledItems[0].order + index }
        }
      })

      onReorder(allItems)
    }
  }, [enabledItems, toolbarConfig, onReorder])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={enabledItems.map(item => item.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {enabledItems.map((item) => (
            <SortableToolbarItem
              key={item.id}
              id={item.id}
              loading={loading}
              enhancingPrompt={enhancingPrompt}
              webSearchEnabled={webSearchEnabled}
              onEnhancePrompt={onEnhancePrompt}
              onToggleWebSearch={onToggleWebSearch}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
})
ChatInputToolbar.displayName = 'ChatInputToolbar'
