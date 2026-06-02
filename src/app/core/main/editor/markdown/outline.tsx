'use client'

import { Editor } from '@tiptap/react'
import { ListTree, Search, GripVertical } from 'lucide-react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { getOutlineHeadingTextClass, getOutlinePanelClass } from '@/lib/outline-styles'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useTranslations } from 'next-intl'

interface HeadingItem {
  level: number
  text: string
  id: string
  pos: number
  nodeSize: number
}

interface OutlineProps {
  editor: Editor
  isOpen: boolean
  position?: 'left' | 'right'
  floating?: boolean
  variant?: 'panel' | 'drawer'
  onHeadingSelect?: () => void
}

const HEADING_SCROLL_OFFSET = 88

function isImplicitOutlineHeading(text: string): boolean {
  const trimmed = text.trim()

  if (
    !trimmed ||
    trimmed.length > 90 ||
    trimmed.includes('|') ||
    /[。；;:]$/.test(trimmed)
  ) {
    return false
  }

  return /^(?:第?[一二三四五六七八九十百千万]+[章节部分]?|[0-9]{1,2})[、．.]\s*\S/.test(trimmed)
}

export function Outline({
  editor,
  isOpen,
  position = 'right',
  floating = false,
  variant = 'panel',
  onHeadingSelect,
}: OutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [maxFilterLevel, setMaxFilterLevel] = useState<number>(6) // 默认显示全部层级 (1-6)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  
  const t = useTranslations('editor')
  const headingsRef = useRef<HeadingItem[]>([])
  const isEditorReadyRef = useRef(false)
  const [isReady, setIsReady] = useState(false)

  const getEditorScrollContainer = useCallback(() => {
    const editorElement = editor?.view?.dom as HTMLElement | undefined
    if (!editorElement) return null

    return editorElement.closest('.overflow-y-auto') as HTMLElement | null
      || editorElement.parentElement
  }, [editor])

  // 检测编辑器是否就绪
  useEffect(() => {
    if (!editor) {
      isEditorReadyRef.current = false
      return
    }

    const checkEditor = () => {
      if (!editor || (editor as any).isDestroyed) {
        isEditorReadyRef.current = false
        return
      }

      if (editor.view && editor.view.dom && editor.view.dom.isConnected) {
        try {
          editor.view.dom.getBoundingClientRect()
          isEditorReadyRef.current = true
          setIsReady(true)
        } catch {
          isEditorReadyRef.current = false
          setIsReady(false)
          setTimeout(checkEditor, 50)
          return
        }
      } else {
        isEditorReadyRef.current = false
        setIsReady(false)
        setTimeout(checkEditor, 50)
      }
    }

    checkEditor()
  }, [editor])

  useEffect(() => {
    headingsRef.current = headings
  }, [headings])

  // 从文档树中提取 heading 和隐式标题
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const items: HeadingItem[] = []
    const fallbackItems: HeadingItem[] = []
    let index = 0
    let fallbackIndex = 0

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level
        const text = node.textContent.trim() || `Heading ${level}`
        const id = `heading-${index}-${level}-${text.slice(0, 20)}`
        const nodeSize = node.nodeSize
        items.push({
          level,
          text,
          id,
          pos,
          nodeSize,
        })
        index++
      }

      if (node.type.name === 'paragraph') {
        const text = node.textContent.trim()

        if (isImplicitOutlineHeading(text)) {
          fallbackItems.push({
            level: 2,
            text,
            id: `implicit-heading-${fallbackIndex}-${text.slice(0, 20)}`,
            pos,
            nodeSize: node.nodeSize,
          })
          fallbackIndex++
        }
      }
    })

    return items.length > 0 ? items : fallbackItems
  }, [editor])

  // ProseMirror 级别的 Heading 及其下属段落节点块拖拽移动逻辑
  const moveHeadingNode = useCallback((sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || !editor) return

    const currentHeadings = headingsRef.current
    const sourceHeading = currentHeadings[sourceIndex]
    const targetHeading = currentHeadings[targetIndex]

    if (!sourceHeading || !targetHeading) return

    // 1. 算出源 Heading 的内容块范围：[sourceStart, sourceEnd]
    // 范围直至下一个同级或更高层级 Heading 之前，或是文档末尾
    const sourceStart = sourceHeading.pos
    let sourceEnd = editor.state.doc.content.size

    for (let i = sourceIndex + 1; i < currentHeadings.length; i++) {
      if (currentHeadings[i].level <= sourceHeading.level) {
        sourceEnd = currentHeadings[i].pos
        break
      }
    }

    // 2. 剪切该范围的文档片段
    const slice = editor.state.doc.slice(sourceStart, sourceEnd)
    
    // 3. 执行 Prosemirror 事务：先删除，再映射目标，最后插入
    let tr = editor.state.tr.delete(sourceStart, sourceEnd)
    
    // 4. 计算删除内容后的目标位置映射
    const mappedTargetPos = tr.mapping.map(targetHeading.pos)

    // 5. 插入切片
    tr = tr.insert(mappedTargetPos, slice.content)
    editor.view.dispatch(tr)
    
    // 6. 重新聚焦编辑器并重置拖拽高亮状态
    editor.commands.focus()
    setDragOverIndex(null)
  }, [editor])

  // 依据光标位置获取激活的标题
  const findActiveHeading = useCallback((cursorPos: number): string | null => {
    if (headings.length === 0) return null

    for (let i = headings.length - 1; i >= 0; i--) {
      const heading = headings[i]
      if (cursorPos >= heading.pos) {
        return heading.id
      }
    }

    if (cursorPos < headings[0]?.pos) {
      for (const heading of headings) {
        if (heading.pos >= cursorPos) {
          return heading.id
        }
      }
    }

    return headings[0]?.id || null
  }, [headings])

  useEffect(() => {
    if (!editor || !editor.view || !editor.view.dom) return

    try {
      setHeadings(extractHeadings())
    } catch (e) {
      console.error('[Outline] Error in extractHeadings:', e)
    }

    const handleUpdate = () => {
      try {
        setHeadings(extractHeadings())
      } catch (e) {
        console.error('[Outline] Error in extractHeadings on update:', e)
      }
    }

    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
    }
  }, [editor, extractHeadings])

  const findActiveHeadingByScroll = useCallback((): string | null => {
    if (!isEditorReadyRef.current || headings.length === 0) return null

    const scrollContainer = getEditorScrollContainer()
    if (!scrollContainer) return headings[0]?.id || null

    const scrollTop = scrollContainer.scrollTop
    const viewportTop = scrollTop + 100
    const containerRect = scrollContainer.getBoundingClientRect()
    let activeId: string | null = null

    for (const heading of headings) {
      const domNode = editor.view.nodeDOM(heading.pos) as HTMLElement | undefined
      if (domNode) {
        const rect = domNode.getBoundingClientRect()
        const relativeTop = rect.top - containerRect.top + scrollTop

        if (relativeTop <= viewportTop) {
          activeId = heading.id
        } else {
          break
        }
      }
    }

    return activeId || headings[0]?.id || null
  }, [editor, getEditorScrollContainer, headings])

  const resolveActiveHeading = useCallback((source: 'selection' | 'viewport' = 'viewport'): string | null => {
    if (headings.length === 0) return null

    const { from } = editor.state.selection
    const scrollActiveId = findActiveHeadingByScroll()
    const cursorActiveId = findActiveHeading(from)

    if (source === 'selection') {
      if (editor.view.hasFocus()) {
        return cursorActiveId || scrollActiveId || headings[0]?.id || null
      }
      return scrollActiveId || cursorActiveId || headings[0]?.id || null
    }

    return scrollActiveId || cursorActiveId || headings[0]?.id || null
  }, [editor, findActiveHeading, findActiveHeadingByScroll, headings])

  useEffect(() => {
    if (!editor || !editor.view || !editor.view.dom) return

    const updateActiveHeading = () => {
      const activeId = resolveActiveHeading('selection')
      setActiveHeadingId(activeId)
    }

    const handleScroll = () => {
      const scrollActiveId = resolveActiveHeading('viewport')
      if (scrollActiveId) {
        setActiveHeadingId(scrollActiveId)
      }
    }

    handleScroll()
    editor.on('selectionUpdate', updateActiveHeading)
    editor.on('transaction', updateActiveHeading)

    const scrollContainer = getEditorScrollContainer()
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      editor.off('selectionUpdate', updateActiveHeading)
      editor.off('transaction', updateActiveHeading)
      scrollContainer?.removeEventListener('scroll', handleScroll)
    }
  }, [editor, getEditorScrollContainer, resolveActiveHeading])

  useEffect(() => {
    if (!isOpen) return

    const raf = requestAnimationFrame(() => {
      setActiveHeadingId(resolveActiveHeading('viewport'))
    })

    return () => cancelAnimationFrame(raf)
  }, [isOpen, resolveActiveHeading])

  const scrollHeadingIntoView = useCallback((heading: HeadingItem) => {
    const scrollContainer = getEditorScrollContainer()
    const headingElement = editor.view.nodeDOM(heading.pos) as HTMLElement | null

    if (!scrollContainer || !headingElement) {
      editor.commands.scrollIntoView()
      return
    }

    const containerRect = scrollContainer.getBoundingClientRect()
    const headingRect = headingElement.getBoundingClientRect()
    const targetTop = scrollContainer.scrollTop + headingRect.top - containerRect.top - HEADING_SCROLL_OFFSET

    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    })
  }, [editor, getEditorScrollContainer])

  const scrollToHeading = useCallback((id: string) => {
    const currentHeadings = headingsRef.current
    const heading = currentHeadings.find(h => h.id === id)
    if (heading && editor) {
      const targetPos = Math.min(heading.pos + 1, editor.state.doc.content.size)
      editor.commands.focus()
      editor.commands.setTextSelection(targetPos)

      requestAnimationFrame(() => {
        scrollHeadingIntoView(heading)
        setActiveHeadingId(heading.id)
      })

      onHeadingSelect?.()
    }
  }, [editor, onHeadingSelect, scrollHeadingIntoView])

  useEffect(() => {
    if (activeHeadingId) {
      const activeElement = document.getElementById(`outline-${activeHeadingId}`)
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [activeHeadingId])

  if (!isOpen || !isReady) return null

  // 1. 进行大纲模糊过滤和按 H1/H2 等层级过滤计算
  const filteredHeadings = headings.filter((h) => {
    const matchSearch = h.text.toLowerCase().includes(searchQuery.toLowerCase())
    const matchLevel = h.level <= maxFilterLevel
    return matchSearch && matchLevel
  })

  // 渲染大纲树的核心条目
  const OutlineList = () => (
    filteredHeadings.length === 0 ? (
      <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        暂无匹配标题
      </div>
    ) : (
      <ul className="space-y-1.5 px-3 pb-5">
        {filteredHeadings.map((heading) => {
          // 获取原始 headings 里的绝对索引值，用于 ProseMirror 移动计算
          const absoluteIndex = headings.findIndex((h) => h.id === heading.id)
          const active = activeHeadingId === heading.id
          const level = Math.min(Math.max(heading.level, 1), 6)

          return (
            <li 
              key={heading.id}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(absoluteIndex))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverIndex(absoluteIndex)
              }}
              onDragLeave={() => {
                setDragOverIndex(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'), 10)
                moveHeadingNode(sourceIdx, absoluteIndex)
              }}
              className={cn(
                "relative group/item rounded-md transition-all duration-200",
                dragOverIndex === absoluteIndex && "border-t-2 border-primary bg-primary/5 pt-1.5"
              )}
            >
              <button
                id={`outline-${heading.id}`}
                onClick={() => scrollToHeading(heading.id)}
                className={cn(
                  'relative flex h-8 w-full min-w-0 items-center rounded-md pr-2 text-left text-[14px] transition-colors',
                  'hover:bg-muted/70',
                  level === 1 && 'font-semibold text-foreground',
                  level > 1 && 'text-[hsl(var(--muted-foreground))]',
                  level >= 4 && 'text-xs',
                  active && 'bg-primary/5 !text-primary font-medium',
                )}
                style={{ paddingLeft: `${(level - 1) * 12 + 20}px` }}
                title={heading.text}
              >
                {/* 拖拽手柄，仅悬浮时可见 */}
                <span className="absolute left-1.5 opacity-0 group-hover/item:opacity-40 transition-opacity cursor-grab">
                  <GripVertical size={11} />
                </span>

                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-transparent',
                    active && 'bg-primary',
                  )}
                />
                <span className={getOutlineHeadingTextClass()}>{heading.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  )

  if (variant === 'drawer') {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => {
        if (!open) {
          onHeadingSelect?.()
        }
      }}>
        <DrawerContent className="max-h-[80vh] rounded-t-[24px]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{t('outline.title')}</DrawerTitle>
          </DrawerHeader>
          
          {/* 大纲过滤与搜索框 */}
          <div className="px-4 py-2 space-y-2 border-b border-border/40">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/65 border rounded-lg">
              <Search size={13} className="text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索文档结构..."
                className="flex-1 text-xs bg-transparent outline-none border-none"
              />
            </div>
          </div>

          <div className="overflow-y-auto px-1 pb-4 mt-2">
            <OutlineList />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div className={getOutlinePanelClass(position, floating)}>
      <div className="flex h-full min-h-0 flex-col bg-background/95 shadow-lg backdrop-blur">
        
        {/* 大纲标题头部 */}
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-4 border-b border-border/40">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <ListTree className="h-4 w-4 text-primary" />
            <span>{t('outline.title')}</span>
          </div>
          
          {/* 大纲级别快速过滤按钮 */}
          <div className="flex items-center gap-1 border border-border/80 rounded-md p-[2px] bg-muted/30">
            <button
              onClick={() => setMaxFilterLevel(2)}
              className={cn(
                "px-1.5 py-[2px] text-[10px] rounded transition-all font-mono",
                maxFilterLevel === 2 ? "bg-background text-primary shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
              title="仅展示 H1-H2 结构"
            >
              H2
            </button>
            <button
              onClick={() => setMaxFilterLevel(6)}
              className={cn(
                "px-1.5 py-[2px] text-[10px] rounded transition-all font-mono",
                maxFilterLevel === 6 ? "bg-background text-primary shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
              title="展示所有结构"
            >
              ALL
            </button>
          </div>
        </div>

        {/* 大纲顶部模糊过滤搜索框 */}
        <div className="px-3.5 py-2.5 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 hover:bg-muted/85 border border-border/60 rounded-lg transition-colors group">
            <Search size={12} className="text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索结构大纲..."
              className="flex-1 text-[11px] bg-transparent outline-none border-none placeholder:text-muted-foreground/80"
            />
          </div>
        </div>

        {/* 允许滚动的大纲列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto outline-panel-scroll mt-2">
          <OutlineList />
        </div>
      </div>
    </div>
  )
}

export default Outline
