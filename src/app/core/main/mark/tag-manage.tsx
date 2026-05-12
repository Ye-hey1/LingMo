"use client"
import * as React from "react"
import { useTranslations } from 'next-intl'
import { Plus, TagIcon, Inbox, SquareCheck, GripVertical } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { initTagsDb, insertTag, Tag, TAG_COLORS, updateTag, updateTagColor, updateTagsOrder } from "@/db/tags"
import type { Mark } from "@/db/marks"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import useChatStore from "@/stores/chat"
import { MarkLoading } from './mark-loading'
import { ImageGallery } from './image-gallery'
import { filterMarks } from './mark-filters'
import { MarkListDefaultView } from './mark-list-default-view'
import { MarkListCompactView } from './mark-list-compact-view'
import { MarkListCardView } from './mark-list-card-view'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/enhanced-context-menu"
import { TagMobileActions } from './tag-mobile-actions'
import { useTextSize } from "@/contexts/text-size-context"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Wrapper for AccordionItem that accepts sortable props
function AccordionItemWrapper({ 
  value, 
  children,
  sortableAttributes,
  sortableListeners,
  sortableActivatorRef,
  ...props 
}: any) {
  return (
    <AccordionItem value={value} {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.type === ContextMenu) {
          return React.cloneElement(child as React.ReactElement, {
            children: React.Children.map((child as React.ReactElement).props.children, (contextChild: any) => {
              if (React.isValidElement(contextChild) && contextChild.type === ContextMenuTrigger) {
                return React.cloneElement(contextChild as React.ReactElement, {
                  children: React.Children.map((contextChild as React.ReactElement).props.children, (triggerChild: any) => {
                    // 将 sortable 属性应用到 AccordionTrigger
                    if (React.isValidElement(triggerChild) && triggerChild.type === AccordionTrigger) {
                      return (
                        <div ref={sortableActivatorRef} {...sortableAttributes} {...sortableListeners}>
                          {triggerChild}
                        </div>
                      )
                    }
                    return triggerChild
                  })
                })
              }
              return contextChild
            })
          })
        }
        return child
      })}
    </AccordionItem>
  )
}

