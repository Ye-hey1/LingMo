import OpenAI from 'openai';
import { getAISettings, validateAIService, prepareMessages, createOpenAIClient, handleAIError } from './utils';
import type { AiConfig } from '@/app/core/setting/config'
import { estimateTokens } from './token-counter'
import { resolveThinkingSettings } from './model-capabilities'
import { isVisionContentUnsupportedError, prepareMessagesWithImages } from './vision-bridge'
import { createAiStreamContentProcessor } from './sanitize'
import { getAiRateLimitUserMessage, isAiRateLimitError } from './rate-limit'
import { formatMcpToolErrorMessage } from '../mcp/error-message'

function isChunkLoadFailure(error: unknown) {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === 'string'
      ? error
      : String(error ?? '')

  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|importing a module script failed/i.test(message)
}

export interface AiStreamFinishMetadata {
  finishReason?: string | null
  finishReasons: Array<string | null>
  truncated: boolean
  aborted: boolean
  contentLength: number
  toolCallCount: number
}

/**
 * fetchAiStream 的选项接口
 */
export interface FetchAiStreamOptions {
  /** 请求文本 */
  text: string
  /** 每次收到流式内容时的回调函数 */
  onUpdate: (content: string) => void
  /** 用于终止请求的信号 */
  abortSignal?: AbortSignal
  /** MCP 工具列表 */
  mcpTools?: any[]
  /** 翻译函数 */
  t?: (key: string, params?: Record<string, any>) => string
  /** 当前chat ID，用于关联MCP工具调用记录 */
  chatId?: number
  /** 图片URL数组 */
  imageUrls?: string[]
  /** 每次收到思考内容时的回调函数 */
  onThinkingUpdate?: (thinking: string) => void
  /** 消息数组（如果提供则忽略 text 参数） */
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  /** 最大token数限制 */
  maxTokens?: number
  /** 流完成时的回调函数 */
  onStreamFinish?: (metadata: AiStreamFinishMetadata) => void
  /** 模型store key */
  modelStoreKey?: string
  /** 仅用于长期记忆检索的语义查询；不会替换用户原始消息 */
  memoryRetrievalQuery?: string
}

function isTruncationFinishReason(reason?: string | null) {
  return reason === 'length' || reason === 'max_tokens'
}

function inferProvider(config?: AiConfig) {
  const source = `${config?.templateKey || ''} ${config?.key || ''} ${config?.title || ''} ${config?.baseURL || ''}`.toLowerCase()
  if (source.includes('deepseek')) return 'deepseek'
  if (source.includes('openai')) return 'openai'
  if (source.includes('anthropic') || source.includes('claude')) return 'anthropic'
  if (source.includes('gemini') || source.includes('google')) return 'google'
  if (source.includes('ollama')) return 'ollama'
  if (source.includes('openrouter')) return 'openrouter'
  if (source.includes('siliconflow')) return 'siliconflow'
  return config?.templateKey || config?.key || 'unknown'
}

function getErrorKind(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/Request was aborted|USER_STOPPED/i.test(message)) return 'aborted'
  if (/AI_STREAM_READ_ERROR|AI_TRANSPORT_ERROR|AI_JSON_PARSE_ERROR|error decoding response body|unexpected end of hex escape|error sending request|Failed to fetch|NetworkError|Load failed|connect/i.test(message)) return 'connect'
  if (/timeout|timed out/i.test(message)) return 'timeout'
  if (/status=401|401|Unauthorized/i.test(message)) return 'unauthorized'
  if (/status=402|402|payment required|insufficient.*balance|balance.*insufficient|insufficient.*quota|quota.*insufficient|quota exceeded|billing|credits?.*(?:exhausted|insufficient)|(?:exhausted|insufficient).*credits?/i.test(message)) return 'billing'
  if (/status=429|429|rate limit/i.test(message)) return 'rate_limit'
  if (/status=5\d\d| 5\d\d/i.test(message)) return 'server'
  return 'unknown'
}

function isExpectedAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) {
    return true
  }

  return error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'Request was aborted.')
}

function appendRateLimitNotice(content: string, error: unknown) {
  const notice = `> ${getAiRateLimitUserMessage(error)}`
  const trimmed = content.trim()
  return trimmed ? `${trimmed}\n\n${notice}` : notice
}

