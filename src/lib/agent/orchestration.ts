import type { ReActStep, ToolResult } from './types'
import type { LoopDetectionResult } from './loop-detection'

export const SIMPLE_AGENT_GREETING_REPLY = '你好！我是小墨，你的本地知识管理agent助手。'

type SafeGrepMatch = {
  filePath: string
  line: number
  preview: string
}

export type SafeGrepSummary = {
  query: string
  folderPath: string
  matchCount: number
  truncated: boolean
  candidateFiles: Array<{
    filePath: string
    count: number
    firstLine?: number
    preview?: string
  }>
  sampleMatches: SafeGrepMatch[]
}

const SIMPLE_GREETINGS = new Set([
  '你好',
  '您好',
  '嗨',
  '哈喽',
  '哈罗',
  '在吗',
  '在不在',
  'hello',
  'hi',
  'hey',
])

const SIMPLE_THANKS = new Set([
  '谢谢',
  '感谢',
  'thanks',
  'thankyou',
  'thx',
])

function compactSemanticText(value: string) {
  return Array.from(value.toLowerCase())
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .join('')
}

export function getDirectAgentReply(userInput: string, imageUrls?: string[]): string | null {
  if (imageUrls && imageUrls.length > 0) {
    return null
  }

  const compact = compactSemanticText(userInput)
  if (!compact) {
    return null
  }

  if (SIMPLE_GREETINGS.has(compact) || compact === '你好小墨' || compact === 'hi小墨') {
    return SIMPLE_AGENT_GREETING_REPLY
  }

  if (SIMPLE_THANKS.has(compact)) {
    return '不客气，我在。'
  }

  return null
}

function unpackCompressedData(data: any) {
  if (data?.compressed === true && typeof data.preview === 'string') {
    try {
      return JSON.parse(data.preview)
    } catch {
      return data
    }
  }

  return data
}

function toSafeGrepMatch(value: any): SafeGrepMatch | null {
  const filePath = typeof value?.filePath === 'string' ? value.filePath : ''
  if (!filePath) {
    return null
  }

  const line = typeof value.line === 'number' ? value.line : 0
  const preview = typeof value.preview === 'string' ? value.preview : ''
  return {
    filePath,
    line,
    preview: preview.slice(0, 180),
  }
}

export function summarizeSafeGrepData(data: any, maxFiles = 8, maxMatches = 12): SafeGrepSummary | null {
  const raw = unpackCompressedData(data)
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const rawSampleMatches: unknown[] | null = Array.isArray(raw.sampleMatches) ? raw.sampleMatches : null
  const rawMatchList: unknown[] | null = Array.isArray(raw.matches) ? raw.matches : null
  const sampleMatches = rawSampleMatches
    ? rawSampleMatches.map(toSafeGrepMatch).filter((match): match is SafeGrepMatch => Boolean(match)).slice(0, maxMatches)
    : rawMatchList
      ? rawMatchList.map(toSafeGrepMatch).filter((match): match is SafeGrepMatch => Boolean(match)).slice(0, maxMatches)
      : []

  const rawMatches = rawMatchList
    ? rawMatchList.map(toSafeGrepMatch).filter((match): match is SafeGrepMatch => Boolean(match))
    : sampleMatches

  const query = typeof raw.query === 'string' ? raw.query : ''
  const folderPath = typeof raw.folderPath === 'string' ? raw.folderPath : ''
  const matchCount = typeof raw.matchCount === 'number'
    ? raw.matchCount
    : typeof raw.itemCount === 'number'
      ? raw.itemCount
      : rawMatches.length
  const truncated = raw.truncated === true || raw.wasTruncated === true

  const fileMap = new Map<string, SafeGrepSummary['candidateFiles'][number]>()
  for (const match of rawMatches) {
    const existing = fileMap.get(match.filePath)
    if (existing) {
      existing.count += 1
      continue
    }

    fileMap.set(match.filePath, {
      filePath: match.filePath,
      count: 1,
      firstLine: match.line || undefined,
      preview: match.preview || undefined,
    })
  }

  const candidateFiles = Array.isArray(raw.candidateFiles)
    ? raw.candidateFiles
        .filter((item: any) => typeof item?.filePath === 'string')
        .map((item: any) => ({
          filePath: item.filePath,
          count: typeof item.count === 'number' ? item.count : 1,
          firstLine: typeof item.firstLine === 'number' ? item.firstLine : undefined,
          preview: typeof item.preview === 'string' ? item.preview.slice(0, 180) : undefined,
        }))
        .slice(0, maxFiles)
    : Array.from(fileMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, maxFiles)

  return {
    query,
    folderPath,
    matchCount,
    truncated,
    candidateFiles,
    sampleMatches,
  }
}

