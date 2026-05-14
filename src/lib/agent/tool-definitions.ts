import type { Tool } from './types'
import type OpenAI from 'openai'

/**
 * 将内部 Tool 定义转换为 OpenAI Function Calling 格式
 */
export function convertToolToOpenAIFunction(tool: Tool): OpenAI.Chat.ChatCompletionTool {
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const param of tool.parameters) {
    const prop: any = {
      type: mapParamType(param.type),
      description: param.description,
    }

    if (param.type === 'array') {
      prop.items = { type: 'string' }
    }

    properties[param.name] = prop

    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      },
    },
  }
}

/**
 * 批量转换工具列表
 */
export function convertToolsToOpenAIFormat(tools: Tool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map(convertToolToOpenAIFunction)
}

function mapParamType(type: string): string {
  switch (type) {
    case 'string': return 'string'
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'array': return 'array'
    case 'object': return 'object'
    default: return 'string'
  }
}
