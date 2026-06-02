import type {
  SkillContent,
  SkillMatchConfidence,
  SkillMatchScore,
  SkillMatchSignal,
  SkillMatchSignalSource,
} from './types'

interface SkillSignalCandidate {
  source: SkillMatchSignalSource
  text: string
  weight: number
}

interface MatchedTerm {
  term: string
  weight: number
}

const SOURCE_LABELS: Record<SkillMatchSignalSource, string> = {
  'skill-id': 'Skill ID',
  'skill-name': 'Skill 名称',
  description: '描述',
  'use-case': '使用场景',
  heading: '标题',
  reference: '参考文件',
  script: '脚本',
  asset: '资源',
  instruction: '正文',
}

const ENGLISH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'best',
  'by',
  'can',
  'for',
  'from',
  'guide',
  'help',
  'how',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'use',
  'using',
  'when',
  'with',
])

const CHINESE_STOP_TERMS = new Set([
  '一个',
  '一些',
  '以及',
  '使用',
  '内容',
  '功能',
  '可以',
  '如何',
  '如果',
  '进行',
  '这个',
  '这些',
])

const QUERY_SYNONYMS: Record<string, string[]> = {
  ppt: ['powerpoint', 'presentation', 'presentations', 'slides', 'deck'],
  powerpoint: ['ppt', 'presentation', 'slides', 'deck'],
  slides: ['ppt', 'powerpoint', 'presentation', 'deck'],
  deck: ['ppt', 'powerpoint', 'presentation', 'slides'],
  演示: ['presentation', 'presentations', 'slides', 'deck', 'ppt', 'powerpoint'],
  演示文稿: ['presentation', 'presentations', 'slides', 'deck', 'ppt', 'powerpoint'],
  幻灯片: ['presentation', 'presentations', 'slides', 'deck', 'ppt', 'powerpoint'],
  导出: ['export', 'generate', 'create'],
  生成: ['generate', 'create', 'build'],
  创建: ['create', 'generate', 'build'],
  笔记: ['note', 'notes'],
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/\\|()[\]{}:：,，.;；!?！？"'`~<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value)
  const tokens: string[] = []

  tokens.push(...normalized.match(/[a-z0-9][a-z0-9-]{1,}/g) || [])
  const chineseSegments = normalized.match(/[\u4e00-\u9fa5]{2,12}/g) || []
  tokens.push(...chineseSegments)
  for (const segment of chineseSegments) {
    for (const length of [2, 3, 4]) {
      if (segment.length <= length) continue
      for (let index = 0; index <= segment.length - length; index++) {
        tokens.push(segment.slice(index, index + length))
      }
    }
  }

  return uniqueValues(tokens)
    .filter(token => token.length >= 2)
    .filter(token => !ENGLISH_STOP_WORDS.has(token))
    .filter(token => !CHINESE_STOP_TERMS.has(token))
}

function splitIdentifier(value: string) {
  return uniqueValues(
    value
      .split(/[-_\s/\\:：.]+/)
      .map(part => normalizeText(part))
      .filter(part => part.length >= 2)
  )
}

function extractMarkdownHeadings(instructions: string) {
  return uniqueValues(
    instructions
      .split(/\r?\n/)
      .map(line => line.match(/^#{1,4}\s+(.+)$/)?.[1] || '')
      .filter(Boolean)
  ).slice(0, 12)
}

function extractUseCaseSections(instructions: string) {
  const lines = instructions.split(/\r?\n/)
  const sections: string[] = []
  const headingPattern = /^#{1,4}\s*(when to use|use cases?|适用场景|使用场景|何时使用|触发条件|应用场景)\s*$/i

  for (let index = 0; index < lines.length; index++) {
    if (!headingPattern.test(lines[index].trim())) {
      continue
    }

    const collected: string[] = []
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next]
      if (/^#{1,4}\s+/.test(line)) {
        break
      }
      const trimmed = line.trim()
      if (trimmed) {
        collected.push(trimmed.replace(/^[-*]\s+/, ''))
      }
      if (collected.length >= 8) {
        break
      }
    }

    if (collected.length > 0) {
      sections.push(collected.join(' '))
    }
  }

  return sections
}

function extractInstructionLead(instructions: string) {
  return uniqueValues(
    instructions
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('---'))
      .slice(0, 8)
  ).join(' ')
}

