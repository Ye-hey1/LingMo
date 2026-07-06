/**
 * AI 热点兴趣配置系统（兴趣词组 DSL + 自然语言）
 * ----------------------------------------------------------------
 * 移植自 TrendRadar 的 frequency_words.txt 词组 DSL，并适配 LingMo 的 TS 架构。
 *
 * 设计目标：把原本硬编码在 rules.ts/config.ts 的 5 个固定分类和魔数权重，
 * 变成用户可编辑、可扩展的配置。用户能定义自己关心的 AI 子领域
 * （如"只看具身智能 + 国产芯片"），分类与评分随之动态调整。
 *
 * 词组 DSL 语法（借鉴 TrendRadar，每段词组用空行分隔）：
 *   [组别名]            ← 该组显示名 / 分类标签（第一行）
 *   关键词A             ← 普通词（OR 关系，任一命中即归属该组）
 *   关键词B => 显示名   ← 命中后打标签时用「显示名」
 *   +必须词             ← AND 关系，必须全部命中
 *   !过滤词             ← 命中则排除该条
 *   /正则/i => 别名      ← 正则匹配（可选 flags），支持别名
 *   @5                  ← 该组最多展示 N 条（用于裁剪展示）
 *
 *   [GLOBAL_FILTER]     ← 单独段落，全局过滤词（命中即从结果中剔除）
 *   娱乐
 *   八卦
 *
 * 评分（借鉴 TrendRadar 的 rank/max_count 思路，扩展为透明可调权重）：
 *   每个命中的词组贡献 tagBonus；必须词命中额外加权；过滤词扣分。
 */

export interface ParsedWord {
  word: string
  isRegex: boolean
  pattern: RegExp | null
  displayName: string | null
}

export interface WordGroup {
  /** 分组显示名 / 分类标签 */
  displayName: string
  /** 必须词（AND，全部命中） */
  required: ParsedWord[]
  /** 普通词（OR，任一命中） */
  normal: ParsedWord[]
  /** 该组最多展示条数（0 = 不限制） */
  maxCount: number
  /** 该组命中时贡献的热度加成 */
  weight: number
}

export interface InterestConfig {
  /** 词组规则（keyword 模式，免 token） */
  wordGroups: WordGroup[]
  /** 组内/全局过滤词（命中即排除） */
  filterWords: ParsedWord[]
  globalFilters: ParsedWord[]
  /** 原始配置文本（用于 AI 模式回退 / 调试） */
  rawText: string
  /** 自然语言兴趣描述（AI 模式使用） */
  interestsText: string
  /** 评分权重（透明可调） */
  scoring: InterestScoring
}

export interface InterestScoring {
  /** 命中一个词组标签的基础加分 */
  tagBonus: number
  /** 命中必须词的额外加分 */
  requiredBonus: number
  /** 可信信源加分 */
  trustedSourceBonus: number
  /** 被收藏加分 */
  favoriteBonus: number
  /** 已沉淀加分 */
  savedBonus: number
  /** 已读扣分 */
  readPenalty: number
}

export const DEFAULT_SCORING: InterestScoring = {
  tagBonus: 6,
  requiredBonus: 4,
  trustedSourceBonus: 10,
  favoriteBonus: 5,
  savedBonus: 3,
  readPenalty: 2,
}

/* ----------------------------- 单词解析 ----------------------------- */

function parseWord(raw: string): ParsedWord {
  let displayName: string | null = null
  let wordConfig = raw.trim()

  // 显示别名：word => alias
  const aliasIdx = wordConfig.indexOf('=>')
  if (aliasIdx !== -1) {
    const alias = wordConfig.slice(aliasIdx + 2).trim()
    wordConfig = wordConfig.slice(0, aliasIdx).trim()
    if (alias) displayName = alias
  }

  // 正则：/pattern/flags（flags 被忽略，统一 IGNORECASE）
  const regexMatch = wordConfig.match(/^\/(.+)\/[a-z]*$/i)
  if (regexMatch) {
    const patternStr = regexMatch[1]
    try {
      return {
        word: patternStr,
        isRegex: true,
        pattern: new RegExp(patternStr, 'i'),
        displayName,
      }
    } catch {
      // 非法正则降级为普通字符串
      return { word: patternStr, isRegex: false, pattern: null, displayName }
    }
  }

  return { word: wordConfig.toLowerCase(), isRegex: false, pattern: null, displayName }
}

