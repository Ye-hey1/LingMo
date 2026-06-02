'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

// 定义 Callout 级别和默认的 Emojis/颜色
export const CALLOUT_TYPES = {
  note: {
    color: 'border-blue-500 bg-blue-500/5 dark:bg-blue-500/10 text-blue-800 dark:text-blue-200',
    icon: '💡',
    label: '提示'
  },
  warning: {
    color: 'border-amber-500 bg-amber-500/5 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200',
    icon: '⚠️',
    label: '警告'
  },
  success: {
    color: 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    icon: '✅',
    label: '成功'
  },
  danger: {
    color: 'border-rose-500 bg-rose-500/5 dark:bg-rose-500/10 text-rose-800 dark:text-rose-200',
    icon: '❌',
    label: '危险'
  },
  info: {
    color: 'border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-200',
    icon: 'ℹ️',
    label: '须知'
  }
}

export type CalloutType = keyof typeof CALLOUT_TYPES

function CalloutView({ node, updateAttributes }: ReactNodeViewProps) {
  const type = (node.attrs.type as CalloutType) || 'note'
  const emoji = node.attrs.emoji || CALLOUT_TYPES[type].icon
  const config = CALLOUT_TYPES[type]
  const [showPicker, setShowPicker] = useState(false)

  // 极简的内置 Emoji 快速选择器以实现 premium 质感
  const EMOJI_OPTIONS = ['💡', '⚠️', '✅', '❌', 'ℹ️', '🔥', '📌', '🚀', '🎯', '✨']

  return (
    <NodeViewWrapper className="callout-node-wrapper my-5 group relative">
      <div className={cn(
        "flex gap-3 px-4 py-3 rounded-xl border-l-4 shadow-sm/50 transition-all duration-200 hover:shadow-md/50",
        config.color
      )}>
        {/* Emoji Icon Selector */}
        <div 
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center justify-center shrink-0 w-6 h-6 text-lg select-none cursor-pointer rounded hover:bg-muted/30 active:scale-95 transition-all duration-150 relative"
          title="更换图标"
        >
          {emoji}

          {showPicker && (
            <div 
              className="absolute left-0 top-7 z-50 flex flex-wrap gap-1 p-1.5 w-44 bg-popover border border-border rounded-lg shadow-lg text-sm select-none"
              onClick={(e) => e.stopPropagation()}
            >
              {EMOJI_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    updateAttributes({ emoji: item })
                    setShowPicker(false)
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted active:scale-90 transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content Container */}
        <div className="flex-1 min-w-0 prose prose-sm dark:prose-invert max-w-none">
          <div data-node-view-content="" className="min-h-[1.5rem] callout-content-dom outline-none" />
        </div>

        {/* Premium Badge Toggler in hover state */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-3 top-2 flex items-center gap-1">
          {Object.keys(CALLOUT_TYPES).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => updateAttributes({ type: lvl, emoji: CALLOUT_TYPES[lvl as CalloutType].icon })}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold transition-all border border-transparent",
                type === lvl 
                  ? "bg-foreground/10 text-foreground border-foreground/20" 
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {CALLOUT_TYPES[lvl as CalloutType].label}
            </button>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const CalloutExtension = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
      },
      emoji: {
        default: '💡',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (element) => ({
          type: element.getAttribute('data-callout-type') || 'note',
          emoji: element.getAttribute('data-callout-emoji') || '💡',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        'data-callout-type': node.attrs.type,
        'data-callout-emoji': node.attrs.emoji,
      }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  markdownTokenName: 'callout',

  // 1. Markdown 反序列化：检测 GFM blockquote 头部
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^>\s*\[!(NOTE|WARNING|SUCCESS|DANGER|INFO)\]/i)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src, tokens, lexer) => {
      const match = /^>\s*\[!(NOTE|WARNING|SUCCESS|DANGER|INFO)\](?:\s*([^\n\r]+))?\r?\n([\s\S]*?)(?=\n\n|\n[^\s>#]|$)/i.exec(src)
      if (!match) return undefined

      const typeStr = match[1].toLowerCase() as CalloutType
      const emoji = match[2]?.trim() || CALLOUT_TYPES[typeStr].icon
      const rawBody = match[3] || ''
      
      // 去除每行开头的 '>'
      const cleanBody = rawBody
        .split('\n')
        .map(line => line.replace(/^>\s?/, ''))
        .join('\n')

      return {
        type: 'callout',
        raw: match[0],
        content: cleanBody,
        attrs: { type: typeStr, emoji },
        tokens: lexer.blockTokens(cleanBody),
      }
    },
  },

  // 2. Markdown 序列化成 GFM blockquote
  renderMarkdown(node, helpers) {
    const type = node.attrs?.type?.toUpperCase() || 'NOTE'
    const emoji = node.attrs?.emoji || '💡'
    
    // 渲染子元素并加前缀
    const content = (helpers as any).state?.renderContent(node) || ''
    const lines = content.trim().split('\n')
    
    const formatted = lines
      .map((line: string, idx: number) => {
        if (idx === 0) {
          return `> [!${type}] ${emoji}\n> ${line}`
        }
        return `> ${line}`
      })
      .join('\n')

    return `\n${formatted}\n`
  },

  // 3. 解析 markdown 语法树 token
  parseMarkdown(token, _helpers) {
    return {
      type: 'callout',
      attrs: {
        type: token.attrs?.type || 'note',
        emoji: token.attrs?.emoji || '💡',
      },
    }
  },
})

export default CalloutExtension
