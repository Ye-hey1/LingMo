import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const researchDir = join(root, 'research')

function listSessionFiles(dir) {
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.research.json'))
      .map(name => join(dir, name))
  } catch {
    return []
  }
}

function scoreSession(session) {
  const sources = Array.isArray(session.sources) ? session.sources : []
  const evidences = Array.isArray(session.evidences) ? session.evidences : []
  const domains = new Set()

  for (const source of sources) {
    try {
      domains.add(new URL(source.url).hostname.replace(/^www\./, ''))
    } catch {
      // Ignore malformed URLs in evaluation.
    }
  }

  const citedSourceIds = new Set(evidences.map(item => item.sourceId).filter(Boolean))
  const highConfidence = evidences.filter(item => item.confidence === 'high').length
  const citationCoverage = sources.length ? citedSourceIds.size / sources.length : 0
  const confidenceRatio = evidences.length ? highConfidence / evidences.length : 0
  const domainScore = Math.min(1, domains.size / 3)
  const evidenceScore = Math.min(1, evidences.length / 8)

  return {
    sourceCount: sources.length,
    evidenceCount: evidences.length,
    independentDomains: domains.size,
    citationCoverage,
    confidenceRatio,
    score: Math.round((citationCoverage * 0.35 + confidenceRatio * 0.25 + domainScore * 0.2 + evidenceScore * 0.2) * 100),
  }
}

const files = process.argv.slice(2)
const sessionFiles = files.length > 0 ? files : listSessionFiles(researchDir)

if (sessionFiles.length === 0) {
  console.log('No research session files found. Run Deep Research first, then execute pnpm test:research.')
  process.exit(0)
}

let failed = false

for (const file of sessionFiles) {
  const path = join(root, file)
  const actualPath = statSync(file, { throwIfNoEntry: false }) ? file : path
  const session = JSON.parse(readFileSync(actualPath, 'utf8'))
  const metrics = scoreSession(session)
  const pass = metrics.sourceCount >= 3 && metrics.evidenceCount >= 4 && metrics.independentDomains >= 2
  failed ||= !pass

  console.log(JSON.stringify({
    file: actualPath,
    query: session.query,
    strategy: session.strategy,
    pass,
    ...metrics,
  }, null, 2))
}

if (failed) {
  process.exitCode = 1
}
