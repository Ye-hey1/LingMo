'use client'

import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { fetchCompletion, fetchCompletionStream } from '@/lib/ai/completion'
import { getCompletionCache } from '@/lib/ai/completion-cache'
import { buildCompletionContext, type CompletionContext } from '@/lib/ai/completion-context'
import { isSubsetOfSuffix, removeSuffixOverlap } from '@/lib/ai/completion-dedup'
import { debounce } from 'lodash-es'

type GhostTextStorage = {
  ghostText: {
    enabled: boolean
  }
}

export interface GhostTextOptions {
  debounceTime: number
  enabled: boolean
}

interface GhostTextPluginState {
  prediction: string
  pos: number
  isLoading: boolean
  requestId: number
}

interface PredictionInput {
  context: string
  pos: number
  richContext: CompletionContext
}

export const ghostTextPluginKey = new PluginKey('ghostTextPlugin')

const STREAM_FLUSH_INTERVAL = 50
const CONTEXT_CHARS = 2200
const AFTER_CONTEXT_CHARS = 600
const MIN_CONTEXT_LENGTH = 15
const FIRST_TOKEN_TIMEOUT_MS = 2800
const REQUEST_TIMEOUT_MS = 9000
const STREAM_COMPLETION_TOKENS = 120
const FALLBACK_COMPLETION_TOKENS = 160
const PREDICTABLE_NODE_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote'])

export function getGhostTextStorage(editor: { storage: unknown }) {
  return (editor.storage as GhostTextStorage).ghostText
}

function getPredictionInput(view: EditorView): PredictionInput | null {
  const { selection, doc } = view.state

  if (!selection.empty) {
    return null
  }

  const pos = selection.from
  const $from = doc.resolve(pos)
  const nodeName = $from.parent.type.name

  if (!PREDICTABLE_NODE_TYPES.has(nodeName)) {
    return null
  }

  const richContext = buildCompletionContext(doc, pos, {
    beforeChars: CONTEXT_CHARS,
    afterChars: AFTER_CONTEXT_CHARS,
  })
  const context = richContext.textBefore

  if (context.trim().length < MIN_CONTEXT_LENGTH) {
    return null
  }

  return {
    context,
    pos,
    richContext,
  }
}

export function canRequestGhostTextCompletion(editor: Editor): boolean {
  return Boolean(getPredictionInput(editor.view))
}

export function requestGhostTextCompletion(editor: Editor): boolean {
  editor.commands.focus()

  if (!canRequestGhostTextCompletion(editor)) {
    return false
  }

  getGhostTextStorage(editor).enabled = true
  editor.view.dispatch(
    editor.state.tr.setMeta(ghostTextPluginKey, { type: 'REQUEST' })
  )
  return true
}

function createCacheContext(input: PredictionInput) {
  return `${input.context}\u241e${input.richContext.textAfter}`
}

function postProcessPrediction(prediction: string, suffix: string) {
  const withoutOverlap = removeSuffixOverlap(prediction, suffix)
  const trimmed = withoutOverlap.trim()

  if (trimmed.length >= 4 && isSubsetOfSuffix(trimmed, suffix.trim())) {
    return ''
  }

  return withoutOverlap
}

function isAbortLikeError(error: unknown) {
  return error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'Request was aborted.')
}

function isExpectedGhostTextError(error: unknown) {
  return isAbortLikeError(error) ||
    (error instanceof Error && error.name === 'AICompletionUnavailableError')
}

function createLinkedAbortController(parentSignal: AbortSignal) {
  const controller = new AbortController()

  if (parentSignal.aborted) {
    controller.abort()
    return { controller, dispose: () => {} }
  }

  const abort = () => controller.abort()
  parentSignal.addEventListener('abort', abort, { once: true })

  return {
    controller,
    dispose: () => parentSignal.removeEventListener('abort', abort),
  }
}

