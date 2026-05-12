'use client'

import { type Editor } from '@tiptap/react'
import {
  Braces,
  ChevronRight,
  CheckSquare,
  Image as ImageIcon,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Plus,
  Quote,
  Table as TableIcon,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { handleImageUpload } from '@/lib/image-handler'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'

const MENU_WIDTH = 204
const MENU_MAX_HEIGHT = 360
const VIEWPORT_MARGIN = 8
const TRIGGER_SIZE = 28
const FLOATING_GAP = 8
const TABLE_PICKER_ROWS = 8
const TABLE_PICKER_COLS = 8
const TABLE_PICKER_CELL_SIZE = 19
const TABLE_PICKER_CELL_GAP = 4
const TABLE_PICKER_WIDTH = 216
const TABLE_PICKER_HEIGHT = 230
const LINK_DIALOG_WIDTH = 520
const LINK_DIALOG_HEIGHT = 184
const DEFAULT_TABLE_SIZE = { rows: 3, cols: 3 }

type MenuPosition = {
  targetPos: number
  context: EmptyTextblockContext
  buttonTop: number
  buttonLeft: number
  menuTop: number
  menuLeft: number
  highlightTop: number
  highlightLeft: number
  highlightWidth: number
  highlightHeight: number
}

type BlockAction = {
  key: string
  label: string
  icon: ReactNode
  active?: boolean
  iconBox?: string
  iconTone?: string
  trailing?: ReactNode
  command: () => void
}

type TableSize = {
  rows: number
  cols: number
}

type FloatingPanelPosition = {
  top: number
  left: number
}

type EmptyTextblockContext = 'root' | 'tableCell'

type EmptyTextblockInfo = {
  pos: number
  context: EmptyTextblockContext
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getSelectedPathName(path: string) {
  return path.split(/[\\/]/).pop() || 'file'
}

function toFileUrl(path: string) {
  return encodeURI(`file:///${path.replace(/\\/g, '/')}`)
}

function createLinkText(text: string, href: string) {
  return {
    type: 'text',
    text,
    marks: [
      {
        type: 'link',
        attrs: { href },
      },
    ],
  }
}

function DividerIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5 text-foreground"
    >
      <path d="M4 6H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 3" opacity="0.72" />
      <path d="M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 14H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 3" opacity="0.72" />
    </svg>
  )
}

