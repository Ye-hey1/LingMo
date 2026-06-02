'use client'

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { fetchCompletionStream } from '@/lib/ai/completion'
import { getCompletionCache } from '@/lib/ai/completion-cache'
import { buildCompletionContext, type CompletionContext } from '@/lib/ai/completion-context'
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
}

export const ghostTextPluginKey = new PluginKey('ghostTextPlugin')

// 流式 chunk 缓冲常量：每 50ms 刷新一次，防止 ProseMirror 事务洪泛
const STREAM_FLUSH_INTERVAL = 50

export function getGhostTextStorage(editor: { storage: unknown }) {
  return (editor.storage as GhostTextStorage).ghostText
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

    // 防抖发送 AI 预测请求（流式版本 + 缓存 + 多级上下文）
    const requestPrediction = debounce(async (context: string, pos: number, view: any, richContext?: CompletionContext) => {
      if (!getGhostTextStorage(editor).enabled) return

      // 优先检查缓存：命中则直接显示灰字，跳过网络请求
      const cache = getCompletionCache()
      const cached = cache.get(context)
      if (cached) {
        view.dispatch(
          view.state.tr.setMeta(ghostTextPluginKey, {
            type: 'SET_PREDICTION',
            prediction: cached,
            pos,
          })
        )
        return
      }

      if (abortController) {
        abortController.abort()
      }
      const controller = new AbortController()
      abortController = controller

      // 设置加载状态
      view.dispatch(
        view.state.tr.setMeta(ghostTextPluginKey, {
          type: 'SET_LOADING',
          isLoading: true,
          pos,
        })
      )

      // 流式 chunk 缓冲区
      let chunkBuffer = ''
      let bufferTimer: ReturnType<typeof setTimeout> | null = null
      let hasReceivedFirstChunk = false
      let accumulatedPrediction = ''

      // 刷新缓冲区：将累积的 chunk 批量 dispatch 到 ProseMirror
      const flushBuffer = () => {
        if (!getGhostTextStorage(editor).enabled || controller.signal.aborted || abortController !== controller) {
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
              pos,
            })
          )
          chunkBuffer = ''
        }
        bufferTimer = null
      }

      // 流式结束时清理缓冲区
      const cleanupBuffer = () => {
        if (bufferTimer) {
          clearTimeout(bufferTimer)
          bufferTimer = null
        }
        // 刷出剩余的缓冲内容
        flushBuffer()
      }

      try {
        await fetchCompletionStream(
          context,
          (chunk, isFirst) => {
            // 检查是否已被取消
            if (!getGhostTextStorage(editor).enabled || controller.signal.aborted || abortController !== controller) return

            if (isFirst && !hasReceivedFirstChunk) {
              // 首个 chunk 直接设置预测文本
              hasReceivedFirstChunk = true
              accumulatedPrediction = chunk
              view.dispatch(
                view.state.tr.setMeta(ghostTextPluginKey, {
                  type: 'SET_PREDICTION',
                  prediction: chunk,
                  pos,
                })
              )
            } else {
              // 后续 chunk 放入缓冲区，定时刷新
              chunkBuffer += chunk
              if (!bufferTimer) {
                bufferTimer = setTimeout(flushBuffer, STREAM_FLUSH_INTERVAL)
              }
            }
          },
          controller.signal,
          richContext
        )

        // 流式完成，刷出剩余缓冲
        cleanupBuffer()

        const isCurrentRequest = abortController === controller
        if (!getGhostTextStorage(editor).enabled || controller.signal.aborted || !isCurrentRequest) {
          if (isCurrentRequest) {
            view.dispatch(
              view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' })
            )
          }
          return
        }

        // 如果整个流没有产生任何预测，清空状态
        if (!hasReceivedFirstChunk) {
          view.dispatch(
            view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' })
          )
        } else if (accumulatedPrediction) {
          // 流式成功完成，将最终预测结果写入缓存
          cache.set(context, accumulatedPrediction)
        }
      } catch (error: any) {
        const isCurrentRequest = abortController === controller
        cleanupBuffer()
        if (error.name !== 'AbortError') {
          console.error('[GhostText] Stream error:', error)
        }
        if (isCurrentRequest) {
          view.dispatch(
            view.state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' })
          )
        }
      } finally {
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
            return { prediction: '', pos: -1, isLoading: false }
          },
          apply(tr, value): GhostTextPluginState {
            const meta = tr.getMeta(ghostTextPluginKey)
            if (meta) {
              if (meta.type === 'SET_PREDICTION') {
                return { prediction: meta.prediction, pos: meta.pos, isLoading: false }
              }
              if (meta.type === 'APPEND_PREDICTION') {
                // 流式追加：增量更新预测文本
                return {
                  prediction: value.prediction + meta.chunk,
                  pos: meta.pos,
                  isLoading: false,
                }
              }
              if (meta.type === 'SET_LOADING') {
                return { ...value, isLoading: true, pos: meta.pos }
              }
              if (meta.type === 'CLEAR') {
                return { prediction: '', pos: -1, isLoading: false }
              }
            }

            // 如果文档或选区发生了改变，并且不是由该 plugin 引起的，就清空预测
            if (tr.docChanged || tr.selectionSet) {
              return { prediction: '', pos: -1, isLoading: false }
            }

            return value
          },
        },
        props: {
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(state) as GhostTextPluginState
            if (!pluginState || !pluginState.prediction || pluginState.pos === -1) {
              return DecorationSet.empty
            }

            // 检查当前光标是否仍在原来的位置
            const { selection } = state
            if (selection.from !== pluginState.pos) {
              return DecorationSet.empty
            }

            // 绘制半透明灰色的行内预测文本 widget
            const span = document.createElement('span')
            span.className = 'ghost-text select-none pointer-events-none opacity-40 text-muted-foreground transition-opacity whitespace-pre'
            span.textContent = pluginState.prediction
            span.style.color = 'var(--muted-foreground, #8e8e93)'
            span.style.fontStyle = 'italic'

            const decoration = Decoration.widget(pluginState.pos, span, {
              side: 1, // 渲染在光标右侧
            })

            return DecorationSet.create(state.doc, [decoration])
          },
          handleKeyDown(view, event) {
            const state = view.state
            const pluginState = ghostTextPluginKey.getState(state) as GhostTextPluginState

            if (!getGhostTextStorage(editor).enabled) {
              if (abortController) {
                abortController.abort()
                abortController = null
              }
              requestPrediction.cancel()
              if (pluginState && (pluginState.prediction || pluginState.isLoading)) {
                view.dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              }
              return false
            }

            // 1. 如果当前有灰字，按下 Tab 键则一键采纳
            if (event.key === 'Tab' && pluginState && pluginState.prediction) {
              event.preventDefault()
              const { dispatch } = view
              const insertText = pluginState.prediction

              // 插入预测文字
              const tr = state.tr.insertText(insertText, pluginState.pos)
              // 清理灰字状态
              tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' })
              dispatch(tr)

              // 触发编辑器的自动更新
              editor.commands.focus()
              return true
            }

            // 2. 如果按下 Escape，直接清除灰字
            if (event.key === 'Escape' && pluginState && pluginState.prediction) {
              event.preventDefault()
              const { dispatch } = view
              dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              return true
            }

            // 3. 按下其他任何键，取消之前的 AI 请求并清除当前的预测灰字
            if (abortController) {
              abortController.abort()
              abortController = null
            }
            requestPrediction.cancel()

            // 仅对非控制字符输入触发重新灰字预测打字检测
            const isCharacterKey = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
            const isBackspace = event.key === 'Backspace'

            if (isCharacterKey || isBackspace) {
              const { dispatch } = view
              // 先静默清空当前灰字
              if (pluginState && pluginState.prediction) {
                dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              }

              // 防抖调度下一次预测
              // 需要在 keydown 事件分发完、ProseMirror 状态更新后触发，所以用 setTimeout 包裹
              setTimeout(() => {
                const currentSelection = view.state.selection
                if (!currentSelection.empty) return

                const currentPos = currentSelection.from
                const $from = view.state.doc.resolve(currentPos)

                // 仅在 paragraph / heading / listItem 等文本节点内部进行预测
                const nodeName = $from.parent.type.name
                if (nodeName !== 'paragraph' && nodeName !== 'heading' && nodeName !== 'listItem') return

                // 提取上下文（扩展到 500 字符）
                const contextStart = Math.max(0, currentPos - 500)
                const context = view.state.doc.textBetween(contextStart, currentPos)

                if (context.trim().length >= 15) {
                  // 构建多级上下文
                  const richContext = buildCompletionContext(view.state.doc, currentPos)
                  requestPrediction(context, currentPos, view, richContext)
                }
              }, 50)
            } else {
              // 其他操作如方向键移动光标，直接清除
              if (pluginState && (pluginState.prediction || pluginState.isLoading)) {
                view.dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              }
            }

            return false
          },
          handleDOMEvents: {
            mousedown(view) {
              // 鼠标点击时立刻清除
              const state = view.state
              const pluginState = ghostTextPluginKey.getState(state) as GhostTextPluginState
              if (pluginState && (pluginState.prediction || pluginState.isLoading)) {
                view.dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              }
              if (abortController) {
                abortController.abort()
                abortController = null
              }
              requestPrediction.cancel()
              return false
            },
            blur(view) {
              // 失去焦点时立刻清除
              const state = view.state
              const pluginState = ghostTextPluginKey.getState(state) as GhostTextPluginState
              if (pluginState && (pluginState.prediction || pluginState.isLoading)) {
                view.dispatch(state.tr.setMeta(ghostTextPluginKey, { type: 'CLEAR' }))
              }
              if (abortController) {
                abortController.abort()
                abortController = null
              }
              requestPrediction.cancel()
              return false
            }
          }
        },
      }),
    ]
  },
})
