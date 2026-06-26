/**
 * context-budget - 上下文预算控制器
 *
 * 设计目标：
 * - Phase 0 #5: 给 prompt-assembler 装配的各段落加 token 预算守卫
 * - 按段落优先级分配预算，超预算时按策略截断
 * - 不引入 tiktoken，复用项目已有的 estimateTokens（字符近似）
 * - 不破坏现有装配流程，作为可选的"安全网"
 *
 * 核心概念：
 * - 段落（Section）：prompt 的一段已序列化文本，带优先级
 * - 优先级：数字越大越不能被截断（Identity > Memory > Skills > RAG > UserPref）
 * - 截断策略：硬切 / 删除子段 / 整段丢弃
 */

import { estimateTokens } from '@/lib/ai/token-counter'

export type SectionTruncateStrategy =
  | 'hard-cut'        // 按 minTokens 字符数截断
  | 'drop-subsection' // 删除末尾子段（按 \n\n 切分）
  | 'drop-whole'      // 整段丢弃

export interface BudgetedSection {
  /** 段落标识，用于 warnings 和日志 */
  id: string
  /** 已序列化好的段落文本（不含其他段落的拼接） */
  content: string
  /**
   * 优先级：数字越大越重要，越优先保留。
   * 推荐分级：
   *   100 = 必保留（Identity、Core Rules）
   *   80  = 高（Output Rules、Anti-Patterns）
   *   60  = 中（Skills、Runtime Discipline）
   *   40  = 低（Memory、RAG）
   *   20  = 可弃（User Preference、Extras）
   */
  priority: number
  /** 截断策略，默认 'drop-whole' */
  truncateStrategy?: SectionTruncateStrategy
  /** 即使超预算也保留的最低 token 数（仅 hard-cut/drop-subsection 生效） */
  minTokens?: number
}

export interface BudgetConfig {
  /**
   * 整个 prompt 的总 token 预算上限。
   * 不含模型响应输出（output）和聊天历史（history）。
   * 默认 16000，覆盖大多数 32K 模型一半上下文。
   */
  totalBudget?: number
  /**
   * 是否在超预算时打印 console.warn。
   * 默认 true（开发态诊断）。
   */
  warnOnOverflow?: boolean
}

export interface BudgetResult {
  /** 最终拼接后的文本（按 sections 输入顺序，被丢弃的段落变空字符串） */
  assembledText: string
  /** 实际保留的段落 id 列表（按输入顺序） */
  keptSectionIds: string[]
  /** 被完全丢弃的段落 id 列表 */
  droppedSectionIds: string[]
  /** 被部分截断的段落信息 */
  truncated: Array<{
    id: string
    originalTokens: number
    keptTokens: number
    strategy: SectionTruncateStrategy
  }>
  /** 最终总 token 数 */
  totalTokens: number
  /** 触发的告警信息 */
  warnings: string[]
  /** 每个保留段落（含被截断后的）最终文本，按 id 索引；调用方可用于自行重排 */
  keptTextById: Record<string, string>
}

const DEFAULT_TOTAL_BUDGET = 16000

/**
 * 按优先级 + 预算装配段落。
 *
 * 算法：
 * 1. 计算每段 token 数
 * 2. 按 priority desc 排序，决定保留/截断
 * 3. 高优先级完整保留，边界段落按 minTokens 截断，低优先级丢弃
 * 4. 按原始 sections 输入顺序拼回文本
 *
 * @param sections 段落列表（顺序即拼接顺序）
 * @param config   预算配置
 */
