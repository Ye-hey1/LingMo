import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-research-tests-'))

// 内存中模拟 Session 状态
let mockSessionDb = {}

// 初始化全局 Mock
globalThis.MOCKS = {
  mcpServerManager: {
    callTool: async () => ({ isError: false, content: [] }),
    getServerTools: () => [],
    connectServer: async () => {},
  },
  mcpStore: {
    useMcpStore: {
      getState: () => ({
        initialized: true,
        servers: [],
        getServerState: () => null,
        initMcpData: async () => {},
        loadMcpConfig: async () => {},
      })
    }
  },
  aiUtils: {
    createOpenAIClient: async () => {
      return {
        chat: {
          completions: {
            create: async ({ messages }) => {
              const lastMsg = messages[messages.length - 1].content
              
              // 模拟意图分类
              if (lastMsg.includes('Classify this deep research task')) {
                return { choices: [{ message: { content: JSON.stringify({ strategy: 'comprehensive' }) } }] }
              }
              // 模拟生成搜索词
              if (lastMsg.includes('Generate up to')) {
                return { choices: [{ message: { content: JSON.stringify({
                  queries: [
                    { query: 'test query 1', researchGoal: 'verify query 1' },
                    { query: 'test query 2', researchGoal: 'verify query 2' }
                  ]
                }) } }] }
              }
              // 模拟处理搜索结果
              if (lastMsg.includes('Extract up to 4 unique learnings')) {
                return {
                  choices: [{
                    message: {
                      content: JSON.stringify({
                        learnings: ['学习点 1', '学习点 2'],
                        evidences: [
                          { sourceId: 'S1', claim: '事实 1', quote: '原话 1', relevanceScore: 0.9, confidence: 'high' },
                          { sourceId: 'S2', claim: '事实 2', quote: '原话 2', relevanceScore: 0.8, confidence: 'medium' }
                        ],
                        followUpQuestions: ['追问 1']
                      })
                    }
                  }]
                }
              }
              // 模拟爬虫筛选 URL
              if (lastMsg.includes('你是一个深入研究的爬虫筛选助手')) {
                return {
                  choices: [{
                    message: {
                      content: JSON.stringify({
                        urls: ['https://mockdomain.com/crawled-page']
                      })
                    }
                  }]
                }
              }
              // 模拟交叉印证聚类
              if (lastMsg.includes('你是一个深度研究的交叉印证与证据链审查专家')) {
                return {
                  choices: [{
                    message: {
                      content: JSON.stringify({
                        clusters: [
                          {
                            factClaim: '事实 1 被多源印证',
                            supportingEvidenceIds: ['E1', 'E2', 'E5'],
                            contradictingEvidenceIds: []
                          },
                          {
                            factClaim: '事实 2 有冲突',
                            supportingEvidenceIds: ['E3'],
                            contradictingEvidenceIds: ['E4']
                          }
                        ]
                      })
                    }
                  }]
                }
              }
              // 模拟问答
              return { choices: [{ message: { content: '{}' } }] }
            }
          }
        }
      }
    },
    getAISettings: async () => ({ model: 'mock-model', baseURL: 'https://mock.ai' }),
    validateAIService: async () => true,
  },
  tavily: {
    tavilySearch: async () => ({ results: [] }),
    tavilyExtract: async ({ urls }) => ({
      results: urls.map(url => ({
        url,
        rawContent: `这里是网页 ${url} 的内容，里面包含了外链 https://mockdomain.com/crawled-page1 和 https://mockdomain.com/crawled-page2`
      }))
    }),
    requestDuckDuckGoFallback: async (query) => {
      globalThis.MOCKS.tavily.ddgCalled = true
      return {
        results: [
          { title: 'DDG 结果 1', url: 'https://ddg.com/1', content: 'DDG 内容 1', score: 0.8 }
        ]
      }
    },
    searchWeb: async (options) => {
      globalThis.MOCKS.tavily.tavilyCalled = true
      if (globalThis.MOCKS.tavily.shouldFail) {
        throw new Error('Tavily Mock 模拟检索失败')
      }
      return {
        provider: 'tavily',
        results: [
          { title: 'Tavily 结果 1', url: 'https://tavily.com/1', content: 'Tavily 内容 1', score: 0.9 }
        ]
      }
    },
    tavilyCalled: false,
    ddgCalled: false,
    shouldFail: false,
  },
  tauriFs: {
    BaseDirectory: { AppData: 'appdata' },
    exists: async () => true,
    mkdir: async () => {},
    writeTextFile: async (path, content) => {
      globalThis.MOCKS.tauriFs.writtenFiles = globalThis.MOCKS.tauriFs.writtenFiles || {}
      globalThis.MOCKS.tauriFs.writtenFiles[path] = content
    },
    readTextFile: async () => '',
    writtenFiles: {},
  },
  workspace: {
    getFilePathOptions: async (relativePath) => ({ path: relativePath, baseDir: 'appdata' }),
    getWorkspacePath: async () => ({ isCustom: false, path: 'workspace' }),
  },
  sessionStore: {
    saveSessionState: async (state) => {
      mockSessionDb[state.id] = JSON.parse(JSON.stringify(state))
    },
    loadSessionState: async (sessionId) => {
      return mockSessionDb[sessionId] ? JSON.parse(JSON.stringify(mockSessionDb[sessionId])) : null
    },
  },
  articleStore: {
    default: {
      getState: () => ({
        loadFileTree: async () => {
          globalThis.MOCKS.articleStore.reloadCalled = true
        }
      }),
      reloadCalled: false,
    }
  },
  OpenAI: class {
    constructor() {}
  }
}