function estimateMessagesTokens(messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
  return messages.reduce((sum, message) => {
    if (!('content' in message)) return sum
    return sum + estimateTokens(flattenMessageContentToText(message.content))
  }, 0)
}

async function recordAiUsage(params: {
  aiConfig?: AiConfig
  storeKey?: string
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  conversationId?: number
  toolCallCount?: number
  success: boolean
  errorKind?: string
  latencyMs: number
}) {
  try {
    const { insertAiUsageEvent } = await import('@/db/ai-usage')
    await insertAiUsageEvent({
      platform: 'lingmo',
      provider: inferProvider(params.aiConfig),
      model: params.aiConfig?.model || '',
      modelType: params.aiConfig?.modelType || 'chat',
      storeKey: params.storeKey || 'primaryModel',
      conversationId: params.conversationId ?? null,
      messageCount: params.messages?.length || 0,
      tokenEstimate: params.messages ? estimateMessagesTokens(params.messages) : 0,
      toolCallCount: params.toolCallCount || 0,
      success: params.success,
      errorKind: params.errorKind || null,
      latencyMs: Math.max(0, Math.round(params.latencyMs)),
    })
  } catch (error) {
    if (isChunkLoadFailure(error)) {
      console.warn('Skipped AI usage recording because its chunk is not available. Refreshing the dev window or restarting the dev server will restore it.')
    } else {
      console.error('Failed to record AI usage:', error)
    }
  }
}

function flattenMessageContentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }

      const typedPart = part as { type?: string; text?: string }
      if (typedPart.type === 'text') {
        return typedPart.text || ''
      }

      if (typedPart.type === 'image_url') {
        return '[图片内容已省略]'
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toTextOnlyMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
  return messages.map((message) => {
    if (!('content' in message)) {
      return message
    }

    const nextContent = flattenMessageContentToText(message.content)
    if (typeof message.content === 'string') {
      return message
    }

    return {
      ...message,
      content: nextContent,
    } as OpenAI.Chat.ChatCompletionMessageParam
  })
}

/**
 * 非流式方式获取AI结果
 * @param text 请求文本
 * @param modelType 模型类型（可选）
 * @param messages 消息数组（可选，如果提供则忽略 text 参数）
 */
export async function fetchAi(
  text: string,
  modelType?: string,
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  const startedAt = Date.now()
  let aiConfig: AiConfig | undefined
  let finalMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  try {
    // 获取AI设置
    aiConfig = await getAISettings(modelType)

    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) {
      await recordAiUsage({
        aiConfig,
        storeKey: modelType || 'primaryModel',
        messages: finalMessages,
        success: false,
        errorKind: 'missing_config',
        latencyMs: Date.now() - startedAt,
      })
      return ''
    }

    // 准备消息
    const prepared = await prepareMessages(text, messages)
    finalMessages = toTextOnlyMessages(prepared.messages)

    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: finalMessages,
      temperature: aiConfig?.temperature ?? 0.7,
      top_p: aiConfig?.topP ?? 1,
      max_tokens: 4096,
    })

    await recordAiUsage({
      aiConfig,
      storeKey: modelType || 'primaryModel',
      messages: finalMessages,
      success: true,
      latencyMs: Date.now() - startedAt,
    })

    return completion.choices[0].message.content || ''
  } catch (error) {
    await recordAiUsage({
      aiConfig,
      storeKey: modelType || 'primaryModel',
      messages: finalMessages,
      success: false,
      errorKind: getErrorKind(error),
      latencyMs: Date.now() - startedAt,
    })
    return handleAIError(error) || ''
  }
}

/**
 * 流式方式获取AI结果
 * @param options 选项对象
 */
export async function fetchAiStream(options: FetchAiStreamOptions): Promise<string>
/**
 * 流式方式获取AI结果（旧版本，保持向后兼容）
 * @deprecated 请使用对象参数版本
 */
