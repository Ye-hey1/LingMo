'use client'

import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { html } from '@codemirror/lang-html'
import { EditorState, Compartment } from '@codemirror/state'
import { useTheme } from 'next-themes'

interface HtmlCodeEditorProps {
  content: string
  onChange: (value: string) => void
  onEditorMount?: (view: EditorView | null) => void
}

// 语法高亮颜色通过 CSS 变量注入，确保跟随用户主题切换
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-foreground)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    caretColor: 'var(--color-foreground)',
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
    backgroundColor: 'color-mix(in srgb, var(--color-muted) 50%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-third) !important',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--color-muted)',
    outline: '1px solid var(--color-muted-foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-foreground) 8%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--color-foreground) 15%, transparent)',
  },
  '.cm-foldGutter': {
    color: 'var(--color-muted-foreground)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-popover)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-foreground)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent)',
    color: 'var(--color-accent-foreground)',
  },
})

export function HtmlCodeEditor({ content, onChange, onEditorMount }: HtmlCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onEditorMountRef = useRef(onEditorMount)
  const themeCompartment = useRef(new Compartment())
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onEditorMountRef.current = onEditorMount
  }, [onEditorMount])

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        html(),
        EditorView.lineWrapping,
        themeCompartment.current.of(editorTheme),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view
    onEditorMountRef.current?.(view)

    return () => {
      view.destroy()
      viewRef.current = null
      onEditorMountRef.current?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconfigure theme when resolvedTheme changes to refresh computed styles
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // CSS variables auto-update, but CodeMirror may need a reconfigure
    // to pick up the new values in its internal styles
    view.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme),
    })
  }, [resolvedTheme])

  // Handle external content changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentContent = view.state.doc.toString()
    if (currentContent !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      })
    }
  }, [content])

  return <div ref={containerRef} className="h-full w-full" />
}
