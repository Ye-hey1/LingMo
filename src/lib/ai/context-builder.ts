/**
 * 上下文构建器
 * 统一处理 Chat 和 Agent 模式的上下文构建逻辑
 */

import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getContextForQuery, getContextForQueryInFolder } from '@/lib/rag'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { searchWeb } from '@/lib/tavily'
import { decideDocumentGrounding } from '@/lib/ai/document-grounding'
import type { LinkedResource } from '@/lib/files'
import { isLinkedFolder } from '@/lib/files'
import type { RagSource } from '@/lib/rag'

// ============================================================
// Types
// ============================================================

export interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

export interface ChatCitationSource extends RagSource {
  url?: string
  title?: string
  sourceType?: 'rag' | 'web' | 'current' | 'linked' | 'quote'
  startLine?: number
  endLine?: number
  from?: number
  to?: number
}

export type RagStrategy = 'off' | 'document-first' | 'supplement'

export interface ContextBuildDiagnostics {
  strategy: RagStrategy
  ragEnabled: boolean
  ragSkippedReason?: string
  ragQuery: string
  ragKeywords: string[]
  webEnabled: boolean
  currentNoteInjected: boolean
  linkedFileCount: number
  linkedFileInjectedCount: number
  quoteInjected: boolean
  ragSourceCount: number
  injectedChars: {
    web: number
    current: number
    linked: number
    quote: number
    rag: number
    total: number
  }
  warnings: string[]
}

export interface ContextBuildOptions {
  linkedResources: LinkedResource[]
  linkedResourcePreviews: Record<string, string | null>
  linkedResourcePreview: string | null
  quoteData: QuoteData | null
  isRagEnabled: boolean
  webSearchEnabled: boolean
  userQuery: string
  webSearchQuery?: string
  contextBudget: number
  currentArticle?: string
  activeFilePath?: string
}

export interface ContextBuildResult {
  context: string
  ragSources: string[]
  ragSourceDetails: ChatCitationSource[]
  diagnostics: ContextBuildDiagnostics
  /**
   * Phase 1 #B：结构化上下文段（与 context 字段并行）。
   * 每个段是该层"应直接展示给模型"的 Markdown 文本（含小节标题）。
   * 调用方可把这些段注入到 buildAgentSystemPrompt 的 contextSections，
   * 让预算控制器按层独立截断，而不是把所有东西塞进一个字符串。
   *
   * context 字段保持原行为不变（向后兼容），仍是这些段的拼接结果。
   */
  sections?: {
    web?: string
    current?: string
    linked?: string
    quote?: string
    rag?: string
  }
}

// ============================================================
// Constants
// ============================================================

const CITATION_CONTENT_LIMIT = 1600
const RECENT_WEB_QUERY_PATTERN = /最新|最近|近况|当前|今天|今日|本周|本月|今年|新闻|资讯|快讯|动态|热门|热榜|趋势|发布|更新|latest|recent|current|today|this week|this month|news|trending/i

// RAG 关键词停用词
const RAG_STOP_WORDS = new Set([
  '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
  '好', '自己', '这', '那', '里', '就是', '为', '与', '之', '用', '可以',
  '但', '而', '或', '及', '等', '对', '把', '被', '让', '给', '从', '向',
  '什么', '怎么', '怎样', '如何', '为什么', '哪些', '多少',
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
  'what', 'how', 'why', 'where', 'when', 'who', 'which'
])

// ============================================================
// Helper Functions
// ============================================================

function getLinkedResourceKey(resource: LinkedResource): string {
  return resource.relativePath || resource.path || resource.name
}

function getLinkedFileName(path: unknown): string {
  const normalized = typeof path === 'string' ? path.trim() : ''
  return normalized.split('/').pop() || normalized
}

