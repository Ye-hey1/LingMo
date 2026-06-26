export type McpToolErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'server'
  | 'outdated_skill'
  | 'not_connected'
  | 'invalid_arguments'
  | 'unknown'

export interface McpToolNameParts {
  fullName: string
  serverId?: string
  toolName: string
  label: string
}

export interface McpToolErrorInfo {
  kind: McpToolErrorKind
  title: string
  message: string
  suggestion: string
  retryable: boolean
  rawDetails: string
  skillHint?: string
  tool: McpToolNameParts
}

const OUTDATED_SKILL_RE = /outdated\s+mcp\s+skill|outdated\s+skill|update\s+your\s+skill|anysearch-ai\/anysearch-skill/i
const AUTH_RE = /invalid[_\s-]?api[_\s-]?key|invalid\s+api\s+key|api\s*key\s*(?:invalid|expired|missing|required)|unauthorized|\b401\b|forbidden|\b403\b|authentication|auth(?:orization)?\s+failed|permission\s+denied/i
const QUOTA_RE = /insufficient.*(?:balance|quota|credits?)|(?:balance|quota|credits?).*insufficient|quota\s+exceeded|payment\s+required|\b402\b|billing/i
const RATE_LIMIT_RE = /rate.?limit|too many requests|\b429\b/i
const TIMEOUT_RE = /timeout|timed?\s*out|deadline/i
const NETWORK_RE = /network|fetch|econnrefused|econnreset|enotfound|dns|socket|connection|failed to fetch|connect/i
const SERVER_RE = /status=5\d\d|http\s+5\d\d|\b5\d\d\b|upstream|server error|internal error|bad gateway|service unavailable|gateway timeout/i
const NOT_CONNECTED_RE = /server .*not connected|not connected|connection closed|server unavailable|mcp.*not.*ready/i
const INVALID_ARGUMENTS_RE = /invalid json|invalid argument|invalid arguments|missing required|required parameter|schema|参数/i

function stringifyErrorValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Error) {
    const detail = stringifyErrorValue((value as Error & { cause?: unknown }).cause)
    return [value.name, value.message, detail].filter(Boolean).join(': ')
  }
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const parts = [
      stringifyErrorValue(record.message),
      stringifyErrorValue(record.error),
      stringifyErrorValue(record.data),
      stringifyErrorValue(record.cause),
    ].filter(Boolean)
    if (parts.length > 0) {
      return parts.join('\n')
    }
  }
  try {
    const json = JSON.stringify(value, null, 2)
    return json === '{}' || json === '[]' ? '' : json
  } catch {
    return String(value)
  }
}

function dedupeLines(value: string): string {
  const lines = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(line)
  }
  return deduped.join('\n')
}

