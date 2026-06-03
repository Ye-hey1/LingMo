/**
 * 工具输入验证器
 *
 * 借鉴 claude-code-source Tool.validateInput 的设计模式：
 * 在工具执行前验证参数类型、必填项、取值范围，
 * 避免 LLM 生成无效参数导致执行失败浪费迭代。
 */

import type { Tool, ToolParameter } from './types'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  /** 自动修正后的参数（如类型转换） */
  correctedParams?: Record<string, any>
}

/**
 * 验证工具调用参数
 */
export function validateToolInput(
  tool: Tool,
  params: Record<string, any>,
): ValidationResult {
  const errors: string[] = []
  const correctedParams = { ...params }

  // 1. 检查必填参数
  for (const param of tool.parameters) {
    if (param.required && (params[param.name] === undefined || params[param.name] === null || params[param.name] === '')) {
      errors.push(`缺少必填参数: ${param.name} — ${param.description}`)
      continue
    }
  }

  // 2. 检查参数类型
  for (const param of tool.parameters) {
    const value = correctedParams[param.name]
    if (value === undefined || value === null) continue

    const typeError = checkType(param, value)
    if (typeError) {
      // 尝试自动修正类型
      const corrected = tryCorrectType(param, value)
      if (corrected !== undefined) {
        correctedParams[param.name] = corrected
      } else {
        errors.push(typeError)
      }
    }
  }

  // 3. 检查未知参数（可能是 LLM 幻觉）
  const knownParams = new Set(tool.parameters.map(p => p.name))
  const unknownKeys = Object.keys(params).filter(k => !knownParams.has(k))
  if (unknownKeys.length > 0) {
    // 静默移除未知参数而非报错，避免干扰 LLM
    for (const key of unknownKeys) {
      delete correctedParams[key]
    }
  }

  // 4. 应用默认值
  for (const param of tool.parameters) {
    if (correctedParams[param.name] === undefined && param.default !== undefined) {
      correctedParams[param.name] = param.default
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    correctedParams: Object.keys(correctedParams).length > 0 ? correctedParams : undefined,
  }
}

function checkType(param: ToolParameter, value: any): string | null {
  const actualType = typeof value

  switch (param.type) {
    case 'string':
      if (actualType !== 'string') {
        return `参数 ${param.name} 应为 string，实际为 ${actualType}`
      }
      break
    case 'number':
      if (actualType !== 'number' || isNaN(value)) {
        return `参数 ${param.name} 应为 number，实际为 ${actualType}`
      }
      break
    case 'boolean':
      if (actualType !== 'boolean') {
        return `参数 ${param.name} 应为 boolean，实际为 ${actualType}`
      }
      break
    case 'array':
      if (!Array.isArray(value)) {
        return `参数 ${param.name} 应为 array，实际为 ${actualType}`
      }
      break
    case 'object':
      if (actualType !== 'object' || Array.isArray(value) || value === null) {
        return `参数 ${param.name} 应为 object，实际为 ${actualType}`
      }
      break
  }

  return null
}

function tryCorrectType(param: ToolParameter, value: any): any {
  switch (param.type) {
    case 'string':
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      }
      break
    case 'number':
      if (typeof value === 'string') {
        const num = Number(value)
        if (!isNaN(num)) return num
      }
      break
    case 'boolean':
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
      }
      if (typeof value === 'number') {
        return value !== 0
      }
      break
    case 'array':
      if (typeof value === 'string') {
        // 尝试解析 JSON 数组
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) return parsed
        } catch { /* not JSON */ }
        // 逗号分隔字符串转数组
        if (value.includes(',')) {
          return value.split(',').map(s => s.trim()).filter(Boolean)
        }
      }
      break
  }

  return undefined
}

/**
 * 构建验证错误消息（给 LLM 的反馈）
 */
export function formatValidationErrors(toolName: string, result: ValidationResult): string {
  if (result.valid) return ''

  const lines = [`工具 "${toolName}" 参数验证失败：`]
  for (const error of result.errors) {
    lines.push(`- ${error}`)
  }
  lines.push('请检查参数格式后重新调用。')
  return lines.join('\n')
}
