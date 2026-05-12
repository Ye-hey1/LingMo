'use client'

import { useState, useEffect, useRef } from 'react'
import { usePDFAnnotationStore, type Annotation } from '@/stores/pdf-annotation'
import { useTranslations } from 'next-intl'
import { Highlighter, Underline, MessageSquare } from 'lucide-react'

const COLORS = ['yellow', 'green', 'blue', 'red'] as const
const COLOR_STYLE: Record<string, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-green-400',
  blue: 'bg-blue-400',
  red: 'bg-red-400',
}

export function AnnotationPopover({ pdfPath }: { pdfPath: string }) {
  const t = useTranslations('article.pdf')
  const popoverState = usePDFAnnotationStore(s => s.popoverState)
  const closePopover = usePDFAnnotationStore(s => s.closePopover)
  const addAnnotation = usePDFAnnotationStore(s => s.addAnnotation)
  const [noteMode, setNoteMode] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [selectedColor, setSelectedColor] = useState<string>('yellow')
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!popoverState.visible) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closePopover()
        setNoteMode(false)
        setNoteText('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverState.visible, closePopover])

  if (!popoverState.visible || !popoverState.position) return null

  const createAnnotation = (type: Annotation['type']) => {
    if (!popoverState.position) return
    const annotation: Annotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      color: selectedColor as Annotation['color'],
      pageIndex: popoverState.position.pageIndex,
      selectedText: popoverState.selectedText,
      note: noteMode && noteText.trim() ? noteText.trim() : undefined,
      position: { rects: popoverState.position.rects },
      createdAt: Date.now(),
    }
    addAnnotation(pdfPath, annotation)
    closePopover()
    setNoteMode(false)
    setNoteText('')
  }

  // 计算弹窗位置
  const style: React.CSSProperties = {
    position: 'fixed',
    left: popoverState.x,
    top: popoverState.y - 8,
    transform: 'translate(-50%, -100%)',
    zIndex: 50,
  }

  return (
    <div ref={ref} style={style} className="bg-popover text-popover-foreground rounded-lg border shadow-lg p-2">
      {!noteMode ? (
        <div className="flex items-center gap-1">
          {/* 批注类型按钮 */}
          <button
            className="p-1.5 rounded hover:bg-accent transition-colors"
            onClick={() => createAnnotation('highlight')}
            title={t('highlight')}
          >
            <Highlighter className="h-4 w-4" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-accent transition-colors"
            onClick={() => createAnnotation('underline')}
            title={t('underline')}
          >
            <Underline className="h-4 w-4" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-accent transition-colors"
            onClick={() => setNoteMode(true)}
            title={t('note')}
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* 颜色选择 */}
          {COLORS.map(color => (
            <button
              key={color}
              className={`w-5 h-5 rounded-full border-2 transition-all ${COLOR_STYLE[color]} ${selectedColor === color ? 'border-foreground scale-110' : 'border-transparent'}`}
              onClick={() => setSelectedColor(color)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 w-56">
          <textarea
            className="w-full h-16 text-xs rounded border bg-background px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('addNote')}
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                createAnnotation('comment')
              }
            }}
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {COLORS.map(color => (
                <button
                  key={color}
                  className={`w-4 h-4 rounded-full border transition-all ${COLOR_STYLE[color]} ${selectedColor === color ? 'border-foreground scale-110' : 'border-transparent'}`}
                  onClick={() => setSelectedColor(color)}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <button
                className="px-2 py-0.5 text-xs rounded hover:bg-accent"
                onClick={() => { setNoteMode(false); setNoteText('') }}
              >
                {t('cancelAnnotation')}
              </button>
              <button
                className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => createAnnotation('comment')}
              >
                {t('addNote')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
