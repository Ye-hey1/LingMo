import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = process.cwd()
const researchDir = join(root, 'research')
const researchSessionDirName = '.sessions'
const defaultBenchmarkPath = join(root, 'scripts', 'research-benchmark-cases.json')

function parseArgs(argv) {
  const args = {
    benchmarkPath: existsSync(defaultBenchmarkPath) ? defaultBenchmarkPath : null,
    fixture: false,
    json: false,
    strict: false,
    writeIndexPath: null,
    files: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--benchmark') {
      args.benchmarkPath = resolve(argv[++index])
    } else if (arg === '--no-benchmark') {
      args.benchmarkPath = null
    } else if (arg === '--fixture') {
      args.fixture = true
    } else if (arg === '--json') {
      args.json = true
    } else if (arg === '--strict') {
      args.strict = true
    } else if (arg === '--write-index') {
      args.writeIndexPath = resolve(argv[++index] || '.tmp/deep_research/history-index.json')
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      args.files.push(arg)
    }
  }

  return args
}

async function importHistoryIndexModule() {
  const sourcePath = join(root, 'src/lib/research/history-index.ts')
  const tempDir = mkdtempSync(join(tmpdir(), 'lingmo-research-eval-'))
  const outPath = join(tempDir, 'history-index.mjs')
  const source = readFileSync(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText
  writeFileSync(outPath, output, 'utf8')
  return import(pathToFileURL(outPath).href)
}

function listSessionFiles(dir) {
  const paths = [
    dir,
    join(dir, researchSessionDirName),
  ]

  try {
    return paths.flatMap(path => {
      try {
        return readdirSync(path)
          .filter(name => name.endsWith('.research.json'))
          .map(name => join(path, name))
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function resolveSessionPath(file) {
  const actualPath = statSync(file, { throwIfNoEntry: false }) ? file : join(root, file)
  return resolve(actualPath)
}

function loadSessionFiles(files) {
  return files.map(file => {
    const path = resolveSessionPath(file)
    return {
      path,
      session: JSON.parse(readFileSync(path, 'utf8')),
    }
  })
}

function fixtureSessions() {
  const now = new Date().toISOString()
  return [{
    path: '<fixture:ai-agent-memory>',
    session: {
      id: 'fixture-ai-agent-memory',
      query: '2026 年 AI Agent 记忆、工具调用和工作流编排的最佳实践',
      strategy: 'technical',
      startedAt: now,
      completedAt: now,
      searchProviders: ['tavily', 'duckduckgo'],
      sources: [
        { id: 'S1', title: 'LangGraph agent memory patterns', url: 'https://langchain-ai.github.io/langgraph/concepts/memory/', engine: 'tavily', retrievedAt: now, publishedAt: now, credibilityScore: 0.9 },
        { id: 'S2', title: 'OpenAI tools and function calling guide', url: 'https://platform.openai.com/docs/guides/tools', engine: 'tavily', retrievedAt: now, publishedAt: now, credibilityScore: 0.9 },
        { id: 'S3', title: 'Anthropic tool use docs', url: 'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview', engine: 'duckduckgo', retrievedAt: now, publishedAt: now, credibilityScore: 0.82 },
        { id: 'S4', title: 'Agent workflow evaluation notes', url: 'https://example.com/agent-eval', engine: 'duckduckgo', retrievedAt: now, publishedAt: now, credibilityScore: 0.65 },
      ],
      evidences: [
        { id: 'E1', sourceId: 'S1', sourceUrl: 'https://langchain-ai.github.io/langgraph/concepts/memory/', claim: 'Agent memory should separate short-term thread state from long-term user or domain memory.', relevanceScore: 0.92, confidence: 'high' },
        { id: 'E2', sourceId: 'S2', sourceUrl: 'https://platform.openai.com/docs/guides/tools', claim: 'Tool calling should use structured schemas and explicit result handling.', relevanceScore: 0.88, confidence: 'high' },
        { id: 'E3', sourceId: 'S3', sourceUrl: 'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview', claim: 'Agents need clear boundaries around tool choice and execution results.', relevanceScore: 0.78, confidence: 'medium' },
        { id: 'E4', sourceId: 'S4', sourceUrl: 'https://example.com/agent-eval', claim: 'Evaluation loops should measure recency, accuracy, source quality, and cache behavior.', relevanceScore: 0.76, confidence: 'medium' },
      ],
      learnings: [
        'AI Agent 的稳定性来自状态、工具调用、缓存和评估闭环的分层治理。',
        '可检索历史索引能把过去研究变成下一轮研究的上下文，而不是孤立报告。',
        'Benchmark 应同时看准确性、时效性、缓存命中率和来源质量。',
      ],
      visitedUrls: [
        'https://langchain-ai.github.io/langgraph/concepts/memory/',
        'https://platform.openai.com/docs/guides/tools',
        'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview',
        'https://example.com/agent-eval',
      ],
      cacheStats: { hits: 3, misses: 5, writes: 5, bypasses: 0 },
      providerHealth: [
        { name: 'tavily', failureCount: 0, lastFailureTime: 0, isBroken: false, responseTime: 320 },
        { name: 'duckduckgo', failureCount: 0, lastFailureTime: 0, isBroken: false, responseTime: 540 },
      ],
      quality: {
        overall: 86,
        sourceDiversity: 84,
        evidenceStrength: 87,
        coverage: 85,
        grade: 'A',
        summary: 'Fixture session for research eval smoke test.',
      },
    },
  }]
}

function readBenchmarkCases(path) {
  if (!path || !existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(parsed) ? parsed : parsed.cases || []
}

function writeIndex(path, index) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(index, null, 2), 'utf8')
}

function sessionPass(metrics) {
  return metrics.sourceCount >= 3
    && metrics.evidenceCount >= 4
    && metrics.independentDomains >= 2
    && metrics.sourceQualityScore >= 45
}

function printHumanReport({ sessionResults, index, benchmarkSummary, writeIndexPath, strict }) {
  for (const result of sessionResults) {
    console.log(JSON.stringify(result, null, 2))
  }

  console.log(JSON.stringify({
    index: {
      version: index.version,
      documentCount: index.documentCount,
      avgDocumentLength: index.avgDocumentLength,
      generatedAt: index.generatedAt,
      writtenTo: writeIndexPath,
    },
  }, null, 2))

  if (benchmarkSummary) {
    console.log(JSON.stringify({
      benchmark: {
        strict,
        caseCount: benchmarkSummary.caseCount,
        passCount: benchmarkSummary.passCount,
        averageAccuracyProxy: benchmarkSummary.averageAccuracyProxy,
        averageRecencyScore: benchmarkSummary.averageRecencyScore,
        averageSourceQualityScore: benchmarkSummary.averageSourceQualityScore,
        averageCacheHitRate: benchmarkSummary.averageCacheHitRate,
        results: benchmarkSummary.results,
      },
    }, null, 2))
  }
}

const args = parseArgs(process.argv.slice(2))
const history = await importHistoryIndexModule()
const sessionFiles = args.files.length > 0 ? args.files : listSessionFiles(researchDir)
const loadedSessions = args.fixture ? fixtureSessions() : loadSessionFiles(sessionFiles)

if (loadedSessions.length === 0) {
  console.log('No research session files found. Run Deep Research first, then execute pnpm test:research.')
  process.exit(0)
}

const sessions = loadedSessions.map(item => item.session)
const index = history.buildResearchHistoryIndex(sessions)
const sessionResults = loadedSessions.map(item => {
  const metrics = history.scoreResearchSession(item.session)
  return {
    file: item.path,
    query: item.session.query,
    strategy: item.session.strategy,
    pass: sessionPass(metrics),
    ...metrics,
  }
})
const benchmarkCases = readBenchmarkCases(args.benchmarkPath)
const benchmarkSummary = benchmarkCases.length
  ? history.evaluateResearchBenchmark(index, benchmarkCases)
  : null

if (args.writeIndexPath) {
  writeIndex(args.writeIndexPath, index)
}

const output = {
  sessions: sessionResults,
  index: {
    version: index.version,
    documentCount: index.documentCount,
    avgDocumentLength: index.avgDocumentLength,
    generatedAt: index.generatedAt,
    writtenTo: args.writeIndexPath,
  },
  benchmark: benchmarkSummary,
}

if (args.json) {
  console.log(JSON.stringify(output, null, 2))
} else {
  printHumanReport({
    sessionResults,
    index,
    benchmarkSummary,
    writeIndexPath: args.writeIndexPath,
    strict: args.strict,
  })
}

const failedSession = sessionResults.some(result => !result.pass)
const failedBenchmark = args.strict && benchmarkSummary && benchmarkSummary.passCount < benchmarkSummary.caseCount
if (failedSession || failedBenchmark) {
  process.exitCode = 1
}
