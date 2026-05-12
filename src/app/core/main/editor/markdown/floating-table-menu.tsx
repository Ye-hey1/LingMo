'use client'

import { Editor } from '@tiptap/react'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

interface FloatingTableMenuProps {
  editor: Editor
}

type TableControlPosition = {
  tableGuide: RectStyle
  leftGuide: RectStyle
  rowMarkers: InsertMarker[]
  columnMarkers: InsertMarker[]
  selectMarkers: SelectMarker[]
}

type RectStyle = {
  top: number
  left: number
  width: number
  height: number
}

type Bounds = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

type InsertMarker = {
  id: string
  type: 'row' | 'column'
  placement: 'before' | 'after'
  targetPos: number
  buttonTop: number
  buttonLeft: number
  lineTop: number
  lineLeft: number
  lineWidth?: number
  lineHeight?: number
}

type SelectMarker = {
  id: string
  type: 'row' | 'column'
  anchorPos: number
  headPos: number
  highlight: RectStyle
  canDelete: boolean
}

const VIEWPORT_MARGIN = 8
const DOT_HIT_SIZE = 22
const SELECT_GUIDE_SIZE = 6

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getElementFromSelection(editor: Editor) {
  const { from } = editor.state.selection
  const domAtPos = editor.view.domAtPos(from)
  const node = domAtPos.node

  return node instanceof HTMLElement ? node : node.parentElement
}

function getSelectedCell(editor: Editor) {
  const selection = editor.state.selection as typeof editor.state.selection & {
    $anchorCell?: { pos: number }
  }
  const anchorCellPos = selection.$anchorCell?.pos
  if (typeof anchorCellPos === 'number') {
    const dom = editor.view.nodeDOM(anchorCellPos)
    if (dom instanceof HTMLElement) {
      const cell = dom.matches('td, th') ? dom : dom.closest('td, th')
      if (cell) return cell as HTMLTableCellElement
    }
  }

  const element = getElementFromSelection(editor)
  return element?.closest('td, th') as HTMLTableCellElement | null
}

function getTableCells(row: Element | null) {
  if (!row) return []
  return Array.from(row.children).filter((child) => child.matches('td, th')) as HTMLTableCellElement[]
}

function getColumnIndex(cell: HTMLTableCellElement) {
  return getTableCells(cell.parentElement).indexOf(cell)
}

function getColumnCount(table: HTMLTableElement) {
  const firstRow = table.rows.item(0)
  return getTableCells(firstRow).length
}

function getCellFocusPos(editor: Editor, cell: HTMLTableCellElement) {
  const textBlock = cell.querySelector('p, h1, h2, h3, h4, h5, h6, pre') as HTMLElement | null
  const target = textBlock || cell

  try {
    return clamp(editor.view.posAtDOM(target, 0), 0, editor.state.doc.content.size)
  } catch {
    return null
  }
}

function getCellStartPos(editor: Editor, cell: HTMLTableCellElement) {
  const row = cell.parentElement
  const index = getTableCells(row).indexOf(cell)
  if (!row || index < 0) return null

  try {
    return clamp(editor.view.posAtDOM(row, index), 0, editor.state.doc.content.size)
  } catch {
    return null
  }
}