function normalizeLinkHref(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(https?:|mailto:|tel:|file:|#|\/)/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function TablePicker({
  size,
  label,
  onHover,
  onInsert,
}: {
  size: TableSize
  label: string
  onHover: (size: TableSize) => void
  onInsert: (size: TableSize) => void
}) {
  const cells = Array.from({ length: TABLE_PICKER_ROWS * TABLE_PICKER_COLS })

  return (
    <div
      className="pointer-events-auto rounded-lg border border-gray-200 bg-white p-2.5 text-gray-950 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
      style={{ width: TABLE_PICKER_WIDTH }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10">
          {size.rows} x {size.cols}
        </span>
      </div>
      <div
        className="grid justify-center"
        style={{
          gridTemplateColumns: `repeat(${TABLE_PICKER_COLS}, ${TABLE_PICKER_CELL_SIZE}px)`,
          gap: TABLE_PICKER_CELL_GAP,
        }}
      >
        {cells.map((_, index) => {
          const row = Math.floor(index / TABLE_PICKER_COLS) + 1
          const col = (index % TABLE_PICKER_COLS) + 1
          const selected = row <= size.rows && col <= size.cols

          return (
            <button
              key={`${row}-${col}`}
              type="button"
              className={cn(
                'rounded border transition-colors',
                selected
                  ? 'border-emerald-500 bg-emerald-100 shadow-sm dark:bg-emerald-500/25'
                  : 'border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-emerald-500/15'
              )}
              style={{ width: TABLE_PICKER_CELL_SIZE, height: TABLE_PICKER_CELL_SIZE }}
              title={`${row} x ${col}`}
              onMouseEnter={() => onHover({ rows: row, cols: col })}
              onClick={() => onInsert({ rows: row, cols: col })}
            />
          )
        })}
      </div>
    </div>
  )
}

function getElementAtPos(editor: Editor, pos: number) {
  const domAtPos = editor.view.domAtPos(pos)
  const node = domAtPos.node

  return node instanceof HTMLElement ? node : node.parentElement
}

function getTableCellElementAtPos(editor: Editor, pos: number) {
  return getElementAtPos(editor, pos)?.closest('td, th') as HTMLElement | null
}

function getResolvedEmptyTextblockInfo(editor: Editor, pos: number): EmptyTextblockInfo | null {
  const $from = editor.state.doc.resolve(pos)
  const parentName = $from.parent.type.name
  const isSupportedTextblock = parentName === 'paragraph' || parentName === 'heading'
  if (!isSupportedTextblock || $from.parent.content.size > 0) return null

  let context: EmptyTextblockContext = 'root'

  for (let depth = 0; depth <= $from.depth; depth += 1) {
    const nodeName = $from.node(depth).type.name
    if (nodeName === 'tableCell' || nodeName === 'tableHeader') {
      context = 'tableCell'
      continue
    }
    if (['listItem', 'taskItem', 'codeBlock'].includes(nodeName)) {
      return null
    }
  }

  return {
    pos: $from.start($from.depth),
    context,
  }
}

function getEditableEmptyTextblockInfo(editor: Editor, pos: number) {
  const { doc } = editor.state
  const safePos = clamp(pos, 0, doc.content.size)
  const candidatePositions = [safePos, safePos + 1, safePos - 1]

  for (const candidate of candidatePositions) {
    if (candidate < 0 || candidate > doc.content.size) continue
    const emptyLineInfo = getResolvedEmptyTextblockInfo(editor, candidate)
    if (emptyLineInfo !== null) return emptyLineInfo
  }

  return null
}

function getSelectionEmptyTextblockInfo(editor: Editor) {
  const { selection } = editor.state
  if (!selection.empty) return null
  return getEditableEmptyTextblockInfo(editor, selection.from)
}

function isTrailingRootEmptyTextblock(editor: Editor, info: EmptyTextblockInfo) {
  if (info.context !== 'root') return false

  const { doc } = editor.state
  const $pos = doc.resolve(info.pos)
  const topLevelIndex = $pos.index(0)
  if (topLevelIndex < 0 || topLevelIndex >= doc.childCount) return false

  // Treat a run of trailing empty root paragraphs as the default blank tail.
  for (let index = topLevelIndex; index < doc.childCount; index += 1) {
    const node = doc.child(index)
    if (node.type.name !== 'paragraph' || node.content.size > 0) {
      return false
    }
  }

  const depth = $pos.depth
  const parent = $pos.parent
  if (parent.type.name !== 'paragraph') return false

  return $pos.end(depth) >= doc.content.size - 1
}

function shouldSuppressDefaultTrailingPosition(
  editor: Editor,
  position: Pick<MenuPosition, 'targetPos' | 'context'> | null
) {
  if (!position) return false
  return isTrailingRootEmptyTextblock(editor, {
    pos: position.targetPos,
    context: position.context,
  })
}

function getEmptyLineRect(
  editor: Editor,
  emptyLinePos: number,
  fallbackCoords: { top: number; bottom: number; left: number },
  editorBounds: DOMRect
) {
  const node = editor.view.nodeDOM(Math.max(0, emptyLinePos - 1))

  if (node instanceof HTMLElement) {
    const rect = node.getBoundingClientRect()
    if (rect.height > 0) {
      return {
        top: rect.top,
        left: rect.left,
        right: editorBounds.right - 12,
        height: rect.height,
      }
    }
  }

  return {
    top: fallbackCoords.top,
    left: fallbackCoords.left,
    right: editorBounds.right - 12,
    height: Math.max(fallbackCoords.bottom - fallbackCoords.top, 24),
  }
}

function getMenuPosition(editor: Editor, targetPos: number): MenuPosition | null {
  const emptyLineInfo = getEditableEmptyTextblockInfo(editor, targetPos)
  if (emptyLineInfo === null) return null
  const emptyLinePos = emptyLineInfo.pos

  const coords = editor.view.coordsAtPos(emptyLinePos)
  const editorBounds = editor.view.dom.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxButtonTop = Math.max(VIEWPORT_MARGIN, viewportHeight - TRIGGER_SIZE - VIEWPORT_MARGIN)
  const maxButtonLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - TRIGGER_SIZE - VIEWPORT_MARGIN)
  const lineRect = getEmptyLineRect(editor, emptyLinePos, coords, editorBounds)
  const lineHeight = Math.max(lineRect.height, 24)
  const highlightHeight = clamp(lineHeight, 24, 30)
  const cellElement = emptyLineInfo.context === 'tableCell'
    ? getTableCellElementAtPos(editor, emptyLinePos)
    : null
  const cellRect = cellElement?.getBoundingClientRect()
  const preferredHighlightLeft = cellRect
    ? cellRect.left + 8
    : lineRect.left
  const preferredHighlightRight = cellRect
    ? cellRect.right - 8
    : editorBounds.right - 12
  const highlightLeft = clamp(preferredHighlightLeft, VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN)
  const highlightRight = clamp(preferredHighlightRight, highlightLeft + 40, viewportWidth - VIEWPORT_MARGIN)
  const maxHighlightTop = Math.max(VIEWPORT_MARGIN, viewportHeight - highlightHeight - VIEWPORT_MARGIN)
  const highlightTop = clamp(lineRect.top + (lineHeight - highlightHeight) / 2, VIEWPORT_MARGIN, maxHighlightTop)

  const buttonTop = clamp(
    highlightTop + highlightHeight / 2 - TRIGGER_SIZE / 2,
    VIEWPORT_MARGIN,
    maxButtonTop
  )
  const preferredButtonLeft = cellRect
    ? cellRect.left - TRIGGER_SIZE - 6
    : highlightLeft - TRIGGER_SIZE - FLOATING_GAP
  const buttonLeft = clamp(
    preferredButtonLeft,
    VIEWPORT_MARGIN,
    maxButtonLeft
  )
  const preferredMenuLeft = buttonLeft + TRIGGER_SIZE + FLOATING_GAP
  const maxMenuLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - MENU_WIDTH - VIEWPORT_MARGIN)
  const menuLeft = clamp(preferredMenuLeft, VIEWPORT_MARGIN, maxMenuLeft)
  const maxMenuTop = Math.max(VIEWPORT_MARGIN, viewportHeight - MENU_MAX_HEIGHT - VIEWPORT_MARGIN)
  const menuTop = clamp(buttonTop - 6, VIEWPORT_MARGIN, maxMenuTop)

  return {
    targetPos: emptyLinePos,
    context: emptyLineInfo.context,
    buttonTop,
    buttonLeft,
    menuTop,
    menuLeft,
    highlightTop,
    highlightLeft,
    highlightWidth: highlightRight - highlightLeft,
    highlightHeight,
  }
}