function buildSkillSignalCandidates(skill: SkillContent): SkillSignalCandidate[] {
  const metadata = skill.metadata
  const candidates: SkillSignalCandidate[] = [
    { source: 'skill-id', text: metadata.id, weight: 0.95 },
    { source: 'skill-name', text: metadata.name, weight: 1 },
    { source: 'description', text: metadata.description, weight: 0.9 },
  ]

  for (const useCase of extractUseCaseSections(skill.instructions)) {
    candidates.push({ source: 'use-case', text: useCase, weight: 1 })
  }

  for (const heading of extractMarkdownHeadings(skill.instructions)) {
    candidates.push({ source: 'heading', text: heading, weight: 0.55 })
  }

  const instructionLead = extractInstructionLead(skill.instructions)
  if (instructionLead) {
    candidates.push({ source: 'instruction', text: instructionLead, weight: 0.35 })
  }

  for (const reference of skill.references) {
    candidates.push({
      source: 'reference',
      text: `${reference.name} ${reference.description || ''}`,
      weight: 0.45,
    })
  }

  for (const script of skill.scripts) {
    candidates.push({
      source: 'script',
      text: `${script.name} ${script.description || ''}`,
      weight: 0.4,
    })
  }

  for (const asset of skill.assets) {
    candidates.push({
      source: 'asset',
      text: `${asset.name} ${asset.description || ''}`,
      weight: 0.3,
    })
  }

  return candidates.filter(candidate => candidate.text.trim())
}

function buildQueryTerms(userInput: string): MatchedTerm[] {
  const terms = new Map<string, number>()

  for (const token of tokenize(userInput)) {
    terms.set(token, token.length >= 4 || /[\u4e00-\u9fa5]/.test(token) ? 1 : 0.7)
  }

  for (const part of splitIdentifier(userInput)) {
    if (part.length >= 3) {
      terms.set(part, Math.max(terms.get(part) || 0, 0.9))
    }
  }

  for (const [term, synonyms] of Object.entries(QUERY_SYNONYMS)) {
    if (!terms.has(term) && !normalizeText(userInput).includes(term)) {
      continue
    }
    for (const synonym of synonyms) {
      terms.set(synonym, Math.max(terms.get(synonym) || 0, 0.75))
    }
  }

  return Array.from(terms.entries()).map(([term, weight]) => ({ term, weight }))
}

function getMatchedTerms(signalText: string, queryTerms: MatchedTerm[]): MatchedTerm[] {
  const normalizedSignal = normalizeText(signalText)
  const signalTokens = new Set(tokenize(signalText))
  const matched: MatchedTerm[] = []

  for (const queryTerm of queryTerms) {
    const normalizedTerm = normalizeText(queryTerm.term)
    if (!normalizedTerm) {
      continue
    }

    if (
      normalizedSignal.includes(normalizedTerm) ||
      signalTokens.has(normalizedTerm) ||
      (normalizedTerm.length >= 4 && Array.from(signalTokens).some(token => token.includes(normalizedTerm)))
    ) {
      matched.push(queryTerm)
    }
  }

  return matched
}

function clampScore(score: number) {
  return Math.max(0, Math.min(1, score))
}

function confidenceForScore(score: number): SkillMatchConfidence {
  if (score >= 0.68) return 'high'
  if (score >= 0.36) return 'medium'
  return 'low'
}

function summarizeSignal(signal: SkillMatchSignal) {
  const terms = signal.matchedTerms.slice(0, 5).join(', ')
  return `${SOURCE_LABELS[signal.source]}匹配: ${terms}`
}

export function calculateSkillMatchScore(
  skill: SkillContent,
  userInput: string
): SkillMatchScore {
  const queryTerms = buildQueryTerms(userInput)
  const matchedSignals: SkillMatchSignal[] = []

  if (queryTerms.length === 0) {
    return {
      skill,
      score: 0,
      confidence: 'low',
      reasons: [],
      matchedSignals,
    }
  }

  for (const candidate of buildSkillSignalCandidates(skill)) {
    const matchedTerms = getMatchedTerms(candidate.text, queryTerms)
    if (matchedTerms.length === 0) {
      continue
    }

    const matchedWeight = matchedTerms.reduce((sum, term) => sum + term.weight, 0)
    const coverage = Math.min(1, matchedWeight / 4)
    const exactPhraseBoost = normalizeText(candidate.text).includes(normalizeText(userInput)) ? 0.35 : 0
    const signalScore = candidate.weight * Math.min(1, coverage) + exactPhraseBoost

    matchedSignals.push({
      source: candidate.source,
      text: candidate.text,
      matchedTerms: matchedTerms.map(term => term.term),
      weight: signalScore,
    })
  }

  if (matchedSignals.length === 0) {
    return {
      skill,
      score: 0,
      confidence: 'low',
      reasons: [],
      matchedSignals,
    }
  }

  matchedSignals.sort((a, b) => b.weight - a.weight)

  const totalWeight = matchedSignals.reduce((sum, signal) => sum + signal.weight, 0)
  const sourceDiversity = new Set(matchedSignals.map(signal => signal.source)).size
  const queryCoverage = Math.min(1, new Set(matchedSignals.flatMap(signal => signal.matchedTerms)).size / 6)
  const diversityBoost = Math.min(0.2, Math.max(0, sourceDiversity - 1) * 0.05)
  const coverageBoost = Math.min(0.2, queryCoverage * 0.2)
  const score = clampScore(totalWeight / 2.4 + diversityBoost + coverageBoost)
  const confidence = confidenceForScore(score)

  return {
    skill,
    score,
    confidence,
    reasons: matchedSignals.slice(0, 3).map(summarizeSignal),
    matchedSignals: matchedSignals.slice(0, 8),
  }
}