function compactRawDetails(value: string, maxLength = 900): string {
  const cleaned = dedupeLines(value)
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength).trim()}...`
}

export function parseMcpToolName(toolName: string): McpToolNameParts {
  const fullName = String(toolName || '').trim()
  const separatorIndex = fullName.indexOf('__')
  if (separatorIndex < 0) {
    const fallback = fullName || 'unknown'
    return {
      fullName: fallback,
      toolName: fallback,
      label: fallback,
    }
  }

  const serverId = fullName.slice(0, separatorIndex)
  const parsedToolName = fullName.slice(separatorIndex + 2) || fullName
  return {
    fullName,
    serverId,
    toolName: parsedToolName,
    label: parsedToolName,
  }
}

export function classifyMcpToolError(error: unknown): McpToolErrorKind {
  const text = stringifyErrorValue(error)

  if (AUTH_RE.test(text)) return 'auth'
  if (QUOTA_RE.test(text)) return 'quota'
  if (RATE_LIMIT_RE.test(text)) return 'rate_limit'
  if (TIMEOUT_RE.test(text)) return 'timeout'
  if (NOT_CONNECTED_RE.test(text)) return 'not_connected'
  if (NETWORK_RE.test(text)) return 'network'
  if (SERVER_RE.test(text)) return 'server'
  if (INVALID_ARGUMENTS_RE.test(text)) return 'invalid_arguments'
  if (OUTDATED_SKILL_RE.test(text)) return 'outdated_skill'
  return 'unknown'
}

export function extractMcpSkillHint(error: unknown): string | undefined {
  const text = stringifyErrorValue(error)
  if (!OUTDATED_SKILL_RE.test(text)) return undefined

  const lines = dedupeLines(text).split('\n')
  const matched = lines.find(line => OUTDATED_SKILL_RE.test(line))
  return matched || '该 MCP 服务返回了版本更新提示。'
}

export function formatMcpToolError(input: {
  toolName: string
  error?: unknown
  serverName?: string
}): McpToolErrorInfo {
  const rawDetails = compactRawDetails(stringifyErrorValue(input.error) || 'MCP 工具没有返回可解析的错误详情。')
  const kind = classifyMcpToolError(rawDetails)
  const tool = parseMcpToolName(input.toolName)
  const toolLabel = input.serverName
    ? `${input.serverName}/${tool.toolName}`
    : tool.label
  const skillHint = extractMcpSkillHint(rawDetails)

  switch (kind) {
    case 'auth':
      return {
        kind,
        title: 'MCP 工具认证失败',
        message: `${toolLabel} 的 API Key 无效、过期或没有传入。`,
        suggestion: '请在 MCP 设置中更新该服务的 API Key/环境变量或请求头，保存后重新连接服务再试。',
        retryable: false,
        rawDetails,
        skillHint,
        tool,
      }
    case 'quota':
      return {
        kind,
        title: 'MCP 服务额度不足',
        message: `${toolLabel} 所属服务返回额度或余额不足。`,
        suggestion: '请检查该 MCP 服务商账户余额、套餐额度，或切换到仍可用的服务。',
        retryable: false,
        rawDetails,
        skillHint,
        tool,
      }
    case 'rate_limit':
      return {
        kind,
        title: 'MCP 服务限流',
        message: `${toolLabel} 调用频率过高，被 MCP 服务或上游接口限制。`,
        suggestion: '请稍后重试，或降低并发/请求频率。',
        retryable: true,
        rawDetails,
        skillHint,
        tool,
      }
    case 'timeout':
      return {
        kind,
        title: 'MCP 工具调用超时',
        message: `${toolLabel} 响应时间过长。`,
        suggestion: '请检查 MCP 服务是否仍在运行、网络是否可用；必要时重连该服务后重试。',
        retryable: true,
        rawDetails,
        skillHint,
        tool,
      }
    case 'network':
      return {
        kind,
        title: 'MCP 服务连接失败',
        message: `${toolLabel} 无法连接到 MCP 服务或其上游接口。`,
        suggestion: '请确认本地 MCP 进程/HTTP 地址可访问，网络代理配置正确，然后重连服务。',
        retryable: true,
        rawDetails,
        skillHint,
        tool,
      }
    case 'server':
      return {
        kind,
        title: 'MCP 上游服务异常',
        message: `${toolLabel} 的 MCP 服务或上游接口暂时不可用。`,
        suggestion: '请稍后重试；如果连续失败，请打开 MCP 设置查看该服务日志或切换工具。',
        retryable: true,
        rawDetails,
        skillHint,
        tool,
      }
    case 'outdated_skill':
      return {
        kind,
        title: 'MCP 服务版本提示',
        message: `${toolLabel} 返回了版本更新提示。`,
        suggestion: '如果凭据确认无误，请按该 MCP 服务的提示更新对应服务/Skill 后重新连接。',
        retryable: false,
        rawDetails,
        skillHint,
        tool,
      }
    case 'not_connected':
      return {
        kind,
        title: 'MCP 服务未连接',
        message: `${toolLabel} 所属 MCP 服务当前不可用。`,
        suggestion: '请在 MCP 设置中重新连接该服务，确认状态为已连接后再调用。',
        retryable: true,
        rawDetails,
        skillHint,
        tool,
      }
    case 'invalid_arguments':
      return {
        kind,
        title: 'MCP 工具参数错误',
        message: `${toolLabel} 收到的参数不符合该工具要求。`,
        suggestion: '请检查工具入参格式、必填字段和 JSON 结构后重试。',
        retryable: false,
        rawDetails,
        skillHint,
        tool,
      }
    default:
      return {
        kind,
        title: 'MCP 工具执行失败',
        message: `${toolLabel} 调用失败，但服务没有返回明确错误类型。`,
        suggestion: '请检查该 MCP 服务是否正在运行、配置是否完整，并查看 MCP 设置里的服务日志。',
        retryable: true,
        rawDetails,
        skillHint,
        tool,
      }
  }
}

export function formatMcpToolErrorMessage(input: {
  toolName: string
  error?: unknown
  serverName?: string
  includeRawDetails?: boolean
}): string {
  const info = formatMcpToolError(input)
  const lines = [
    `${info.title}：${info.message}`,
    `建议：${info.suggestion}`,
  ]

  if (info.skillHint && info.kind !== 'auth') {
    lines.push(`服务提示：${info.skillHint}`)
  } else if (info.skillHint && info.kind === 'auth') {
    lines.push(`补充：该 MCP 服务还返回了版本提示，但当前应先修复 API Key。`)
  }

  if (input.includeRawDetails !== false && info.rawDetails) {
    lines.push(`原始错误：${info.rawDetails}`)
  }

  return lines.join('\n')
}

export function mcpErrorKindToToolErrorKind(kind: McpToolErrorKind): 'permission' | 'timeout' | 'network' | 'validation' | 'tool' {
  if (kind === 'auth') return 'permission'
  if (kind === 'timeout') return 'timeout'
  if (kind === 'network' || kind === 'server' || kind === 'not_connected' || kind === 'rate_limit') return 'network'
  if (kind === 'invalid_arguments') return 'validation'
  return 'tool'
}