export function EmptyLineBlockMenu({ editor }: { editor: Editor }) {
  const t = useTranslations('editor')
  const [menuOpen, setMenuOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tablePickerSize, setTablePickerSize] = useState<TableSize>(DEFAULT_TABLE_SIZE)
  const [tablePickerPosition, setTablePickerPosition] = useState<FloatingPanelPosition | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkDialogPosition, setLinkDialogPosition] = useState<FloatingPanelPosition | null>(null)
  const [linkText, setLinkText] = useState('')
  const [linkHref, setLinkHref] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const tableButtonRef = useRef<HTMLButtonElement>(null)
  const tablePickerRef = useRef<HTMLDivElement>(null)
  const linkDialogRef = useRef<HTMLFormElement>(null)
  const linkTextInputRef = useRef<HTMLInputElement>(null)
  const hoverPositionRef = useRef<MenuPosition | null>(null)

  const refresh = useCallback(() => {
    if (!editor.isEditable) {
      hoverPositionRef.current = null
      setVisible(false)
      setMenuOpen(false)
      setTablePickerOpen(false)
      setTablePickerPosition(null)
      setLinkDialogOpen(false)
      setLinkDialogPosition(null)
      setPosition(null)
      return
    }

    const selectionInfo = getSelectionEmptyTextblockInfo(editor)
    const shouldSkipSelectionAnchor =
      selectionInfo !== null && isTrailingRootEmptyTextblock(editor, selectionInfo)
    const nextSelectionPosition =
      selectionInfo !== null && !shouldSkipSelectionAnchor
        ? getMenuPosition(editor, selectionInfo.pos)
        : null

    if (nextSelectionPosition && !shouldSuppressDefaultTrailingPosition(editor, nextSelectionPosition)) {
      setVisible(true)
      setPosition(nextSelectionPosition)
      return
    }

    if (
      hoverPositionRef.current &&
      !shouldSuppressDefaultTrailingPosition(editor, hoverPositionRef.current) &&
      !menuOpen &&
      !linkDialogOpen
    ) {
      setVisible(true)
      setPosition(hoverPositionRef.current)
      return
    }

    if (!editor.isFocused && !menuOpen && !linkDialogOpen) {
      setVisible(false)
      setTablePickerOpen(false)
      setTablePickerPosition(null)
      setPosition(null)
      return
    }

    setVisible(false)
    setTablePickerOpen(false)
    setTablePickerPosition(null)
    setPosition(null)
  }, [editor, linkDialogOpen, menuOpen])

  useEffect(() => {
    refresh()

    editor.on('selectionUpdate', refresh)
    editor.on('transaction', refresh)
    editor.on('focus', refresh)
    editor.on('blur', refresh)
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)

    return () => {
      editor.off('selectionUpdate', refresh)
      editor.off('transaction', refresh)
      editor.off('focus', refresh)
      editor.off('blur', refresh)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [editor, refresh])

  useEffect(() => {
    const editorDom = editor.view.dom

    const clearHoverPosition = () => {
      hoverPositionRef.current = null
      if (!menuOpen && !linkDialogOpen) {
        refresh()
      }
    }

    const handleMouseLeave = (event: MouseEvent) => {
      const relatedTarget = event.relatedTarget as Node | null
      if (
        relatedTarget &&
        (
          triggerRef.current?.contains(relatedTarget) ||
          menuRef.current?.contains(relatedTarget) ||
          tablePickerRef.current?.contains(relatedTarget) ||
          linkDialogRef.current?.contains(relatedTarget)
        )
      ) return

      clearHoverPosition()
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (menuOpen || linkDialogOpen || tablePickerOpen) return

      const posAtCoords = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })
      const nextPositionRaw = posAtCoords ? getMenuPosition(editor, posAtCoords.pos) : null
      const nextPosition = shouldSuppressDefaultTrailingPosition(editor, nextPositionRaw)
        ? null
        : nextPositionRaw

      hoverPositionRef.current = nextPosition

      if (nextPosition) {
        setVisible(true)
        setPosition(nextPosition)
        return
      }

      refresh()
    }

    editorDom.addEventListener('mousemove', handleMouseMove)
    editorDom.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      editorDom.removeEventListener('mousemove', handleMouseMove)
      editorDom.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [editor, linkDialogOpen, menuOpen, refresh, tablePickerOpen])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        tablePickerRef.current?.contains(target) ||
        linkDialogRef.current?.contains(target)
      ) return
      setMenuOpen(false)
      setTablePickerOpen(false)
      setTablePickerPosition(null)
      setLinkDialogOpen(false)
      setLinkDialogPosition(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const getTablePickerPosition = useCallback((): FloatingPanelPosition | null => {
    const button = tableButtonRef.current
    if (!button) return null

    const rect = button.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const placeRight = rect.right + 8 + TABLE_PICKER_WIDTH <= viewportWidth - VIEWPORT_MARGIN
    const preferredLeft = placeRight
      ? rect.right + 8
      : rect.left - TABLE_PICKER_WIDTH - 8
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - TABLE_PICKER_WIDTH - VIEWPORT_MARGIN)
    const left = Math.min(Math.max(VIEWPORT_MARGIN, preferredLeft), maxLeft)
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - TABLE_PICKER_HEIGHT - VIEWPORT_MARGIN)
    const top = Math.min(Math.max(VIEWPORT_MARGIN, rect.top), maxTop)

    return { top, left }
  }, [])

  const openTablePicker = useCallback(() => {
    setTablePickerOpen(true)
    setTablePickerPosition(getTablePickerPosition())
  }, [getTablePickerPosition])

  const closeTablePicker = useCallback(() => {
    setTablePickerOpen(false)
    setTablePickerPosition(null)
  }, [])

  const updateTablePickerPosition = useCallback(() => {
    const nextPosition = getTablePickerPosition()
    if (nextPosition) setTablePickerPosition(nextPosition)
  }, [getTablePickerPosition])

  const getLinkDialogPosition = useCallback((): FloatingPanelPosition | null => {
    const { selection } = editor.state
    const coords = editor.view.coordsAtPos(selection.from)
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - LINK_DIALOG_WIDTH - VIEWPORT_MARGIN)
    const left = Math.min(Math.max(VIEWPORT_MARGIN, coords.left), maxLeft)
    const belowTop = coords.bottom + 10
    const aboveTop = coords.top - LINK_DIALOG_HEIGHT - 10
    const top = belowTop + LINK_DIALOG_HEIGHT <= viewportHeight - VIEWPORT_MARGIN
      ? belowTop
      : Math.max(VIEWPORT_MARGIN, aboveTop)

    return { top, left }
  }, [editor])

  const updateLinkDialogPosition = useCallback(() => {
    const nextPosition = getLinkDialogPosition()
    if (nextPosition) setLinkDialogPosition(nextPosition)
  }, [getLinkDialogPosition])

  useEffect(() => {
    if (!tablePickerOpen) return

    updateTablePickerPosition()
    window.addEventListener('resize', updateTablePickerPosition)
    window.addEventListener('scroll', updateTablePickerPosition, true)

    return () => {
      window.removeEventListener('resize', updateTablePickerPosition)
      window.removeEventListener('scroll', updateTablePickerPosition, true)
    }
  }, [tablePickerOpen, updateTablePickerPosition])

  useEffect(() => {
    if (!linkDialogOpen) return

    updateLinkDialogPosition()
    window.addEventListener('resize', updateLinkDialogPosition)
    window.addEventListener('scroll', updateLinkDialogPosition, true)

    return () => {
      window.removeEventListener('resize', updateLinkDialogPosition)
      window.removeEventListener('scroll', updateLinkDialogPosition, true)
    }
  }, [linkDialogOpen, updateLinkDialogPosition])

  useEffect(() => {
    if (!linkDialogOpen) return
    const raf = requestAnimationFrame(() => linkTextInputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [linkDialogOpen])

  const runCommand = useCallback((action: BlockAction) => {
    action.command()
    setMenuOpen(false)
    setTablePickerOpen(false)
    setTablePickerPosition(null)
    requestAnimationFrame(refresh)
  }, [refresh])

  const insertImage = useCallback(async () => {
    const rangeStart = editor.state.selection.from
    const placeholderText = 'Uploading... '

    editor.chain().focus().insertContentAt(rangeStart, {
      type: 'text',
      text: placeholderText,
    }).run()

    const placeholderEnd = rangeStart + placeholderText.length

    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
          },
        ],
      })

      if (!selected || typeof selected !== 'string') {
        editor.chain().focus().deleteRange({ from: rangeStart, to: placeholderEnd }).run()
        return
      }

      const fileData = await readFile(selected)
      const ext = selected.split('.').pop() || 'png'
      const fileName = getSelectedPathName(selected)
      const file = new File([new Uint8Array(fileData).buffer], fileName, { type: `image/${ext}` })
      const activeFilePath = useArticleStore.getState().activeFilePath
      const result = await handleImageUpload(file, activeFilePath)

      editor.chain().focus().deleteRange({ from: rangeStart, to: placeholderEnd }).insertContentAt(rangeStart, {
        type: 'image',
        attrs: {
          src: result.src,
          alt: file.name,
          relativeSrc: result.relativePath,
        },
      }).run()
    } catch (error) {
      editor.chain().focus().deleteRange({ from: rangeStart, to: placeholderEnd }).run()
      toast({
        title: t('emptyLineMenu.insertFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [editor, t])

  const insertFileLink = useCallback(async () => {
    try {
      const selected = await openDialog({ multiple: false })
      if (!selected || typeof selected !== 'string') return

      const fileName = getSelectedPathName(selected)
      editor.chain().focus().insertContent(createLinkText(fileName, toFileUrl(selected))).run()
    } catch (error) {
      toast({
        title: t('emptyLineMenu.insertFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [editor, t])

  const insertTable = useCallback((size: TableSize) => {
    editor.chain().focus().insertTable({ rows: size.rows, cols: size.cols, withHeaderRow: true }).run()
    setMenuOpen(false)
    setTablePickerOpen(false)
    setTablePickerPosition(null)
    requestAnimationFrame(refresh)
  }, [editor, refresh])

  const insertConfiguredLink = useCallback(() => {
    const href = normalizeLinkHref(linkHref)
    if (!href) {
      toast({
        title: t('emptyLineMenu.linkRequired'),
        variant: 'destructive',
      })
      return
    }

    const text = linkText.trim() || href
    editor.chain().focus().insertContent(createLinkText(text, href)).run()
    setLinkDialogOpen(false)
    setLinkDialogPosition(null)
    setLinkText('')
    setLinkHref('')
    requestAnimationFrame(refresh)
  }, [editor, linkHref, linkText, refresh, t])

  const basicActions: BlockAction[] = [
    ...([1, 2, 3] as const).map((level) => ({
      key: `heading${level}`,
      label: t(`bubbleMenu.heading${level}`),
      icon: <span className="text-[19px] font-medium leading-none">H{level}</span>,
      active: editor.isActive('heading', { level }),
      command: () => editor.chain().focus().setHeading({ level }).run(),
    })),
    {
      key: 'orderedList',
      label: t('bubbleMenu.orderedList'),
      icon: <ListOrdered className="h-5 w-5" />,
      active: editor.isActive('orderedList'),
      command: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'bulletList',
      label: t('bubbleMenu.bulletList'),
      icon: <List className="h-5 w-5" />,
      active: editor.isActive('bulletList'),
      command: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'taskList',
      label: t('bubbleMenu.taskList'),
      icon: <CheckSquare className="h-5 w-5" />,
      active: editor.isActive('taskList'),
      command: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      key: 'codeBlock',
      label: t('bubbleMenu.codeBlock'),
      icon: <Braces className="h-5 w-5" />,
      active: editor.isActive('codeBlock'),
      command: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      key: 'blockquote',
      label: t('bubbleMenu.blockquote'),
      icon: <Quote className="h-5 w-5" />,
      active: editor.isActive('blockquote'),
      command: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      key: 'divider',
      label: t('emptyLineMenu.divider'),
      icon: <DividerIcon />,
      command: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      key: 'link',
      label: t('bubbleMenu.link'),
      icon: <Link2 className="h-5 w-5" />,
      command: () => {
        setTablePickerOpen(false)
        setTablePickerPosition(null)
        setMenuOpen(false)
        setLinkDialogPosition(getLinkDialogPosition())
        setLinkDialogOpen(true)
      },
    },
  ]

  const commonActions: BlockAction[] = [
    {
      key: 'taskList',
      label: t('emptyLineMenu.task'),
      icon: <CheckSquare className="h-5 w-5" />,
      iconBox: 'border border-blue-400/80 bg-blue-50 dark:bg-blue-500/10',
      iconTone: 'text-blue-500',
      active: editor.isActive('taskList'),
      command: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      key: 'image',
      label: t('emptyLineMenu.image'),
      icon: <ImageIcon className="h-5 w-5" />,
      iconBox: 'border border-amber-400/80 bg-amber-50 dark:bg-amber-500/10',
      iconTone: 'text-amber-500',
      command: () => { void insertImage() },
    },
    {
      key: 'file',
      label: t('emptyLineMenu.file'),
      icon: <Paperclip className="h-5 w-5" />,
      iconTone: 'text-sky-500',
      command: () => { void insertFileLink() },
    },
  ]

  if (!visible || !position) return null
  if (shouldSuppressDefaultTrailingPosition(editor, position)) return null

  const inTableCell = position.context === 'tableCell'

  const linkDialog = linkDialogOpen && linkDialogPosition && typeof document !== 'undefined'
    ? createPortal(
      <form
        ref={linkDialogRef}
        className="fixed z-[9999] rounded-lg border border-gray-200 bg-white p-4 text-gray-950 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
        style={{
          top: linkDialogPosition.top,
          left: linkDialogPosition.left,
          width: LINK_DIALOG_WIDTH,
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          insertConfiguredLink()
        }}
      >
        <div className="mb-3 text-base font-medium text-foreground">{t('emptyLineMenu.linkFormTitle')}</div>
        <div className="grid gap-3">
          <label className="grid grid-cols-[48px_1fr] items-center gap-2 text-sm text-muted-foreground">
            <span>{t('emptyLineMenu.linkText')}</span>
            <input
              ref={linkTextInputRef}
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary dark:border-neutral-700 dark:bg-neutral-900"
              value={linkText}
              placeholder={t('emptyLineMenu.linkTextPlaceholder')}
              onChange={(event) => setLinkText(event.target.value)}
            />
          </label>
          <label className="grid grid-cols-[48px_1fr] items-center gap-2 text-sm text-muted-foreground">
            <span>{t('emptyLineMenu.linkHref')}</span>
            <input
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary dark:border-neutral-700 dark:bg-neutral-900"
              value={linkHref}
              placeholder={t('emptyLineMenu.linkHrefPlaceholder')}
              onChange={(event) => setLinkHref(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
              onClick={() => {
                setLinkDialogOpen(false)
                setLinkDialogPosition(null)
                setLinkText('')
                setLinkHref('')
              }}
            >
              {t('emptyLineMenu.cancel')}
            </button>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            >
              {t('emptyLineMenu.insertLink')}
            </button>
          </div>
        </div>
      </form>,
      document.body
    )
    : null

  const tablePickerPanel = tablePickerOpen && tablePickerPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={tablePickerRef}
        className="fixed z-[9999] pointer-events-auto"
        style={{ top: tablePickerPosition.top, left: tablePickerPosition.left }}
        onMouseEnter={openTablePicker}
        onMouseLeave={closeTablePicker}
      >
        <TablePicker
          size={tablePickerSize}
          label={t('emptyLineMenu.tablePickerSize', tablePickerSize)}
          onHover={setTablePickerSize}
          onInsert={insertTable}
        />
      </div>,
      document.body
    )
    : null

  return (
    <>
      <div
        className="pointer-events-none fixed z-40 rounded-md bg-sky-50/80 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12),0_1px_8px_rgba(59,130,246,0.10)] dark:bg-sky-500/10 dark:shadow-[inset_0_0_0_1px_rgba(125,211,252,0.16)]"
        style={{
          top: position.highlightTop,
          left: position.highlightLeft,
          width: position.highlightWidth,
          height: position.highlightHeight,
        }}
      />
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'fixed z-50 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground',
          menuOpen && 'bg-muted text-primary'
        )}
        style={{ top: position.buttonTop, left: position.buttonLeft }}
        title={t('emptyLineMenu.open')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          editor.chain().focus().setTextSelection(position.targetPos).run()
          setMenuOpen((prev) => !prev)
        }}
      >
        <Plus className="h-4 w-4" />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="fixed z-50 max-h-[360px] overflow-visible rounded-lg border border-border bg-background p-2 shadow-lg"
          style={{ top: position.menuTop, left: position.menuLeft, width: MENU_WIDTH }}
          onMouseDown={(event) => {
            const target = event.target as HTMLElement
            if (target.closest('input, textarea')) return
            event.preventDefault()
          }}
        >
          <div className="text-xs font-medium text-muted-foreground">{t('emptyLineMenu.basic')}</div>
          <div
            className="mt-1.5 text-foreground"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 32px)',
              columnGap: 6,
              rowGap: 6,
            }}
          >
            {basicActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={cn(
                  'flex items-center justify-center rounded-md transition-colors hover:bg-muted',
                  action.active && 'bg-muted text-primary'
                )}
                style={{ width: 32, height: 30 }}
                title={action.label}
                onMouseEnter={closeTablePicker}
                onClick={() => runCommand(action)}
              >
                {action.icon}
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs font-medium text-muted-foreground">{t('emptyLineMenu.common')}</div>
          <div className="mt-1.5 space-y-0.5">
            {commonActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted',
                  action.active && 'bg-muted text-primary'
                )}
                onMouseEnter={closeTablePicker}
                onClick={() => runCommand(action)}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm',
                    action.iconTone || 'text-primary',
                    action.iconBox
                  )}
                >
                  {action.icon}
                </span>
                <span className="flex-1 truncate">{action.label}</span>
                {action.trailing}
              </button>
            ))}
            {!inTableCell && (
              <div
                className="relative"
                onMouseEnter={openTablePicker}
              >
                <button
                  ref={tableButtonRef}
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={openTablePicker}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-emerald-400/80 bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10">
                    <TableIcon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 truncate">{t('emptyLineMenu.table')}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {linkDialog}
      {tablePickerPanel}
    </>
  )
}

export default EmptyLineBlockMenu
