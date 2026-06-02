'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Editor } from '@tiptap/react'
import { Check, X, Sparkles } from 'lucide-react'
import { diffWordsWithSpace } from 'diff'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface DiffSession {
  from: number
  to: number
  originalText: string
  newText: string
}

export const diffPluginKey = new PluginKey('diffReviewPlugin')

// 自定义 ProseMirror 插件，用于在编辑器中渲染红绿 Diff 标记
export const createDiffPlugin = (session: DiffSession | null) => {
  return new Plugin({
    key: diffPluginKey,
    state: {
      init() {
        return session
      },
      apply(tr, value) {
        const meta = tr.getMeta(diffPluginKey)
        if (meta === 'clear') {
          return null
        }
        if (meta && typeof meta === 'object') {
          return meta as DiffSession
        }
        // 如果文档被修改且并非我们触发的，可以选择清除 Diff Session
        if (tr.docChanged && value) {
          // 暂时保留，但可以根据偏移映射坐标。为简便起见，用户直接编辑则让其采纳
          return value
        }
        return value
      }
    },
    props: {
      decorations(state) {
        const currentSession = diffPluginKey.getState(state) as DiffSession | null
        if (!currentSession) return DecorationSet.empty

        const { from, originalText, newText } = currentSession
        const decos: Decoration[] = []

        try {
          // 使用 diff 库计算差异
          const diffResult = diffWordsWithSpace(originalText, newText)
          let currentPos = from

          diffResult.forEach((part) => {
            if (part.added) {
              // 新增部分：标记为绿色背景
              const endPos = currentPos + part.value.length
              decos.push(
                Decoration.inline(currentPos, endPos, {
                  class: 'diff-added bg-emerald-200/40 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-b border-emerald-500 rounded-sm px-0.5 py-0.5',
                })
              )
              currentPos = endPos
            } else if (part.removed) {
              // 删除部分：用 ProseMirror widget 插入红色中划线
              const span = document.createElement('span')
              span.className = 'diff-removed line-through opacity-60 bg-rose-200/40 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-b border-rose-500 rounded-sm px-0.5 py-0.5 mx-0.5 select-none'
              span.textContent = part.value
              span.style.textDecoration = 'line-through'

              decos.push(
                Decoration.widget(currentPos, span, {
                  side: -1, // 显示在当前的前方
                })
              )
              // 由于是 removed，不在新文档中前进 currentPos
            } else {
              // 未变动部分：正常前进
              currentPos += part.value.length
            }
          })
        } catch (e) {
          console.error('[Diff Review] Calculation error:', e)
        }

        return DecorationSet.create(state.doc, decos)
      }
    }
  })
}

interface DiffReviewUIProps {
  editor: Editor
  session: DiffSession | null
  onAccept: () => void
  onReject: () => void
}

export function DiffReviewUI({ editor, session, onAccept, onReject }: DiffReviewUIProps) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    if (!session || !editor || !editor.view) return

    try {
      // 获取当前 Diff 区域的头部 DOM 坐标
      const startCoords = editor.view.coordsAtPos(session.from)
      const scrollContainer = editor.view.dom.closest('.overflow-y-auto') as HTMLElement | null

      if (!scrollContainer) {
        setCoords({
          top: startCoords.top - 50,
          left: startCoords.left,
        })
        return
      }

      const containerBounds = scrollContainer.getBoundingClientRect()
      const panelHeight = panelRef.current?.offsetHeight || 44
      const panelWidth = panelRef.current?.offsetWidth || 280

      // 计算相对于 scrollContainer 的坐标
      const top = startCoords.top - containerBounds.top + scrollContainer.scrollTop - panelHeight - 8
      const left = startCoords.left - containerBounds.left + scrollContainer.scrollLeft - panelWidth / 2

      setCoords({
        top: Math.max(scrollContainer.scrollTop + 8, top),
        left: Math.max(scrollContainer.scrollLeft + 12, Math.min(scrollContainer.scrollLeft + containerBounds.width - panelWidth - 12, left)),
      })
    } catch {
      // 捕获边界状态报错
    }
  }, [editor, session])

  useEffect(() => {
    if (!session) return

    updatePosition()
    const scrollContainer = editor.view.dom.closest('.overflow-y-auto')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updatePosition)
    }
    window.addEventListener('resize', updatePosition)

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', updatePosition)
      }
      window.removeEventListener('resize', updatePosition)
    }
  }, [editor, session, updatePosition])

  useEffect(() => {
    // 渲染时如果有高度更新
    updatePosition()
  }, [coords === null, updatePosition])

  if (!session || !coords) return null

  // 渲染浮动在 Diff 区域之上的控制框
  const element = (
    <div
      ref={panelRef}
      className="absolute z-50 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-background/96 text-foreground shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{
        top: coords.top,
        left: coords.left,
      }}
    >
      <div className="flex items-center gap-1.5 pr-2 border-r border-border/80">
        <Sparkles size={13} className="text-emerald-500 animate-pulse" />
        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">AI 修改对照</span>
      </div>
      <button
        onClick={onAccept}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded transition-colors active:scale-95"
        type="button"
      >
        <Check size={12} />
        采纳
      </button>
      <button
        onClick={onReject}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors active:scale-95"
        type="button"
      >
        <X size={12} />
        拒绝
      </button>
    </div>
  )

  // 挂载到编辑器的父节点（即包含 relative 属性的容器）以确保完美定位
  const container = editor.view.dom.closest('.tiptap-editor') || document.body
  return createPortal(element, container)
}
