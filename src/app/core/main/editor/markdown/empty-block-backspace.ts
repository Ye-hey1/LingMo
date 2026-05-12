import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const TEXTBLOCK_FORMATS = new Set(['heading', 'codeBlock'])
const LIST_ITEM_FORMATS = ['listItem', 'taskItem'] as const
const WRAPPER_FORMATS = ['blockquote'] as const
const TABLE_ANCESTORS = new Set(['table', 'tableRow', 'tableCell', 'tableHeader'])
const NON_FORMAT_ATTRS = new Set(['data-id'])

type AncestorMatch = {
  depth: number
  name: string
}

function findAncestor($pos: ResolvedPos, names: readonly string[]): AncestorMatch | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name
    if (names.includes(name)) {
      return { depth, name }
    }
  }

  return null
}

function hasAncestor($pos: ResolvedPos, names: Set<string>) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (names.has($pos.node(depth).type.name)) {
      return true
    }
  }

  return false
}

function hasFormattingAttrs(node: ProseMirrorNode) {
  return Object.entries(node.attrs).some(([name, value]) => {
    if (NON_FORMAT_ATTRS.has(name)) return false
    return value !== null && value !== undefined && value !== false && value !== ''
  })
}

function setCurrentTextblockToParagraph(editor: Editor) {
  const { state, view } = editor
  const { selection, schema } = state
  const { $from } = selection
  const paragraph = schema.nodes.paragraph

  if (!paragraph || !$from.parent.type.isTextblock) {
    return false
  }

  const from = $from.before($from.depth)
  const to = $from.after($from.depth)
  const tr = state.tr
  tr.setBlockType(from, to, paragraph, {})
  tr.setSelection(TextSelection.create(tr.doc, from + 1))
  tr.scrollIntoView()

  view.dispatch(tr)
  return true
}

function findClosestEmptyParagraphPos(doc: ProseMirrorNode, targetPos: number, paragraphName: string) {
  let closestPos: number | null = null
  let closestDistance = Number.POSITIVE_INFINITY

  doc.descendants((node, pos) => {
    if (node.type.name !== paragraphName || node.content.size > 0) {
      return
    }

    const distance = Math.abs(pos - targetPos)
    if (distance < closestDistance) {
      closestDistance = distance
      closestPos = pos
    }
  })

  return closestPos
}

function replaceEmptyListItemWithParagraph(editor: Editor, listItem: AncestorMatch) {
  const { state, view } = editor
  const { selection, schema } = state
  const { $from } = selection
  const paragraph = schema.nodes.paragraph

  if (!paragraph) {
    return false
  }

  const listItemFrom = $from.before(listItem.depth)
  const listItemTo = $from.after(listItem.depth)
  const tr = state.tr

  try {
    tr.replaceRangeWith(listItemFrom, listItemTo, paragraph.create())
  } catch {
    return false
  }

  const paragraphPos = findClosestEmptyParagraphPos(tr.doc, listItemFrom, paragraph.name)
  if (paragraphPos === null) {
    return false
  }

  tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1))
  tr.scrollIntoView()
  view.dispatch(tr)
  return true
}

function shouldResetEmptyBlock(editor: Editor) {
  const { selection } = editor.state
  if (!selection.empty) return false

  const { $from } = selection
  if (!$from.parent.type.isTextblock) return false
  if ($from.parentOffset !== 0 || $from.parent.content.size > 0) return false
  if (hasAncestor($from, TABLE_ANCESTORS)) return false

  return true
}

function resetEmptyFormattedBlock(editor: Editor) {
  if (!shouldResetEmptyBlock(editor)) {
    return false
  }

  const { $from } = editor.state.selection
  const parentName = $from.parent.type.name
  const listItem = findAncestor($from, LIST_ITEM_FORMATS)
  const wrapper = findAncestor($from, WRAPPER_FORMATS)

  if (TEXTBLOCK_FORMATS.has(parentName)) {
    return setCurrentTextblockToParagraph(editor)
  }

  if (listItem) {
    return replaceEmptyListItemWithParagraph(editor, listItem)
  }

  if (wrapper) {
    return editor.chain().focus().lift(wrapper.name).run()
  }

  if (parentName === 'paragraph' && hasFormattingAttrs($from.parent)) {
    return setCurrentTextblockToParagraph(editor)
  }

  return false
}

export const EmptyBlockBackspace = Extension.create({
  name: 'emptyBlockBackspace',

  priority: 10000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => resetEmptyFormattedBlock(this.editor),
      Delete: () => resetEmptyFormattedBlock(this.editor),
    }
  },
})