function wordMatches(word: ParsedWord, textLower: string): boolean {
  if (word.isRegex && word.pattern) return word.pattern.test(textLower)
  return textLower.includes(word.word)
}

/* --------------------------- DSL 解析主入口 --------------------------- */

function parseSection(
  lines: string[],
  defaultWeight: number,
): { groups: WordGroup[]; filterWords: ParsedWord[] } {
  const groups: WordGroup[] = []
  const filterWords: ParsedWord[] = []
  let i = 0

  while (i < lines.length) {
    // 跳过注释和空行（空行已在分段时处理，这里防御）
    if (!lines[i].trim() || lines[i].trim().startsWith('#')) {
      i++
      continue
    }

    let displayName = ''
    let weight = defaultWeight
    const required: ParsedWord[] = []
    const normal: ParsedWord[] = []
    let maxCount = 0

    // 第一行可能是组别名
    const first = lines[i].trim()
    if (/^\[.+\]$/.test(first) && first.toUpperCase() !== '[GLOBAL_FILTER]' && first.toUpperCase() !== '[WORD_GROUPS]') {
      displayName = first.slice(1, -1).trim()
      i++
    }

    // 收集本组词直到空行
    while (i < lines.length && lines[i].trim() !== '') {
      const line = lines[i].trim()
      i++
      if (line.startsWith('#')) continue
      if (line.startsWith('@')) {
        const n = Number.parseInt(line.slice(1), 10)
        if (n > 0) maxCount = n
      } else if (line.startsWith('!')) {
        filterWords.push(parseWord(line.slice(1)))
      } else if (line.startsWith('+')) {
        required.push(parseWord(line.slice(1)))
      } else if (line.startsWith('$')) {
        // 扩展：$N 设置本组权重
        const n = Number.parseFloat(line.slice(1))
        if (Number.isFinite(n) && n > 0) weight = n
      } else {
        normal.push(parseWord(line))
      }
    }

    if (required.length > 0 || normal.length > 0) {
      if (!displayName) {
        // 无组别名时，用普通词的显示名拼接
        displayName = [...normal, ...required]
          .map(w => w.displayName || w.word)
          .join(' / ')
      }
      groups.push({ displayName, required, normal, maxCount, weight })
    }
  }

  return { groups, filterWords }
}

/**
 * 解析兴趣配置文本为结构化配置。
 * 文本格式见文件顶部说明。
 */
export function parseInterestConfig(
  text: string,
  options: { defaultWeight?: number; scoring?: Partial<InterestScoring> } = {},
): InterestConfig {
  const defaultWeight = options.defaultWeight ?? 1
  const content = text || ''

  // 拆分 [GLOBAL_FILTER] 区域
  let wordGroupsText = content
  let globalFiltersText = ''
  const gfi = content.indexOf('[GLOBAL_FILTER]')
  if (gfi !== -1) {
    wordGroupsText = content.slice(0, gfi)
    globalFiltersText = content.slice(gfi + '[GLOBAL_FILTER]'.length)
  }

  // 移除 [WORD_GROUPS] 标记（兼容 TrendRadar）
  wordGroupsText = wordGroupsText.replace(/\[WORD_GROUPS\]/i, '')

  const main = parseSection(wordGroupsText.split('\n'), defaultWeight)
  const globalSection = parseSection(globalFiltersText.split('\n'), defaultWeight)

  return {
    wordGroups: main.groups,
    filterWords: main.filterWords,
    globalFilters: globalSection.filterWords,
    rawText: content,
    interestsText: '',
    scoring: { ...DEFAULT_SCORING, ...options.scoring },
  }
}

/* --------------------------- 匹配与分类 --------------------------- */

export interface ClassificationResult {
  /** 命中的分类标签（按权重降序） */
  tags: string[]
  /** 是否通过全局/组内过滤 */
  passed: boolean
  /** 词组命中贡献的热度加分 */
  groupBonus: number
}

