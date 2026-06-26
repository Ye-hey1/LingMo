'use client'

import { useEffect, useRef } from 'react'
import { EditorView, minimalSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import emitter from '@/lib/emitter'

interface MarkdownSourceEditorProps {
  content: string
  onChange: (value: string) => void
  editable?: boolean
  className?: string
  changeDebounceMs?: number
}

const sourceEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-foreground)',
    fontSize: '14px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '20px 24px 72px',
    caretColor: 'var(--color-foreground)',
    lineHeight: '1.7',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-muted-foreground)',
    borderRight: '1px solid var(--color-border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-muted)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--color-muted) 45%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-third) !important',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-foreground) 8%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--color-foreground) 15%, transparent)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-popover)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-foreground)',
  },
})

export function MarkdownSourceEditor({
  content,
  onChange,
  editable = true,
  className,
  changeDebounceMs = 1200,
}: MarkdownSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const contentRef = useRef(content)
  const changeDebounceMsRef = useRef(changeDebounceMs)
  const applyingExternalChangeRef = useRef(false)
  const hasPendingChangeRef = useRef(false)
  const changeTimerRef = useRef<number | null>(null)
  const themeCompartment = useRef(new Compartment())
  const editableCompartment = useRef(new Compartment())
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    changeDebounceMsRef.current = changeDebounceMs
  }, [changeDebounceMs])

  useEffect(() => {
    const flushPendingChange = () => {
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current)
        changeTimerRef.current = null
      }

      if (hasPendingChangeRef.current && viewRef.current) {
        hasPendingChangeRef.current = false
        onChangeRef.current(contentRef.current)
      }
    }

    if (!containerRef.current) {
      return flushPendingChange
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        minimalSetup,
        themeCompartment.current.of(sourceEditorTheme),
        editableCompartment.current.of([
          EditorView.editable.of(editable),
          EditorState.readOnly.of(!editable),
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingExternalChangeRef.current) {
            return
          }

          let nextContent = contentRef.current
          let offset = 0
          update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            const insertedText = inserted.toString()
            const from = fromA + offset
            const to = toA + offset
            nextContent = `${nextContent.slice(0, from)}${insertedText}${nextContent.slice(to)}`
            offset += insertedText.length - (toA - fromA)
          })
          contentRef.current = nextContent
          emitter.emit('editor-input')
          hasPendingChangeRef.current = true
          if (changeTimerRef.current !== null) {
            window.clearTimeout(changeTimerRef.current)
          }
          changeTimerRef.current = window.setTimeout(flushPendingChange, changeDebounceMsRef.current)
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      flushPendingChange()
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: themeCompartment.current.reconfigure(sourceEditorTheme),
    })
  }, [resolvedTheme])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: editableCompartment.current.reconfigure([
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
      ]),
    })
  }, [editable])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (contentRef.current === content) {
      return
    }

    applyingExternalChangeRef.current = true
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      })
      contentRef.current = content
    } finally {
      applyingExternalChangeRef.current = false
    }
  }, [content])

  return <div ref={containerRef} className={cn('h-full w-full', className)} />
}
