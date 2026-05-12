'use client'

import { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Link,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  Sparkles,
  MessageCircle,
  Minimize2,
  Maximize2,
  Languages,
  ChevronRight,
  Eraser,
  PaintBucket,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'

const POPULAR_LANGUAGES = [
  { name: 'English', code: 'English', i18nKey: 'languages.English' },
  { name: '日本語', code: 'Japanese', i18nKey: 'languages.Japanese' },
  { name: '한국어', code: 'Korean', i18nKey: 'languages.Korean' },
  { name: 'Français', code: 'French', i18nKey: 'languages.French' },
  { name: 'Deutsch', code: 'German', i18nKey: 'languages.German' },
  { name: 'Español', code: 'Spanish', i18nKey: 'languages.Spanish' },
  { name: 'Português', code: 'Portuguese', i18nKey: 'languages.Portuguese' },
  { name: 'Русский', code: 'Russian', i18nKey: 'languages.Russian' },
  { name: 'العربية', code: 'Arabic', i18nKey: 'languages.Arabic' },
]

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const
type HeadingLevel = typeof HEADING_LEVELS[number]

const TEXT_COLOR_SWATCHES = [
  '#111827',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
] as const

const HIGHLIGHT_COLOR_SWATCHES = [
  '#f3f4f6',
  '#e5e7eb',
  '#fecaca',
  '#fed7aa',
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#ddd6fe',
  '#d1d5db',
  '#9ca3af',
  '#f87171',
  '#fb923c',
  '#fde047',
  '#22c55e',
  '#93c5fd',
  '#a78bfa',
] as const

const CELL_FILL_COLOR_SWATCHES = [
  '#ffffff',
  ...HIGHLIGHT_COLOR_SWATCHES,
] as const

const COLOR_MENU_WIDTH = 292
const COLOR_MENU_HEIGHT = 282
const VIEWPORT_MARGIN = 8
const BUBBLE_MENU_FALLBACK_WIDTH = 720

function shouldPreserveNativePointerTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null

  return Boolean(
    element?.closest('input, textarea, select, [contenteditable="true"]')
  )
}

interface BubbleMenuProps {
  editor: Editor
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onAITranslate?: (targetLanguage: string) => void
  onQuoteToChat?: () => void
  onCreateFlashcard?: () => void
}

type FloatingMenuPosition = {
  top: number
  left: number
}

type CellSelectionLike = {
  constructor: { name: string }
  from: number
  to: number
  $anchorCell?: { pos: number }
  $headCell?: { pos: number }
  isRowSelection?: () => boolean
  isColSelection?: () => boolean
}

function isCellSelection(selection: unknown): selection is CellSelectionLike {
  return Boolean(
    selection &&
    typeof selection === 'object' &&
    'constructor' in selection &&
    (selection as { constructor?: { name?: string } }).constructor?.name === 'CellSelection'
  )
}

function isTextSelection(selection: unknown) {
  return Boolean(
    selection &&
    typeof selection === 'object' &&
    'constructor' in selection &&
    (selection as { constructor?: { name?: string } }).constructor?.name === 'TextSelection'
  )
}

function getCellSelectionType(editor: Editor) {
  const selection = editor.state.selection as unknown as CellSelectionLike
  if (!isCellSelection(selection)) return 'cell'
  if (selection.isRowSelection?.()) return 'row'
  if (selection.isColSelection?.()) return 'column'
  return 'cell'
}

function getCellSelectionRect(editor: Editor) {
  const selection = editor.state.selection as unknown as CellSelectionLike
  if (!isCellSelection(selection)) return null

  const rects = [selection.$anchorCell?.pos, selection.$headCell?.pos]
    .filter((pos): pos is number => typeof pos === 'number')
    .map((pos) => {
      const dom = editor.view.nodeDOM(pos)
      return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
    })
    .filter((rect): rect is DOMRect => Boolean(rect))

  if (!rects.length) return null

  const left = Math.min(...rects.map((rect) => rect.left))
  const right = Math.max(...rects.map((rect) => rect.right))
  const top = Math.min(...rects.map((rect) => rect.top))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))

  return new DOMRect(left, top, right - left, bottom - top)
}

