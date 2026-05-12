import OpenAI from 'openai';
import { getAISettings, validateAIService, prepareMessages, createOpenAIClient, handleAIError, convertImageToBase64 } from './utils';
import type { AiConfig } from '@/app/core/setting/config'
import { estimateTokens } from './token-counter'

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
  if (/AI_TRANSPORT_ERROR|error sending request|Failed to fetch|NetworkError|connect/i.test(message)) return 'connect'
  if (/timeout|timed out/i.test(message)) return 'timeout'
  if (/status=401|401|Unauthorized/i.test(message)) return 'unauthorized'
  if (/status=429|429|rate limit/i.test(message)) return 'rate_limit'
  if (/status=5\d\d| 5\d\d/i.test(message)) return 'server'
  return 'unknown'
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
    console.error('Failed to record AI usage:', error)
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
 * @param text 请求文本
 * @param onUpdate 每次收到流式内容时的回调函数
 * @param abortSignal 用于终止请求的信号
 * @param mcpTools MCP 工具列表（可选）
 * @param t 翻译函数（可选）
 * @param chatId 当前chat ID，用于关联MCP工具调用记录（可选）
 * @param imageUrls 图片URL数组（可选）
 * @param onThinkingUpdate 每次收到思考内容时的回调函数（可选）
 * @param messages 消息数组（可选，如果提供则忽略 text 参数）
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
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  const startedAt = Date.now()
  let aiConfig: AiConfig | undefined
  let preparedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let totalToolCallCount = 0
  try {


    // 获取AI设置
    aiConfig = await getAISettings()

    // 验证AI服务
    const validatedBaseURL = await validateAIService(aiConfig?.baseURL)
    if (validatedBaseURL === null) {
      await recordAiUsage({
        aiConfig,
        storeKey: 'primaryModel',
        messages: preparedMessages,
        conversationId: chatId,
        success: false,
        errorKind: 'missing_config',
        latencyMs: Date.now() - startedAt,
      })
      return ''
    }

    // 准备消息 - 如果提供了 messages 数组，使用它；否则用 prepareMessages
    if (messages && messages.length > 0) {
      // 使用提供的消息数组
      const prepared = await prepareMessages('', messages)
      preparedMessages = prepared.messages
    } else {
      const prepared = await prepareMessages(text)
      preparedMessages = prepared.messages
    }

    // 如果有图片，将最后一条用户消息转换为多模态格式
    if (imageUrls && imageUrls.length > 0) {
      const lastMessage = preparedMessages[preparedMessages.length - 1]
      if (lastMessage && lastMessage.role === 'user') {
        const content: any[] = []

        // 添加所有图片（转换为 base64）
        for (const imageUrl of imageUrls) {
          try {
            // 将 Tauri URL 转换为 base64
            const base64Image = await convertImageToBase64(imageUrl)
            if (base64Image) {
              content.push({
                type: 'image_url',
                image_url: {
                  url: base64Image
                }
              })
            }
          } catch (error) {
            console.error('Failed to convert image to base64:', error)
          }
        }

        // 添加文本内容
        content.push({
          type: 'text',
          text: typeof lastMessage.content === 'string' ? lastMessage.content : ''
        })

        // 替换最后一条消息
        preparedMessages[preparedMessages.length - 1] = {
          role: 'user',
          content: content
        }
      }
    }

    const openai = await createOpenAIClient(aiConfig)

    // 构建请求参数
    const requestParams: any = {
      model: aiConfig?.model || '',
      messages: preparedMessages,
      temperature: aiConfig?.temperature ?? 0.7,
      top_p: aiConfig?.topP ?? 1,
      max_tokens: 4096,
      stream: true,
    }

    // 如果有 MCP 工具，添加到请求中
    if (mcpTools && mcpTools.length > 0) {
      requestParams.tools = mcpTools
      requestParams.tool_choice = 'auto'
    }

    const stream = await openai.chat.completions.create(requestParams, {
      signal: abortSignal
    }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

    let thinking = ''
    let fullContent = ''
    const toolCalls: any[] = []
    let hasToolCalls = false
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
      const delta = chunk.choices[0]?.delta
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
      
      // 处理普通内容
      if (content) {
        fullContent += content
      }

      onUpdate(fullContent)
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

        onUpdate('')
        
        // 执行所有工具调用
        const toolResults = []
        for (const toolCall of currentToolCalls) {
          let mcpToolCallId: string | undefined
          try {
            // 解析工具名称（格式：serverId__toolName）
            const fullName = toolCall.function.name
            const [serverId, ...toolNameParts] = fullName.split('__')
            const toolName = toolNameParts.join('__')
            
            // 解析参数
            let args = {}
            try {
              args = JSON.parse(toolCall.function.arguments)
            } catch (parseError) {
              const errorMsg = parseError instanceof Error ? parseError.message : 'Invalid JSON'
              throw new Error(`Invalid JSON in tool arguments: ${errorMsg}. Raw arguments: ${toolCall.function.arguments.slice(0, 200)}`)
            }
            
            // 记录 MCP 工具调用（如果提供了 chatId）
            if (chatId) {
              const { useMcpStore } = await import('@/stores/mcp')
              const { default: useChatStore } = await import('@/stores/chat')
              const mcpStore = useMcpStore.getState()
              const chatStore = useChatStore.getState()
              const server = mcpStore.servers.find(s => s.id === serverId)
              
              mcpToolCallId = `${toolCall.id}-${Date.now()}`
              chatStore.addMcpToolCall({
                id: mcpToolCallId,
                chatId,
                toolName,
                serverId,
                serverName: server?.name || serverId,
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
            
            // 更新 MCP 工具调用状态为成功
            if (chatId && mcpToolCallId) {
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
            if (chatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: `Error: ${errorMsg}`,
                status: 'error'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
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
        
        const nextStream = await openai.chat.completions.create({
          model: aiConfig?.model || '',
          messages: conversationMessages,
          temperature: aiConfig?.temperature ?? 0.7,
          top_p: aiConfig?.topP ?? 1,
          max_tokens: 4096,
          stream: true,
          tools: mcpTools,
          tool_choice: 'auto'
        }, {
          signal: abortSignal
        }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
        
        // 重置工具调用数组
        currentToolCalls = []
        thinking = ''
        fullContent = ''
        
        // 处理响应
        for await (const chunk of nextStream) {
          if (abortSignal?.aborted) {
            break;
          }
          
          const delta = chunk.choices[0]?.delta
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
            fullContent += content
          }
          onUpdate(fullContent)
        }
        
        // 如果没有新的工具调用，退出循环
        if (currentToolCalls.length === 0) {
          break
        }

        totalToolCallCount += currentToolCalls.length
      }
      
      if (iteration >= maxIterations) {
        console.warn('达到最大工具调用次数限制')
        const maxIterationsText = t ? t('record.mark.mark.chat.mcp.maxIterationsReached') : '⚠️ 达到最大工具调用次数限制'
        onUpdate(fullContent + '\n\n' + maxIterationsText)
      }
    }
    
    await recordAiUsage({
      aiConfig,
      storeKey: 'primaryModel',
      messages: preparedMessages,
      conversationId: chatId,
      toolCallCount: totalToolCallCount,
      success: true,
      latencyMs: Date.now() - startedAt,
    })

    return fullContent
  } catch (error) {
    console.error('[fetchAiStream] Error:', error)
    await recordAiUsage({
      aiConfig,
      storeKey: 'primaryModel',
      messages: preparedMessages,
      conversationId: chatId,
      toolCallCount: totalToolCallCount,
      success: false,
      errorKind: getErrorKind(error),
      latencyMs: Date.now() - startedAt,
    })
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
    return handleAIError(error) || ''
  }
}
