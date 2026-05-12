import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

type HeadingRecord = {
  key: string
  level: number
  pos: number
  end: number
}

type HeadingCollapseState = {
  collapsedKeys: Set<string>
}

type HeadingCollapseMeta =
  | { type: 'toggle'; key: string }
  | { type: 'set-level-collapsed'; level: number; collapsed: boolean }

const headingCollapsePluginKey = new PluginKey<HeadingCollapseState>('headingCollapse')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingCollapse: {
      setHeadingLevelCollapsed: (level: number, collapsed: boolean) => ReturnType
    }
  }
}

function getHeadingKey(node: ProseMirrorNode, pos: number) {
  const stableId = node.attrs['data-id'] || node.attrs.id
  return stableId ? `id:${stableId}` : `pos:${pos}`
}

function isImplicitCollapsibleHeading(text: string): boolean {
  const trimmed = text.trim()

  if (
    !trimmed ||
    trimmed.length > 90 ||
    trimmed.includes('|') ||
    /[。；;:]$/.test(trimmed)
  ) {
    return false
  }

  return /^(?:第?[一二三四五六七八九十百千万]+[章节部分]?|[0-9]{1,2})[、．.]\s*\S/.test(trimmed)
}

function getCollapsibleHeadingLevel(node: ProseMirrorNode, parent?: ProseMirrorNode | null) {
  if (node.type.name === 'heading') {
    return node.attrs.level
  }

  if (parent && ['tableCell', 'tableHeader'].includes(parent.type.name)) {
    return null
  }

  if (node.type.name === 'paragraph' && isImplicitCollapsibleHeading(node.textContent)) {
    return 2
  }

  return null
}

function collectCollapsibleHeadings(doc: ProseMirrorNode) {
  const headings: HeadingRecord[] = []

  doc.descendants((node, pos, parent) => {
    const level = getCollapsibleHeadingLevel(node, parent)
    if (level == null) return

    headings.push({
      key: getHeadingKey(node, pos),
      level,
      pos,
      end: pos + node.nodeSize,
    })
  })

  return headings
}

function getValidHeadingKeys(doc: ProseMirrorNode) {
  return new Set(collectCollapsibleHeadings(doc).map((heading) => heading.key))
}

function hasHeadingsAtLevel(doc: ProseMirrorNode, level: number) {
  return collectCollapsibleHeadings(doc).some((heading) => heading.level === level)
}

function getAncestorHeadingKeys(headings: HeadingRecord[], currentIndex: number) {
  const ancestors: string[] = []
  let targetLevel = headings[currentIndex]?.level ?? 0

  for (let index = currentIndex - 1; index >= 0; index--) {
    const heading = headings[index]
    if (heading.level >= targetLevel) continue

    ancestors.push(heading.key)
    targetLevel = heading.level

    if (targetLevel === 1) break
  }

  return ancestors
}

function findHeadingBoundary(headings: HeadingRecord[], currentIndex: number, doc: ProseMirrorNode) {
  const current = headings[currentIndex]
  const nextPeer = headings
    .slice(currentIndex + 1)
    .find((heading) => heading.level <= current.level)

  return nextPeer?.pos ?? doc.content.size
}

function createToggleButton(heading: HeadingRecord, collapsed: boolean) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'heading-collapse-toggle'
  button.dataset.headingCollapseToggle = 'true'
  button.dataset.headingCollapseKey = heading.key
  button.dataset.headingCollapsePos = String(heading.pos)
  button.dataset.headingCollapsed = String(collapsed)
  button.contentEditable = 'false'
  button.setAttribute('contenteditable', 'false')
  button.setAttribute('aria-label', collapsed ? '展开标题内容' : '折叠标题内容')
  button.setAttribute('aria-expanded', String(!collapsed))
  button.title = collapsed ? '展开标题内容' : '折叠标题内容'
  button.tabIndex = -1
  const caret = document.createElement('span')
  caret.className = 'heading-collapse-caret'
  button.appendChild(caret)
  return button
}

function buildDecorations(doc: ProseMirrorNode, collapsedKeys: Set<string>) {
  const headings = collectCollapsibleHeadings(doc)
  const decorations: Decoration[] = []

  headings.forEach((heading, index) => {
    const collapsed = collapsedKeys.has(heading.key)

    decorations.push(
      Decoration.node(heading.pos, heading.end, {
        class: collapsed
          ? 'heading-collapse-heading is-heading-collapsed'
          : 'heading-collapse-heading',
      }),
      Decoration.widget(
        heading.pos + 1,
        () => createToggleButton(heading, collapsed),
        {
          key: `heading-collapse-toggle-${heading.key}-${collapsed}`,
          side: -1,
          ignoreSelection: true,
        }
      )
    )

    if (!collapsed) return

    const boundary = findHeadingBoundary(headings, index, doc)
    doc.descendants((node, pos) => {
      if (pos < heading.end || pos >= boundary) return true
      if (!node.isBlock) return true

      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: 'heading-collapse-hidden',
        })
      )

      return false
    })
  })

  return DecorationSet.create(doc, decorations)
}