export function BubbleMenu({
  editor,
  onAIPolish,
  onAIConcise,
  onAIExpand,
  onAITranslate,
  onQuoteToChat,
  onCreateFlashcard,
}: BubbleMenuProps) {
  const t = useTranslations('editor')
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showAISubmenu, setShowAISubmenu] = useState(false)
  const [showBlockMenu, setShowBlockMenu] = useState(false)
  const [showAlignMenu, setShowAlignMenu] = useState(false)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [colorMenuMode, setColorMenuMode] = useState<'text' | 'cell'>('text')
  const [colorMenuPosition, setColorMenuPosition] = useState<FloatingMenuPosition | null>(null)
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false)
  const [customTranslateLang, setCustomTranslateLang] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isInteractingWithMenu, setIsInteractingWithMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const aiSubmenuRef = useRef<HTMLDivElement>(null)
  const translateSubmenuRef = useRef<HTMLDivElement>(null)
  const colorButtonRef = useRef<HTMLButtonElement>(null)
  const cellFillButtonRef = useRef<HTMLButtonElement>(null)
  const colorMenuRef = useRef<HTMLDivElement>(null)

  const closeToolSubmenus = useCallback(() => {
    setShowAISubmenu(false)
    setShowBlockMenu(false)
    setShowAlignMenu(false)
    setShowColorMenu(false)
    setColorMenuPosition(null)
    setShowTranslateSubmenu(false)
  }, [])

  const getColorMenuPosition = useCallback((mode = colorMenuMode): FloatingMenuPosition | null => {
    const button = mode === 'cell' ? cellFillButtonRef.current : colorButtonRef.current
    if (!button) return null

    const rect = button.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const menuHeight = colorMenuRef.current?.offsetHeight || COLOR_MENU_HEIGHT
    const preferredTop = rect.bottom + 6
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - menuHeight - VIEWPORT_MARGIN)
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, preferredTop),
      maxTop
    )
    const preferredLeft = rect.left
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - COLOR_MENU_WIDTH - VIEWPORT_MARGIN)
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, preferredLeft),
      maxLeft
    )

    return { top, left }
  }, [colorMenuMode])

  const updateColorMenuPosition = useCallback(() => {
    const nextPosition = getColorMenuPosition()
    if (nextPosition) setColorMenuPosition(nextPosition)
  }, [getColorMenuPosition])

  // 处理翻译
  const handleTranslate = useCallback(async (targetLanguage: string) => {
    const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
    if (!selectedText) {
      toast({ title: t('translation.fail'), description: t('translation.failNoSelection'), variant: 'destructive' })
      return
    }
    onAITranslate?.(targetLanguage)
  }, [editor, onAITranslate, t])

  const handleCustomTranslate = useCallback(async () => {
    const targetLanguage = customTranslateLang.trim()
    if (!targetLanguage) {
      toast({ title: t('translation.customLanguageEmpty'), description: t('translation.customLanguageExample'), variant: 'destructive' })
      return
    }
    await handleTranslate(targetLanguage)
    setCustomTranslateLang('')
  }, [customTranslateLang, handleTranslate, t])

  // 更新定位
  const updatePosition = useCallback(() => {
    const { selection } = editor.state
    const { from, to } = selection

    const editorElement = document.querySelector('.ProseMirror')
    const scrollContainer = editorElement?.parentElement
    if (!editorElement || !scrollContainer) return

    const containerBounds = scrollContainer.getBoundingClientRect()
    const currentMenuWidth = menuRef.current?.offsetWidth || Math.min(BUBBLE_MENU_FALLBACK_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
    const visibleLeft = Math.max(containerBounds.left, VIEWPORT_MARGIN)
    const visibleRight = Math.min(containerBounds.right, window.innerWidth - VIEWPORT_MARGIN)
    const minVisibleLeft = visibleLeft
    const maxVisibleLeft = visibleRight - currentMenuWidth
    const clampVisibleLeft = (left: number) => {
      if (maxVisibleLeft < minVisibleLeft) return minVisibleLeft
      return Math.min(Math.max(left, minVisibleLeft), maxVisibleLeft)
    }
    const clampVisibleTop = (top: number) =>
      Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - VIEWPORT_MARGIN)

    if (isCellSelection(selection)) {
      const rect = getCellSelectionRect(editor)
      if (!rect) {
        setShow(false)
        return
      }

      const preferredTop = rect.top - 48
      const selectionType = getCellSelectionType(editor)
      const preferredLeft = selectionType === 'row'
        ? rect.left
        : rect.left + rect.width / 2 - currentMenuWidth / 2
      const left = clampVisibleLeft(preferredLeft)

      setPosition({
        top: preferredTop < VIEWPORT_MARGIN ? clampVisibleTop(rect.bottom + 10) : clampVisibleTop(preferredTop),
        left,
      })
      setShow(true)
      return
    }

    // 检查选区是否有效（空选区、光标位置、无效位置都不显示）
    if (!isTextSelection(selection)) {
      setShow(false)
      return
    }

    if (from === to || from < 0 || to < 0 || from > editor.state.doc.content.size || to > editor.state.doc.content.size) {
      setShow(false)
      return
    }

    const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n').trim()
    if (!selectedText) {
      setShow(false)
      return
    }

    // 选区有效时不要因编辑器临时失焦隐藏菜单。
    // 点击浮动工具栏会触发 blur；如果这里隐藏，按钮 click 还没执行菜单就消失了。

    // 检查是否是图片节点
    const node = editor.state.doc.nodeAt(from)
    if (node?.type.name === 'image') {
      setShow(false)
      return
    }

    // 检查是否是数学公式节点，如果是则不显示 bubble menu
    if (node?.type.name === 'inlineMath' || node?.type.name === 'blockMath') {
      setShow(false)
      return
    }

    // 获取选区坐标（视口坐标）
    const coords = editor.view.coordsAtPos(from)

    // 计算菜单位置（顶部在选区上方）
    const top = coords.top - 48 // 48 是大约的菜单高度 + 间距

    const left = clampVisibleLeft(coords.left)

    // 如果上方空间不够，改为在光标下方显示
    if (coords.top < 48) {
      setPosition({ top: clampVisibleTop(coords.top + 24), left })
    } else {
      setPosition({ top: clampVisibleTop(top), left })
    }

    setShow(true)
  }, [editor])

  // AI子菜单边界检测
  useEffect(() => {
    if (!showAISubmenu || !aiSubmenuRef.current) return

    const checkSubmenuBounds = () => {
      const rect = aiSubmenuRef.current!.getBoundingClientRect()

      // 直接获取最新编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      if (!editorElement) return

      const editorBounds = editorElement.getBoundingClientRect()
      const padding = 8

      // 检测右边界 - 基于编辑器边缘
      if (rect.right > editorBounds.right - padding) {
        aiSubmenuRef.current!.setAttribute('data-right-edge', 'true')
      } else {
        aiSubmenuRef.current!.removeAttribute('data-right-edge')
      }

      // 检测下边界 - 基于编辑器边缘
      if (rect.bottom > editorBounds.bottom - padding) {
        aiSubmenuRef.current!.setAttribute('data-bottom-edge', 'true')
      } else {
        aiSubmenuRef.current!.removeAttribute('data-bottom-edge')
      }
    }

    const raf = requestAnimationFrame(checkSubmenuBounds)
    return () => cancelAnimationFrame(raf)
  }, [showAISubmenu, show])

  // 翻译子菜单边界检测
  useEffect(() => {
    if (!showTranslateSubmenu || !translateSubmenuRef.current) return

    const checkTranslateBounds = () => {
      const rect = translateSubmenuRef.current!.getBoundingClientRect()

      // 直接获取最新编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      if (!editorElement) return

      const editorBounds = editorElement.getBoundingClientRect()
      const padding = 8

      // 检测右边界 - 基于编辑器边缘
      if (rect.right > editorBounds.right - padding) {
        translateSubmenuRef.current!.setAttribute('data-translate-submenu-right', 'true')
      } else {
        translateSubmenuRef.current!.removeAttribute('data-translate-submenu-right')
      }
    }

    const raf = requestAnimationFrame(checkTranslateBounds)
    return () => cancelAnimationFrame(raf)
  }, [showTranslateSubmenu, show])

  useEffect(() => {
    const updateHandler = () => updatePosition()

    // 初始化时检查是否有有效的选区
    const { selection } = editor.state
    const { from, to } = selection

    // 只有在有选中文本或表格单元格选区时才显示工具栏
    const hasTextSelection =
      isTextSelection(selection) &&
      from !== to &&
      editor.state.doc.textBetween(from, to, '\n', '\n').trim().length > 0

    if (hasTextSelection || isCellSelection(selection)) {
      updatePosition()
    } else {
      setShow(false)
    }

    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updatePosition)

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updatePosition)
    }
  }, [editor, updatePosition])

  useEffect(() => {
    if (!showColorMenu) return

    updateColorMenuPosition()
    window.addEventListener('resize', updateColorMenuPosition)
    window.addEventListener('scroll', updateColorMenuPosition, true)

    return () => {
      window.removeEventListener('resize', updateColorMenuPosition)
      window.removeEventListener('scroll', updateColorMenuPosition, true)
    }
  }, [showColorMenu, updateColorMenuPosition])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        menuRef.current?.contains(target) ||
        colorMenuRef.current?.contains(target)
      ) {
        return
      }

      if (menuRef.current) {
        setShow(false)
        closeToolSubmenus()
        setIsInteractingWithMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeToolSubmenus])

  // Update position on scroll
  useEffect(() => {
    const scrollContainer = document.querySelector('.ProseMirror')?.parentElement
    if (!scrollContainer) return

    const handleScroll = () => {
      if (show) {
        updatePosition()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [show, updatePosition])

  useEffect(() => {
    if (!show) return

    const raf = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(raf)
  }, [show, updatePosition])

  const setLink = useCallback(() => {
    if (showLinkInput) {
      if (linkUrl === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      }
      setShowLinkInput(false)
      setLinkUrl('')
    } else {
      const previousUrl = editor.getAttributes('link').href
      setLinkUrl(previousUrl || '')
      setShowLinkInput(true)
    }
  }, [editor, linkUrl, showLinkInput])

  const toggleBold = () => editor.chain().focus().toggleBold().run()
  const toggleItalic = () => editor.chain().focus().toggleItalic().run()
  const toggleStrike = () => editor.chain().focus().toggleStrike().run()
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run()
  const toggleCode = () => editor.chain().focus().toggleCode().run()
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run()
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run()
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run()
  const toggleTaskList = () => editor.chain().focus().toggleTaskList().run()
  const toggleCodeBlock = () => editor.chain().focus().toggleCodeBlock().run()
  const setParagraph = () => {
    editor.chain().focus().setParagraph().run()
    closeToolSubmenus()
  }
  const setHeading = (level: HeadingLevel) => {
    editor.chain().focus().setHeading({ level }).run()
    closeToolSubmenus()
  }
  const setTextAlign = (alignment: 'left' | 'center' | 'right') => {
    editor.chain().focus().setTextAlign(alignment).run()
    setShowAlignMenu(false)
  }
  const clearFormatting = () => {
    editor.chain().focus().unsetAllMarks().clearNodes().run()
    closeToolSubmenus()
  }
  const setTextColor = (color: string | null) => {
    if (color) {
      editor.chain().focus().setColor(color).run()
    } else {
      editor.chain().focus().unsetColor().run()
    }
  }
  const setHighlightColor = (color: string | null) => {
    if (color) {
      editor.chain().focus().setHighlight({ color }).run()
    } else {
      editor.chain().focus().unsetHighlight().run()
    }
  }
  const resetColorStyles = () => {
    editor.chain().focus().unsetColor().unsetHighlight().run()
  }
  const setCellFillColor = (color: string | null) => {
    editor.chain().focus().setCellAttribute('backgroundColor', color).run()
  }
  const setTableCellAlign = (alignment: 'left' | 'center' | 'right') => {
    editor.chain().focus().setCellAttribute('align', alignment).run()
    setShowAlignMenu(false)
  }
  const deleteSelectedTableRegion = () => {
    const selectionType = getCellSelectionType(editor)
    if (selectionType === 'row') {
      editor.chain().focus().deleteRow().run()
      return
    }
    if (selectionType === 'column') {
      editor.chain().focus().deleteColumn().run()
    }
  }

  const handleQuoteToChat = useCallback(() => {
    onQuoteToChat?.()
    setShow(false)
    closeToolSubmenus()
  }, [closeToolSubmenus, onQuoteToChat])

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs)

  const currentTextAlign = (() => {
    if (editor.isActive({ textAlign: 'center' })) return 'center'
    if (editor.isActive({ textAlign: 'right' })) return 'right'
    return 'left'
  })()

  const currentTextColor = editor.getAttributes('textStyle').color as string | undefined
  const currentHighlightColor = editor.getAttributes('highlight').color as string | undefined
  const isTableSelectionActive = isCellSelection(editor.state.selection)
  const tableSelectionType = getCellSelectionType(editor)
  const currentCellBackground = (
    editor.getAttributes('tableCell').backgroundColor ||
    editor.getAttributes('tableHeader').backgroundColor
  ) as string | undefined
  const currentCellAlign = (
    editor.getAttributes('tableCell').align ||
    editor.getAttributes('tableHeader').align ||
    currentTextAlign
  ) as 'left' | 'center' | 'right'
  const effectiveTextAlign = isTableSelectionActive ? currentCellAlign : currentTextAlign
  const CurrentAlignIcon = effectiveTextAlign === 'center'
    ? AlignCenter
    : effectiveTextAlign === 'right'
      ? AlignRight
      : AlignLeft

  if (!show) return null

  const colorMenu = showColorMenu && colorMenuPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={colorMenuRef}
        className="fixed z-[2147483647] rounded-lg border border-border bg-background p-3 shadow-xl"
        style={{
          top: colorMenuPosition.top,
          left: colorMenuPosition.left,
          width: COLOR_MENU_WIDTH,
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        {colorMenuMode === 'cell' ? (
          <>
            <div className="mb-2 whitespace-nowrap text-xs font-medium text-muted-foreground">单元格填充色</div>
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(8, 28px)', gap: 6 }}
            >
              {CELL_FILL_COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  className={cn(
                    'h-7 w-7 rounded border border-border transition-colors hover:brightness-95',
                    currentCellBackground === color && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setCellFillColor(color)}
                  title={color === '#ffffff' ? '白色' : color}
                />
              ))}
            </div>
            <button className="mt-3 h-8 w-full rounded-md border border-border px-2 text-sm hover:bg-muted" onClick={() => setCellFillColor(null)}>
              清除填充
            </button>
          </>
        ) : (
          <>
            <div>
              <div className="mb-2 whitespace-nowrap text-xs font-medium text-muted-foreground">{t('bubbleMenu.textColor')}</div>
              <div
                className="grid"
                style={{ gridTemplateColumns: 'repeat(8, 28px)', gap: 6 }}
              >
                {TEXT_COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-base font-medium transition-colors hover:bg-muted',
                      currentTextColor === color && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                    style={{ color }}
                    onClick={() => setTextColor(color)}
                    title={color}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-2 whitespace-nowrap text-xs font-medium text-muted-foreground">{t('bubbleMenu.backgroundColor')}</div>
              <div
                className="grid"
                style={{ gridTemplateColumns: 'repeat(8, 28px)', gap: 6 }}
              >
                {HIGHLIGHT_COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      'h-7 w-7 rounded border border-border transition-colors hover:brightness-95',
                      currentHighlightColor === color && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setHighlightColor(color)}
                    title={color}
                  />
                ))}
              </div>
            </div>

            <button className="mt-3 h-8 w-full rounded-md border border-border px-2 text-sm hover:bg-muted" onClick={resetColorStyles}>
              {t('bubbleMenu.restoreDefault')}
            </button>
          </>
        )}
      </div>,
      document.body
    )
    : null

  const deleteLabel = tableSelectionType === 'row'
    ? '删除当前行'
    : tableSelectionType === 'column'
      ? '删除当前列'
      : '删除行/列'
  const canDeleteSelection = tableSelectionType === 'row' || tableSelectionType === 'column'

  const menuContent = (
    <>
      <div
        ref={menuRef}
        className="fixed z-[2147483646] transition-[top,left] duration-150 ease-out"
        style={{
          top: position.top,
          left: position.left
        }}
        onMouseDown={(event) => {
          if (!shouldPreserveNativePointerTarget(event.target)) {
            event.preventDefault()
          }
        }}
      >
        {/* 工具栏 */}
      <div
        className="flex w-max max-w-[calc(100vw-24px)] flex-nowrap items-center gap-0.5 whitespace-nowrap px-1 py-1 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border border-border rounded-lg shadow-lg"
      >
        {/* 块类型 */}
        <div className="relative">
          <button
            className={cn(
              'flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted transition-colors',
              showBlockMenu && 'bg-muted text-primary'
            )}
            onClick={() => {
              setShowAISubmenu(false)
              setShowAlignMenu(false)
              setShowColorMenu(false)
              setShowBlockMenu(!showBlockMenu)
            }}
            title={t('bubbleMenu.blockType')}
          >
            <List className="h-4 w-4" />
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showBlockMenu && 'rotate-180')} />
          </button>

          {showBlockMenu && (
            <div className="absolute top-full left-0 mt-1 max-h-96 w-52 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg z-[2147483647]">
              <button
                className={cn(
                  'flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70',
                  isActive('paragraph') && 'bg-muted text-primary'
                )}
                onClick={setParagraph}
              >
                <span className="flex w-7 shrink-0 items-center justify-center text-lg font-medium leading-none">T</span>
                <span className="flex-1 truncate">{t('bubbleMenu.paragraph')}</span>
                {isActive('paragraph') && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>

              <div className="border-t border-border my-1" />

              {HEADING_LEVELS.map((level) => (
                <button
                  key={level}
                  className={cn(
                    'flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70',
                    isActive('heading', { level }) && 'bg-muted text-primary'
                  )}
                  onClick={() => setHeading(level)}
                >
                  <span className="flex w-7 shrink-0 items-center justify-center text-lg font-medium leading-none">H{level}</span>
                  <span className="flex-1 truncate">{t(`bubbleMenu.heading${level}`)}</span>
                  {isActive('heading', { level }) && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))}

              <div className="border-t border-border my-1" />

              <button className={cn('flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70', isActive('blockquote') && 'bg-muted text-primary')} onClick={() => { toggleBlockquote(); closeToolSubmenus() }}>
                <span className="flex w-7 shrink-0 items-center justify-center"><Quote className="h-4 w-4" /></span>
                <span className="flex-1 truncate">{t('bubbleMenu.blockquote')}</span>
                {isActive('blockquote') && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              <button className={cn('flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70', isActive('bulletList') && 'bg-muted text-primary')} onClick={() => { toggleBulletList(); closeToolSubmenus() }}>
                <span className="flex w-7 shrink-0 items-center justify-center"><List className="h-4 w-4" /></span>
                <span className="flex-1 truncate">{t('bubbleMenu.bulletList')}</span>
                {isActive('bulletList') && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              <button className={cn('flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70', isActive('orderedList') && 'bg-muted text-primary')} onClick={() => { toggleOrderedList(); closeToolSubmenus() }}>
                <span className="flex w-7 shrink-0 items-center justify-center"><ListOrdered className="h-4 w-4" /></span>
                <span className="flex-1 truncate">{t('bubbleMenu.orderedList')}</span>
                {isActive('orderedList') && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              <button className={cn('flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70', isActive('taskList') && 'bg-muted text-primary')} onClick={() => { toggleTaskList(); closeToolSubmenus() }}>
                <span className="flex w-7 shrink-0 items-center justify-center"><CheckSquare className="h-4 w-4" /></span>
                <span className="flex-1 truncate">{t('bubbleMenu.taskList')}</span>
                {isActive('taskList') && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              <button className={cn('flex h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-muted/70', isActive('codeBlock') && 'bg-muted text-primary')} onClick={() => { toggleCodeBlock(); closeToolSubmenus() }}>
                <span className="flex w-7 shrink-0 items-center justify-center"><Code className="h-4 w-4" /></span>
                <span className="flex-1 truncate">{t('bubbleMenu.codeBlock')}</span>
                {isActive('codeBlock') && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 对齐 */}
        <div className="relative">
          <button
            className={cn(
              'flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted transition-colors',
              showAlignMenu && 'bg-muted text-primary'
            )}
            onClick={() => {
              setShowAISubmenu(false)
              setShowBlockMenu(false)
              setShowColorMenu(false)
              setShowAlignMenu(!showAlignMenu)
            }}
            title={t(`bubbleMenu.align${effectiveTextAlign === 'left' ? 'Left' : effectiveTextAlign === 'center' ? 'Center' : 'Right'}`)}
          >
            <CurrentAlignIcon className="h-4 w-4" />
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAlignMenu && 'rotate-180')} />
          </button>

          {showAlignMenu && (
            <div className="absolute top-full left-0 mt-1 w-36 rounded-lg border border-border bg-background py-1 shadow-lg z-[2147483647]">
              <button className={cn('w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2', effectiveTextAlign === 'left' && 'bg-muted text-primary')} onClick={() => isTableSelectionActive ? setTableCellAlign('left') : setTextAlign('left')}>
                <AlignLeft className="h-4 w-4" />
                <span>{t('bubbleMenu.alignLeft')}</span>
              </button>
              <button className={cn('w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2', effectiveTextAlign === 'center' && 'bg-muted text-primary')} onClick={() => isTableSelectionActive ? setTableCellAlign('center') : setTextAlign('center')}>
                <AlignCenter className="h-4 w-4" />
                <span>{t('bubbleMenu.alignCenter')}</span>
              </button>
              <button className={cn('w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2', effectiveTextAlign === 'right' && 'bg-muted text-primary')} onClick={() => isTableSelectionActive ? setTableCellAlign('right') : setTextAlign('right')}>
                <AlignRight className="h-4 w-4" />
                <span>{t('bubbleMenu.alignRight')}</span>
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 文本格式化 */}
        <div className="flex gap-0.5">
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('bold') && 'bg-muted text-primary')} onClick={toggleBold} title={t('bubbleMenu.bold')}><Bold className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('italic') && 'bg-muted text-primary')} onClick={toggleItalic} title={t('bubbleMenu.italic')}><Italic className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('strike') && 'bg-muted text-primary')} onClick={toggleStrike} title={t('bubbleMenu.strike')}><Strikethrough className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('underline') && 'bg-muted text-primary')} onClick={toggleUnderline} title={t('bubbleMenu.underline')}><Underline className="w-4 h-4" /></button>

          <div className="relative">
            {showLinkInput ? (
              <div className="flex items-center gap-1 px-1">
                <input type="url" placeholder={t('bubbleMenu.linkPlaceholder')} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setLink() } else if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl('') } }} className="w-32 px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <button className="p-1 rounded hover:bg-muted text-xs" onClick={setLink}>{t('bubbleMenu.confirm')}</button>
                <button className="p-1 rounded hover:bg-muted text-xs" onClick={() => { setShowLinkInput(false); setLinkUrl('') }}>{t('bubbleMenu.cancel')}</button>
              </div>
            ) : (
              <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('link') && 'bg-muted text-primary')} onClick={setLink} title={t('bubbleMenu.link')}><Link className="w-4 h-4" /></button>
            )}
          </div>

          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('code') && 'bg-muted text-primary')} onClick={toggleCode} title={t('bubbleMenu.inlineCode')}><Code className="w-4 h-4" /></button>

          <div className="relative">
            <button
              ref={colorButtonRef}
              className={cn(
                'flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted transition-colors',
                ((showColorMenu && colorMenuMode === 'text') || currentTextColor || currentHighlightColor) && 'bg-muted text-primary'
              )}
              onClick={() => {
                setShowAISubmenu(false)
                setShowBlockMenu(false)
                setShowAlignMenu(false)
                const nextOpen = !(showColorMenu && colorMenuMode === 'text')
                setColorMenuMode('text')
                setShowColorMenu(nextOpen)
                if (nextOpen) {
                  setColorMenuPosition(getColorMenuPosition('text'))
                  requestAnimationFrame(updateColorMenuPosition)
                } else {
                  setColorMenuPosition(null)
                }
              }}
              title={t('bubbleMenu.colorMenu')}
            >
              <span
                className="flex h-5 min-w-5 items-center justify-center rounded px-1 text-[16px] font-medium leading-none"
                style={{
                  color: currentTextColor || undefined,
                  backgroundColor: currentHighlightColor || undefined
                }}
              >
                A
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showColorMenu && colorMenuMode === 'text' && 'rotate-180')} />
            </button>

          </div>
          {isTableSelectionActive && (
            <button
              ref={cellFillButtonRef}
              className={cn(
                'flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted transition-colors',
                ((showColorMenu && colorMenuMode === 'cell') || currentCellBackground) && 'bg-muted text-primary'
              )}
              onClick={() => {
                setShowAISubmenu(false)
                setShowBlockMenu(false)
                setShowAlignMenu(false)
                const nextOpen = !(showColorMenu && colorMenuMode === 'cell')
                setColorMenuMode('cell')
                setShowColorMenu(nextOpen)
                if (nextOpen) {
                  setColorMenuPosition(getColorMenuPosition('cell'))
                  requestAnimationFrame(updateColorMenuPosition)
                } else {
                  setColorMenuPosition(null)
                }
              }}
              title="单元格填充色"
            >
              <PaintBucket className="h-4 w-4" />
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showColorMenu && colorMenuMode === 'cell' && 'rotate-180')} />
            </button>
          )}
        </div>

        {isTableSelectionActive && (
          <>
            <div className="w-px h-5 bg-border mx-1" />
            <div className="flex gap-0.5">
              <button
                className="p-1.5 rounded hover:bg-muted transition-colors"
                onClick={() => editor.chain().focus().mergeCells().run()}
                title="合并单元格"
              >
                <TableCellsMerge className="w-4 h-4" />
              </button>
              <button
                className="p-1.5 rounded hover:bg-muted transition-colors"
                onClick={() => editor.chain().focus().splitCell().run()}
                title="拆分单元格"
              >
                <TableCellsSplit className="w-4 h-4" />
              </button>
              <button
                className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10"
                onClick={deleteSelectedTableRegion}
                disabled={!canDeleteSelection}
                title={deleteLabel}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        <div className="w-px h-5 bg-border mx-1" />

        <button className="p-1.5 rounded hover:bg-muted transition-colors" onClick={clearFormatting} title={t('bubbleMenu.clearFormatting')}><Eraser className="w-4 h-4" /></button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* AI 操作 */}
        <div className="relative">
          <button
            className={cn('p-1.5 rounded hover:bg-muted transition-colors text-primary', showAISubmenu && 'bg-muted')}
            onClick={() => {
              setShowBlockMenu(false)
              setShowAlignMenu(false)
              setShowColorMenu(false)
              setShowAISubmenu(!showAISubmenu)
            }}
            title={t('bubbleMenu.ai')}
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {showAISubmenu && (
            <div
              ref={aiSubmenuRef}
              className="absolute top-full right-0 mt-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-32 z-[2147483647] data-right-edge:left-auto data-right-edge:right-0 data-right-edge:translate-x-0 data-bottom-edge:top-full data-bottom-edge:mt-1 data-bottom-edge:translate-y-0"
            >
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onAIPolish?.() }}>
                <Sparkles className="w-3.5 h-3.5" /><span>{t('bubbleMenu.polish')}</span>
              </button>
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onAIConcise?.() }}>
                <Minimize2 className="w-3.5 h-3.5" /><span>{t('bubbleMenu.concise')}</span>
              </button>
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onAIExpand?.() }}>
                <Maximize2 className="w-3.5 h-3.5" /><span>{t('bubbleMenu.expand')}</span>
              </button>

              <div className="border-t border-border my-1" />

              <div
                className="relative"
                onMouseEnter={() => setShowTranslateSubmenu(true)}
                onMouseLeave={() => setShowTranslateSubmenu(false)}
              >
                <button
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  onClick={() => setShowTranslateSubmenu(!showTranslateSubmenu)}
                >
                  <Languages className="w-3.5 h-3.5" /><span>{t('bubbleMenu.translate')}</span><ChevronRight className={cn('w-3.5 h-3.5 ml-auto transition-transform', showTranslateSubmenu && 'rotate-90')} />
                </button>

                {showTranslateSubmenu && (
                  <div
                    ref={translateSubmenuRef}
                    className="absolute top-0 left-full ml-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-40 z-[2147483647] max-h-60 overflow-y-auto data-translate-submenu-right:left-auto data-translate-submenu-right:right-full data-translate-submenu-right:ml-0 data-translate-submenu-right:mr-1"
                    data-submenu="translate"
                  >
                    {POPULAR_LANGUAGES.map((lang) => (
                      <button key={lang.code} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); setShowTranslateSubmenu(false); handleTranslate(lang.code) }}>
                        <span>{t(`bubbleMenu.${lang.i18nKey}`)}</span>
                      </button>
                    ))}
                    <div className="border-t border-border my-1" />
                    <div className="px-3 py-1 flex items-center gap-1">
                      <input type="text" placeholder={t('bubbleMenu.customLanguagePlaceholder')} value={customTranslateLang} onChange={(e) => setCustomTranslateLang(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { handleCustomTranslate() } else if (e.key === 'Escape') { setShowTranslateSubmenu(false); setCustomTranslateLang('') } }} className="w-full px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary" />
                    </div>
                  </div>
                )}
              </div>

              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); handleQuoteToChat() }}>
                <MessageCircle className="w-3.5 h-3.5" /><span>{t('bubbleMenu.quoteToChat')}</span>
              </button>
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onCreateFlashcard?.() }}>
                <WalletCards className="w-3.5 h-3.5" /><span>生成闪卡</span>
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
      {colorMenu}
    </>
  )

  return typeof document === 'undefined' ? menuContent : createPortal(menuContent, document.body)
}

export default BubbleMenu