function formatSafeGrepObservation(result: ToolResult): string | null {
  const summary = summarizeSafeGrepData(result.data)
  if (!summary) {
    return null
  }

  if (summary.matchCount === 0) {
    return [
      `safe_grep 未检索到匹配结果${summary.query ? `：${summary.query}` : ''}。`,
      '下一步：换一个更贴近用户目标的关键词，或直接基于已有上下文回答。',
    ].join('\n')
  }

  const lines = [
    `safe_grep 检索到 ${summary.matchCount} 条${summary.truncated ? '（已截断）' : ''}${summary.query ? `：${summary.query}` : ''}。`,
  ]

  if (summary.candidateFiles.length > 0) {
    lines.push('候选文件：')
    for (const item of summary.candidateFiles) {
      const lineText = item.firstLine ? `第 ${item.firstLine} 行` : '匹配位置'
      const countText = item.count > 1 ? `，${item.count} 条匹配` : ''
      const previewText = item.preview ? `：${item.preview}` : ''
      lines.push(`- ${item.filePath}（${lineText}${countText}）${previewText}`)
    }
  }

  lines.push(
    summary.truncated
      ? '下一步：不要重复宽泛 safe_grep；请读取上面的具体文件，或用更具体 query、folderPath、includeExtensions 收窄后再搜索。'
      : '下一步：优先读取最相关的具体文件，再给出结论。'
  )

  return lines.join('\n')
}

export function formatToolObservation(toolName: string, result: ToolResult): string | null {
  if (toolName === 'safe_grep' && result.success) {
    return formatSafeGrepObservation(result)
  }

  return null
}

export function isTruncatedSafeGrepObservation(observation?: string): boolean {
  if (!observation) {
    return false
  }

  return /safe_grep 检索到 \d+ 条（已截断）|Found \d+ matches \(truncated\)|"truncated"\s*:\s*true|已截断/.test(observation)
}

function normalizeSafeGrepParams(params: Record<string, any> = {}) {
  const query = typeof params.query === 'string' ? compactSemanticText(params.query) : ''
  const folderPath = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
  const includeExtensions = Array.isArray(params.includeExtensions)
    ? params.includeExtensions.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean).sort()
    : []

  return {
    query,
    folderPath,
    includeExtensions,
  }
}

function hasSearchNarrowing(current: ReturnType<typeof normalizeSafeGrepParams>, previous: ReturnType<typeof normalizeSafeGrepParams>) {
  if (current.folderPath && current.folderPath !== previous.folderPath) {
    return true
  }

  if (current.includeExtensions.length > 0 && previous.includeExtensions.length === 0) {
    return true
  }

  return current.query.length >= previous.query.length + 3 && current.query.includes(previous.query)
}

export function getSafeGrepConvergenceMessage(
  toolName: string,
  params: Record<string, any>,
  steps: ReActStep[]
): string | null {
  if (toolName !== 'safe_grep') {
    return null
  }

  const truncatedSearches = steps
    .filter((step) => step.action?.tool === 'safe_grep' && isTruncatedSafeGrepObservation(step.observation))
    .slice(-3)

  if (truncatedSearches.length === 0) {
    return null
  }

  const current = normalizeSafeGrepParams(params)
  const last = truncatedSearches[truncatedSearches.length - 1]
  const lastParams = normalizeSafeGrepParams(last.action?.params || {})
  const sameSearch = current.query === lastParams.query &&
    current.folderPath === lastParams.folderPath &&
    current.includeExtensions.join(',') === lastParams.includeExtensions.join(',')
  const broadCurrent = !current.folderPath && current.includeExtensions.length === 0 && current.query.length <= 16

  if (!sameSearch && !(truncatedSearches.length >= 2 && broadCurrent && !hasSearchNarrowing(current, lastParams))) {
    return null
  }

  return 'safe_grep 结果已截断，继续宽泛搜索不会增加有效信息。请读取上一轮候选文件，或使用更具体的 query、folderPath、includeExtensions 收窄检索。'
}

function summarizeObservationForUser(observation?: string) {
  if (!observation) {
    return ''
  }

  const cleaned = observation
    .replace(/^\[cached\]\s*/i, '')
    .split(/\n\s*数据详情：\s*\n/)[0]
    .trim()

  if (
    /Action Input JSON|你只输出了思考内容|请直接输出|已调整工具选择|已避免重复探索|工具 .+执行失败|工具 .+执行出错/.test(cleaned)
  ) {
    return ''
  }

  return cleaned.length > 900 ? `${cleaned.slice(0, 900).trim()}...` : cleaned
}

export function buildLoopFallbackAnswer(loopResult: LoopDetectionResult, steps: ReActStep[]) {
  const usefulSteps = steps.filter((step) =>
    step.action &&
    step.observation &&
    !step.observation.includes('失败') &&
    !step.observation.includes('错误') &&
    !step.observation.includes('无法解析') &&
    !step.observation.includes('你只输出')
  )
  const lastUseful = usefulSteps[usefulSteps.length - 1]
  const currentClue = summarizeObservationForUser(lastUseful?.observation)

  return [
    '我已停止重复操作，避免继续消耗时间。',
    loopResult.suggestion ? `下一步建议：${loopResult.suggestion}` : '',
    currentClue ? `目前已有线索：\n${currentClue}` : '目前还没有得到足够可靠的内容结论。',
  ].filter(Boolean).join('\n\n')
}