export async function fetchAiStream(
  text: string,
  onUpdate: (content: string) => void,
  abortSignal?: AbortSignal,
  mcpTools?: any[],
  t?: (key: string, params?: Record<string, any>) => string,
  chatId?: number,
  imageUrls?: string[],
  onThinkingUpdate?: (thinking: string) => void,
  messages?: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens?: number,
  onStreamFinish?: (metadata: AiStreamFinishMetadata) => void,
  modelStoreKey?: string,
): Promise<string>
export async function fetchAiStream(
  textOrOptions: string | FetchAiStreamOptions,
  onUpdate?: (content: string) => void,
  abortSignal?: AbortSignal,
  mcpTools?: any[],
  t?: (key: string, params?: Record<string, any>) => string,
  chatId?: number,
  imageUrls?: string[],
  onThinkingUpdate?: (thinking: string) => void,
  messages?: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens?: number,
  onStreamFinish?: (metadata: AiStreamFinishMetadata) => void,
  modelStoreKey?: string,
): Promise<string> {
  // 统一参数处理
  const options: FetchAiStreamOptions = typeof textOrOptions === 'string'
    ? {
        text: textOrOptions,
        onUpdate: onUpdate!,
        abortSignal,
        mcpTools,
        t,
        chatId,
        imageUrls,
        onThinkingUpdate,
        messages,
        maxTokens,
        onStreamFinish,
        modelStoreKey,
      }
    : textOrOptions

  const {
    text,
    onUpdate: handleUpdate,
    abortSignal: signal,
    mcpTools: tools,
    t: translate,
    chatId: currentChatId,
    imageUrls: urls,
    onThinkingUpdate: handleThinkingUpdate,
    messages: inputMessages,
    maxTokens: tokens,
    onStreamFinish: handleStreamFinish,
    modelStoreKey: storeKey,
    memoryRetrievalQuery,
  } = options

  const startedAt = Date.now()
  let aiConfig: AiConfig | undefined
  let preparedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let totalToolCallCount = 0
  let usageStoreKey = storeKey?.trim() || 'primaryModel'
  let fullContent = ''
  try {


    // 获取AI设置
    aiConfig = storeKey?.trim() ? await getAISettings(storeKey.trim()) : undefined
    if (!aiConfig) {
      aiConfig = await getAISettings()
      usageStoreKey = 'primaryModel'
    }

    // 验证AI服务
    const validatedBaseURL = await validateAIService(aiConfig?.baseURL)
    if (validatedBaseURL === null) {
      await recordAiUsage({
        aiConfig,
        storeKey: usageStoreKey,
        messages: preparedMessages,
        conversationId: currentChatId,
        success: false,
        errorKind: 'missing_config',
        latencyMs: Date.now() - startedAt,
      })
      return ''
    }

    // 准备消息 - 如果提供了 messages 数组，使用它；否则用 prepareMessages
    if (inputMessages && inputMessages.length > 0) {
      // 使用提供的消息数组
      const prepared = await prepareMessages('', inputMessages, { memoryRetrievalQuery })
      preparedMessages = prepared.messages
    } else {
      const prepared = await prepareMessages(text, undefined, { memoryRetrievalQuery })
      preparedMessages = prepared.messages
    }

    const openai = await createOpenAIClient(aiConfig)
    const thinkingSettings = resolveThinkingSettings(aiConfig)
    const capabilities = thinkingSettings.profile
    const textPreparedMessages = preparedMessages
    preparedMessages = await prepareMessagesWithImages(textPreparedMessages, aiConfig, urls, signal)

    // 构建请求参数
    const requestParams: any = {
      model: aiConfig?.model || '',
      messages: preparedMessages,
      temperature: aiConfig?.temperature ?? 0.7,
      top_p: aiConfig?.topP ?? 1,
      stream: true,
      ...thinkingSettings.requestPatch,
    }

    // 仅在调用方明确指定时设置 max_tokens，否则由模型自身决定上限
    if (tokens && tokens > 0) {
      requestParams.max_tokens = tokens
    }

    // 如果有 MCP 工具，添加到请求中
    if (tools && tools.length > 0) {
      requestParams.tools = tools
      if (capabilities.supportsToolChoice) {
        requestParams.tool_choice = 'auto'
      }
    }

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    try {
      stream = await openai.chat.completions.create(requestParams, {
        signal
      }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    } catch (error) {
      if (!urls?.length || !isVisionContentUnsupportedError(error)) {
        throw error
      }

      preparedMessages = await prepareMessagesWithImages(textPreparedMessages, aiConfig, urls, signal, {
        forceBridge: true,
      })
      requestParams.messages = preparedMessages
      stream = await openai.chat.completions.create(requestParams, {
        signal
      }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    }

    let thinking = ''
    const streamProcessor = createAiStreamContentProcessor()
    const toolCalls: any[] = []
    let hasToolCalls = false
    let finishReason: string | null | undefined
    const finishReasons: Array<string | null> = []
    
    for await (const chunk of stream) {
      if (signal?.aborted) {
        break;
      }
      
      const choice = chunk.choices[0]
      const delta = choice?.delta
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason
        finishReasons.push(choice.finish_reason)
      }
      const thinkingContent = (delta as any)?.reasoning_content || ''
      const content = delta?.content || ''
      
      if (thinkingContent) {
        // 处理思考内容
      }
      
      // 处理工具调用
      if (delta?.tool_calls) {
        hasToolCalls = true
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0
          
          // 初始化工具调用对象
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id || '',
              type: 'function',
              function: {
                name: toolCall.function?.name || '',
                arguments: ''
              }
            }
          }
          
          // 累积工具调用参数
          if (toolCall.function?.arguments) {
            toolCalls[index].function.arguments += toolCall.function.arguments
          }
          
          // 更新其他字段
          if (toolCall.id) {
            toolCalls[index].id = toolCall.id
          }
          if (toolCall.function?.name) {
            toolCalls[index].function.name = toolCall.function.name
          }
        }
      }
      
      // 如果有工具调用，不显示中间内容，直接跳过
      if (hasToolCalls) {
        continue
      }
      
      // 处理思考内容（通过独立回调）
      if (thinkingContent) {
        thinking += thinkingContent
        if (onThinkingUpdate) {
          onThinkingUpdate(thinking)
        }
      }
      
      // 处理普通内容，同时拆分部分模型直接输出的 <think>...</think>
      if (content) {
        const processed = streamProcessor.push(content)
        if (processed.thinking) {
          thinking += processed.thinking
          if (onThinkingUpdate) {
            onThinkingUpdate(thinking)
          }
        }
        if (processed.content) {
          fullContent += processed.content
        }
      }

      handleUpdate(fullContent)
    }

    const remaining = streamProcessor.flush()
    if (remaining.thinking) {
      thinking += remaining.thinking
      if (handleThinkingUpdate) {
        handleThinkingUpdate(thinking)
      }
    }
    if (remaining.content) {
      fullContent += remaining.content
      handleUpdate(fullContent)
    }

    // 如果有工具调用，执行工具并继续对话（支持多轮工具调用）
    if (toolCalls.length > 0) {
      totalToolCallCount += toolCalls.length
      // 动态导入 callTool 函数（避免循环依赖）
      const { callTool } = await import('../mcp/tools')

      // 初始化消息历史
      let conversationMessages = [...preparedMessages]
      let currentToolCalls = toolCalls
      const maxIterations = 10 // 防止无限循环
      let iteration = 0
      
      // 循环处理工具调用，直到 AI 不再调用工具
      while (currentToolCalls.length > 0 && iteration < maxIterations) {
        iteration++

        handleUpdate('')
        
        // 执行所有工具调用
        const toolResults = []
        for (const toolCall of currentToolCalls) {
          let mcpToolCallId: string | undefined
          const fullName = toolCall.function.name
          const [serverId, ...toolNameParts] = fullName.split('__')
          const toolName = toolNameParts.join('__')
          let serverName = serverId
          try {
            // 解析工具名称（格式：serverId__toolName）
            // 解析参数
            let args = {}
            try {
              args = JSON.parse(toolCall.function.arguments)
            } catch (parseError) {
              const errorMsg = parseError instanceof Error ? parseError.message : 'Invalid JSON'
              throw new Error(`Invalid JSON in tool arguments: ${errorMsg}. Raw arguments: ${toolCall.function.arguments.slice(0, 200)}`)
            }
            
            // 记录 MCP 工具调用（如果提供了 chatId）
            if (currentChatId) {
              const { useMcpStore } = await import('@/stores/mcp')
              const { default: useChatStore } = await import('@/stores/chat')
              const mcpStore = useMcpStore.getState()
              const chatStore = useChatStore.getState()
              const server = mcpStore.servers.find(s => s.id === serverId)
              serverName = server?.name || serverId
              
              mcpToolCallId = `${toolCall.id}-${Date.now()}`
              chatStore.addMcpToolCall({
                id: mcpToolCallId,
                chatId: currentChatId,
                toolName,
                serverId,
                serverName,
                params: args,
                result: '',
                status: 'calling',
                timestamp: Date.now()
              })
            }
            
            // 调用 MCP 工具
            const result = await callTool(serverId, toolName, args)

            // 格式化结果
            const resultText = result.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('\n')

            if (result.isError) {
              const friendlyError = formatMcpToolErrorMessage({
                toolName: fullName,
                error: resultText || 'Unknown MCP tool error',
                serverName,
              })

              if (currentChatId && mcpToolCallId) {
                const { default: useChatStore } = await import('@/stores/chat')
                const chatStore = useChatStore.getState()
                chatStore.updateMcpToolCall(mcpToolCallId, {
                  result: friendlyError,
                  status: 'error'
                })
              }

              toolResults.push({
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                content: friendlyError
              })
              continue
            }

            // 更新 MCP 工具调用状态为成功
            if (currentChatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: resultText || 'Tool executed successfully',
                status: 'success'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: resultText || 'Tool executed successfully'
            })
            
          } catch (error) {
            console.error('工具调用失败:', error)
            
            // 更新 MCP 工具调用状态为错误
            const friendlyError = formatMcpToolErrorMessage({
              toolName: fullName,
              error,
              serverName,
            })
            if (currentChatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: friendlyError,
                status: 'error'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: friendlyError
            })
          }
        }
        
        // 将工具调用和结果添加到消息历史
        conversationMessages = [
          ...conversationMessages,
          {
            role: 'assistant' as const,
            content: null,
            tool_calls: currentToolCalls
          },
          ...toolResults
        ]
        
        const nextRequestParams: any = {
          model: aiConfig?.model || '',
          messages: conversationMessages,
          temperature: aiConfig?.temperature ?? 0.7,
          top_p: aiConfig?.topP ?? 1,
          stream: true,
          tools: tools,
          ...thinkingSettings.requestPatch,
        }

        if (tokens && tokens > 0) {
          nextRequestParams.max_tokens = tokens
        }

        if (capabilities.supportsToolChoice) {
          nextRequestParams.tool_choice = 'auto'
        }

        const nextStream = await openai.chat.completions.create(nextRequestParams, {
          signal
        }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
        
        // 重置工具调用数组
        currentToolCalls = []
        thinking = ''
        fullContent = ''
        const nextStreamProcessor = createAiStreamContentProcessor()
        
        // 处理响应
        for await (const chunk of nextStream) {
          if (signal?.aborted) {
            break;
          }
          
          const choice = chunk.choices[0]
          const delta = choice?.delta
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
            finishReasons.push(choice.finish_reason)
          }
          const thinkingContent = (delta as any)?.reasoning_content || ''
          const content = delta?.content || ''
          
          // 检查是否又有新的工具调用
          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index || 0
              
              if (!currentToolCalls[index]) {
                currentToolCalls[index] = {
                  id: toolCall.id || '',
                  type: 'function',
                  function: {
                    name: toolCall.function?.name || '',
                    arguments: ''
                  }
                }
              }
              
              if (toolCall.function?.arguments) {
                currentToolCalls[index].function.arguments += toolCall.function.arguments
              }
              
              if (toolCall.id) {
                currentToolCalls[index].id = toolCall.id
              }
              if (toolCall.function?.name) {
                currentToolCalls[index].function.name = toolCall.function.name
              }
            }
          }
          
          // 如果有新的工具调用，不显示内容
          if (currentToolCalls.length > 0) {
            continue
          }
          
          // 处理思考内容（通过独立回调）
          if (thinkingContent) {
            thinking += thinkingContent
            if (onThinkingUpdate) {
              onThinkingUpdate(thinking)
            }
          }
          if (content) {
            const processed = nextStreamProcessor.push(content)
            if (processed.thinking) {
              thinking += processed.thinking
              if (handleThinkingUpdate) {
                handleThinkingUpdate(thinking)
              }
            }
            if (processed.content) {
              fullContent += processed.content
            }
          }
          handleUpdate(fullContent)
        }

        const remaining = nextStreamProcessor.flush()
        if (remaining.thinking) {
          thinking += remaining.thinking
          if (handleThinkingUpdate) {
            handleThinkingUpdate(thinking)
          }
        }
        if (remaining.content) {
          fullContent += remaining.content
          handleUpdate(fullContent)
        }
        
        // 如果没有新的工具调用，退出循环
        if (currentToolCalls.length === 0) {
          break
        }

        totalToolCallCount += currentToolCalls.length
      }
      
      if (iteration >= maxIterations) {
        console.warn('达到最大工具调用次数限制')
        const maxIterationsText = translate ? translate('record.mark.mark.chat.mcp.maxIterationsReached') : '⚠️ 达到最大工具调用次数限制'
        handleUpdate(fullContent + '\n\n' + maxIterationsText)
      }
    }

    handleStreamFinish?.({
      finishReason: finishReason ?? null,
      finishReasons,
      truncated: finishReasons.some(isTruncationFinishReason),
      aborted: Boolean(signal?.aborted),
      contentLength: fullContent.length,
      toolCallCount: totalToolCallCount,
    })
    
    await recordAiUsage({
      aiConfig,
      storeKey: usageStoreKey,
      messages: preparedMessages,
      conversationId: currentChatId,
      toolCallCount: totalToolCallCount,
      success: true,
      latencyMs: Date.now() - startedAt,
    })

    return fullContent
  } catch (error) {
    const aborted = isExpectedAbortError(error, signal)
    if (!aborted) {
      console.error('[fetchAiStream] Error:', error)
    }
    await recordAiUsage({
      aiConfig,
      storeKey: usageStoreKey,
      messages: preparedMessages,
      conversationId: currentChatId,
      toolCallCount: totalToolCallCount,
      success: false,
      errorKind: getErrorKind(error),
      latencyMs: Date.now() - startedAt,
    })
    if (aborted) {
      handleStreamFinish?.({
        finishReason: null,
        finishReasons: [],
        truncated: false,
        aborted: true,
        contentLength: 0,
        toolCallCount: totalToolCallCount,
      })
      return ''
    }
    if (isAiRateLimitError(error) && fullContent.trim()) {
      const fallbackContent = appendRateLimitNotice(fullContent, error)
      handleUpdate(fallbackContent)
      handleStreamFinish?.({
        finishReason: 'rate_limit',
        finishReasons: ['rate_limit'],
        truncated: false,
        aborted: false,
        contentLength: fallbackContent.length,
        toolCallCount: totalToolCallCount,
      })
      return fallbackContent
    }
    return handleAIError(error) || ''
  }
}

