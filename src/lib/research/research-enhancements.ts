/**
 * Deep Research 增强模块
 *
 * 优化点：
 * 1. 流式报告生成 — 当前报告是最后一次性生成，改为边研究边生成章节
 * 2. 实时搜索结果预览 — 用户不用等全部完成才能看到搜索到的内容
 * 3. 并发搜索进度条 — 展示每个搜索引擎的实时状态
 * 4. 研究结果流式渲染 — 报告生成时实时渲染 Markdown
 */

import type {
  DeepResearchProgress,
  ResearchSource,
  ResearchEvidence,
  DeepResearchResult,
} from './deep-research'

// ---------------------------------------------------------------------------
// 1. 流式进度事件（用于前端实时渲染）
// ---------------------------------------------------------------------------

export type ResearchStreamEvent =
  | { type: 'status'; stage: DeepResearchProgress['stage']; detail: string }
  | { type: 'search_started'; query: string; providerCount: number }
  | { type: 'search_result'; query: string; provider: string; resultCount: number; title?: string }
  | { type: 'source_found'; source: ResearchSource }
  | { type: 'evidence_extracted'; evidence: ResearchEvidence }
  | { type: 'learning_added'; learning: string }
  | { type: 'verification_started'; evidenceCount: number }
  | { type: 'verification_completed'; confirmed: number; conflicted: number }
  | { type: 'report_section'; sectionTitle: string; sectionContent: string }
  | { type: 'report_complete'; report: string }
  | { type: 'error'; message: string }
  | { type: 'progress'; progress: DeepResearchProgress }

// ---------------------------------------------------------------------------
// 2. 研究结果摘要生成器（在搜索阶段就实时产出中间摘要）
// ---------------------------------------------------------------------------

export function buildIntermediateSummary(
  learnings: string[],
  sources: ResearchSource[],
  evidences: ResearchEvidence[],
  currentQuery?: string,
): string {
  if (learnings.length === 0) return ''

  const topLearnings = learnings.slice(0, 8)
  const topSources = sources
    .sort((a, b) => b.credibilityScore - a.credibilityScore)
    .slice(0, 5)

  const sections: string[] = []

  if (currentQuery) {
    sections.push(`### 正在检索：${currentQuery}`)
  }

  sections.push(`> 已收集 ${sources.length} 个来源，${evidences.length} 条证据，${learnings.length} 条发现\n`)

  if (topLearnings.length > 0) {
    sections.push('**关键发现：**')
    sections.push(topLearnings.map((l, i) => `${i + 1}. ${l}`).join('\n'))
  }

  if (topSources.length > 0) {
    sections.push('\n**高置信度来源：**')
    sections.push(topSources.map(s =>
      `- [${s.title}](${s.url}) — 置信度 ${(s.credibilityScore * 100).toFixed(0)}%`
    ).join('\n'))
  }

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// 3. 搜索引擎状态追踪
// ---------------------------------------------------------------------------

export interface ProviderStatus {
  name: string
  status: 'idle' | 'searching' | 'done' | 'failed' | 'degraded'
  resultCount: number
  durationMs?: number
  error?: string
}

export function createProviderTracker(providers: string[]) {
  const statuses = new Map<string, ProviderStatus>()

  for (const name of providers) {
    statuses.set(name, {
      name,
      status: 'idle',
      resultCount: 0,
    })
  }

  return {
    markSearching(name: string) {
      const status = statuses.get(name)
      if (status) {
        status.status = 'searching'
        status.durationMs = Date.now()
      }
    },

    markDone(name: string, resultCount: number) {
      const status = statuses.get(name)
      if (status) {
        status.status = 'done'
        status.resultCount = resultCount
        status.durationMs = status.durationMs ? Date.now() - status.durationMs : undefined
      }
    },

    markFailed(name: string, error: string) {
      const status = statuses.get(name)
      if (status) {
        status.status = status.resultCount > 0 ? 'degraded' : 'failed'
        status.error = error
        status.durationMs = status.durationMs ? Date.now() - status.durationMs : undefined
      }
    },

    getStatuses(): ProviderStatus[] {
      return [...statuses.values()]
    },

    getActiveSearches(): number {
      return [...statuses.values()].filter(s => s.status === 'searching').length
    },

    getTotalResults(): number {
      return [...statuses.values()].reduce((sum, s) => sum + s.resultCount, 0)
    },
  }
}

// ---------------------------------------------------------------------------
// 4. 研究报告章节流式生成
// ---------------------------------------------------------------------------

export interface ReportSection {
  title: string
  content: string
  order: number
}

/**
 * 将完整报告按 ## 标题拆分为章节（用于流式逐步渲染）
 */
export function splitReportIntoSections(report: string): ReportSection[] {
  if (!report?.trim()) return []

  const lines = report.split('\n')
  const sections: ReportSection[] = []
  let currentTitle = '概述'
  let currentContent: string[] = []
  let order = 0

  for (const line of lines) {
    // 检测 ## 级标题（不包含 # 一级标题）
    const headingMatch = line.match(/^##\s+(.+)/)
    if (headingMatch) {
      // 保存之前的章节
      if (currentContent.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n').trim(),
          order: order++,
        })
      }
      currentTitle = headingMatch[1].trim()
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  // 保存最后一个章节
  if (currentContent.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n').trim(),
      order: order,
    })
  }

  return sections
}

