'use client'

import { Editor } from '@tiptap/react'
import { ListTree } from 'lucide-react'
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

function OutlineItems({
  headings,
  activeHeadingId,
  onSelect,
}: {
  headings: HeadingItem[]
  activeHeadingId: string | null
  onSelect: (id: string) => void
}) {
  return headings.length === 0 ? (
    <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
      暂无标题
    </div>
  ) : (
    <ul className="space-y-0.5 px-3 pb-5">
      {headings.map((heading) => {
        const active = activeHeadingId === heading.id
        const level = Math.min(Math.max(heading.level, 1), 6)

        return (
          <li key={heading.id}>
            <button
              id={`outline-${heading.id}`}
              onClick={() => onSelect(heading.id)}
              className={cn(
                'group relative flex h-9 w-full min-w-0 items-center rounded-md pr-2 text-left text-[15px] transition-colors',
                'hover:bg-muted/60',
                level === 1 && 'font-semibold',
                level > 1 && 'text-[hsl(var(--muted-foreground))]',
                level >= 4 && 'text-sm',
                active && 'bg-transparent !text-[#1677ff]',
              )}
              style={{ paddingLeft: `${(level - 1) * 16 + 12}px` }}
              title={heading.text}
            >
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-transparent',
                  active && 'bg-[#1677ff]',
                )}
              />
              <span className={getOutlineHeadingTextClass()}>{heading.text}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
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
  const t = useTranslations('editor')
  // Use ref to always get latest headings in event handlers
  const headingsRef = useRef<HeadingItem[]>([])
  // Track if editor is ready - use both ref and state
  const isEditorReadyRef = useRef(false)
  const [isReady, setIsReady] = useState(false)

  const getEditorScrollContainer = useCallback(() => {
    const editorElement = editor?.view?.dom as HTMLElement | undefined
    if (!editorElement) return null

    return editorElement.closest('.overflow-y-auto') as HTMLElement | null
      || editorElement.parentElement
  }, [editor])

  // Check if editor is ready - wait for view to be available
  useEffect(() => {
    if (!editor) {
      isEditorReadyRef.current = false
      return
    }

    // Check periodically if editor view is available
    const checkEditor = () => {
      // Check if editor is destroyed
      if (!editor || (editor as any).isDestroyed) {
        isEditorReadyRef.current = false
        return
      }

      // Check if editor view is ready
      if (editor.view && editor.view.dom && editor.view.dom.isConnected) {
        // Additional check: ensure DOM is actually mounted
        try {
          // This will throw if not ready
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

  // Keep ref in sync with state
  useEffect(() => {
    headingsRef.current = headings
  }, [headings])

  // Extract headings from the editor with position info
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
        // Use index to create stable ID that doesn't depend on position
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

  // Find the active heading based on cursor position
  const findActiveHeading = useCallback((cursorPos: number): string | null => {
    if (headings.length === 0) return null

    for (let i = headings.length - 1; i >= 0; i--) {
      const heading = headings[i]
      if (cursorPos >= heading.pos) {
        return heading.id
      }
    }

    // If cursor is before the first heading, find the first heading that comes after cursor
    if (cursorPos < headings[0]?.pos) {
      for (const heading of headings) {
        if (heading.pos >= cursorPos) {
          return heading.id
        }
      }
    }

    return headings[0]?.id || null
  }, [headings])

  // Update headings when editor content changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) {
      return
    }

    // Initial extraction
    try {
      setHeadings(extractHeadings())
    } catch (e) {
      console.error('[Outline] Error in extractHeadings:', e)
    }

    // Listen to editor update events to keep headings in sync
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

  // Find active heading based on scroll position (viewport)
  const findActiveHeadingByScroll = useCallback((): string | null => {
    // Check if editor is fully initialized - use isEditorReadyRef
    if (!isEditorReadyRef.current || headings.length === 0) return null

    const scrollContainer = getEditorScrollContainer()
    if (!scrollContainer) return headings[0]?.id || null

    const scrollTop = scrollContainer.scrollTop
    const viewportTop = scrollTop + 100 // Add some offset for better UX
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

  // Update active heading when selection or scroll changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const updateActiveHeading = () => {
      const activeId = resolveActiveHeading('selection')
      setActiveHeadingId(activeId)
    }

    // Handle scroll - update based on viewport position
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

  // When outline opens (especially hover panel), re-sync active heading by viewport first.
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

  // Scroll to heading when clicked
  const scrollToHeading = useCallback((id: string) => {
    // Use ref to get latest headings to avoid stale closure
    const currentHeadings = headingsRef.current
    const heading = currentHeadings.find(h => h.id === id)
    if (heading && editor) {
      const targetPos = Math.min(heading.pos + 1, editor.state.doc.content.size)

      // First, focus the editor to ensure it can receive commands
      editor.commands.focus()

      // Then set the selection inside the heading, not before the heading node.
      editor.commands.setTextSelection(targetPos)

      requestAnimationFrame(() => {
        scrollHeadingIntoView(heading)
        setActiveHeadingId(heading.id)
      })

      onHeadingSelect?.()
    }
  }, [editor, onHeadingSelect, scrollHeadingIntoView])

  // Auto-scroll to keep active heading visible
  useEffect(() => {
    if (activeHeadingId) {
      const activeElement = document.getElementById(`outline-${activeHeadingId}`)
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [activeHeadingId])

  // 如果编辑器还没准备好或没有打开Outline，直接返回 null
  if (!isOpen || !isReady) return null

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
          <div className="overflow-y-auto px-1 pb-4">
            <OutlineItems
              headings={headings}
              activeHeadingId={activeHeadingId}
              onSelect={scrollToHeading}
            />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div className={getOutlinePanelClass(position, floating)}>
      <div className="flex h-full min-h-0 flex-col bg-background/95 shadow-lg backdrop-blur">
        <div className="flex h-11 shrink-0 items-center gap-2 px-4 text-[13px] font-medium text-[hsl(var(--muted-foreground))]">
          <ListTree className="h-4 w-4" />
          <span>{t('outline.title')}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto outline-panel-scroll">
          <OutlineItems
            headings={headings}
            activeHeadingId={activeHeadingId}
            onSelect={scrollToHeading}
          />
        </div>
      </div>
    </div>
  )
}

export default Outline