export const GhostTextExtension = Extension.create<GhostTextOptions>({
  name: 'ghostText',

  addOptions() {
    return {
      debounceTime: 500,
      enabled: true,
    }
  },

  addStorage() {
    return {
      prediction: '',
      pos: -1,
      isLoading: false,
      enabled: this.options.enabled,
    }
  },

  addProseMirrorPlugins() {
    const { options, editor } = this
    let abortController: AbortController | null = null
    let skipNextAutoRequest = false

    const cancelPrediction = () => {
      if (abortController) {
        abortController.abort()
        abortController = null
      }
      requestPrediction.cancel()
    }

    const clearPrediction = (view: EditorView) => {
      const pluginState = ghostTextPluginKey.getState(view.state) as GhostTextPluginState | undefined
      if (pluginState && (pluginState.prediction || pluginState.isLoading)) {
        view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
      }
    }

    const queuePrediction = (view: EditorView, immediate = false) => {
      if (!getGhostTextStorage(editor).enabled || !view.editable) {
        cancelPrediction()
        clearPrediction(view)
        return false
      }

      const input = getPredictionInput(view)
      if (!input) {
        cancelPrediction()
        clearPrediction(view)
        return false
      }

      cancelPrediction()
      requestPrediction(input, view)
      if (immediate) {
        requestPrediction.flush()
      }
      return true
    }

    const requestPrediction = debounce(async (input: PredictionInput, view: EditorView) => {
      if (!getGhostTextStorage(editor).enabled) return

      const cache = getCompletionCache()
      const cacheContext = createCacheContext(input)
      const cached = cache.get(cacheContext)

      if (cached) {
        view.dispatch(
          view.state.tr.setMeta(ghostTextPluginKey, {
            type: 'SET_PREDICTION',
            prediction: cached,
            pos: input.pos,
          })
        )
        return
      }

      if (abortController) {
        abortController.abort()
      }

      const controller = new AbortController()
      abortController = controller

      view.dispatch(
        view.state.tr.setMeta(ghostTextPluginKey, {
          type: 'SET_LOADING',
          isLoading: true,
          pos: input.pos,
        })
      )

      let chunkBuffer = ''
      let bufferTimer: ReturnType<typeof setTimeout> | null = null
      let firstTokenTimer: ReturnType<typeof setTimeout> | null = null
      let requestTimer: ReturnType<typeof setTimeout> | null = null
      let hasReceivedFirstChunk = false
      let accumulatedPrediction = ''

      requestTimer = setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

      const isActiveRequest = () => (
        getGhostTextStorage(editor).enabled &&
        !controller.signal.aborted &&
        abortController === controller
      )

      const flushBuffer = () => {
        if (!isActiveRequest()) {
          chunkBuffer = ''
          bufferTimer = null
          return
        }

        if (chunkBuffer) {
          accumulatedPrediction += chunkBuffer
          view.dispatch(
            view.state.tr.setMeta(ghostTextPluginKey, {
              type: 'APPEND_PREDICTION',
              chunk: chunkBuffer,
              pos: input.pos,
            })
          )
          chunkBuffer = ''
        }
        bufferTimer = null
      }

      const clearFirstTokenTimer = () => {
        if (firstTokenTimer) {
          clearTimeout(firstTokenTimer)
          firstTokenTimer = null
        }
      }

      const cleanupBuffer = () => {
        if (bufferTimer) {
          clearTimeout(bufferTimer)
          bufferTimer = null
        }
        flushBuffer()
      }

      const applyFallbackCompletion = async () => {
        if (!isActiveRequest()) {
          return false
        }

        const fallback = await fetchCompletion(
          input.context,
          controller.signal,
          input.richContext,
          {
            showErrorToast: false,
            maxTokens: FALLBACK_COMPLETION_TOKENS,
          }
        )

        if (!fallback || !isActiveRequest()) {
          return false
        }

        hasReceivedFirstChunk = true
        accumulatedPrediction = fallback
        chunkBuffer = ''
        view.dispatch(
          view.state.tr.setMeta(ghostTextPluginKey, {
            type: 'SET_PREDICTION',
            prediction: fallback,
            pos: input.pos,
          })
        )
        return true
      }

      const runStreamCompletion = async () => {
        const {
          controller: streamController,
          dispose: disposeStreamController,
        } = createLinkedAbortController(controller.signal)

        firstTokenTimer = setTimeout(() => {
          if (!hasReceivedFirstChunk && isActiveRequest()) {
            streamController.abort()
          }
        }, FIRST_TOKEN_TIMEOUT_MS)

        try {
          await fetchCompletionStream(
            input.context,
            (chunk, isFirst) => {
              if (!isActiveRequest()) return

              if (isFirst && !hasReceivedFirstChunk) {
                clearFirstTokenTimer()
                hasReceivedFirstChunk = true
                accumulatedPrediction = chunk
                view.dispatch(
                  view.state.tr.setMeta(ghostTextPluginKey, {
                    type: 'SET_PREDICTION',
                    prediction: chunk,
                    pos: input.pos,
                  })
                )
                return
              }

              chunkBuffer += chunk
              if (!bufferTimer) {
                bufferTimer = setTimeout(flushBuffer, STREAM_FLUSH_INTERVAL)
              }
            },
            streamController.signal,
            input.richContext,
            {
              showErrorToast: false,
              maxTokens: STREAM_COMPLETION_TOKENS,
            }
          )
        } finally {
          clearFirstTokenTimer()
          disposeStreamController()
        }
      }

      try {
        try {
          await runStreamCompletion()
        } catch (error: unknown) {
          cleanupBuffer()

          if (!hasReceivedFirstChunk && await applyFallbackCompletion()) {
            // A provider or proxy can accept the request but never emit stream
            // deltas. The fallback turns that stuck loading state into text.
          } else {
            throw error
          }
        }

        cleanupBuffer()

        if (!hasReceivedFirstChunk) {
          await applyFallbackCompletion()
        }

        const isCurrentRequest = abortController === controller
        if (!getGhostTextStorage(editor).enabled || controller.signal.aborted || !isCurrentRequest) {
          if (isCurrentRequest) {
            view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
          }
          return
        }

        const finalPrediction = postProcessPrediction(
          accumulatedPrediction,
          input.richContext.textAfter
        )

        if (!hasReceivedFirstChunk || !finalPrediction) {
          view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
          return
        }

        if (finalPrediction !== accumulatedPrediction) {
          view.dispatch(
            view.state.tr.setMeta(ghostTextPluginKey, {
              type: 'SET_PREDICTION',
              prediction: finalPrediction,
              pos: input.pos,
            })
          )
        }

        cache.set(cacheContext, finalPrediction)
      } catch (error: unknown) {
        const isCurrentRequest = abortController === controller
        cleanupBuffer()
        clearFirstTokenTimer()
        if (!isExpectedGhostTextError(error)) {
          console.error('[GhostText] Stream error:', error)
        }
        if (isCurrentRequest) {
          view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
        }
      } finally {
        clearFirstTokenTimer()
        if (requestTimer) {
          clearTimeout(requestTimer)
          requestTimer = null
        }
        if (abortController === controller) {
          abortController = null
        }
      }
    }, options.debounceTime)

    return [
      new Plugin({
        key: ghostTextPluginKey,
        state: {
          init(): GhostTextPluginState {
            return { prediction: '', pos: -1, isLoading: false, requestId: 0 }
          },
          apply(tr, value): GhostTextPluginState {
            const meta = tr.getMeta(ghostTextPluginKey)
            if (meta) {
              if (meta.type === 'REQUEST') {
                return {
                  prediction: '',
                  pos: -1,
                  isLoading: false,
                  requestId: value.requestId + 1,
                }
              }
              if (meta.type === 'SET_PREDICTION') {
                return {
                  prediction: meta.prediction,
                  pos: meta.pos,
                  isLoading: false,
                  requestId: value.requestId,
                }
              }
              if (meta.type === 'APPEND_PREDICTION') {
                return {
                  prediction: value.prediction + meta.chunk,
                  pos: meta.pos,
                  isLoading: false,
                  requestId: value.requestId,
                }
              }
              if (meta.type === 'SET_LOADING') {
                return {
                  ...value,
                  prediction: '',
                  isLoading: true,
                  pos: meta.pos,
                }
              }
              if (meta.type === 'CLEAR') {
                return {
                  prediction: '',
                  pos: -1,
                  isLoading: false,
                  requestId: value.requestId,
                }
              }
            }

            if (tr.docChanged || tr.selectionSet) {
              return {
                prediction: '',
                pos: -1,
                isLoading: false,
                requestId: value.requestId,
              }
            }

            return value
          },
        },
        view() {
          let handledRequestId = 0

          return {
            update(view, previousState) {
              const pluginState = ghostTextPluginKey.getState(view.state) as GhostTextPluginState | undefined

              if (!pluginState) {
                return
              }

              const manualRequest = pluginState.requestId !== handledRequestId

              if (!getGhostTextStorage(editor).enabled) {
                handledRequestId = pluginState.requestId
                cancelPrediction()
                clearPrediction(view)
                return
              }

              if (manualRequest) {
                handledRequestId = pluginState.requestId
                queuePrediction(view, true)
                return
              }

              const docChanged = view.state.doc !== previousState.doc
              if (docChanged) {
                if (skipNextAutoRequest) {
                  skipNextAutoRequest = false
                  return
                }
                queuePrediction(view)
                return
              }

              if (!view.state.selection.eq(previousState.selection)) {
                cancelPrediction()
              }
            },
            destroy() {
              cancelPrediction()
            },
          }
        },
        props: {
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(state) as GhostTextPluginState
            if (!pluginState || (!pluginState.prediction && !pluginState.isLoading) || pluginState.pos === -1) {
              return DecorationSet.empty
            }

            const { selection } = state
            if (selection.from !== pluginState.pos) {
              return DecorationSet.empty
            }

            const span = document.createElement('span')
            if (pluginState.prediction) {
              span.className = 'ghost-text select-none pointer-events-none opacity-40 text-muted-foreground transition-opacity whitespace-pre'
              span.textContent = pluginState.prediction
              span.style.fontStyle = 'italic'
            } else {
              span.className = 'ghost-text-loading select-none pointer-events-none text-muted-foreground whitespace-pre'
              span.textContent = ' AI 补全中...'
            }
            span.style.color = 'var(--muted-foreground, #8e8e93)'

            const decoration = Decoration.widget(pluginState.pos, span, {
              side: 1,
            })

            return DecorationSet.create(state.doc, [decoration])
          },
          handleKeyDown(view, event) {
            const state = view.state
            const pluginState = ghostTextPluginKey.getState(state) as GhostTextPluginState

            if (!getGhostTextStorage(editor).enabled) {
              cancelPrediction()
              clearPrediction(view)
              return false
            }

            if (event.key === 'Tab' && pluginState?.prediction) {
              event.preventDefault()
              cancelPrediction()
              skipNextAutoRequest = true

              const tr = state.tr.insertText(pluginState.prediction, pluginState.pos)
              tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' })
              view.dispatch(tr)
              editor.commands.focus()
              return true
            }

            if (event.key === 'Escape' && pluginState && (pluginState.prediction || pluginState.isLoading)) {
              event.preventDefault()
              cancelPrediction()
              view.dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              return true
            }

            if (pluginState && (pluginState.prediction || pluginState.isLoading)) {
              cancelPrediction()
              view.dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
            }

            return false
          },
          handleDOMEvents: {
            mousedown(view) {
              cancelPrediction()
              clearPrediction(view)
              return false
            },
            blur(view) {
              cancelPrediction()
              clearPrediction(view)
              return false
            },
          },
        },
      }),
    ]
  },
})