export function enforceBudgetOnSections(
  sections: BudgetedSection[],
  config: BudgetConfig = {},
): BudgetResult {
  const totalBudget = config.totalBudget ?? DEFAULT_TOTAL_BUDGET
  const warnOnOverflow = config.warnOnOverflow !== false
  const warnings: string[] = []

  // 计算每段 token
  const withTokens = sections.map(s => ({
    ...s,
    tokens: estimateTokens(s.content),
    truncateStrategy: s.truncateStrategy ?? 'drop-whole',
  }))

  // 总和如果已经在预算内，直接拼接返回
  const totalEstimated = withTokens.reduce((sum, s) => sum + s.tokens, 0)
  if (totalEstimated <= totalBudget) {
    const keptTextById: Record<string, string> = {}
    for (const s of sections) {
      if (s.content) keptTextById[s.id] = s.content
    }
    return {
      assembledText: sections.map(s => s.content).filter(Boolean).join('\n\n'),
      keptSectionIds: sections.map(s => s.id),
      droppedSectionIds: [],
      truncated: [],
      totalTokens: totalEstimated,
      warnings: [],
      keptTextById,
    }
  }

  // 超预算：按 priority desc 决定保留
  // 复制一份按优先级排序，从高到低"装入背包"
  const orderDesc = [...withTokens].sort((a, b) => b.priority - a.priority)
  const decision = new Map<string, { action: 'keep' | 'truncate' | 'drop'; keptTokens: number; keptText: string }>()

  let remaining = totalBudget

  for (const section of orderDesc) {
    if (remaining <= 0) {
      decision.set(section.id, { action: 'drop', keptTokens: 0, keptText: '' })
      continue
    }

    if (section.tokens <= remaining) {
      // 完整保留
      decision.set(section.id, { action: 'keep', keptTokens: section.tokens, keptText: section.content })
      remaining -= section.tokens
      continue
    }

    // 装不下完整段，按策略处理
    if (section.truncateStrategy === 'drop-whole') {
      decision.set(section.id, { action: 'drop', keptTokens: 0, keptText: '' })
      continue
    }

    const minTokens = Math.min(section.minTokens ?? 0, remaining)
    if (minTokens <= 0) {
      decision.set(section.id, { action: 'drop', keptTokens: 0, keptText: '' })
      continue
    }

    // 截断到 minTokens
    const truncatedText = truncateText(section.content, minTokens, section.truncateStrategy)
    const truncatedTokens = estimateTokens(truncatedText)
    decision.set(section.id, {
      action: 'truncate',
      keptTokens: truncatedTokens,
      keptText: truncatedText,
    })
    remaining -= truncatedTokens
  }

  // 按原始顺序拼回
  const keptSectionIds: string[] = []
  const droppedSectionIds: string[] = []
  const truncated: BudgetResult['truncated'] = []
  const keptTextById: Record<string, string> = {}
  const parts: string[] = []
  let finalTokens = 0

  for (const section of withTokens) {
    const d = decision.get(section.id)
    if (!d || d.action === 'drop' || !d.keptText) {
      droppedSectionIds.push(section.id)
      if (d && d.action === 'truncate') {
        truncated.push({
          id: section.id,
          originalTokens: section.tokens,
          keptTokens: 0,
          strategy: section.truncateStrategy ?? 'drop-whole',
        })
      }
      continue
    }
    parts.push(d.keptText)
    keptTextById[section.id] = d.keptText
    finalTokens += d.keptTokens
    keptSectionIds.push(section.id)
    if (d.action === 'truncate') {
      truncated.push({
        id: section.id,
        originalTokens: section.tokens,
        keptTokens: d.keptTokens,
        strategy: section.truncateStrategy ?? 'drop-whole',
      })
    }
  }

  // 生成 warnings
  for (const t of truncated) {
    const ratio = ((1 - t.keptTokens / t.originalTokens) * 100).toFixed(0)
    warnings.push(`段落 "${t.id}" 被截断（${t.keptTokens}/${t.originalTokens} tokens，删除 ${ratio}%）`)
  }
  for (const id of droppedSectionIds) {
    warnings.push(`段落 "${id}" 因预算不足被完全丢弃`)
  }

  if (warnOnOverflow && warnings.length > 0) {
    console.warn(`[context-budget] 超预算 ${totalEstimated} > ${totalBudget} tokens:`, warnings)
  }

  return {
    assembledText: parts.join('\n\n'),
    keptSectionIds,
    droppedSectionIds,
    truncated,
    totalTokens: finalTokens,
    warnings,
    keptTextById,
  }
}

function truncateText(text: string, targetTokens: number, strategy: SectionTruncateStrategy): string {
  if (strategy === 'drop-subsection') {
    // 按 \n\n 切分子段，从头保留直到接近 targetTokens
    const subs = text.split(/\n\n+/)
    const kept: string[] = []
    let keptTokens = 0
    for (const sub of subs) {
      const subTokens = estimateTokens(sub)
      if (keptTokens + subTokens > targetTokens && kept.length > 0) break
      kept.push(sub)
      keptTokens += subTokens
    }
    if (kept.length === 0 && subs.length > 0) {
      // 至少留一段
      kept.push(subs[0])
    }
    return kept.join('\n\n')
  }

  // hard-cut：按字符估算截断到 targetTokens
  // 反推字符数：粗略假设 2.5 字符/token（中英混合）
  const approxChars = targetTokens * 2.5
  if (text.length <= approxChars) return text
  // 在 approxChars 附近找最近的 \n，避免截断半句话
  const cutAt = text.lastIndexOf('\n', approxChars)
  const finalCut = cutAt > approxChars * 0.5 ? cutAt : Math.floor(approxChars)
  return `${text.slice(0, finalCut).trimEnd()}\n…[预算截断]`
}

/**
 * 辅助：从 BudgetResult 构造一份给可观测性用的摘要。
 * 适合塞到 agent telemetry 或日志。
 */
export function summarizeBudgetResult(result: BudgetResult): string {
  const parts: string[] = [`total=${result.totalTokens}`]
  if (result.truncated.length > 0) {
    parts.push(`truncated=${result.truncated.length}`)
  }
  if (result.droppedSectionIds.length > 0) {
    parts.push(`dropped=${result.droppedSectionIds.length}`)
  }
  return parts.join(' ')
}

/**
 * 辅助：根据"模型上下文窗口"反推合理预算。
 * 经验分配：context_window × 0.4 给 system prompt，0.3 给 history，0.3 给 output
 */
export function suggestBudgetForContextWindow(contextWindow: number): {
  systemPrompt: number
  history: number
  output: number
} {
  return {
    systemPrompt: Math.floor(contextWindow * 0.4),
    history: Math.floor(contextWindow * 0.3),
    output: Math.floor(contextWindow * 0.3),
  }
}