function matchesLinkedResourcePath(candidate: unknown, resource: LinkedResource): boolean {
  const normalized = typeof candidate === 'string' ? candidate.trim() : ''
  if (!normalized) return false

  const linkedPaths = new Set([
    resource.relativePath,
    resource.path,
    resource.name,
    getLinkedFileName(resource.relativePath),
    getLinkedFileName(resource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function isActiveLinkedResource(
  activeFilePath: string | undefined,
  currentArticle: string | undefined,
  resource: LinkedResource
): boolean {
  return !!currentArticle && matchesLinkedResourcePath(activeFilePath, resource)
}

function normalizeCitationContent(content: unknown): string {
  if (typeof content !== 'string') return ''
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= CITATION_CONTENT_LIMIT) return normalized
  return `${normalized.slice(0, CITATION_CONTENT_LIMIT).trim()}\n...`
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDateDaysAgo(days: number, date = new Date()) {
  const next = new Date(date)
  next.setDate(next.getDate() - Math.max(0, days - 1))
  return getLocalDateString(next)
}

export function addCitationSource(
  sources: string[],
  details: ChatCitationSource[],
  detail: ChatCitationSource
) {
  const filepath = detail.filepath?.trim() || ''
  const filename = detail.filename?.trim() || getLinkedFileName(filepath)
  const content = normalizeCitationContent(detail.content)

  if (!filename && !filepath) return

  const nextDetail: ChatCitationSource = {
    ...detail,
    filepath,
    filename,
    content,
  }

  const exists = details.some((item) =>
    (item.filepath || item.filename) === (nextDetail.filepath || nextDetail.filename)
    && (item.sourceType || 'rag') === (nextDetail.sourceType || 'rag')
    && normalizeCitationContent(item.content).slice(0, 120) === content.slice(0, 120)
  )

  if (!exists) {
    details.push(nextDetail)
  }

  if (filename && !sources.includes(filename)) {
    sources.push(filename)
  }
}

function takeContent(content: string, limit: number, budget: { remaining: number }, label: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''

  const allowed = Math.max(0, Math.min(limit, budget.remaining))
  if (allowed <= 0) {
    return `[Context omitted: ${label}; total context budget exhausted.]`
  }

  budget.remaining -= Math.min(normalized.length, allowed)
  if (normalized.length <= allowed) return normalized

  return `${normalized.slice(0, allowed).trim()}\n\n[Context truncated: ${label}; ${normalized.length - allowed} characters omitted.]`
}

function filterRAGKeywords(keywords: { text: string; weight: number }[]) {
  return keywords.filter(k => {
    const text = k.text.trim().toLowerCase()
    return !RAG_STOP_WORDS.has(text) && text.length > 1
  })
}

function countChars(value: string) {
  return value.trim().length
}

function extractMarkdownSignals(content?: string, limit = 8): string[] {
  if (!content) return []

  const signals: string[] = []
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,3}\s+(.{2,80})/)
    if (heading?.[1]) {
      signals.push(heading[1].trim())
    }
    if (signals.length >= limit) break
  }

  if (signals.length < Math.min(limit, 4)) {
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.{2,60})/)
      if (bullet?.[1]) {
        signals.push(bullet[1].trim())
      }
      if (signals.length >= limit) break
    }
  }

  return Array.from(new Set(signals)).slice(0, limit)
}