// ---------------------------------------------------------------------------
// 5. 研究质量评估
// ---------------------------------------------------------------------------

export interface ResearchQualityScore {
  overall: number // 0-100
  sourceDiversity: number // 0-100
  evidenceStrength: number // 0-100
  coverage: number // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  summary: string
}

export function assessResearchQuality(result: DeepResearchResult): ResearchQualityScore {
  const { sources, evidences, learnings } = result

  // 来源多样性：独立域名数
  const uniqueHosts = new Set(
    sources.map(s => {
      try {
        const parsed = new URL(s.url)
        return parsed.hostname.replace(/^www\./, '') || parsed.protocol.replace(':', '') || s.url
      } catch {
        return s.url
      }
    }).filter(Boolean)
  )
  const sourceDiversity = Math.min(100, Math.round(
    Math.min(uniqueHosts.size / 4, 1) * 70 + Math.min(sources.length / 8, 1) * 30
  ))

  // 证据强度：高置信度证据比例
  const highConf = evidences.filter(e => e.confidence === 'high').length
  const evidenceStrength = evidences.length > 0
    ? Math.round((highConf / evidences.length) * 60 + Math.min(evidences.length * 2, 40))
    : 0

  // 覆盖度：learnings 数量
  const coverage = Math.min(100, Math.round(
    Math.min(learnings.length * 5, 50) +
    Math.min(sources.length * 3, 30) +
    Math.min(evidences.length * 2, 20)
  ))

  const overall = Math.round(sourceDiversity * 0.3 + evidenceStrength * 0.4 + coverage * 0.3)

  const grade = overall >= 85 ? 'A' : overall >= 70 ? 'B' : overall >= 55 ? 'C' : overall >= 40 ? 'D' : 'F'

  const summary = [
    `来源 ${sources.length} 个（${uniqueHosts.size} 个独立域名）`,
    `证据 ${evidences.length} 条（高置信 ${highConf}）`,
    `发现 ${learnings.length} 条`,
    overall >= 70 ? '研究基础扎实' : '建议补充更多来源',
  ].join('，')

  return { overall, sourceDiversity, evidenceStrength, coverage, grade, summary }
}

// ---------------------------------------------------------------------------
// 6. 增强的进度格式（包含搜索引擎状态）
// ---------------------------------------------------------------------------

export interface EnhancedResearchProgress extends DeepResearchProgress {
  providerStatuses?: ProviderStatus[]
  intermediateSummary?: string
  qualityPreview?: string
}

// 注：encodeEnhancedProgress 已移除（dead code），实际序列化由 progress-status.ts 处理。
// EnhancedResearchProgress 接口保留作为类型扩展点，供前端实时进度展示使用。
