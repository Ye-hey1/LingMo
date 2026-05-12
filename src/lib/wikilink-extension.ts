import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface WikiLinkOptions {
  // eslint-disable-next-line no-unused-vars
  onClick: (target: string) => void
}

// 匹配 [[链接名]] 和 [[链接名|显示文字]]
const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

export const WikiLinkExtension = Extension.create<WikiLinkOptions>({
  name: 'wikilink',

  addOptions() {
    return {
      onClick: () => {},
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const onClick = this.options.onClick

    return [
      new Plugin({
        key: new PluginKey('wikilinkDecoration'),
        props: {
          decorations: (state) => {
            const { doc } = state
            const decorations: Decoration[] = []

            doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              let match
              WIKILINK_REGEX.lastIndex = 0

              while ((match = WIKILINK_REGEX.exec(text)) !== null) {
                const target = match[1].trim()
                const display = match[2]?.trim() || target
                const from = pos + match.index
                const to = from + match[0].length

                decorations.push(
                  Decoration.inline(from, to, {
                    class: 'wikilink',
                    'data-wikilink': target,
                    'data-display': display,
                  })
                )
              }
            })

            return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty
          },

          handleClick: (view, pos, event) => {
            const target = event.target as HTMLElement
            const wikilinkEl = target.closest('.wikilink') as HTMLElement | null
            if (wikilinkEl) {
              const linkTarget = wikilinkEl.getAttribute('data-wikilink')
              if (linkTarget) {
                onClick(linkTarget)
                return true
              }
            }
            return false
          },
        },
      }),
    ]
  },
})

export function normalizeWikiLinkTarget(target: string): string {
  return target.trim().replace(/\.md$/i, '').toLowerCase()
}

// 从 Markdown 内容中提取所有 WikiLink 目标名
export function extractWikiLinks(content: string): string[] {
  const links: string[] = []
  let match
  WIKILINK_REGEX.lastIndex = 0
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return [...new Set(links)]
}

// 从内容中提取带上下文的 WikiLink（用于反向链接显示）
export function extractWikiLinksWithContext(content: string): Array<{ target: string; line: number; context: string }> {
  const results: Array<{ target: string; line: number; context: string }> = []
  const lines = content.split('\n')
  WIKILINK_REGEX.lastIndex = 0

  lines.forEach((line, lineIndex) => {
    let match
    WIKILINK_REGEX.lastIndex = 0
    while ((match = WIKILINK_REGEX.exec(line)) !== null) {
      results.push({
        target: match[1].trim(),
        line: lineIndex + 1,
        context: line.trim(),
      })
    }
  })

  return results
}
