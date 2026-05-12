import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'

export interface WikiLinkSuggestionOptions {
  getFiles: () => Array<{ path: string; name: string }>
}

export const WikiLinkSuggestionExtension = Extension.create<WikiLinkSuggestionOptions>({
  name: 'wikilinkSuggestion',

  addOptions() {
    return {
      getFiles: () => [],
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const getFiles = this.options.getFiles

    return [
      new Plugin({
        key: new PluginKey('wikilinkSuggestion'),
        props: {
          handleKeyDown(view, event) {
            const widget = document.querySelector('[data-wikilink-suggestion]') as HTMLElement | null
            if (!widget) return false

            const items = widget.querySelectorAll('[data-suggestion-item]')
            const activeIndex = Array.from(items).findIndex(item => item.classList.contains('active'))

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              const nextIndex = activeIndex < items.length - 1 ? activeIndex + 1 : 0
              items.forEach((item, i) => {
                item.classList.toggle('active', i === nextIndex)
              })
              items[nextIndex]?.scrollIntoView({ block: 'nearest' })
              return true
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              const prevIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1
              items.forEach((item, i) => {
                item.classList.toggle('active', i === prevIndex)
              })
              items[prevIndex]?.scrollIntoView({ block: 'nearest' })
              return true
            }

            if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault()
              const activeItem = items[activeIndex] as HTMLElement | null
              if (activeItem) {
                const target = activeItem.getAttribute('data-target')
                if (target) {
                  insertWikiLink(view, target)
                }
              }
              return true
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              removeSuggestionWidget()
              return true
            }

            return false
          },
        },

        appendTransaction(transactions, _oldState, newState) {
          const docChanged = transactions.some(tr => tr.docChanged)
          if (!docChanged) return null

          const { $head } = newState.selection
          const textBefore = newState.doc.textBetween(
            Math.max(0, $head.pos - 50),
            $head.pos,
            '\n'
          )

          const match = textBefore.match(/\[\[([^\]]*?)$/)
          if (!match) {
            removeSuggestionWidget()
            return null
          }

          const query = match[1]
          const files = getFiles()
          const filtered = files
            .filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 10)

          if (filtered.length === 0) {
            removeSuggestionWidget()
            return null
          }

          showSuggestionWidget(editor, filtered, editor.view.coordsAtPos($head.pos))
          return null
        },
      }),
    ]
  },
})

function insertWikiLink(view: any, target: string) {
  const { $head } = view.state.selection
  const textBefore = view.state.doc.textBetween(
    Math.max(0, $head.pos - 100),
    $head.pos,
    '\n'
  )

  const match = textBefore.match(/\[\[([^\]]*?)$/)
  if (!match) return

  const from = $head.pos - match[1].length
  const to = $head.pos

  const tr = view.state.tr.insertText(`[[${target}]]`, from - 2, to)
  view.dispatch(tr)
  removeSuggestionWidget()
}

function showSuggestionWidget(
  editor: Editor,
  items: Array<{ path: string; name: string }>,
  coords: { left: number; right: number; top: number; bottom: number }
) {
  removeSuggestionWidget()

  const widget = document.createElement('div')
  widget.setAttribute('data-wikilink-suggestion', '')
  widget.style.cssText = [
    'position: fixed',
    `left: ${coords.left}px`,
    `top: ${coords.bottom + 4}px`,
    'z-index: 9999',
    'min-width: 220px',
    'max-width: 320px',
    'max-height: 240px',
    'overflow-y: auto',
    'background: var(--popover, hsl(0 0% 100%))',
    'border: 1px solid var(--border, hsl(240 5.9% 90%))',
    'border-radius: 8px',
    'box-shadow: 0 4px 16px rgba(0,0,0,0.12)',
    'padding: 4px',
  ].join(';')

  items.forEach((item, index) => {
    const el = document.createElement('div')
    el.setAttribute('data-suggestion-item', '')
    el.setAttribute('data-target', item.name)
    el.className = index === 0 ? 'active' : ''
    el.style.cssText = [
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'padding: 6px 10px',
      'border-radius: 4px',
      'cursor: pointer',
      'font-size: 13px',
      'color: var(--popover-foreground, hsl(240 10% 3.9%))',
      'transition: background 0.1s',
    ].join(';')

    const icon = document.createElement('span')
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'
    icon.style.cssText = 'opacity:0.5;flex-shrink:0'

    const label = document.createElement('span')
    label.textContent = item.name
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'

    el.appendChild(icon)
    el.appendChild(label)

    if (index === 0) {
      el.style.background = 'var(--accent, hsl(240 4.8% 95.9%))'
    }

    el.addEventListener('mouseenter', () => {
      widget.querySelectorAll('[data-suggestion-item]').forEach(i => {
        i.classList.remove('active')
        ;(i as HTMLElement).style.background = 'transparent'
      })
      el.classList.add('active')
      el.style.background = 'var(--accent, hsl(240 4.8% 95.9%))'
    })

    el.addEventListener('mouseleave', () => {
      el.classList.remove('active')
      el.style.background = 'transparent'
    })

    el.addEventListener('click', () => {
      insertWikiLink(editor.view, item.name)
    })

    widget.appendChild(el)
  })

  document.body.appendChild(widget)
}

function removeSuggestionWidget() {
  document.querySelectorAll('[data-wikilink-suggestion]').forEach(el => el.remove())
}
