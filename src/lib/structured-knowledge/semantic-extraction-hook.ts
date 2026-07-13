'use client'

import emitter from '@/lib/emitter'
import { enqueueSemanticExtraction, getSemanticExtractionQueue, recoverPendingSemanticExtractions } from './semantic-extraction-queue'

let installed = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleSavedListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let syncContentUpdatedListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editorInputListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleOpenedListener: any = null

function isMarkdownPath(path: string) {
  return /\.(md|markdown|mdx)$/i.test(path)
}

export function installSemanticExtractionHook(): () => void {
  if (installed) return uninstallSemanticExtractionHook
  installed = true
  const queue = getSemanticExtractionQueue()

  articleSavedListener = ((event: { path: string; content?: string; largeMarkdown?: boolean }) => {
    if (!event?.path || !isMarkdownPath(event.path)) return
    enqueueSemanticExtraction({
      filePath: event.path,
      content: event.largeMarkdown ? undefined : event.content,
      reason: 'article-saved',
    })
  }) as any

  syncContentUpdatedListener = ((event: { path: string; content?: string }) => {
    if (!event?.path || !isMarkdownPath(event.path)) return
    enqueueSemanticExtraction({ filePath: event.path, content: event.content, reason: 'sync-content-updated' })
  }) as any

  editorInputListener = (() => queue.noteActivity()) as any
  articleOpenedListener = (() => queue.noteActivity()) as any

  emitter.on('article-saved', articleSavedListener)
  emitter.on('sync-content-updated', syncContentUpdatedListener)
  emitter.on('editor-input', editorInputListener)
  emitter.on('article-opened', articleOpenedListener)
  void recoverPendingSemanticExtractions({ limit: 25 }).catch(error => {
    console.warn('[SemanticExtractionQueue] startup recovery failed:', error)
  })

  return uninstallSemanticExtractionHook
}

export function uninstallSemanticExtractionHook() {
  if (articleSavedListener) emitter.off('article-saved', articleSavedListener)
  if (syncContentUpdatedListener) emitter.off('sync-content-updated', syncContentUpdatedListener)
  if (editorInputListener) emitter.off('editor-input', editorInputListener)
  if (articleOpenedListener) emitter.off('article-opened', articleOpenedListener)
  articleSavedListener = null
  syncContentUpdatedListener = null
  editorInputListener = null
  articleOpenedListener = null
  installed = false
}