/**
 * 流式方式获取AI结果，每次返回本次 token
 * @param text 请求文本
 * @param onUpdate 每次收到流式内容时的回调函数
 * @param abortSignal 用于终止请求的信号
 */
export async function fetchAiStreamToken(text: string, onUpdate: (content: string) => void, abortSignal?: AbortSignal): Promise<string> {
  const startedAt = Date.now()
  let aiConfig: AiConfig | undefined
  let messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  try {
    // 获取AI设置
    aiConfig = await getAISettings()
    
    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) {
      await recordAiUsage({
        aiConfig,
        storeKey: 'primaryModel',
        messages,
        success: false,
        errorKind: 'missing_config',
        latencyMs: Date.now() - startedAt,
      })
      return ''
    }
    
    // 准备消息
    const prepared = await prepareMessages(text)
    messages = prepared.messages
  
    const openai = await createOpenAIClient(aiConfig)

    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature ?? 0.7,
      top_p: aiConfig?.topP ?? 1,
      max_tokens: 4096,
      stream: true,
    }, {
      signal: abortSignal
    })
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        onUpdate(content)
      }
    }
    
    await recordAiUsage({
      aiConfig,
      storeKey: 'primaryModel',
      messages,
      success: true,
      latencyMs: Date.now() - startedAt,
    })

    return ''
  } catch (error) {
    await recordAiUsage({
      aiConfig,
      storeKey: 'primaryModel',
      messages,
      success: false,
      errorKind: getErrorKind(error),
      latencyMs: Date.now() - startedAt,
    })
    if (isExpectedAbortError(error, abortSignal)) {
      return ''
    }
    return handleAIError(error) || ''
  }
}
