'use client'

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { useState, createElement } from 'react'
import { Copy, Check } from 'lucide-react'

function CodeBlockView({ node, updateAttributes, extension }: any) {
  const [copied, setCopied] = useState(false)
  const language = node.attrs.language || 'text'

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(node.textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // 获取低亮支持的所有编程语言列表并排序
  const languages = [...(extension.options.lowlight.listLanguages() || [])].sort()

  return createElement(
    NodeViewWrapper,
    { className: 'code-block-wrapper my-6 relative group rounded-xl overflow-hidden border border-border bg-muted/20 dark:bg-muted/10 hover:shadow-sm transition-all duration-200' },
    [
      // Header 标题控制栏
      createElement(
        'div',
        { 
          key: 'header', 
          className: 'flex items-center justify-between px-4 py-2 bg-muted/30 text-xs text-muted-foreground border-b border-border/80 select-none' 
        },
        [
          // 语言下拉快速切换器
          createElement(
            'div',
            { key: 'lang-selector-container', className: 'flex items-center gap-1.5' },
            [
              createElement(
                'select',
                {
                  key: 'lang-select',
                  value: language,
                  onChange: (e: any) => updateAttributes({ language: e.target.value }),
                  className: 'font-mono font-semibold uppercase bg-transparent text-muted-foreground hover:text-foreground cursor-pointer outline-none border-none pr-1 appearance-none transition-colors'
                },
                [
                  createElement('option', { key: 'default', value: 'text', className: 'bg-popover text-foreground' }, 'TEXT'),
                  ...languages.map((lang: string) => 
                    createElement('option', { key: lang, value: lang, className: 'bg-popover text-foreground' }, lang.toUpperCase())
                  )
                ]
              )
            ]
          ),
          // 复制按钮
          createElement(
            'button',
            {
              key: 'copy-btn',
              onClick: handleCopy,
              className: 'flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted active:scale-95 transition-all text-muted-foreground hover:text-foreground'
            },
            [
              copied 
                ? createElement(Check, { key: 'ico-chk', className: 'w-3.5 h-3.5 text-emerald-500 stroke-[2.5]' })
                : createElement(Copy, { key: 'ico-cpy', className: 'w-3.5 h-3.5' }),
              createElement('span', { key: 'btn-txt' }, copied ? '已复制' : '复制')
            ]
          )
        ]
      ),
      // 代码内容展示区
      createElement(
        'pre',
        { key: 'pre-body', className: 'p-4 m-0 overflow-x-auto bg-transparent font-mono text-sm leading-relaxed outline-none' },
        createElement(NodeViewContent, { as: 'code', className: `language-${language}` })
      )
    ]
  )
}

export const StableCodeBlockLowlight = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {}

    return {
      ...parentShortcuts,
      Enter: ({ editor }) => {
        const { selection } = editor.state
        const { $from, empty } = selection

        if (!empty || $from.parent.type !== this.type) {
          return false
        }

        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2
        const endsWithDoubleNewline = $from.parent.textContent.endsWith('\n\n')
        const action = isAtEnd && endsWithDoubleNewline ? 'exit' : 'newline'

        if (action === 'exit') {
          return editor.chain()
            .command(({ tr }) => {
              tr.delete($from.pos - 2, $from.pos)
              return true
            })
            .exitCode()
            .run()
        }

        return editor.commands.insertContent('\n')
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  }
})

export default StableCodeBlockLowlight
