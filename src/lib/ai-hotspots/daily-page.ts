export interface AiHotDailyArticle {
  id: string
  title: string
  url: string
  role: string
  source: string
  summary: string
}

export interface AiHotDailySection {
  title: string
  subtitle: string
  articles: AiHotDailyArticle[]
}

export interface AiHotDailyMetric {
  label: string
  value: number
}

export interface AiHotDailyPage {
  sections: AiHotDailySection[]
  metrics: AiHotDailyMetric[]
  articleCount: number
}

type FlightNode = unknown

function extractFlightText(html: string) {
  const chunks: string[] = []
  const pattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html))) {
    try {
      const payload = JSON.parse(match[1]) as unknown
      if (Array.isArray(payload) && typeof payload[1] === 'string') {
        chunks.push(payload[1])
      }
    } catch {
      // Ignore non-flight script fragments.
    }
  }

  return chunks.join('')
}

function findJsonEnd(text: string, startIndex: number) {
  const startChar = text[startIndex]
  if (startChar !== '[' && startChar !== '{' && startChar !== '"') return -1

  let depth = startChar === '"' ? 0 : 1
  let inString = startChar === '"'
  let escaped = false

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        if (startChar === '"' && depth === 0) return index + 1
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '[' || char === '{') {
      depth += 1
    } else if (char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }

  return -1
}

function parseFlightLabels(flight: string) {
  const labels = new Map<string, FlightNode>()
  const labelPattern = /(?:^|\n)([0-9a-z]+):/g
  let match: RegExpExecArray | null

  while ((match = labelPattern.exec(flight))) {
    const id = match[1]
    const start = match.index + match[0].length
    const valueStart = start + flight.slice(start).search(/\S/)
    if (valueStart < start) continue

    const end = findJsonEnd(flight, valueStart)
    if (end < 0) continue

    try {
      labels.set(id, JSON.parse(flight.slice(valueStart, end)))
    } catch {
      // Module references and malformed fragments are not render nodes.
    }
  }

  return labels
}

function resolveNode(node: FlightNode, labels: Map<string, FlightNode>, seen = new Set<string>()): FlightNode {
  if (typeof node === 'string') {
    const ref = node.match(/^\$L([0-9a-z]+)$/)?.[1]
    if (!ref || seen.has(ref) || !labels.has(ref)) return node
    return resolveNode(labels.get(ref), labels, new Set([...seen, ref]))
  }

  if (Array.isArray(node)) {
    return node.map(child => resolveNode(child, labels, seen))
  }

  if (node && typeof node === 'object') {
    const result: Record<string, FlightNode> = {}
    for (const [key, value] of Object.entries(node)) {
      result[key] = resolveNode(value, labels, seen)
    }
    return result
  }

  return node
}

function getProps(node: FlightNode): Record<string, FlightNode> | null {
  if (!Array.isArray(node)) return null
  const props = node[3]
  return props && typeof props === 'object' && !Array.isArray(props)
    ? props as Record<string, FlightNode>
    : null
}

function hasClass(node: FlightNode, className: string) {
  const classValue = getProps(node)?.className
  return typeof classValue === 'string' && classValue.split(/\s+/).includes(className)
}

function isElement(node: FlightNode, tagName?: string, className?: string) {
  if (!Array.isArray(node) || node[0] !== '$') return false
  if (tagName && node[1] !== tagName) return false
  return className ? hasClass(node, className) : true
}

function getChildren(node: FlightNode): FlightNode {
  return getProps(node)?.children
}

function collectText(node: FlightNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    if (node[0] === '$') return collectText(getChildren(node))
    return node.map(collectText).join('')
  }
  if (node && typeof node === 'object') {
    return collectText((node as Record<string, FlightNode>).children)
  }
  return ''
}

function findFirst(node: FlightNode, predicate: (node: FlightNode) => boolean): FlightNode | null {
  if (predicate(node)) return node

  const children = Array.isArray(node) && node[0] === '$' ? getChildren(node) : node
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findFirst(child, predicate)
      if (match) return match
    }
  } else if (children && typeof children === 'object') {
    for (const value of Object.values(children as Record<string, FlightNode>)) {
      const match = findFirst(value, predicate)
      if (match) return match
    }
  }

  return null
}