function findToggleButton(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null
  return target.closest<HTMLButtonElement>('[data-heading-collapse-toggle="true"]')
}

function toggleHeadingFromButton(view: EditorView, event: Event) {
  const button = findToggleButton(event.target)
  const key = button?.dataset.headingCollapseKey
  const rawPos = Number(button?.dataset.headingCollapsePos)
  if (!button || !key || Number.isNaN(rawPos)) return false

  event.preventDefault()
  event.stopPropagation()

  const selectionPos = Math.min(rawPos + 1, view.state.doc.content.size)
  const tr = view.state.tr
    .setMeta(headingCollapsePluginKey, { type: 'toggle', key })
    .setSelection(TextSelection.near(view.state.doc.resolve(selectionPos), 1))
    .scrollIntoView()

  view.dispatch(tr)
  return true
}

function createHeadingCollapsePlugin() {
  let lastToggle: { key: string; at: number } | null = null

  const handleToggleEvent = (view: EditorView, event: Event) => {
    const button = findToggleButton(event.target)
    const key = button?.dataset.headingCollapseKey

    if (key && lastToggle?.key === key && Date.now() - lastToggle.at < 350) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }

    const handled = toggleHeadingFromButton(view, event)

    if (handled && key) {
      lastToggle = { key, at: Date.now() }
    }

    return handled
  }

  return new Plugin<HeadingCollapseState>({
    key: headingCollapsePluginKey,
    state: {
      init() {
        return { collapsedKeys: new Set() }
      },
      apply(tr, previous, _oldState, newState) {
        const collapsedKeys = new Set(previous.collapsedKeys)
        const meta = tr.getMeta(headingCollapsePluginKey) as HeadingCollapseMeta | undefined

        if (meta?.type === 'toggle') {
          if (collapsedKeys.has(meta.key)) {
            collapsedKeys.delete(meta.key)
          } else {
            collapsedKeys.add(meta.key)
          }
        } else if (meta?.type === 'set-level-collapsed') {
          const headings = collectCollapsibleHeadings(newState.doc)
          headings.forEach((heading, index) => {
            if (heading.level !== meta.level) return
            if (meta.collapsed) {
              collapsedKeys.add(heading.key)
            } else {
              collapsedKeys.delete(heading.key)
              getAncestorHeadingKeys(headings, index).forEach((ancestorKey) => {
                collapsedKeys.delete(ancestorKey)
              })
            }
          })
        }

        if (tr.docChanged) {
          const validKeys = getValidHeadingKeys(newState.doc)
          for (const key of collapsedKeys) {
            if (!validKeys.has(key)) {
              collapsedKeys.delete(key)
            }
          }
        }

        return { collapsedKeys }
      },
    },
    props: {
      decorations(state) {
        const pluginState = headingCollapsePluginKey.getState(state)
        if (!pluginState) return null

        return buildDecorations(state.doc, pluginState.collapsedKeys)
      },
      handleDOMEvents: {
        pointerdown(view, event) {
          return handleToggleEvent(view, event)
        },
        mousedown(view, event) {
          return handleToggleEvent(view, event)
        },
        click(view, event) {
          return handleToggleEvent(view, event)
        },
      },
    },
  })
}

export function setHeadingLevelCollapsed(editor: Editor, level: number, collapsed: boolean) {
  if (!hasHeadingsAtLevel(editor.state.doc, level)) {
    return false
  }

  editor.view.dispatch(
    editor.state.tr.setMeta(headingCollapsePluginKey, {
      type: 'set-level-collapsed',
      level,
      collapsed,
    } satisfies HeadingCollapseMeta)
  )

  return true
}

export const HeadingCollapse = Extension.create({
  name: 'headingCollapse',

  addCommands() {
    return {
      setHeadingLevelCollapsed:
        (level: number, collapsed: boolean) =>
        ({ editor }) => {
          return setHeadingLevelCollapsed(editor, level, collapsed)
        },
    }
  },

  addProseMirrorPlugins() {
    return [createHeadingCollapsePlugin()]
  },
})