async function importTsModule(relativePath) {
  const sourcePath = join(repoRoot, relativePath)
  let source = await readFile(sourcePath, 'utf8')
  
  // 使用 Mocks 替换掉原有的 imports 逻辑
  source = source.replace(/import\s+OpenAI\s+from\s+['"]openai['"]/g, 'const OpenAI = globalThis.MOCKS.OpenAI;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/mcp\/server-manager['"]/g, 'const {$1} = globalThis.MOCKS.mcpServerManager;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/stores\/mcp['"]/g, 'const {$1} = globalThis.MOCKS.mcpStore;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/ai\/utils['"]/g, 'const {$1} = globalThis.MOCKS.aiUtils;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/tavily['"]/g, 'const {$1} = globalThis.MOCKS.tavily;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@tauri-apps\/plugin-fs['"]/g, 'const {$1} = globalThis.MOCKS.tauriFs;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/workspace['"]/g, 'const {$1} = globalThis.MOCKS.workspace;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/session-store['"]/g, 'const {$1} = globalThis.MOCKS.sessionStore;')
  source = source.replace(/await\s+import\s*\(\s*['"]@\/stores\/article['"]\s*\)/g, 'globalThis.MOCKS.articleStore')
  
  if (!source.includes('globalThis.MOCKS.articleStore')) {
    console.log('警告：没有找到 import("@/stores/article") 进行替换！')
  }

  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText
  const outPath = join(tempDir, relativePath.replace(/[\\/]/g, '__').replace(/\.ts$/, '.mjs'))
  await writeFile(outPath, output, 'utf8')
  return import(pathToFileURL(outPath).href)
}

try {
  // 导入我们要测试的模块
  const researchModule = await importTsModule('src/lib/research/deep-research.ts')
  const { runDeepResearch, searchProviderRegistry, performCrossVerification } = researchModule

  // 1. 验证 Tavily 搜索熔断降级机制
  console.log('--- 开始测试 1：Tavily 熔断降级机制 ---')
  globalThis.MOCKS.tavily.tavilyCalled = false
  globalThis.MOCKS.tavily.ddgCalled = false
  globalThis.MOCKS.tavily.shouldFail = false

  // 手动模拟 Tavily 3 次失败触发熔断
  searchProviderRegistry.recordFailure('tavily', 100)
  searchProviderRegistry.recordFailure('tavily', 100)
  searchProviderRegistry.recordFailure('tavily', 100)
  
  assert.equal(searchProviderRegistry.isBroken('tavily'), true, 'Tavily 应该处于熔断状态')

  // 在熔断状态下执行深研的搜索提供商逻辑
  // 触发一次 mock 调用
  const result = await runDeepResearch({
    query: '测试熔断检索',
    breadth: 1,
    depth: 1,
  })

  assert.equal(globalThis.MOCKS.tavily.ddgCalled, true, 'Tavily 熔断时，应该自动降级并调用 DuckDuckGo')
  console.log('✅ 测试 1：Tavily 熔断降级与自动降级成功通过。')

  // 2. 验证多源证据交叉验证逻辑 (performCrossVerification)
  console.log('--- 开始测试 2：多源证据交叉验证置信度重算 ---')
  const mockSources = [
    { id: 'S1', title: '域 1 网页', url: 'https://domain1.com/page', engine: 'web', credibilityScore: 0.8, retrievedAt: '' },
    { id: 'S2', title: '域 1 网页 2', url: 'https://domain1.com/page2', engine: 'web', credibilityScore: 0.7, retrievedAt: '' },
    { id: 'S3', title: '域 2 网页', url: 'https://domain2.com/page', engine: 'web', credibilityScore: 0.7, retrievedAt: '' },
    { id: 'S4', title: '域 3 网页', url: 'https://domain3.com/page', engine: 'web', credibilityScore: 0.7, retrievedAt: '' },
  ]
  const mockEvidences = [
    // 事实 1 的支持证据（来自 3 个独立域：domain1.com, domain2.com, domain3.com），置信度应升级为 high
    { id: 'E1', sourceId: 'S1', sourceUrl: 'https://domain1.com/page', claim: '事实 1', relevanceScore: 0.9, confidence: 'medium' },
    { id: 'E2', sourceId: 'S3', sourceUrl: 'https://domain2.com/page', claim: '事实 1', relevanceScore: 0.8, confidence: 'medium' },
    { id: 'E5', sourceId: 'S4', sourceUrl: 'https://domain3.com/page', claim: '事实 1', relevanceScore: 0.8, confidence: 'medium' },
    // 事实 2 的支持证据和矛盾证据，置信度应降级为 low
    { id: 'E3', sourceId: 'S1', sourceUrl: 'https://domain1.com/page', claim: '事实 2 支持', relevanceScore: 0.9, confidence: 'medium' },
    { id: 'E4', sourceId: 'S4', sourceUrl: 'https://domain3.com/page', claim: '事实 2 矛盾', relevanceScore: 0.8, confidence: 'medium' },
  ]

  const verifyResult = await performCrossVerification(mockSources, mockEvidences)
  const updatedEvidences = verifyResult.evidences

  // 寻找 E1，验证其是否根据 hosts.size >= 3 被升级为了 high
  const e1 = updatedEvidences.find(e => e.id === 'E1')
  assert.equal(e1.confidence, 'high', 'E1 支持域名数 >= 3，其置信度应该升级为 high')

  // 寻找 E3 和 E4，它们存在矛盾，其置信度应该都为 low
  const e3 = updatedEvidences.find(e => e.id === 'E3')
  const e4 = updatedEvidences.find(e => e.id === 'E4')
  assert.equal(e3.confidence, 'low', '有冲突的证据 E3 置信度应该为 low')
  assert.equal(e4.confidence, 'low', '有冲突的证据 E4 置信度应该为 low')

  console.log('✅ 测试 2：多源证据交叉验证成功通过。')

  // 3. 验证断点续传与持久化状态机 (Session Resume)
  console.log('--- 开始测试 3：断点续传与持久化状态机 ---')
  mockSessionDb = {} // 清空
  globalThis.MOCKS.tavily.ddgCalled = false
  globalThis.MOCKS.tavily.tavilyCalled = false
  globalThis.MOCKS.tavily.shouldFail = false
  
  // 恢复熔断器
  searchProviderRegistry.recordSuccess('tavily', 100)
  assert.equal(searchProviderRegistry.isBroken('tavily'), false, 'Tavily 应该脱离熔断')

  // 模拟中断：我们在运行中途手动保存 Session 状态，然后通过再次运行传入 sessionId 恢复
  const sessionId = 'test-session-123'
  
  // 先伪造一个已经进行到一半的 Session
  mockSessionDb[sessionId] = {
    id: sessionId,
    query: '如何优化 Agent',
    strategy: 'comprehensive',
    startedAt: new Date().toISOString(),
    visitedUrls: ['https://tavily.com/1'],
    sources: [
      { id: 'S1', title: '旧来源', url: 'https://tavily.com/1', engine: 'web', credibilityScore: 0.8, retrievedAt: '' }
    ],
    evidences: [
      { id: 'E1', sourceId: 'S1', sourceUrl: 'https://tavily.com/1', claim: '旧事实', relevanceScore: 0.9, confidence: 'medium' }
    ],
    learnings: ['旧学习点'],
    // 队列里只剩下一个任务了
    pendingQueries: [
      { query: 'test query 2', researchGoal: 'verify query 2', depth: 1, breadth: 1 }
    ],
    currentDepth: 1,
    totalDepth: 2,
    currentBreadth: 1,
    totalBreadth: 2,
  }

  // 触发恢复运行
  const resumeResult = await runDeepResearch({
    query: '如何优化 Agent',
    sessionId,
  })

  // 检查恢复后的最终学习点和来源
  assert.equal(resumeResult.learnings.includes('旧学习点'), true, '应该保留旧有的学习点')
  assert.equal(resumeResult.session.sources.some(s => s.title === '旧来源'), true, '应该保留旧有的来源列表')
  console.log('✅ 测试 3：断点续传与持久化状态机成功通过。')

  // 4. 验证统一的 Event Bus 发射、沉淀至 docs/research-reports/ 以及触发热重载
  console.log('--- 开始测试 4：Event Bus 发射与知识库热重载、本地文件沉淀 ---')
  
  let eventsEmitted = []
  const mockEventBus = {
    emit: (event, data) => {
      eventsEmitted.push({ event, data })
    }
  }

  globalThis.MOCKS.tauriFs.writtenFiles = {}
  globalThis.MOCKS.articleStore.reloadCalled = false

  const finalRes = await runDeepResearch({
    query: '全面测试任务',
    breadth: 1,
    depth: 1,
    eventBus: mockEventBus,
  })

  // 验证 Event Bus 广播
  const startedEvent = eventsEmitted.find(e => e.event === 'research.started')
  const completedEvent = eventsEmitted.find(e => e.event === 'research.completed')
  assert.ok(startedEvent, '应该广播 research.started 事件')
  assert.ok(completedEvent, '应该广播 research.completed 事件')

  // 验证知识库写入
  const writtenPaths = Object.keys(globalThis.MOCKS.tauriFs.writtenFiles)
  const reportPath = writtenPaths.find(p => p.startsWith('docs/research-reports/research-'))
  assert.ok(reportPath, '应该在 docs/research-reports/ 下生成报告文件')
  assert.match(globalThis.MOCKS.tauriFs.writtenFiles[reportPath], /type: research_report/, '报告中应该包含 frontmatter')
  assert.match(globalThis.MOCKS.tauriFs.writtenFiles[reportPath], /附录：多源证据交叉验证印证表/, '报告中应该包含附录多源证据交叉验证印证表')

  // 验证触发了热重载
  assert.equal(globalThis.MOCKS.articleStore.reloadCalled, true, '在写入报告后，应该触发 useArticleStore 的 loadFileTree()')

  console.log('✅ 测试 4：Event Bus、报告沉淀与知识库热重载成功通过。')
  console.log('\n🎉 所有深度研究重构逻辑的测试均已全部成功通过！')

} catch (error) {
  console.error('❌ 测试执行失败：', error)
  process.exitCode = 1
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