/**
 * 对单条文本（标题+摘要+已有标签）进行分类。
 * 返回命中的分类标签与热度加成。
 */
export function classifyByInterest(
  text: string,
  config: InterestConfig,
): ClassificationResult {
  const textLower = text.toLowerCase()
  if (!textLower.trim()) {
    return { tags: [], passed: false, groupBonus: 0 }
  }

  // 全局过滤优先级最高
  if (config.globalFilters.some(w => wordMatches(w, textLower))) {
    return { tags: [], passed: false, groupBonus: 0 }
  }
  // 组内过滤词
  if (config.filterWords.some(w => wordMatches(w, textLower))) {
    return { tags: [], passed: false, groupBonus: 0 }
  }

  const hits: Array<{ group: WordGroup; bonus: number }> = []
  for (const group of config.wordGroups) {
    // 必须词（AND）
    if (group.required.length > 0) {
      const allRequired = group.required.every(w => wordMatches(w, textLower))
      if (!allRequired) continue
    }
    // 普通词（OR）；若只有必须词无普通词，则必须词满足即命中
    const normalHit = group.normal.length === 0 || group.normal.some(w => wordMatches(w, textLower))
    if (!normalHit) continue

    const bonus = group.weight * config.scoring.tagBonus +
      (group.required.length > 0 ? config.scoring.requiredBonus : 0)
    hits.push({ group, bonus })
  }

  if (hits.length === 0) {
    // 无词组规则时放行所有（支持"显示全部"），但无标签
    return { tags: [], passed: true, groupBonus: 0 }
  }

  hits.sort((a, b) => b.bonus - a.bonus)
  return {
    tags: hits.map(h => h.group.displayName),
    passed: true,
    groupBonus: hits.reduce((sum, h) => sum + h.bonus, 0),
  }
}

/* --------------------------- 默认配置（迁移旧规则） --------------------------- */

/**
 * 默认兴趣配置。从旧 rules.ts 的 5 个固定分类迁移而来，
 * 现在用户可在设置里编辑这段文本来调整分类。
 */
export const DEFAULT_INTEREST_TEXT = `# AI 热点兴趣配置 —— 词组 DSL
# 语法：[组别名] 普通词 / +必须词 / !过滤词 / /正则/i => 别名 / @N 最多展示 / $权重
# 每段词组用空行分隔。修改后下次刷新生效。

[AI模型]
gpt
claude
gemini
deepseek
openai
anthropic
大模型
多模态
智能体
/prompt engineering/i => 提示工程

[产品应用]
agent
sdk
api
产品
应用
发布
上线

[行业动态]
发布
融资
收购
上市
监管
政策
市场

[论文研究]
paper
research
benchmark
论文
研究
评测
/arxiv/i

[技巧经验]
教程
实战
经验
优化
技巧

[GLOBAL_FILTER]
娱乐
明星
八卦
足球
篮球
彩票
`

/** 默认的自然语言兴趣描述（AI 智能分类模式使用，可编辑） */
export const DEFAULT_INTERESTS_TEXT = `下面是我要关注的内容（按重要性排序，越靠前越重要）：

1. AI 模型与基础能力：关注 GPT、Claude、Gemini、DeepSeek、Qwen 等大模型的能力演进、开源闭源策略与多模态进展。
2. AI 产品与智能体：关注 Agent、SDK、API、开发者工具的产品发布与落地场景。
3. AI 基础设施与算力：关注英伟达、AMD、国产算力、CUDA 相关的算力供给、推理成本与供应链。
4. 芯片与硬件：关注芯片、半导体、光刻机、先进封装与国产替代。
5. 机器人与具身智能：关注人形机器人、四足、具身智能的产品发布与量产。
6. 行业与资本：关注 AI 领域的融资、收购、上市、监管与政策变化。
7. 学术研究：关注重要论文、benchmark、评测与方法论突破。

标题质量要求（命中以下特征的请跳过）：
- 不要标题党/震惊体（"震惊！""太可怕了！"）
- 不要营销软文、广告推广类`
