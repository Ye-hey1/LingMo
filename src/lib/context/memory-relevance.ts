export interface MemoryRelevanceScore {
  lexical: number
  semantic?: number
  combined: number
}

const LOW_SIGNAL_TOKENS = new Set([
  '这个', '那个', '然后', '继续', '一下', '一个', '用户', '进行', '内容', '问题',
  'this', 'that', 'then', 'continue', 'user', 'about', 'with', 'from',
])

function normalizeText(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function tokenize(value: string) {
  const normalized = normalizeText(value)
  const tokens = new Set<string>()

  for (const word of normalized.match(/[a-z0-9][a-z0-9_-]+/g) || []) {
    if (word.length > 1 && !LOW_SIGNAL_TOKENS.has(word)) tokens.add(word)
  }

  for (const segment of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    if (segment.length === 1) {
      if (!LOW_SIGNAL_TOKENS.has(segment)) tokens.add(segment)
      continue
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      const bigram = segment.slice(index, index + 2)
      if (!LOW_SIGNAL_TOKENS.has(bigram)) tokens.add(bigram)
    }
  }

  return tokens
}

function getLexicalScore(query: string, content: string) {
  const queryTokens = tokenize(query)
  const contentTokens = tokenize(content)
  if (queryTokens.size === 0 || contentTokens.size === 0) return 0

  let overlap = 0
  for (const token of queryTokens) {
    if (contentTokens.has(token)) overlap += 1
  }

  const overlapCoefficient = overlap / Math.max(1, Math.min(queryTokens.size, contentTokens.size))
  const normalizedQuery = normalizeText(query).replace(/\s+/g, '')
  const normalizedContent = normalizeText(content).replace(/\s+/g, '')
  const substringBoost = normalizedQuery.length >= 4 && normalizedContent.includes(normalizedQuery) ? 0.2 : 0
  return Math.min(1, overlapCoefficient + substringBoost)
}

export function scoreMemoryRelevance(
  query: string,
  content: string,
  semanticSimilarity?: number,
): MemoryRelevanceScore {
  const lexical = getLexicalScore(query, content)
  const semantic = typeof semanticSimilarity === 'number' && Number.isFinite(semanticSimilarity)
    ? Math.max(-1, Math.min(1, semanticSimilarity))
    : undefined

  const combined = semantic === undefined
    ? lexical * 0.9
    : Math.max(
      semantic,
      lexical * 0.9,
      semantic * 0.72 + lexical * 0.28,
    )

  return { lexical, semantic, combined }
}
