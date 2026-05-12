import type { ToolCall } from '@/lib/agent/types'

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

  toolCalls.forEach((toolCall) => {
    if (toolCall.status !== 'success' || !toolCall.result?.success) return

    if (toolCall.toolName === 'web_search') {
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
        })
      })
      return
    }

    if (toolCall.toolName === 'web_fetch') {
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
  })

  return citations
}
