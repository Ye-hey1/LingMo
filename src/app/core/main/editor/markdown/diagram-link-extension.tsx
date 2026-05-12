import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { DraftingCompass, ExternalLink } from 'lucide-react'

import { isDiagramPath } from '@/lib/diagram'
import useArticleStore from '@/stores/article'

function normalizeDiagramSrc(src: string): string {
  return src.trim().replace(/^\.\//, '')
}

const DIAGRAM_LINK_PATTERN = /[^)]*(?:\.(?:excalidraw|diagram)\.json|\.drawio(?:\.xml)?)/

function DiagramLinkView({ node }: ReactNodeViewProps) {
  const src = node.attrs.src as string
  const alt = (node.attrs.alt as string) || '图表'

  const openDiagram = () => {
    useArticleStore.getState().setActiveFilePath(normalizeDiagramSrc(src))
  }

  return (
    <NodeViewWrapper className="not-prose my-3">
      <button
        type="button"
        onClick={openDiagram}
        className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-3">
          <DraftingCompass className="size-5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{alt}</span>
            <span className="block truncate text-xs text-muted-foreground">{src}</span>
          </span>
        </span>
        <ExternalLink className="ml-3 size-4 shrink-0 text-muted-foreground" />
      </button>
    </NodeViewWrapper>
  )
}

export const DiagramLink = Node.create({
  name: 'diagramLink',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '图表' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="diagram-link"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'diagram-link' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramLinkView)
  },

  markdownTokenName: 'diagramLink',

  markdownTokenizer: {
    name: 'diagramLink',
    level: 'block',
    start: (src: string) => {
      const match = src.match(new RegExp(`!\\[[^\\]]*\\]\\(${DIAGRAM_LINK_PATTERN.source}\\)`, 'i'))
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src) => {
      const match = new RegExp(`^!\\[([^\\]]*)\\]\\((${DIAGRAM_LINK_PATTERN.source})\\)`, 'i').exec(src)
      if (!match) return undefined

      const alt = match[1] || '图表'
      const diagramSrc = normalizeDiagramSrc(match[2])
      if (!isDiagramPath(diagramSrc)) return undefined

      return {
        type: 'diagramLink',
        raw: match[0],
        attrs: { alt, src: diagramSrc },
      }
    },
  },

  renderMarkdown(node) {
    const attrs = node.attrs || {}
    return `\n![${attrs.alt || '图表'}](${attrs.src || ''})\n`
  },

  parseMarkdown(token) {
    return {
      type: 'diagramLink',
      attrs: token.attrs,
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: new RegExp(`!\\[([^\\]]*)\\]\\((${DIAGRAM_LINK_PATTERN.source})\\)$`, 'i'),
        type: this.type,
        getAttributes: (match) => ({
          alt: match[1] || '图表',
          src: normalizeDiagramSrc(match[2]),
        }),
      }),
    ]
  },
})
