'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Tag, Trash2 } from 'lucide-react'
import { useKnowledgeGraphTagsStore } from '@/stores/knowledge-graph-tags'
import {
  getNoteGenFilePointerDragDetail,
  isPointInsideElement,
  NOTE_GEN_FILE_POINTER_DRAG_EVENT,
} from '@/lib/file-pointer-drag'
import {
  appendUniqueGraphTagQuery,
  getGraphTagNameFromPath,
  parseGraphTagDrop,
} from '@/lib/knowledge-graph-tags'

export function KnowledgeGraphTagsPanel() {
  const { tagGroups, initTagGroups, addTagGroup, updateTagGroup, removeTagGroup } = useKnowledgeGraphTagsStore()
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [dropTarget, setDropTarget] = useState<'new' | string | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const newDropRef = useRef<HTMLDivElement | null>(null)
  const groupDropRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    initTagGroups()
  }, [initTagGroups])

  const handleAddTagGroup = useCallback(() => {
    const group = addTagGroup(name, query)
    if (!group) return
    setName('')
    setQuery('')
  }, [addTagGroup, name, query])

  const applyDropToDraft = useCallback((path: string) => {
    setQuery(current => appendUniqueGraphTagQuery(current, path))
    setName(current => current.trim() ? current : getGraphTagNameFromPath(path))
  }, [])

  const handleNewDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDropTarget(null)

    const resource = parseGraphTagDrop(event.dataTransfer)
    if (!resource?.path) return
    applyDropToDraft(resource.path)
  }, [applyDropToDraft])

  const handleExistingDrop = useCallback((event: React.DragEvent<HTMLDivElement>, id: string, currentQuery: string) => {
    event.preventDefault()
    setDropTarget(null)

    const resource = parseGraphTagDrop(event.dataTransfer)
    if (!resource?.path) return
    updateTagGroup(id, {
      query: appendUniqueGraphTagQuery(currentQuery, resource.path),
    })
  }, [updateTagGroup])

  useEffect(() => {
    if (!isExpanded) return

    function resolvePointerDropTarget(x: number, y: number) {
      if (isPointInsideElement(newDropRef.current, x, y)) return 'new' as const
      for (const group of tagGroups) {
        if (isPointInsideElement(groupDropRefs.current[group.id] || null, x, y)) {
          return group.id
        }
      }
      return null
    }

    function handleFilePointerDrag(event: Event) {
      const detail = getNoteGenFilePointerDragDetail(event)
      if (!detail?.path || detail.isDirectory) return

      const target = resolvePointerDropTarget(detail.x, detail.y)
      if (detail.phase === 'start' || detail.phase === 'move') {
        setDropTarget(target)
        return
      }

      setDropTarget(null)
      if (detail.phase !== 'end' || !target) return

      if (target === 'new') {
        applyDropToDraft(detail.path)
        return
      }

      const group = tagGroups.find(item => item.id === target)
      if (!group) return
      updateTagGroup(group.id, {
        query: appendUniqueGraphTagQuery(group.query, detail.path),
      })
    }

    window.addEventListener(NOTE_GEN_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
    return () => {
      window.removeEventListener(NOTE_GEN_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
      setDropTarget(null)
    }
  }, [applyDropToDraft, isExpanded, tagGroups, updateTagGroup])

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-background">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <div className="flex min-w-0 items-center gap-1.5">
          <Tag className="size-3.5 text-muted-foreground" />
          <span>标签</span>
        </div>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
          {tagGroups.length} 组
        </span>
      </button>

      {isExpanded ? <div className="p-1.5">
        <div
          ref={newDropRef}
          className={`rounded-md border border-dashed p-2 transition-colors ${dropTarget === 'new' ? 'border-foreground/50 bg-muted/45' : 'border-border/70 bg-muted/10'}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDropTarget('new')
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={handleNewDrop}
        >
          <div className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-1.5">
            <label className="sr-only" htmlFor="new-tag-name">标签名</label>
            <input
              id="new-tag-name"
              value={name}
              placeholder="标签名"
              onChange={event => setName(event.target.value)}
              className="h-7 min-w-0 rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-foreground/70"
            />
            <label className="sr-only" htmlFor="new-tag-query">关联文章</label>
            <input
              id="new-tag-query"
              value={query}
              placeholder="拖入文章/关键词"
              onChange={event => setQuery(event.target.value)}
              className="h-7 min-w-0 rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-foreground/70"
            />
            <button
              type="button"
              className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground transition hover:bg-muted active:scale-[0.98]"
              title="添加标签"
              onClick={handleAddTagGroup}
            >
              <Plus className="size-3.5" />
              添加
            </button>
          </div>
        </div>

        {tagGroups.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {tagGroups.map(group => (
              <div
                key={group.id}
                ref={(node) => {
                  groupDropRefs.current[group.id] = node
                }}
                className={`group rounded-md border px-2 py-1.5 transition-colors ${dropTarget === group.id ? 'border-foreground/50 bg-muted/45' : 'border-border/60 bg-background hover:bg-muted/35'}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropTarget(group.id)
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => handleExistingDrop(event, group.id, group.query)}
              >
                <div className="flex items-center gap-1.5">
                  <Tag className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={group.name}
                    aria-label="标签名"
                    onChange={event => updateTagGroup(group.id, { name: event.target.value })}
                    className="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs font-medium text-foreground outline-none"
                  />
                  <button
                    type="button"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="删除标签组"
                    onClick={() => removeTagGroup(group.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <input
                  value={group.query}
                  aria-label="关联文章"
                  onChange={event => updateTagGroup(group.id, { query: event.target.value })}
                  placeholder="拖入文章/关键词"
                  className="mt-0.5 h-6 w-full rounded border border-transparent bg-transparent px-5 text-[11px] text-muted-foreground outline-none transition-colors hover:border-border/60 hover:bg-background focus:border-foreground/60 focus:bg-background focus:text-foreground"
                />
              </div>
            ))}
          </div>
        ) : null}
      </div> : null}
    </section>
  )
}
