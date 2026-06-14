import type {
  ResearchProviderHealth,
  ResearchSearchCacheStats,
  ResearchSession,
} from './deep-research'

export const RESEARCH_HISTORY_INDEX_VERSION = '2026-06-research-history-v1'

const DAY_MS = 24 * 60 * 60 * 1000
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where', 'how',
  'are', 'was', 'were', 'into', 'about', '研究', '分析', '总结', '最新', '当前', '进行',
])

export interface ResearchHistoryDocument {
  id: string
  sessionId: string
  query: string
  strategy: string
  startedAt?: string
  completedAt?: string
  reportPath?: string
  sessionPath?: string
  sourceCount: number
  evidenceCount: number
  independentDomains: number
  sourceDomains: string[]
  sourceUrls: string[]
  sourceTitles: string[]
  learnings: string[]
  evidenceClaims: string[]
  latestSourcePublishedAt?: string
  qualityGrade?: string
  qualityScore?: number
  cacheStats?: ResearchSearchCacheStats
  providerHealth?: ResearchProviderHealth[]
  metrics: ResearchHistoryMetrics
  terms: Record<string, number>
  length: number
  searchableText: string
  updatedAt: string
}

export interface ResearchHistoryIndex {
  version: string
  generatedAt: string
  documentCount: number
  avgDocumentLength: number
  documents: ResearchHistoryDocument[]
  documentFrequency: Record<string, number>
  postings: Record<string, Array<{ id: string; weight: number }>>
}

export interface ResearchHistoryMetrics {
  sourceCount: number
  evidenceCount: number
  independentDomains: number
  citationCoverage: number
  highConfidenceRatio: number
  averageCredibility: number
  sourceQualityScore: number
  recencyDays: number | null
  recencyScore: number
  cacheHitRate: number | null
  accuracyProxy: number
}

export interface ResearchHistorySearchResult {
  document: ResearchHistoryDocument
  score: number
  matchedTerms: string[]
  snippets: string[]
}

export interface ResearchBenchmarkCase {
  id: string
  question: string
  expectedKeywords?: string[]
  requiredDomains?: string[]
  freshnessDays?: number
  minSources?: number
  minEvidence?: number
  minKeywordCoverage?: number
  minSourceQuality?: number
}

export interface ResearchBenchmarkResult {
  id: string
  question: string
  pass: boolean
  topSessionId?: string
  topQuery?: string
  searchScore: number
  keywordCoverage: number
  requiredDomainCoverage: number
  accuracyProxy: number
  recencyScore: number
  sourceQualityScore: number
  cacheHitRate: number | null
  sourceCount: number
  evidenceCount: number
  matchedTerms: string[]
}

export interface ResearchBenchmarkSummary {
  caseCount: number
  passCount: number
  averageAccuracyProxy: number
  averageRecencyScore: number
  averageSourceQualityScore: number
  averageCacheHitRate: number | null
  results: ResearchBenchmarkResult[]
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toTimestamp(value?: string) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}+#._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeResearchText(value: string): string[] {
  const normalized = normalizeText(value)
  if (!normalized) return []

  const tokens: string[] = []
  const segments = normalized.match(/[a-z0-9][a-z0-9+#._-]*|[\u4e00-\u9fff]+/g) || []

  for (const segment of segments) {
    if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      if (segment.length === 1) {
        tokens.push(segment)
      } else {
        for (let index = 0; index < segment.length - 1; index += 1) {
          tokens.push(segment.slice(index, index + 2))
        }
        if (segment.length <= 6) {
          tokens.push(segment)
        }
      }
      continue
    }

    const clean = segment.replace(/^[-_.]+|[-_.]+$/g, '')
    if (clean.length >= 2 && !STOP_WORDS.has(clean)) {
      tokens.push(clean)
    }
  }

  return tokens.filter(token => !STOP_WORDS.has(token))
}

function addWeightedTerms(target: Map<string, number>, value: string, weight: number) {
  for (const token of tokenizeResearchText(value)) {
    target.set(token, (target.get(token) || 0) + weight)
  }
}