// Sortable Tag Item Component
function SortableTagItem({ tag, children }: { tag: Tag; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    setActivatorNodeRef,
  } = useSortable({ id: tag.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // 将拖拽激活器引用传递给子组件
  return (
    <div ref={setNodeRef} style={style}>
      {React.cloneElement(children as React.ReactElement, { 
        sortableAttributes: attributes,
        sortableListeners: listeners,
        sortableActivatorRef: setActivatorNodeRef
      })}
    </div>
  )
}

export function TagManage() {
  const t = useTranslations();
  const { getContextMenuTextSize } = useTextSize()
  const [newTagName, setNewTagName] = React.useState<string>("")
  const [isAdding, setIsAdding] = React.useState(false)
  const [editingTagId, setEditingTagId] = React.useState<number | null>(null)
  const [editingName, setEditingName] = React.useState<string>("")
  const [hasInitialized, setHasInitialized] = React.useState(false)
  const { init } = useChatStore()
  const textSize = getContextMenuTextSize('record')

  // 自定义传感器：使用轻量位移触发，点击不拖拽、移动即可拖拽
  const customPointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 6,
    },
  })

  const sensors = useSensors(
    customPointerSensor,
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const {
    currentTag,
    currentTagId,
    tags,
    fetchTags,
    initTags,
    setCurrentTagId,
    getCurrentTag,
    deleteTag,
  } = useTagStore()

  const {
    marks,
    queues,
    fetchMarks,
    recordFilters,
    recordViewMode,
    hasActiveRecordFilters,
    setVisibleMarkIds,
    pendingScrollMarkId,
    setPendingScrollMarkId,
    highlightedMarkId,
    setHighlightedMarkId,
    expandedRecordTagIds,
    setExpandedRecordTagIds,
  } = useMarkStore()

  const openRecordTag = React.useCallback((tagId: number | string) => {
    const nextTagId = tagId.toString()
    if (expandedRecordTagIds.includes(nextTagId)) return
    setExpandedRecordTagIds([...expandedRecordTagIds, nextTagId])
  }, [expandedRecordTagIds, setExpandedRecordTagIds])

  async function handleAddTag() {
    if (!newTagName.trim()) return
    const res = await insertTag({ name: newTagName.trim() })
    const newTagId = res.lastInsertId as number
    await setCurrentTagId(newTagId)
    await fetchTags()
    getCurrentTag()
    await fetchMarks()
    await init(newTagId)
    setNewTagName("")
    setIsAdding(false)
    // 添加新标签后自动展开
    openRecordTag(newTagId)
  }

  async function handleSelectTag(tag: Tag) {
    await setCurrentTagId(tag.id)
    getCurrentTag()
    await fetchMarks()
    await init(tag.id)
  }

  async function handleDeleteTag(tagId: number) {
    const deletedTagId = tagId.toString()
    const remainingTags = tags.filter(tag => tag.id !== tagId)
    await deleteTag(tagId)
    setExpandedRecordTagIds(expandedRecordTagIds.filter(id => id !== deletedTagId))
    if (currentTagId === tagId && remainingTags[0]) {
      await init(remainingTags[0].id)
    }
    await fetchMarks()
  }

  async function handleRename(tag: Tag) {
    if (!editingName.trim()) return
    await updateTag({ ...tag, name: editingName.trim() })
    await fetchTags()
    getCurrentTag()
    setEditingTagId(null)
    setEditingName("")
  }

  function startEditing(tag: Tag) {
    setEditingTagId(tag.id)
    setEditingName(tag.name)
  }

  // 获取当前标签下的记录
  const getTagMarks = (tagId: number) => {
    return marks.filter(mark => mark.tagId === tagId)
  }

  const filtersActive = hasActiveRecordFilters()

  const getFilteredTagMarks = React.useCallback((tagId: number) => {
    return filterMarks(getTagMarks(tagId), {
      ...recordFilters,
      tagId: 'all',
    })
  }, [marks, recordFilters])

  const getRenderableTagMarks = React.useCallback((tagId: number) => {
    return getFilteredTagMarks(tagId).filter((mark: Mark) => {
      if (mark.type === 'image' || mark.type === 'scan') {
        return !!(mark.content && mark.content.trim() !== '')
      }
      return true
    })
  }, [getFilteredTagMarks])

  const getRenderableTagCount = React.useCallback((tagId: number) => {
    return getRenderableTagMarks(tagId).length
  }, [getRenderableTagMarks])

  const visibleTags = React.useMemo(() => {
    return tags.filter((tag) => {
      if (recordFilters.tagId !== 'all' && tag.id !== recordFilters.tagId) {
        return false
      }

      if (!filtersActive) {
        return true
      }

      const hasQueue = queues.some((queue) => queue.tagId === tag.id)
      return getFilteredTagMarks(tag.id).length > 0 || hasQueue
    })
  }, [filtersActive, getFilteredTagMarks, queues, recordFilters.tagId, tags])

  const visibleMarkIds = React.useMemo(() => {
    return visibleTags.flatMap((tag) => getRenderableTagMarks(tag.id).map((mark: Mark) => mark.id))
  }, [getRenderableTagMarks, visibleTags])

  // 处理拖拽结束
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tags.findIndex((tag) => tag.id === active.id)
      const newIndex = tags.findIndex((tag) => tag.id === over.id)

      const newTags = arrayMove(tags, oldIndex, newIndex)
      
      // 更新本地状态
      const updatedTags = newTags.map((tag, index) => ({
        ...tag,
        sortOrder: index
      }))
      
      // 批量更新数据库
      await updateTagsOrder(updatedTags.map(tag => ({ id: tag.id, sortOrder: tag.sortOrder || 0 })))
      await fetchTags()
    }
  }

  React.useEffect(() => {
    const fetchData = async() => {
      await initTagsDb()
      await fetchTags()
      await initTags()
      await fetchMarks()
    }
    fetchData()
  }, [initTags, fetchTags, fetchMarks])

  // 初始化时展开当前标签（只执行一次）
  React.useEffect(() => {
    if (currentTag && !hasInitialized) {
      setExpandedRecordTagIds([currentTag.id.toString()])
      setHasInitialized(true)
    }
  }, [currentTag, hasInitialized, setExpandedRecordTagIds])

  // 监听刷新事件，展开当前标签
  React.useEffect(() => {
    const handleRefresh = () => {
      if (currentTagId) {
        openRecordTag(currentTagId)
        fetchMarks()
      }
    }
    
    emitter.on(EmitterRecordEvents.refreshMarks, handleRefresh)
    
    return () => {
      emitter.off(EmitterRecordEvents.refreshMarks, handleRefresh)
    }
  }, [currentTagId, fetchMarks, openRecordTag])

  React.useEffect(() => {
    if (!pendingScrollMarkId || !currentTagId || !expandedRecordTagIds.includes(currentTagId.toString())) {
      return
    }

    if (!marks.some((mark) => mark.id === pendingScrollMarkId && mark.tagId === currentTagId)) {
      return
    }

    let cancelled = false
    let attempts = 0
    const maxAttempts = 20

    const scrollToTarget = () => {
      if (cancelled) return

      const target = document.querySelector<HTMLElement>(`[data-mark-id="${pendingScrollMarkId}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedMarkId(pendingScrollMarkId)
        setPendingScrollMarkId(null)
        return
      }

      if (attempts >= maxAttempts) {
        setPendingScrollMarkId(null)
        return
      }

      attempts += 1
      window.setTimeout(scrollToTarget, 50)
    }

    scrollToTarget()

    return () => {
      cancelled = true
    }
  }, [currentTagId, expandedRecordTagIds, marks, pendingScrollMarkId, setHighlightedMarkId, setPendingScrollMarkId])

  React.useEffect(() => {
    if (!highlightedMarkId) {
      return
    }

    const clearHighlightTimer = window.setTimeout(() => {
      setHighlightedMarkId(null)
    }, 3000)

    return () => {
      clearTimeout(clearHighlightTimer)
    }
  }, [highlightedMarkId, setHighlightedMarkId])

  React.useEffect(() => {
    setVisibleMarkIds(visibleMarkIds)
    return () => setVisibleMarkIds([])
  }, [setVisibleMarkIds, visibleMarkIds])

  const renderTagRecords = React.useCallback((tagId: number) => {
    const filteredMarks = getRenderableTagMarks(tagId)

    if (filteredMarks.length === 0 && queues.filter(queue => queue.tagId === tagId).length === 0) {
      return (
        <Empty className="border-0 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle className="text-sm">{t('record.mark.empty')}</EmptyTitle>
            <EmptyDescription className="text-xs">
              {t('record.mark.mark.emptyHint')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    switch (recordViewMode) {
    case 'compact':
      return <MarkListCompactView marks={filteredMarks} />
    case 'cards':
      return <MarkListCardView marks={filteredMarks} />
    case 'list':
    default:
      return <MarkListDefaultView marks={filteredMarks} />
    }
  }, [getRenderableTagMarks, queues, recordViewMode, t])

  return (
    <div className="w-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleTags.map(tag => tag.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* 标签列表 */}
          <Accordion
            type="multiple"
            value={expandedRecordTagIds}
            onValueChange={setExpandedRecordTagIds}
            className="w-full"
          >
            {visibleTags.length === 0 ? (
              <Empty className="border-0 py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm">{t('record.mark.list.emptyFiltered')}</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    {t('record.mark.list.emptyFilteredHint')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : visibleTags.map((tag) => {
              const renderableCount = getRenderableTagCount(tag.id)
              const fallbackTotal = tag.total && tag.total > 0 ? tag.total : ''
              const displayCount = tag.id === currentTagId
                ? (renderableCount > 0 ? renderableCount : '')
                : fallbackTotal
              return (
              <SortableTagItem key={tag.id} tag={tag}>
                <AccordionItemWrapper value={tag.id.toString()}>
                  <ContextMenu>
                    <ContextMenuTrigger>
                      <AccordionTrigger 
                        className={`px-3 py-2 hover:no-underline opacity-50 ${currentTagId === tag.id && 'bg-accent opacity-100'}`}
                        onClick={() => {
                          if (tag.id !== currentTagId) {
                            handleSelectTag(tag)
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 flex-1">
                          {tag.color ? (
                            <span
                              className="inline-block size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                          ) : (
                            currentTagId === tag.id ? 
                            <SquareCheck className="size-3" />:
                            <TagIcon className="size-3" />
                          )}
                          {editingTagId === tag.id ? (
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename(tag)
                                if (e.key === 'Escape') setEditingTagId(null)
                                e.stopPropagation()
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="h-6 text-sm"
                              autoFocus
                            />
                          ) : (
                            <div className="text-xs w-full flex items-center justify-between gap-2">
                              <span className={`flex-1 ${currentTagId === tag.id && 'font-bold'}`}>{tag.name}</span>
                              <span className="text-muted-foreground">
                                {displayCount}
                              </span>
                              <span
                                className="inline-flex items-center justify-center text-muted-foreground/70 cursor-grab active:cursor-grabbing select-none"
                                title="拖动排序"
                              >
                                <GripVertical className="size-3" />
                              </span>
                              <TagMobileActions 
                                tag={tag}
                                onRename={startEditing}
                                onDelete={handleDeleteTag}
                                isEditing={editingTagId === tag.id}
                              />
                            </div>
                          )}
                        </div>
                      </AccordionTrigger>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem disabled={editingTagId === tag.id} onClick={() => startEditing(tag)}>
                        {t('record.mark.tag.rename')}
                      </ContextMenuItem>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <span className="flex items-center gap-2">
                            {tag.color ? (
                              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                            ) : null}
                            标签颜色
                          </span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <div className="grid grid-cols-7 gap-1 p-2">
                            <button
                              type="button"
                              className={`size-5 rounded-full border border-border flex items-center justify-center text-muted-foreground text-[10px] hover:ring-2 hover:ring-ring ${!tag.color ? 'ring-2 ring-ring' : ''}`}
                              onClick={async () => {
                                await updateTagColor(tag.id, null)
                                await fetchTags()
                              }}
                            >
                              ×
                            </button>
                            {TAG_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                className={`size-5 rounded-full hover:ring-2 hover:ring-ring hover:ring-offset-1 ${tag.color === c ? 'ring-2 ring-ring ring-offset-1' : ''}`}
                                style={{ backgroundColor: c }}
                                onClick={async () => {
                                  await updateTagColor(tag.id, c)
                                  await fetchTags()
                                }}
                              />
                            ))}
                          </div>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem disabled={tag.isLocked} onClick={() => handleDeleteTag(tag.id)}>
                        <span className="text-red-600">{t('record.mark.tag.delete')}</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  <AccordionContent className="px-0 pb-0">

                    {/* 显示当前标签的队列（正在处理中的记录） */}
                    {queues.filter(queue => queue.tagId === tag.id).map((queue) => (
                      <MarkLoading key={queue.queueId} mark={queue} />
                    ))}

                    {/* 图片画廊 - 显示当前标签下所有无内容的图片 */}
                    <ImageGallery marks={getFilteredTagMarks(tag.id)} />
                    
                    {/* 显示已完成的记录 - 过滤掉没有内容的图片记录 */}
                    {renderTagRecords(tag.id)}
                  </AccordionContent>
                </AccordionItemWrapper>
              </SortableTagItem>
              )
            })}
          </Accordion>
        </SortableContext>
      </DndContext>

      {/* 添加标签 */}
      <div className="p-2">
        {isAdding ? (
          <div className="flex gap-2">
            <Input
              placeholder={t('record.mark.tag.newTagPlaceholder')}
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTag()
                if (e.key === 'Escape') {
                  setIsAdding(false)
                  setNewTagName("")
                }
              }}
              className={`h-8 text-${textSize}`}
              autoFocus
            />
            <Button size="sm" onClick={handleAddTag} className={`h-8 text-${textSize}`}>
              {t('record.mark.tag.add')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
            className={`w-full h-8 text-${textSize}`}
          >
            <Plus className="size-3 mr-1" />
            {t('record.mark.tag.newTag')}
          </Button>
        )}
      </div>
    </div>
  )
}