function stripCommandPrefix(query: string) {
  return query
    .replace(/^你正在执行一个应用内命令[:：][\s\S]*?\n\n/, '')
    .replace(/^\/[^\s\n]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectRagStrategy(options: {
  userQuery: string
  hasPrimaryDocument: boolean
  linkedFolders: LinkedResource[]
  isRagEnabled: boolean
}): { strategy: RagStrategy; skippedReason?: string } {
  if (!options.isRagEnabled) {
    return { strategy: 'off', skippedReason: '知识库检索未启用' }
  }

  const normalized = options.userQuery.toLowerCase()
  const documentTransformCommand =
    /\/(知识盘点|总结|思维导图|可视化报告|简报|海报卡片|闪卡|费曼)/.test(options.userQuery)
    || /总结|提炼|盘点|改写|润色|生成卡片|生成简报|生成海报|生成思维导图/.test(options.userQuery)

  const relationCommand =
    /关联|相关|对比|扩展|补充|找资料|检索|搜索|similar|related|compare|expand/.test(normalized)

  if (options.linkedFolders.length > 0 || relationCommand) {
    return { strategy: 'supplement' }
  }

  if (options.hasPrimaryDocument && documentTransformCommand) {
    return { strategy: 'document-first', skippedReason: '当前任务优先处理已打开/已引用文档，RAG 仅在关联/扩展类任务中补充' }
  }

  return { strategy: 'supplement' }
}

function buildRagSearchQuery(options: {
  userQuery: string
  activeFilePath?: string
  currentArticle?: string
  linkedResources: LinkedResource[]
  quoteData: QuoteData | null
}) {
  const parts = [
    stripCommandPrefix(options.userQuery),
    options.activeFilePath?.split('/').pop()?.replace(/\.[^.]+$/, ''),
    ...options.linkedResources.map(resource => resource.name || resource.relativePath || resource.path),
    options.quoteData?.fileName,
    ...extractMarkdownSignals(options.currentArticle, 10),
  ]

  return Array.from(new Set(parts.map(part => part?.trim()).filter((part): part is string => !!part)))
    .join('\n')
    .slice(0, 1200)
}

// ============================================================
// Context Builders
// ============================================================

/**
 * 构建 Web 搜索上下文
 */
export async function buildWebSearchContext(
  query: string,
  signal?: AbortSignal
): Promise<{ context: string; sources: ChatCitationSource[] }> {
  const needsRecentWindow = RECENT_WEB_QUERY_PATTERN.test(query)
  const response = await searchWeb({
    query,
    maxResults: 5,
    includeAnswer: true,
    topic: needsRecentWindow ? 'news' : undefined,
    startDate: needsRecentWindow ? getDateDaysAgo(30) : undefined,
    endDate: needsRecentWindow ? getLocalDateString() : undefined,
    signal,
  })

  const lines = [
    '## Web search results',
    '',
    `Provider: ${response.provider}${response.degraded ? ' (fallback)' : ''}`,
    needsRecentWindow ? `Date window: ${getDateDaysAgo(30)} to ${getLocalDateString()}` : '',
    needsRecentWindow ? 'Use only dated, in-window sources for strict latest/recent/current claims.' : '',
  ].filter(Boolean)

  if (response.answer?.trim()) {
    lines.push('', `Answer: ${response.answer.trim()}`)
  }

  if (response.results.length > 0) {
    lines.push('', 'Sources:')
    response.results.forEach((result, index) => {
      const title = result.title?.trim() || result.url || `Result ${index + 1}`
      lines.push(`${index + 1}. ${title}`)
      if (result.url?.trim()) lines.push(`   URL: ${result.url.trim()}`)
      if (result.publishedDate?.trim()) lines.push(`   Published: ${result.publishedDate.trim()}`)
      if (result.content?.trim()) lines.push(`   Snippet: ${result.content.trim()}`)
    })
  } else {
    lines.push('', 'No web results were found.')
  }

  const sources = response.results
    .filter(result => result.url || result.title || result.content)
    .map((result, index): ChatCitationSource => ({
      url: result.url,
      title: result.title,
      filepath: result.url || `web-search:${query}:${index + 1}`,
      filename: result.title || result.url || `Web result ${index + 1}`,
      content: result.content || response.answer || '',
      sourceType: 'web',
    }))

  return {
    context: `${lines.join('\n')}\n\n`,
    sources,
  }
}

/**
 * P0-2：RAG 检索的纯 IO 结果（不消耗上下文预算）
 */
export type RagPrefetch = {
  rawContext: string
  sources: string[]
  sourceDetails: ChatCitationSource[]
  keywords: string[]
  warnings: string[]
}

/**
 * 预取 RAG 检索结果：关键词抽取 + 向量检索，可与其他上下文源并发执行。
 */
export async function prefetchRagContext(
  query: string,
  linkedFolders: LinkedResource[],
  isRagEnabled: boolean,
): Promise<RagPrefetch> {
  const empty: RagPrefetch = { rawContext: '', sources: [], sourceDetails: [], keywords: [], warnings: [] }
  if (!isRagEnabled) return empty

  const sources: string[] = []
  const sourceDetails: ChatCitationSource[] = []
  const warnings: string[] = []

  try {
    let keywords = await invoke<{ text: string; weight: number }[]>('rank_keywords', {
      text: query,
      topK: 15,
    })
    keywords = filterRAGKeywords(keywords)
    const keywordTexts = keywords.map(keyword => keyword.text)

    if (keywords.length === 0) {
      warnings.push('RAG 未提取到有效关键词')
      return { ...empty, keywords: keywordTexts, warnings }
    }

    const linkedFolder = linkedFolders[0]
    const ragResult = linkedFolder
      ? await getContextForQueryInFolder(keywords, linkedFolder.relativePath)
      : await getContextForQuery(keywords)

    ragResult.sourceDetails.forEach(sourceDetail => {
      addCitationSource(sources, sourceDetails, { ...sourceDetail, sourceType: 'rag' })
    })
    ragResult.sources.forEach(source => {
      if (!sources.includes(source)) sources.push(source)
    })

    if (!ragResult.context) {
      const searchScope = linkedFolder ? `在关联文件夹"${linkedFolder.name}"中` : '在知识库中'
      warnings.push(`${searchScope}未命中相关内容`)
    }

    return {
      rawContext: ragResult.context || '',
      sources,
      sourceDetails,
      keywords: keywordTexts,
      warnings,
    }
  } catch (error) {
    console.error('Failed to get RAG context:', error)
    warnings.push(`RAG 检索失败：${error instanceof Error ? error.message : String(error)}`)
    return { ...empty, sources, sourceDetails, warnings }
  }
}

/**
 * 构建 RAG 检索上下文
 */
export async function buildRagContext(
  query: string,
  linkedFolders: LinkedResource[],
  isRagEnabled: boolean,
  contextBudget: { remaining: number },
  prefetched?: RagPrefetch,
): Promise<{ context: string; sources: string[]; sourceDetails: ChatCitationSource[]; keywords: string[]; warnings: string[] }> {
  if (!isRagEnabled) {
    return { context: '', sources: [], sourceDetails: [], keywords: [], warnings: [] }
  }

  // P0-2：检索阶段（关键词抽取 + 向量检索）可提前并发完成，这里只消耗预算。
  if (prefetched) {
    const { rawContext, sources: preSources, sourceDetails: preDetails, keywords, warnings: preWarnings } = prefetched
    if (!rawContext) {
      return { context: '', sources: preSources, sourceDetails: preDetails, keywords, warnings: preWarnings }
    }
    const ragContext = takeContent(rawContext, 4000, contextBudget, 'RAG results')
    return {
      context: `## 知识库检索结果\n\n已在知识库中找到与用户问题相关的笔记内容。请优先使用以下信息回答用户问题：\n\n${ragContext}\n`,
      sources: preSources,
      sourceDetails: preDetails,
      keywords,
      warnings: preWarnings,
    }
  }

  const sources: string[] = []
  const sourceDetails: ChatCitationSource[] = []
  const warnings: string[] = []

  try {
    let keywords = await invoke<{ text: string; weight: number }[]>('rank_keywords', {
      text: query,
      topK: 15,
    })
    keywords = filterRAGKeywords(keywords)
    const keywordTexts = keywords.map(keyword => keyword.text)

    if (keywords.length === 0) {
      warnings.push('RAG 未提取到有效关键词')
      return {
        context: '',
        sources,
        sourceDetails,
        keywords: keywordTexts,
        warnings,
      }
    }

    const linkedFolder = linkedFolders[0]
    const ragResult = linkedFolder
      ? await getContextForQueryInFolder(keywords, linkedFolder.relativePath)
      : await getContextForQuery(keywords)

    ragResult.sourceDetails.forEach(sourceDetail => {
      addCitationSource(sources, sourceDetails, {
        ...sourceDetail,
        sourceType: 'rag',
      })
    })
    ragResult.sources.forEach(source => {
      if (!sources.includes(source)) {
        sources.push(source)
      }
    })

    if (ragResult.context) {
      const ragContext = takeContent(ragResult.context, 4000, contextBudget, 'RAG results')
      return {
        context: `## 知识库检索结果\n\n已在知识库中找到与用户问题相关的笔记内容。请优先使用以下信息回答用户问题：\n\n${ragContext}\n`,
        sources,
        sourceDetails,
        keywords: keywordTexts,
        warnings,
      }
    } else {
      const searchScope = linkedFolder ? `在关联文件夹"${linkedFolder.name}"中` : '在知识库中'
      warnings.push(`${searchScope}未命中相关内容`)
      return {
        context: '',
        sources,
        sourceDetails,
        keywords: keywordTexts,
        warnings,
      }
    }
  } catch (error) {
    console.error('Failed to get RAG context:', error)
    warnings.push(`RAG 检索失败：${error instanceof Error ? error.message : String(error)}`)
    return {
      context: '',
      sources,
      sourceDetails,
      keywords: [],
      warnings,
    }
  }
}

/**
 * 构建当前笔记上下文
 */
export function buildCurrentNoteContext(
  activeFilePath: string | undefined,
  currentArticle: string | undefined,
  linkedFiles: LinkedResource[],
  contextBudget: { remaining: number },
  contentLimit = 3000
): { context: string; source?: ChatCitationSource } {
  if (!activeFilePath || !currentArticle) return { context: '' }

  const activeFileAlreadyLinked = linkedFiles.some(resource =>
    matchesLinkedResourcePath(activeFilePath, resource)
  )
  if (activeFileAlreadyLinked) return { context: '' }

  const currentArticleContext = takeContent(
    currentArticle,
    contentLimit,
    contextBudget,
    `current note ${activeFilePath}`
  )

  if (!currentArticleContext) return { context: '' }

  return {
    context: `## 当前打开的笔记\n文件路径: ${activeFilePath}\n\n内容:\n${currentArticleContext}\n\n`,
    source: {
      filepath: activeFilePath,
      filename: getLinkedFileName(activeFilePath),
      content: currentArticle,
      sourceType: 'current',
    },
  }
}

/**
 * P0-2：关联文件的纯 IO 预取结果。
 * 读盘与预算消耗解耦，读取可并发，预算仍按原顺序串行消耗。
 */
export type LinkedFilePrefetch = {
  resource: LinkedResource
  index: number
  preview: string | null
  isPdf: boolean
  isActiveResource: boolean
  content: string
  error?: string
}

/**
 * 并发预取关联文件内容（不消耗上下文预算）
 */
export async function prefetchLinkedFileContents(
  linkedFiles: LinkedResource[],
  linkedResourcePreviews: Record<string, string | null>,
  linkedResourcePreview: string | null,
  activeFilePath: string | undefined,
  currentArticle: string | undefined,
): Promise<LinkedFilePrefetch[]> {
  if (linkedFiles.length === 0) return []
  const workspace = await getWorkspacePath()

  return Promise.all(linkedFiles.map(async (resource, index): Promise<LinkedFilePrefetch> => {
    const resourceKey = getLinkedResourceKey(resource)
    const resourcePath = resource.relativePath || resource.path
    const isActiveResource = isActiveLinkedResource(activeFilePath, currentArticle, resource)
    const preview = linkedResourcePreviews[resourceKey] ?? (index === 0 ? linkedResourcePreview : null)
    const isPdf = /\.pdf$/i.test(resourcePath)
    const base = { resource, index, preview, isPdf, isActiveResource }

    if (isPdf) return { ...base, content: '' }

    try {
      let content = ''
      if (isActiveResource && currentArticle) {
        content = currentArticle
      } else if (workspace.isCustom) {
        content = await readTextFile(resource.path)
      } else {
        const { path, baseDir } = await getFilePathOptions(resource.path || resource.relativePath)
        content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
      }
      return { ...base, content }
    } catch (error) {
      console.error('Failed to read linked file:', error)
      return { ...base, content: '', error: error instanceof Error ? error.message : String(error) }
    }
  }))
}
/**
 * 构建关联文件上下文。
 * P0-2：读盘已在 prefetchLinkedFileContents 中并发完成，这里只按原顺序消耗预算。
 */
export async function buildLinkedFilesContext(
  linkedFiles: LinkedResource[],
  linkedResourcePreviews: Record<string, string | null>,
  linkedResourcePreview: string | null,
  activeFilePath: string | undefined,
  currentArticle: string | undefined,
  contextBudget: { remaining: number },
  prefetched?: LinkedFilePrefetch[],
): Promise<{ context: string; sources: string[]; sourceDetails: ChatCitationSource[]; warnings: string[]; injectedCount: number }> {
  if (linkedFiles.length === 0) {
    return { context: '', sources: [], sourceDetails: [], warnings: [], injectedCount: 0 }
  }

  let context = ''
  const sources: string[] = []
  const sourceDetails: ChatCitationSource[] = []
  const warnings: string[] = []
  let injectedCount = 0

  const entries = prefetched ?? await prefetchLinkedFileContents(
    linkedFiles,
    linkedResourcePreviews,
    linkedResourcePreview,
    activeFilePath,
    currentArticle,
  )

  for (const entry of entries) {
    const { resource, index, preview, isPdf, isActiveResource, content, error } = entry
    const resourcePath = resource.relativePath || resource.path

    if (error) {
      warnings.push(`关联文件读取失败：${resource.name || resourcePath} (${error})`)
      continue
    }

    if (preview) {
      context += `\n${takeContent(preview, 1500, contextBudget, `linked preview ${resource.name || resourcePath}`)}\n`
    }

    if (isPdf) {
      if (isActiveResource && currentArticle) {
        const pdfContext = takeContent(currentArticle, 12000, contextBudget, `linked PDF ${resource.name || resourcePath}`)
        context += `\n## 关联文件内容 ${index + 1}（PDF 文本提取）\n\n文件: "${resource.name}" (${resource.relativePath})\n\n---\n${pdfContext}\n---\n`
        addCitationSource(sources, sourceDetails, {
          filepath: resource.relativePath || resource.path,
          filename: resource.name || getLinkedFileName(resource.relativePath || resource.path),
          content: currentArticle,
          sourceType: 'linked',
        })
        injectedCount += 1
      } else {
        warnings.push(`PDF 关联文件缺少已提取正文：${resource.name || resourcePath}`)
      }
      continue
    }

    if (content) {
      const linkedContext = takeContent(content, 12000, contextBudget, `linked file ${resource.name || resourcePath}`)
      context += `\n## 关联文件内容 ${index + 1}\n\n文件: "${resource.name}" (${resource.relativePath})\n\n---\n${linkedContext}\n---\n`
      addCitationSource(sources, sourceDetails, {
        filepath: resource.relativePath || resource.path,
        filename: resource.name || getLinkedFileName(resource.relativePath || resource.path),
        content,
        sourceType: 'linked',
      })
      injectedCount += 1
    } else {
      warnings.push(`关联文件为空或无法读取：${resource.name || resourcePath}`)
    }
  }

  return { context, sources, sourceDetails, warnings, injectedCount }
}

/**
 * 构建引用内容上下文
 */
export function buildQuoteContext(
  quoteData: QuoteData | null,
  contextBudget: { remaining: number }
): { context: string; source?: ChatCitationSource } {
  if (!quoteData) return { context: '' }

  const { fileName, startLine, endLine, fullContent, from, to, articlePath } = quoteData
  let lineInfo = ''
  const hasValidLineNumbers = startLine !== -1 && endLine !== -1
  const hasValidRange = from >= 0 && to >= from

  if (hasValidLineNumbers) {
    lineInfo = startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}-${endLine} 行`
  }

  const quoteContext = takeContent(fullContent, 10000, contextBudget, `quote ${fileName}`)

  const context = `\n## 📌 用户引用内容

用户引用了笔记 "${fileName}" ${lineInfo}的以下内容：

---
${quoteContext}
---

${hasValidRange ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、翻译、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

**🚨 当且仅当用户明确要求修改时，必须精确替换用户选中的范围**: 当前引用内容来自编辑器选区，必须优先使用 replace_editor_content 的 position-based 模式，只替换这段选中的内容：
- from: ${from}
- to: ${to}
- 使用 content 或 replaceContent 传入新内容
- 只允许替换这个选区，禁止扩大到整篇文档或整段之外

**如果用户说"在这段前面/后面/上面/下面插入、补充、添加"**:
- 仍然使用 replace_editor_content
- 基于当前引用范围整体替换
- 前插: 新内容 + 原引用内容
- 后插: 原引用内容 + 新内容
- 不要使用 insert_at_cursor，因为聊天输入会让编辑器失焦，当前光标位置不可靠

**如果用户明确要求"前面和后面都增加内容"**:
- 仍然使用 replace_editor_content
- 必须先分别生成前插内容和后插内容
- 请在传给工具的 content 中使用这个精确格式：
  <<BEFORE>>
  [前插内容]
  <<AFTER>>
  [后插内容]
- 系统会自动把它拼接成：前插内容 + 原引用内容 + 后插内容
- 不要把前后内容合并成一整段普通文本

**兜底行号信息**:
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止改动选区之外的内容
- 禁止获取整个文档后再重写整篇
- 禁止把 startLine/endLine 擅自改成 1/1` : hasValidLineNumbers ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、翻译、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

**🚨 当且仅当用户明确要求修改时，必须使用行号修改**: 当用户引用内容并要求修改时，你必须使用 replace_editor_content 工具的 line-based 模式，传入精确的行号：
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}
- 必须使用 replaceContent 参数传入新内容

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止使用 from/to 位置参数
- 禁止使用 searchContent 文本搜索模式
- 禁止获取整个文档内容后再操作` : `**注意**: 此引用内容没有有效的行号信息。如果需要修改，请先使用 get_editor_selection 工具获取当前选中的行号信息。`}

请基于这段引用内容回答用户的问题。

`

  return {
    context,
    source: {
      filepath: articlePath,
      filename: fileName,
      content: fullContent,
      sourceType: 'quote',
      startLine,
      endLine,
      from,
      to,
    },
  }
}

/**
 * 主上下文构建函数
 */
export async function buildChatContext(options: ContextBuildOptions): Promise<ContextBuildResult> {
  const {
    linkedResources,
    linkedResourcePreviews,
    linkedResourcePreview,
    quoteData,
    isRagEnabled,
    webSearchEnabled,
    userQuery,
    webSearchQuery,
    contextBudget,
    currentArticle,
    activeFilePath,
  } = options

  const linkedFolders = linkedResources.filter(isLinkedFolder)
  const linkedFiles = linkedResources.filter(r => !isLinkedFolder(r))
  const hasPrimaryDocument = !!currentArticle || linkedFiles.length > 0 || !!quoteData
  const documentGrounding = decideDocumentGrounding({
    userInput: userQuery,
    hasDocumentContext: hasPrimaryDocument,
  })
  const strategyResult = detectRagStrategy({
    userQuery,
    hasPrimaryDocument,
    linkedFolders,
    isRagEnabled,
  })
  const budget = { remaining: contextBudget }
  let context = ''
  const sections: NonNullable<ContextBuildResult['sections']> = {}
  const ragSources: string[] = []
  const ragSourceDetails: ChatCitationSource[] = []

  // P0-2：三个 IO 密集操作（网络搜索 / 磁盘读取 / RAG 检索）之间无数据依赖，
  // 并发启动，先到先得；预算消耗仍按原优先级顺序串行进行。
  const ragQuery = buildRagSearchQuery({ userQuery, activeFilePath, currentArticle, linkedResources, quoteData })
  const [webSearchPrefetch, linkedFilePrefetch, ragPrefetch] = await Promise.allSettled([
    webSearchEnabled && webSearchQuery ? buildWebSearchContext(webSearchQuery) : Promise.resolve(null),
    prefetchLinkedFileContents(linkedFiles, linkedResourcePreviews, linkedResourcePreview, activeFilePath, currentArticle),
    strategyResult.strategy === 'supplement' ? prefetchRagContext(ragQuery, linkedFolders, isRagEnabled) : Promise.resolve(null),
  ])
  const diagnostics: ContextBuildDiagnostics = {
    strategy: strategyResult.strategy,
    ragEnabled: isRagEnabled,
    ragSkippedReason: strategyResult.skippedReason,
    ragQuery: '',
    ragKeywords: [],
    webEnabled: webSearchEnabled,
    currentNoteInjected: false,
    linkedFileCount: linkedFiles.length,
    linkedFileInjectedCount: 0,
    quoteInjected: false,
    ragSourceCount: 0,
    injectedChars: {
      web: 0,
      current: 0,
      linked: 0,
      quote: 0,
      rag: 0,
      total: 0,
    },
    warnings: [],
  }

  // 1. Web 搜索（已在并发预取中完成，直接消耗结果）
  if (webSearchEnabled && webSearchQuery) {
    if (webSearchPrefetch.status === 'fulfilled' && webSearchPrefetch.value) {
      const webSearchContext = webSearchPrefetch.value
      context += webSearchContext.context
      if (webSearchContext.context.trim()) sections.web = webSearchContext.context.trim()
      diagnostics.injectedChars.web += countChars(webSearchContext.context)
      webSearchContext.sources.forEach(source => addCitationSource(ragSources, ragSourceDetails, source))
    } else if (webSearchPrefetch.status === 'rejected') {
      console.error('Failed to get web search context:', webSearchPrefetch.reason)
      diagnostics.warnings.push(`Web 搜索失败：${webSearchPrefetch.reason instanceof Error ? webSearchPrefetch.reason.message : String(webSearchPrefetch.reason)}`)
    }
  }

  // 2. 当前笔记/已附加文件。优先把用户明确引用的内容送进模型。
  const currentNoteResult = buildCurrentNoteContext(
    activeFilePath,
    currentArticle,
    linkedFiles,
    budget,
    documentGrounding.grounded ? 12000 : 3000
  )
  if (currentNoteResult.context) {
    context += currentNoteResult.context
    if (currentNoteResult.context.trim()) {
      sections.current = currentNoteResult.context.trim()
    }
    diagnostics.currentNoteInjected = true
    diagnostics.injectedChars.current += countChars(currentNoteResult.context)
    if (currentNoteResult.source) {
      addCitationSource(ragSources, ragSourceDetails, currentNoteResult.source)
    }
  }

  // 3. 关联文件（文件内容已在并发预取中完成，直接消耗预算）
  const prefetchedLinkedFiles = linkedFilePrefetch.status === 'fulfilled' ? linkedFilePrefetch.value : undefined
  const linkedResult = await buildLinkedFilesContext(
    linkedFiles,
    linkedResourcePreviews,
    linkedResourcePreview,
    activeFilePath,
    currentArticle,
    budget,
    prefetchedLinkedFiles
  )
  context += linkedResult.context
  if (linkedResult.context.trim()) {
    sections.linked = linkedResult.context.trim()
  }
  diagnostics.linkedFileInjectedCount = linkedResult.injectedCount
  diagnostics.injectedChars.linked += countChars(linkedResult.context)
  diagnostics.warnings.push(...linkedResult.warnings)
  linkedResult.sources.forEach(s => {
    if (!ragSources.includes(s)) ragSources.push(s)
  })
  linkedResult.sourceDetails.forEach(d => addCitationSource(ragSources, ragSourceDetails, d))

  // 4. 引用内容
  const quoteResult = buildQuoteContext(quoteData, budget)
  if (quoteResult.context) {
    context += quoteResult.context
    if (quoteResult.context.trim()) {
      sections.quote = quoteResult.context.trim()
    }
    diagnostics.quoteInjected = true
    diagnostics.injectedChars.quote += countChars(quoteResult.context)
    if (quoteResult.source) {
      addCitationSource(ragSources, ragSourceDetails, quoteResult.source)
    }
  }

  // 5. RAG 检索（关键词抽取+向量检索已在并发预取中完成，直接消耗预算）
  if (strategyResult.strategy === 'supplement') {
    diagnostics.ragQuery = ragQuery
    const prefetchedRag = ragPrefetch.status === 'fulfilled' ? ragPrefetch.value ?? undefined : undefined
    const ragResult = await buildRagContext(ragQuery, linkedFolders, isRagEnabled, budget, prefetchedRag)
    context += ragResult.context
    if (ragResult.context.trim()) {
      sections.rag = ragResult.context.trim()
    }
    diagnostics.ragKeywords = ragResult.keywords
    diagnostics.ragSourceCount = ragResult.sources.length
    diagnostics.injectedChars.rag += countChars(ragResult.context)
    diagnostics.warnings.push(...ragResult.warnings)
    ragResult.sources.forEach(s => {
      if (!ragSources.includes(s)) ragSources.push(s)
    })
    ragResult.sourceDetails.forEach(d => addCitationSource(ragSources, ragSourceDetails, d))
  }

  diagnostics.injectedChars.total = countChars(context)

  return { context, ragSources, ragSourceDetails, diagnostics, sections }
}