function hostname(url?: string) {
  if (!url || url.startsWith('local:')) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function latestPublishedAt(sources: ResearchSession['sources']) {
  let latest = 0
  let latestValue: string | undefined

  for (const source of sources || []) {
    const timestamp = toTimestamp(source.publishedAt)
    if (timestamp && timestamp > latest) {
      latest = timestamp
      latestValue = source.publishedAt
    }
  }

  return latestValue
}

function cacheHitRate(cacheStats?: ResearchSearchCacheStats) {
  if (!cacheStats) return null
  const total = cacheStats.hits + cacheStats.misses
  return total > 0 ? round(cacheStats.hits / total) : null
}

export function scoreResearchSession(session: ResearchSession, now = Date.now()): ResearchHistoryMetrics {
  const sources = Array.isArray(session.sources) ? session.sources : []
  const evidences = Array.isArray(session.evidences) ? session.evidences : []
  const sourceIds = new Set(sources.map(source => source.id).filter(Boolean))
  const citedSourceIds = new Set(evidences.map(evidence => evidence.sourceId).filter(id => sourceIds.has(id)))
  const domains = new Set(sources.map(source => hostname(source.url)).filter(Boolean))
  const highConfidence = evidences.filter(evidence => evidence.confidence === 'high').length
  const mediumConfidence = evidences.filter(evidence => evidence.confidence === 'medium').length
  const credibilityValues = sources
    .map(source => typeof source.credibilityScore === 'number' ? source.credibilityScore : 0)
    .filter(value => value > 0)
  const averageCredibility = credibilityValues.length
    ? credibilityValues.reduce((sum, value) => sum + value, 0) / credibilityValues.length
    : 0
  const latestTimestamp = toTimestamp(latestPublishedAt(sources))
    || toTimestamp(session.completedAt)
    || toTimestamp(session.startedAt)
  const recencyDays = latestTimestamp ? Math.max(0, Math.round((now - latestTimestamp) / DAY_MS)) : null
  const recencyScore = recencyDays === null
    ? 0
    : Math.round(100 * Math.exp(-recencyDays / 365))

  const citationCoverage = sources.length ? citedSourceIds.size / sources.length : 0
  const highConfidenceRatio = evidences.length ? highConfidence / evidences.length : 0
  const evidenceConfidenceRatio = evidences.length ? (highConfidence + mediumConfidence * 0.65) / evidences.length : 0
  const domainScore = Math.min(1, domains.size / 4)
  const sourceVolumeScore = Math.min(1, sources.length / 8)
  const evidenceVolumeScore = Math.min(1, evidences.length / 12)
  const sourceQualityScore = Math.round(100 * (
    averageCredibility * 0.25
    + citationCoverage * 0.25
    + domainScore * 0.2
    + sourceVolumeScore * 0.15
    + evidenceVolumeScore * 0.15
  ))
  const accuracyProxy = Math.round(100 * (
    evidenceConfidenceRatio * 0.45
    + citationCoverage * 0.25
    + averageCredibility * 0.15
    + domainScore * 0.15
  ))

  return {
    sourceCount: sources.length,
    evidenceCount: evidences.length,
    independentDomains: domains.size,
    citationCoverage: round(citationCoverage),
    highConfidenceRatio: round(highConfidenceRatio),
    averageCredibility: round(averageCredibility),
    sourceQualityScore,
    recencyDays,
    recencyScore,
    cacheHitRate: cacheHitRate(session.cacheStats),
    accuracyProxy,
  }
}

export function createResearchHistoryDocument(input: {
  session: ResearchSession
  reportContent?: string
  reportPath?: string
  sessionPath?: string
  now?: number
}): ResearchHistoryDocument {
  const { session } = input
  const sources = Array.isArray(session.sources) ? session.sources : []
  const evidences = Array.isArray(session.evidences) ? session.evidences : []
  const sourceDomains = Array.from(new Set(sources.map(source => hostname(source.url)).filter(Boolean)))
  const sourceTitles = sources.map(source => source.title || source.url).filter(Boolean).slice(0, 80)
  const sourceUrls = sources.map(source => source.url).filter(Boolean).slice(0, 120)
  const learnings = (session.learnings || []).filter(Boolean).slice(0, 120)
  const evidenceClaims = evidences.map(evidence => evidence.claim).filter(Boolean).slice(0, 160)
  const searchableText = [
    session.query,
    session.strategy,
    ...learnings,
    ...evidenceClaims,
    ...sourceTitles,
    ...sourceDomains,
    input.reportContent ? input.reportContent.slice(0, 20000) : '',
  ].filter(Boolean).join('\n')

  const termWeights = new Map<string, number>()
  addWeightedTerms(termWeights, session.query, 4)
  addWeightedTerms(termWeights, session.strategy, 1.2)
  learnings.forEach(learning => addWeightedTerms(termWeights, learning, 2.2))
  evidenceClaims.forEach(claim => addWeightedTerms(termWeights, claim, 2.6))
  sourceTitles.forEach(title => addWeightedTerms(termWeights, title, 1.4))
  sourceDomains.forEach(domain => addWeightedTerms(termWeights, domain, 1))
  if (input.reportContent) {
    addWeightedTerms(termWeights, input.reportContent.slice(0, 20000), 0.35)
  }

  const terms = Object.fromEntries(
    Array.from(termWeights.entries()).map(([token, weight]) => [token, round(weight)])
  )
  const length = round(Array.from(termWeights.values()).reduce((sum, weight) => sum + weight, 0))

  return {
    id: session.id,
    sessionId: session.id,
    query: session.query,
    strategy: session.strategy,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    reportPath: input.reportPath,
    sessionPath: input.sessionPath,
    sourceCount: sources.length,
    evidenceCount: evidences.length,
    independentDomains: sourceDomains.length,
    sourceDomains,
    sourceUrls,
    sourceTitles,
    learnings,
    evidenceClaims,
    latestSourcePublishedAt: latestPublishedAt(sources),
    qualityGrade: session.quality?.grade,
    qualityScore: session.quality?.overall,
    cacheStats: session.cacheStats,
    providerHealth: session.providerHealth,
    metrics: scoreResearchSession(session, input.now),
    terms,
    length,
    searchableText,
    updatedAt: new Date(input.now || Date.now()).toISOString(),
  }
}

export function buildResearchHistoryIndexFromDocuments(
  documents: ResearchHistoryDocument[],
  now = Date.now(),
): ResearchHistoryIndex {
  const uniqueDocuments = Array.from(new Map(documents.map(doc => [doc.id, doc])).values())
    .sort((a, b) => (toTimestamp(b.completedAt) || 0) - (toTimestamp(a.completedAt) || 0))
  const documentFrequency: Record<string, number> = {}
  const postings: Record<string, Array<{ id: string; weight: number }>> = {}
  let totalLength = 0

  for (const document of uniqueDocuments) {
    totalLength += document.length
    for (const [term, weight] of Object.entries(document.terms)) {
      documentFrequency[term] = (documentFrequency[term] || 0) + 1
      if (!postings[term]) postings[term] = []
      postings[term].push({ id: document.id, weight })
    }
  }

  return {
    version: RESEARCH_HISTORY_INDEX_VERSION,
    generatedAt: new Date(now).toISOString(),
    documentCount: uniqueDocuments.length,
    avgDocumentLength: uniqueDocuments.length ? round(totalLength / uniqueDocuments.length) : 0,
    documents: uniqueDocuments,
    documentFrequency,
    postings,
  }
}

export function buildResearchHistoryIndex(
  sessions: ResearchSession[],
  options: { reportContents?: Record<string, string>; now?: number } = {},
): ResearchHistoryIndex {
  const documents = sessions.map(session => createResearchHistoryDocument({
    session,
    reportContent: options.reportContents?.[session.id],
    now: options.now,
  }))
  return buildResearchHistoryIndexFromDocuments(documents, options.now)
}

export function upsertResearchHistoryDocument(
  index: ResearchHistoryIndex | null,
  document: ResearchHistoryDocument,
  now = Date.now(),
): ResearchHistoryIndex {
  const documents = index?.documents?.filter(item => item.id !== document.id) || []
  return buildResearchHistoryIndexFromDocuments([...documents, document], now)
}

function snippetsForDocument(document: ResearchHistoryDocument, matchedTerms: string[]) {
  const candidates = [
    ...document.learnings,
    ...document.evidenceClaims,
    ...document.sourceTitles,
  ]
  const normalizedTerms = matchedTerms.map(term => term.toLowerCase())

  return candidates
    .filter(candidate => {
      const normalized = candidate.toLowerCase()
      return normalizedTerms.some(term => normalized.includes(term))
    })
    .slice(0, 3)
}

export function searchResearchHistory(
  index: ResearchHistoryIndex,
  query: string,
  options: { limit?: number; minScore?: number } = {},
): ResearchHistorySearchResult[] {
  const queryTerms = Array.from(new Set(tokenizeResearchText(query)))
  if (!queryTerms.length || !index.documentCount) return []

  const scores = new Map<string, { score: number; terms: Set<string> }>()
  const docsById = new Map(index.documents.map(document => [document.id, document]))

  for (const term of queryTerms) {
    const postings = index.postings[term]
    if (!postings?.length) continue
    const df = index.documentFrequency[term] || postings.length
    const idf = Math.log(1 + (index.documentCount + 1) / (df + 0.5))

    for (const posting of postings) {
      const entry = scores.get(posting.id) || { score: 0, terms: new Set<string>() }
      entry.score += posting.weight * idf
      entry.terms.add(term)
      scores.set(posting.id, entry)
    }
  }

  const minScore = options.minScore ?? 0.01
  return Array.from(scores.entries())
    .map(([id, entry]) => {
      const document = docsById.get(id)
      if (!document) return null
      const qualityBoost = 1 + document.metrics.sourceQualityScore / 500
      const recencyBoost = 1 + document.metrics.recencyScore / 1000
      const matchedTerms = Array.from(entry.terms)
      const coverageBoost = 1 + matchedTerms.length / Math.max(5, queryTerms.length * 4)
      const score = round(entry.score * qualityBoost * recencyBoost * coverageBoost)
      return {
        document,
        score,
        matchedTerms,
        snippets: snippetsForDocument(document, matchedTerms),
      } satisfies ResearchHistorySearchResult
    })
    .filter((item): item is ResearchHistorySearchResult => !!item && item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 8)
}

function keywordCoverage(document: ResearchHistoryDocument, keywords: string[] = []) {
  if (!keywords.length) return 1
  const text = document.searchableText.toLowerCase()
  const covered = keywords.filter(keyword => text.includes(keyword.toLowerCase()))
  return round(covered.length / keywords.length)
}

function domainCoverage(document: ResearchHistoryDocument, domains: string[] = []) {
  if (!domains.length) return 1
  const sourceDomains = new Set(document.sourceDomains)
  const covered = domains.filter(domain => sourceDomains.has(domain.replace(/^www\./, '').toLowerCase()))
  return round(covered.length / domains.length)
}

function benchmarkRecencyScore(document: ResearchHistoryDocument, freshnessDays?: number) {
  if (!freshnessDays || document.metrics.recencyDays === null) {
    return document.metrics.recencyScore
  }
  if (document.metrics.recencyDays <= freshnessDays) return 100
  return Math.round(100 * Math.exp(-(document.metrics.recencyDays - freshnessDays) / Math.max(freshnessDays, 30)))
}

export function evaluateResearchBenchmark(
  index: ResearchHistoryIndex,
  cases: ResearchBenchmarkCase[],
): ResearchBenchmarkSummary {
  const results: ResearchBenchmarkResult[] = cases.map(testCase => {
    const [top] = searchResearchHistory(index, testCase.question, { limit: 1 })
    if (!top) {
      return {
        id: testCase.id,
        question: testCase.question,
        pass: false,
        searchScore: 0,
        keywordCoverage: 0,
        requiredDomainCoverage: 0,
        accuracyProxy: 0,
        recencyScore: 0,
        sourceQualityScore: 0,
        cacheHitRate: null,
        sourceCount: 0,
        evidenceCount: 0,
        matchedTerms: [],
      }
    }

    const document = top.document
    const keywordScore = keywordCoverage(document, testCase.expectedKeywords)
    const domainScore = domainCoverage(document, testCase.requiredDomains)
    const recencyScore = benchmarkRecencyScore(document, testCase.freshnessDays)
    const sourceQualityScore = document.metrics.sourceQualityScore
    const accuracyProxy = Math.round(100 * (
      keywordScore * 0.45
      + domainScore * 0.15
      + document.metrics.accuracyProxy / 100 * 0.4
    ))
    const pass = top.score > 0
      && keywordScore >= (testCase.minKeywordCoverage ?? 0.35)
      && sourceQualityScore >= (testCase.minSourceQuality ?? 45)
      && document.sourceCount >= (testCase.minSources ?? 2)
      && document.evidenceCount >= (testCase.minEvidence ?? 2)
      && recencyScore >= 30

    return {
      id: testCase.id,
      question: testCase.question,
      pass,
      topSessionId: document.sessionId,
      topQuery: document.query,
      searchScore: top.score,
      keywordCoverage: keywordScore,
      requiredDomainCoverage: domainScore,
      accuracyProxy,
      recencyScore,
      sourceQualityScore,
      cacheHitRate: document.metrics.cacheHitRate,
      sourceCount: document.sourceCount,
      evidenceCount: document.evidenceCount,
      matchedTerms: top.matchedTerms,
    }
  })

  const cacheRates = results
    .map(result => result.cacheHitRate)
    .filter((value): value is number => typeof value === 'number')

  return {
    caseCount: results.length,
    passCount: results.filter(result => result.pass).length,
    averageAccuracyProxy: round(results.reduce((sum, result) => sum + result.accuracyProxy, 0) / Math.max(1, results.length)),
    averageRecencyScore: round(results.reduce((sum, result) => sum + result.recencyScore, 0) / Math.max(1, results.length)),
    averageSourceQualityScore: round(results.reduce((sum, result) => sum + result.sourceQualityScore, 0) / Math.max(1, results.length)),
    averageCacheHitRate: cacheRates.length
      ? round(cacheRates.reduce((sum, value) => sum + value, 0) / cacheRates.length)
      : null,
    results,
  }
}
