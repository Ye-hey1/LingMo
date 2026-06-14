import type { ToolCall } from '@/lib/agent'

export interface MessageCitationDetail {
  url?: string
  title?: string
  filename?: string
  filepath?: string
  articlePath?: string
  content?: string
  startLine?: number
  endLine?: number
  from?: number
  to?: number
  sourceType?: 'web' | 'note' | 'pdf' | 'image' | 'agent' | 'rag' | 'current' | 'linked' | 'quote'
  /** 搜索引擎来源（tavily/duckduckgo/anysearch/firecrawl/serpapi/exa/crawler） */
  engine?: string
  /** 来源可信度评分 0-1 */
  credibilityScore?: number
  /** 来源发布日期 */
  publishedAt?: string
}

export const RAG_DIAGNOSTIC_SOURCE_LABEL = 'RAG 检索诊断'
export const RAG_DIAGNOSTIC_SOURCE_PATH = 'rag-diagnostics'

type CitationSourceLike = Partial<Pick<
  MessageCitationDetail,
  'url' | 'title' | 'filename' | 'filepath' | 'articlePath' | 'sourceType'
>>

export function isRagDiagnosticSource(source?: string | null) {
  const normalized = source?.trim()
  return normalized === RAG_DIAGNOSTIC_SOURCE_LABEL || normalized === RAG_DIAGNOSTIC_SOURCE_PATH
}

export function isRagDiagnosticCitation(detail?: CitationSourceLike | null) {
  if (!detail) return false

  return [
    detail.title,
    detail.filename,
    detail.filepath,
    detail.articlePath,
    detail.url,
  ].some(isRagDiagnosticSource)
}

export function filterVisibleRagSources(sources: string[] = []) {
  const seen = new Set<string>()

  return sources.filter((source) => {
    const normalized = source.trim()
    if (!normalized || isRagDiagnosticSource(normalized) || seen.has(normalized)) {
      return false
    }

    seen.add(normalized)
    return true
  })
}

export function filterVisibleCitationDetails<T extends CitationSourceLike>(details: T[] = []) {
  return details.filter((detail) => !isRagDiagnosticCitation(detail))
}

function getHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function parseStoredAgentHistory(value?: string): { toolCalls?: ToolCall[] } | null {
  if (!value) return null

  try {
    return JSON.parse(value) as { toolCalls?: ToolCall[] }
  } catch {
    return null
  }
}

export function extractWebCitationDetails(toolCalls: ToolCall[] = []): MessageCitationDetail[] {
  const citations: MessageCitationDetail[] = []
  const seen = new Set<string>()

  const pushWebCitation = (citation: MessageCitationDetail) => {
    const url = citation.url?.trim()
    if (!url || seen.has(url)) return
    seen.add(url)
    citations.push(citation)
  }

  /**
   * 匹配工具名：支持精确匹配和 MCP 工具格式（serverId__toolName）
   */
  const matchesToolName = (toolName: string, target: string): boolean => {
    if (toolName === target) return true
    // MCP 工具：serverId__web_search → 匹配 web_search
    if (toolName.includes('__')) {
      const baseName = toolName.split('__').pop()!
      if (baseName === target) return true
    }
    return false
  }

  toolCalls.forEach((toolCall) => {
    if (toolCall.status !== 'success' || !toolCall.result?.success) return

    if (matchesToolName(toolCall.toolName, 'web_search')) {
      const results = toolCall.result.data?.results
      if (!Array.isArray(results)) return

      results.forEach((result) => {
        const url = typeof result?.url === 'string' ? result.url : ''
        const title = typeof result?.title === 'string' ? result.title : getHostLabel(url)
        const snippet = typeof result?.snippet === 'string' ? result.snippet : ''

        pushWebCitation({
          url,
          title,
          filename: getHostLabel(url),
          content: snippet,
          sourceType: 'web',
          engine: toolCall.toolName.includes('__') ? toolCall.toolName.split('__')[0] : 'web_search',
        })
      })
      return
    }

    if (matchesToolName(toolCall.toolName, 'web_fetch') || matchesToolName(toolCall.toolName, 'web_extract')) {
      const url = typeof toolCall.result.data?.url === 'string'
        ? toolCall.result.data.url
        : typeof toolCall.params?.url === 'string'
          ? toolCall.params.url
          : ''

      pushWebCitation({
        url,
        title: getHostLabel(url),
        filename: getHostLabel(url),
        content: typeof toolCall.result.data?.content === 'string' ? toolCall.result.data.content : '',
        sourceType: 'web',
      })
    }

    // 通用 MCP 搜索工具结果提取：尝试从结果数据中提取 URL 列表
    if (toolCall.toolName.includes('__') && !matchesToolName(toolCall.toolName, 'web_search') && !matchesToolName(toolCall.toolName, 'web_fetch')) {
      const data = toolCall.result.data
      if (!data) return

      // 尝试多种常见的搜索结果格式
      const items = Array.isArray(data?.results) ? data.results
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data) ? data
        : null

      if (!items) return

      items.forEach((item: any) => {
        if (!item || typeof item !== 'object') return
        const url = typeof item.url === 'string' ? item.url
          : typeof item.link === 'string' ? item.link
          : ''
        if (!url) return

        const title = typeof item.title === 'string' ? item.title : getHostLabel(url)
        const snippet = typeof item.snippet === 'string' ? item.snippet
          : typeof item.content === 'string' ? item.content
          : ''

        pushWebCitation({
          url,
          title,
          filename: getHostLabel(url),
          content: snippet,
          sourceType: 'web',
          engine: toolCall.toolName.split('__')[0],
        })
      })
    }
  })

  return citations
}