function getBoundsFromRect(rect: DOMRect): Bounds {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function intersectBounds(first: Bounds, second: Bounds): Bounds | null {
  const left = Math.max(first.left, second.left, VIEWPORT_MARGIN)
  const right = Math.min(first.right, second.right, window.innerWidth - VIEWPORT_MARGIN)
  const top = Math.max(first.top, second.top, VIEWPORT_MARGIN)
  const bottom = Math.min(first.bottom, second.bottom, window.innerHeight - VIEWPORT_MARGIN)

  if (right <= left || bottom <= top) return null

  return {
    top,
    left,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

function getEditorBounds(editor: Editor): Bounds {
  const root = editor.view.dom.closest('#aritcle-md-editor') as HTMLElement | null
  return getBoundsFromRect((root || editor.view.dom).getBoundingClientRect())
}

function getTableViewportBounds(editor: Editor, table: HTMLTableElement): Bounds | null {
  const tableWrapper = table.closest('.tableWrapper') as HTMLElement | null
  const containerRect = tableWrapper?.getBoundingClientRect() || table.getBoundingClientRect()
  return intersectBounds(getEditorBounds(editor), getBoundsFromRect(containerRect))
}

function isBoundaryVisible(position: number, min: number, max: number) {
  return position >= min && position <= max
}

function getColumnCells(table: HTMLTableElement, columnIndex: number) {
  return Array.from(table.rows)
    .map((row) => getTableCells(row)[columnIndex])
    .filter(Boolean) as HTMLTableCellElement[]
}

function getVisibleRect(rect: DOMRect, bounds: Bounds): RectStyle {
  const left = clamp(rect.left, bounds.left, bounds.right)
  const right = clamp(rect.right, left + 2, bounds.right)
  const top = clamp(rect.top, bounds.top, bounds.bottom)
  const bottom = clamp(rect.bottom, top + 2, bounds.bottom)

  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  }
}

function isCellSelection(editor: Editor) {
  return editor.state.selection.constructor.name === 'CellSelection'
}

function clearNativeTableSelection(editor: Editor) {
  if (typeof window === 'undefined') return

  const nativeSelection = window.getSelection()
  if (nativeSelection && editor.view.dom.contains(nativeSelection.anchorNode)) {
    nativeSelection.removeAllRanges()
  }
}

function getTableControlPosition(editor: Editor): TableControlPosition | null {
  const cell = getSelectedCell(editor)
  const table = cell?.closest('table') as HTMLTableElement | null
  if (!cell || !table) return null

  const tableRect = table.getBoundingClientRect()
  const editorBounds = getEditorBounds(editor)
  const tableViewportBounds = getTableViewportBounds(editor, table)
  if (!tableViewportBounds) return null

  const tableGuide = getVisibleRect(tableRect, tableViewportBounds)
  const tableContentBounds: Bounds = {
    top: tableGuide.top,
    left: tableGuide.left,
    right: tableGuide.left + tableGuide.width,
    bottom: tableGuide.top + tableGuide.height,
    width: tableGuide.width,
    height: tableGuide.height,
  }
  const lineLeft = tableContentBounds.left
  const lineRight = tableContentBounds.right
  const lineTop = tableContentBounds.top
  const lineBottom = tableContentBounds.bottom
  const rowMarkers: InsertMarker[] = []
  const columnMarkers: InsertMarker[] = []
  const selectMarkers: SelectMarker[] = []
  const rows = Array.from(table.rows)
  const firstRowCells = getTableCells(rows[0])
  const columnCount = firstRowCells.length

  const pushRowInsertMarker = (
    row: HTMLTableRowElement,
    rowIndex: number,
    placement: InsertMarker['placement'],
    boundaryTop: number
  ) => {
    const targetCell = getTableCells(row)[0]
    if (!targetCell) return

    const targetPos = getCellFocusPos(editor, targetCell)
    if (targetPos === null || !isBoundaryVisible(boundaryTop, tableContentBounds.top, tableContentBounds.bottom)) return

    rowMarkers.push({
      id: `row-insert-${rowIndex}-${placement}`,
      type: 'row',
      placement,
      targetPos,
      buttonTop: clamp(boundaryTop - DOT_HIT_SIZE / 2, editorBounds.top + VIEWPORT_MARGIN, editorBounds.bottom - DOT_HIT_SIZE - VIEWPORT_MARGIN),
      buttonLeft: clamp(tableContentBounds.left - DOT_HIT_SIZE / 2, editorBounds.left + VIEWPORT_MARGIN, editorBounds.right - DOT_HIT_SIZE - VIEWPORT_MARGIN),
      lineTop: clamp(boundaryTop - 1, tableContentBounds.top, tableContentBounds.bottom),
      lineLeft,
      lineWidth: lineRight - lineLeft,
    })
  }

  rows.forEach((row, rowIndex) => {
    const rowRect = row.getBoundingClientRect()
    if (rowIndex === 0) {
      pushRowInsertMarker(row, rowIndex, 'before', rowRect.top)
    }
    pushRowInsertMarker(row, rowIndex, 'after', rowRect.bottom)
    if (rowRect.bottom < tableContentBounds.top || rowRect.top > tableContentBounds.bottom) return

    const cells = getTableCells(row)
    const firstCell = cells[0]
    const lastCell = cells[cells.length - 1]
    const anchorPos = firstCell ? getCellStartPos(editor, firstCell) : null
    const headPos = lastCell ? getCellStartPos(editor, lastCell) : null
    if (anchorPos === null || headPos === null) return

    const rowVisibleRect = getVisibleRect(rowRect, tableContentBounds)
    selectMarkers.push({
      id: `select-row-${rowIndex}`,
      type: 'row',
      anchorPos,
      headPos,
      highlight: rowVisibleRect,
      canDelete: rows.length > 1,
    })
  })

  const pushColumnInsertMarker = (
    targetCell: HTMLTableCellElement,
    columnIndex: number,
    placement: InsertMarker['placement'],
    boundaryLeft: number
  ) => {
    const targetPos = getCellFocusPos(editor, targetCell)
    if (targetPos === null || !isBoundaryVisible(boundaryLeft, tableContentBounds.left, tableContentBounds.right)) return

    columnMarkers.push({
      id: `column-insert-${columnIndex}-${placement}`,
      type: 'column',
      placement,
      targetPos,
      buttonTop: clamp(tableContentBounds.top - DOT_HIT_SIZE / 2, editorBounds.top + VIEWPORT_MARGIN, editorBounds.bottom - DOT_HIT_SIZE - VIEWPORT_MARGIN),
      buttonLeft: clamp(boundaryLeft - DOT_HIT_SIZE / 2, editorBounds.left + VIEWPORT_MARGIN, editorBounds.right - DOT_HIT_SIZE - VIEWPORT_MARGIN),
      lineTop,
      lineLeft: clamp(boundaryLeft - 1, tableContentBounds.left, tableContentBounds.right),
      lineHeight: lineBottom - lineTop,
    })
  }

  firstRowCells.forEach((targetCell, columnIndex) => {
    const cellRect = targetCell.getBoundingClientRect()
    if (columnIndex === 0) {
      pushColumnInsertMarker(targetCell, columnIndex, 'before', cellRect.left)
    }
    pushColumnInsertMarker(targetCell, columnIndex, 'after', cellRect.right)
    if (cellRect.right < tableContentBounds.left || cellRect.left > tableContentBounds.right) return

    const columnCells = getColumnCells(table, columnIndex)
    const firstCell = columnCells[0]
    const lastCell = columnCells[columnCells.length - 1]
    const anchorPos = firstCell ? getCellStartPos(editor, firstCell) : null
    const headPos = lastCell ? getCellStartPos(editor, lastCell) : null
    if (anchorPos === null || headPos === null) return

    const columnVisibleRect = getVisibleRect(
      new DOMRect(cellRect.left, tableContentBounds.top, cellRect.width, tableContentBounds.height),
      tableContentBounds
    )
    selectMarkers.push({
      id: `select-column-${columnIndex}`,
      type: 'column',
      anchorPos,
      headPos,
      highlight: columnVisibleRect,
      canDelete: columnCount > 1,
    })
  })

  return {
    tableGuide: {
      top: clamp(tableContentBounds.top - SELECT_GUIDE_SIZE, editorBounds.top + VIEWPORT_MARGIN, editorBounds.bottom - SELECT_GUIDE_SIZE - VIEWPORT_MARGIN),
      left: lineLeft,
      width: lineRight - lineLeft,
      height: SELECT_GUIDE_SIZE,
    },
    leftGuide: {
      top: lineTop,
      left: clamp(tableContentBounds.left - SELECT_GUIDE_SIZE, editorBounds.left + VIEWPORT_MARGIN, editorBounds.right - SELECT_GUIDE_SIZE - VIEWPORT_MARGIN),
      width: SELECT_GUIDE_SIZE,
      height: lineBottom - lineTop,
    },
    rowMarkers,
    columnMarkers,
    selectMarkers,
  }
}

function Tooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
      {label}
      <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-neutral-900" />
    </span>
  )
}