function findAll(node: FlightNode, predicate: (node: FlightNode) => boolean, result: FlightNode[] = []) {
  if (predicate(node)) result.push(node)

  const children = Array.isArray(node) && node[0] === '$' ? getChildren(node) : node
  if (Array.isArray(children)) {
    for (const child of children) findAll(child, predicate, result)
  } else if (children && typeof children === 'object') {
    for (const value of Object.values(children as Record<string, FlightNode>)) {
      findAll(value, predicate, result)
    }
  }

  return result
}

function getHref(node: FlightNode) {
  const href = getProps(node)?.href
  return typeof href === 'string' ? href : ''
}

function parseArticle(node: FlightNode): AiHotDailyArticle | null {
  if (!Array.isArray(node)) return null
  const anchor = findFirst(node, candidate => isElement(candidate, 'a'))
  const sourceNode = findFirst(node, candidate => isElement(candidate, 'div', 'daily-article-source'))
  const roleNode = sourceNode ? findFirst(sourceNode, candidate => isElement(candidate, 'span', 'role-tag')) : null
  const sourceSpans = sourceNode ? findAll(sourceNode, candidate => isElement(candidate, 'span')) : []
  const sourceTextNode = sourceSpans.find(span => span !== roleNode) || null
  const summaryNode = findFirst(node, candidate => isElement(candidate, 'p', 'daily-article-summary'))
  const title = collectText(anchor || findFirst(node, candidate => isElement(candidate, 'h3', 'daily-article-title'))).trim()

  if (!title) return null

  return {
    id: typeof node[2] === 'string' ? node[2] : title,
    title,
    url: anchor ? getHref(anchor) : '',
    role: collectText(roleNode).trim(),
    source: collectText(sourceTextNode).trim(),
    summary: collectText(summaryNode).trim(),
  }
}

function parseSection(node: FlightNode): AiHotDailySection | null {
  const title = collectText(findFirst(node, candidate => isElement(candidate, 'h2', 'daily-section-title'))).trim()
  const subtitle = collectText(findFirst(node, candidate => isElement(candidate, 'span', 'daily-section-subtitle'))).trim()
  const articles = findAll(node, candidate => isElement(candidate, 'article', 'daily-article'))
    .map(parseArticle)
    .filter((article): article is AiHotDailyArticle => Boolean(article))

  if (!title && articles.length === 0) return null
  return { title, subtitle, articles }
}

function parseMetrics(root: FlightNode): AiHotDailyMetric[] {
  const metricNodes = findAll(root, candidate => isElement(candidate, 'div', 'daily-metric'))

  return metricNodes
    .map((metric): AiHotDailyMetric | null => {
      const value = Number(collectText(findFirst(metric, candidate => isElement(candidate, 'div', 'daily-metric-value'))))
      const label = collectText(findFirst(metric, candidate => isElement(candidate, 'div', 'daily-metric-label'))).trim()
      if (!label || !Number.isFinite(value)) return null
      return { label, value }
    })
    .filter((metric): metric is AiHotDailyMetric => Boolean(metric))
}

export function parseAiHotDailyPage(html: string): AiHotDailyPage {
  const flight = extractFlightText(html)
  const labels = parseFlightLabels(flight)
  const roots = Array.from(labels.values()).map(node => resolveNode(node, labels))
  const sections = roots
    .flatMap(root => findAll(root, candidate => isElement(candidate, 'section', 'daily-section')))
    .map(parseSection)
    .filter((section): section is AiHotDailySection => Boolean(section))
  const seenSections = new Set<string>()
  const uniqueSections = sections.filter(section => {
    const key = `${section.title}|${section.articles.map(article => article.id).join(',')}`
    if (seenSections.has(key)) return false
    seenSections.add(key)
    return true
  })
  const metricRoots = roots
    .flatMap(root => parseMetrics(root))
  const seenMetrics = new Set<string>()
  const metrics = metricRoots.filter(metric => {
    const key = `${metric.label}|${metric.value}`
    if (seenMetrics.has(key)) return false
    seenMetrics.add(key)
    return true
  })

  return {
    sections: uniqueSections,
    metrics,
    articleCount: uniqueSections.reduce((sum, section) => sum + section.articles.length, 0),
  }
}