function InsertDotButton({
  marker,
  active,
  onEnter,
  onLeave,
  onClick,
}: {
  marker: InsertMarker
  active: boolean
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
}) {
  const label = marker.type === 'row'
    ? marker.placement === 'before' ? '上方插入行' : '下方插入行'
    : marker.placement === 'before' ? '左侧插入列' : '右侧插入列'

  return (
    <button
      type="button"
      data-floating-table-control="true"
      className="group fixed z-[9998] flex items-center justify-center"
      style={{
        top: marker.buttonTop,
        left: marker.buttonLeft,
        width: DOT_HIT_SIZE,
        height: DOT_HIT_SIZE,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span
        className={[
          'flex items-center justify-center rounded-full transition-all',
          active
            ? 'h-[22px] w-[22px] bg-blue-500 text-white shadow-md ring-1 ring-blue-400'
            : 'h-[5px] w-[5px] bg-slate-300 opacity-0 group-hover:h-[22px] group-hover:w-[22px] group-hover:bg-blue-500 group-hover:text-white group-hover:opacity-100 group-hover:shadow-md',
        ].join(' ')}
      >
        <Plus className={active ? 'h-3.5 w-3.5' : 'h-0 w-0 group-hover:h-3.5 group-hover:w-3.5'} />
      </span>
      <Tooltip label={label} />
    </button>
  )
}

function getGuideMarkerAtPoint(
  markers: SelectMarker[],
  type: SelectMarker['type'],
  clientX: number,
  clientY: number
) {
  return markers.find((marker) => {
    if (marker.type !== type) return false
    const rect = marker.highlight
    if (type === 'row') {
      return clientY >= rect.top && clientY <= rect.top + rect.height
    }

    return clientX >= rect.left && clientX <= rect.left + rect.width
  }) ?? null
}

function getGuideBackground(guide: RectStyle, marker: SelectMarker | null, type: SelectMarker['type'], selected: boolean) {
  const baseColor = 'rgba(226, 232, 240, 0.78)'
  if (!marker) return baseColor

  const rect = marker.highlight
  const direction = type === 'column' ? 'to right' : 'to bottom'
  const start = type === 'column'
    ? clamp(rect.left - guide.left, 0, guide.width)
    : clamp(rect.top - guide.top, 0, guide.height)
  const end = type === 'column'
    ? clamp(rect.left + rect.width - guide.left, start, guide.width)
    : clamp(rect.top + rect.height - guide.top, start, guide.height)
  const activeColor = selected ? 'rgba(59, 130, 246, 0.34)' : 'rgba(59, 130, 246, 0.22)'

  return `linear-gradient(${direction}, transparent 0, transparent ${start}px, ${activeColor} ${start}px, ${activeColor} ${end}px, transparent ${end}px), ${baseColor}`
}

export function FloatingTableMenu({ editor }: FloatingTableMenuProps) {
  const [position, setPosition] = useState<TableControlPosition | null>(null)
  const [activeMarker, setActiveMarker] = useState<InsertMarker | null>(null)
  const [activeSelectMarker, setActiveSelectMarker] = useState<SelectMarker | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [isTableHovered, setIsTableHovered] = useState(false)

  const selectedMarker = useMemo(() => (
    position?.selectMarkers.find((marker) => marker.id === selectedMarkerId) ?? null
  ), [position, selectedMarkerId])
  const previewMarker = activeSelectMarker || selectedMarker
  const shouldShowControls = isTableHovered || Boolean(activeMarker || activeSelectMarker || selectedMarker)
  const columnGuideMarker = activeSelectMarker?.type === 'column'
    ? activeSelectMarker
    : selectedMarker?.type === 'column'
      ? selectedMarker
      : null
  const rowGuideMarker = activeSelectMarker?.type === 'row'
    ? activeSelectMarker
    : selectedMarker?.type === 'row'
      ? selectedMarker
      : null

  const updatePosition = useCallback(() => {
    if (!editor.isEditable || !editor.isActive('table')) {
      setPosition(null)
      setActiveMarker(null)
      setActiveSelectMarker(null)
      setSelectedMarkerId(null)
      editor.view.dom.classList.remove('table-cell-selection-active')
      return
    }

    const hasCellSelection = isCellSelection(editor)
    editor.view.dom.classList.toggle('table-cell-selection-active', hasCellSelection)
    if (!hasCellSelection) {
      setSelectedMarkerId(null)
    }

    const nextPosition = getTableControlPosition(editor)
    setPosition(nextPosition)
  }, [editor])

  const runTableCommand = useCallback((command: () => boolean) => {
    command()
    requestAnimationFrame(updatePosition)
  }, [updatePosition])

  const selectRegion = useCallback((marker: SelectMarker) => {
    editor.view.dom.classList.add('table-cell-selection-active')
    editor
      .chain()
      .setCellSelection({ anchorCell: marker.anchorPos, headCell: marker.headPos })
      .run()
    setSelectedMarkerId(marker.id)
    requestAnimationFrame(() => {
      clearNativeTableSelection(editor)
      updatePosition()
      requestAnimationFrame(() => clearNativeTableSelection(editor))
    })
  }, [editor, updatePosition])

  const runInsertCommand = useCallback((marker: InsertMarker) => {
    setSelectedMarkerId(null)
    try {
      editor.commands.setTextSelection(marker.targetPos)
    } catch {
      editor.commands.focus()
    }

    if (marker.type === 'row') {
      runTableCommand(() => (
        marker.placement === 'before'
          ? editor.chain().focus().addRowBefore().run()
          : editor.chain().focus().addRowAfter().run()
      ))
      return
    }

    runTableCommand(() => (
      marker.placement === 'before'
        ? editor.chain().focus().addColumnBefore().run()
        : editor.chain().focus().addColumnAfter().run()
    ))
  }, [editor, runTableCommand])

  useEffect(() => {
    updatePosition()

    editor.on('selectionUpdate', updatePosition)
    editor.on('transaction', updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      editor.off('selectionUpdate', updatePosition)
      editor.off('transaction', updatePosition)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      editor.view.dom.classList.remove('table-cell-selection-active')
    }
  }, [editor, updatePosition])

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const currentCell = getSelectedCell(editor)
      const currentTable = currentCell?.closest('table')
      if (!currentTable) {
        setIsTableHovered(false)
        return
      }

      const target = event.target as HTMLElement | null
      setIsTableHovered(Boolean(
        target && (
          currentTable.contains(target) ||
          target.closest('[data-floating-table-control="true"]')
        )
      ))
    }

    document.addEventListener('mousemove', handlePointerMove)
    return () => document.removeEventListener('mousemove', handlePointerMove)
  }, [editor])

  if (!position || typeof document === 'undefined') return null

  return createPortal(
    <>
      {shouldShowControls && (
        <>
          <div
            data-floating-table-control="true"
            className="fixed z-[9996] cursor-pointer rounded-sm transition-colors hover:ring-1 hover:ring-blue-400/35"
            style={{
              ...position.tableGuide,
              background: getGuideBackground(position.tableGuide, columnGuideMarker, 'column', selectedMarker?.id === columnGuideMarker?.id),
            }}
            title="选择当前列"
            onMouseMove={(event) => {
              setActiveSelectMarker(getGuideMarkerAtPoint(position.selectMarkers, 'column', event.clientX, event.clientY))
            }}
            onMouseLeave={() => setActiveSelectMarker(null)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              const marker = getGuideMarkerAtPoint(position.selectMarkers, 'column', event.clientX, event.clientY)
              if (marker) selectRegion(marker)
            }}
          />
          <div
            data-floating-table-control="true"
            className="fixed z-[9996] cursor-pointer rounded-sm transition-colors hover:ring-1 hover:ring-blue-400/35"
            style={{
              ...position.leftGuide,
              background: getGuideBackground(position.leftGuide, rowGuideMarker, 'row', selectedMarker?.id === rowGuideMarker?.id),
            }}
            title="选择当前行"
            onMouseMove={(event) => {
              setActiveSelectMarker(getGuideMarkerAtPoint(position.selectMarkers, 'row', event.clientX, event.clientY))
            }}
            onMouseLeave={() => setActiveSelectMarker(null)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              const marker = getGuideMarkerAtPoint(position.selectMarkers, 'row', event.clientX, event.clientY)
              if (marker) selectRegion(marker)
            }}
          />
        </>
      )}
      {previewMarker && (
        <div
          className={[
            'pointer-events-none fixed z-[9995] rounded-sm',
            selectedMarker?.id === previewMarker.id
              ? 'bg-blue-500/18 ring-1 ring-blue-500/50'
              : 'bg-slate-300/35 ring-1 ring-slate-300/50',
          ].join(' ')}
          style={previewMarker.highlight}
        />
      )}
      {activeMarker?.type === 'row' && (
        <div
          className="pointer-events-none fixed z-[9997] h-0.5 rounded-full bg-blue-500"
          style={{
            top: activeMarker.lineTop,
            left: activeMarker.lineLeft,
            width: activeMarker.lineWidth,
          }}
        />
      )}
      {activeMarker?.type === 'column' && (
        <div
          className="pointer-events-none fixed z-[9997] w-0.5 rounded-full bg-blue-500"
          style={{
            top: activeMarker.lineTop,
            left: activeMarker.lineLeft,
            height: activeMarker.lineHeight,
          }}
        />
      )}

      {shouldShowControls && [...position.rowMarkers, ...position.columnMarkers].map((marker) => (
        <InsertDotButton
          key={marker.id}
          marker={marker}
          active={activeMarker?.id === marker.id}
          onEnter={() => setActiveMarker(marker)}
          onLeave={() => setActiveMarker(null)}
          onClick={() => runInsertCommand(marker)}
        />
      ))}

    </>,
    document.body
  )
}

export default FloatingTableMenu
