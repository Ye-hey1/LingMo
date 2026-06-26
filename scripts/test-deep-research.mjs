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
    callTool: async (serverId) => {
      if (serverId.includes('anysearch')) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'invalid_api_key\ninvalid API key' }],
        }
      }
      if (serverId.includes('firecrawl')) {
        return {
          isError: true,
          content: [{ type: 'text', text: '' }],
        }
      }
      return { isError: false, content: [] }
    },
    getServerTools: (serverId) => {
      if (serverId.includes('anysearch')) {
        return [{
          name: 'extract',
          description: 'AnySearch web query',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        }]
      }
      if (serverId.includes('firecrawl')) {
        return [{
          name: 'firecrawl_search',
          description: 'Search web with Firecrawl',
          inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
        }]
      }
      return []
    },
    connectServer: async () => {},
  },
  mcpStore: {
    useMcpStore: {
      getState: () => ({
        initialized: true,
        servers: [
          {
            id: 'mcp-anysearch',
            name: 'anysearch',
            type: 'http',
            enabled: true,
            url: 'https://api.anysearch.com/mcp',
            headers: { Authorization: 'Bearer ${as_sk_mock}' },
            createdAt: 0,
          },
          {
            id: 'mcp-firecrawl',
            name: 'firecrawl-mcp',
            type: 'stdio',
            enabled: true,
            command: 'npx',
            args: ['-y', 'firecrawl-mcp'],
            env: { FIRECRAWL_API_KEY: 'fc-mock' },
            createdAt: 0,
          },
        ],
        getServerState: (serverId) => ({
          id: serverId,
          status: 'connected',
          tools: globalThis.MOCKS.mcpServerManager.getServerTools(serverId),
          resources: [],
        }),
        initMcpData: async () => {},
        loadMcpConfig: async () => {},
      })
    }
  },
  settingStore: {
    default: {
      getState: () => ({
        researchSearchSerpApiEnabled: false,
        serpApiKey: '',
        researchSearchExaEnabled: false,
        exaApiKey: '',
        researchSearchTavilyEnabled: true,
      }),
    },
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
  mcpErrorMessage: {},
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
  tauriHttp: {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ organic_results: [] }),
    }),
  },
  workspace: {
    getFilePathOptions: async (relativePath) => ({ path: relativePath, baseDir: 'appdata' }),
    getWorkspacePath: async () => ({ isCustom: false, path: 'workspace' }),
  },
  filenameUtils: {
    sanitizeFileName: (fileName) => {
      const sanitized = String(fileName)
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
      return sanitized || 'untitled'
    },
    sanitizeFilePath: (filePath) => String(filePath)
      .split('/')
      .map(part => part
        ? globalThis.MOCKS.filenameUtils.sanitizeFileName(part)
        : part)
      .join('/'),
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
  researchEnhancements: {
    assessResearchQuality: (result) => ({
      overall: 78,
      sourceDiversity: 75,
      evidenceStrength: 80,
      coverage: 79,
      grade: 'B',
      summary: `来源 ${result.sources.length} 个，证据 ${result.evidences.length} 条`,
    }),
  },
  xiaomoPrompt: {
    buildXiaoMoDeepResearchSystemPrompt: () => 'You are 小墨. Cite sources with clickable Markdown links whenever a URL exists.',
  },
  OpenAI: class {
    constructor() {}
  }
}

globalThis.MOCKS.mcpServerManager.mcpServerManager = globalThis.MOCKS.mcpServerManager

async function importTsModule(relativePath) {
  const sourcePath = join(repoRoot, relativePath)
  let source = await readFile(sourcePath, 'utf8')
  
  // 使用 Mocks 替换掉原有的 imports 逻辑
  source = source.replace(/import\s+OpenAI\s+from\s+['"]openai['"]/g, 'const OpenAI = globalThis.MOCKS.OpenAI;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/mcp\/server-manager['"]/g, 'const {$1} = globalThis.MOCKS.mcpServerManager;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/mcp\/error-message['"]/g, 'const {$1} = globalThis.MOCKS.mcpErrorMessage;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/stores\/mcp['"]/g, 'const {$1} = globalThis.MOCKS.mcpStore;')
  source = source.replace(/import\s+useSettingStore\s+from\s*['"]@\/stores\/setting['"]/g, 'const useSettingStore = globalThis.MOCKS.settingStore.default;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/ai\/utils['"]/g, 'const {$1} = globalThis.MOCKS.aiUtils;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/ai\/xiaomo-prompt['"]/g, 'const {$1} = globalThis.MOCKS.xiaomoPrompt;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/tavily['"]/g, 'const {$1} = globalThis.MOCKS.tavily;')
  source = source.replace(/import\s*\{\s*fetch\s+as\s+tauriFetch\s*\}\s*from\s*['"]@tauri-apps\/plugin-http['"]/g, 'const { fetch: tauriFetch } = globalThis.MOCKS.tauriHttp;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@tauri-apps\/plugin-fs['"]/g, 'const {$1} = globalThis.MOCKS.tauriFs;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/workspace['"]/g, 'const {$1} = globalThis.MOCKS.workspace;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/sync\/filename-utils['"]/g, 'const {$1} = globalThis.MOCKS.filenameUtils;')
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/session-store['"]/g, 'const {$1} = globalThis.MOCKS.sessionStore;')
  source = source.replace(/import\s*\{\s*assessResearchQuality\s*,\s*type\s+ResearchQualityScore\s*\}\s*from\s*['"]\.\/research-enhancements['"]/g, 'const { assessResearchQuality } = globalThis.MOCKS.researchEnhancements;')
  source = source.replace(/await\s+import\s*\(\s*['"]@\/stores\/article['"]\s*\)/g, 'globalThis.MOCKS.articleStore')
  
  if (source.includes('import("@/stores/article")') && !source.includes('globalThis.MOCKS.articleStore')) {
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
  globalThis.MOCKS.mcpErrorMessage = await importTsModule('src/lib/mcp/error-message.ts')
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
  assert.ok(result.session.providerHealth.some(provider =>
    provider.name.includes('anysearch') && provider.isBroken
  ), 'AnySearch MCP API Key 失败时应该快速熔断，避免反复拖慢搜索')
  assert.ok(result.session.providerHealth.some(provider =>
    provider.name.includes('firecrawl') && provider.isBroken
  ), 'Firecrawl MCP 空错误失败时应该快速熔断，后续降级到其他搜索源')
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

  // 4. 验证统一的 Event Bus 发射与质量评分输出
  console.log('--- 开始测试 4：Event Bus 发射与研究质量评分 ---')
  
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
  assert.equal(finalRes.quality.grade, 'B', '最终结果应该包含研究质量评分')
  assert.equal(finalRes.session.quality.grade, 'B', 'Session 应该保存研究质量评分')
  assert.equal(completedEvent.data.quality.grade, 'B', 'research.completed 事件应该携带质量评分')
  assert.equal(completedEvent.data.sourceCount, finalRes.sources.length, '完成事件应该携带来源数量')
  assert.equal(completedEvent.data.evidenceCount, finalRes.evidences.length, '完成事件应该携带证据数量')
  assert.equal(completedEvent.data.breadth, 1, '完成事件应该携带研究广度')
  assert.equal(completedEvent.data.depth, 1, '完成事件应该携带研究深度')
  assert.ok(completedEvent.data.cacheStats, '完成事件应该携带搜索缓存统计')
  assert.ok(finalRes.session.cacheStats, 'Session 应该保存搜索缓存统计')
  assert.equal(typeof finalRes.session.cacheStats.misses, 'number', '缓存统计应该包含 miss 次数')
  assert.ok(Array.isArray(completedEvent.data.providerHealth), '完成事件应该携带 Provider 健康状态')
  assert.ok(Array.isArray(finalRes.session.providerHealth), 'Session 应该保存 Provider 健康状态')
  assert.ok(finalRes.session.providerHealth.some(provider => provider.name === 'tavily'), 'Provider 健康状态应该包含 Tavily')

  console.log('✅ 测试 4：Event Bus 与研究质量评分成功通过。')

  // 5. 验证研究报告文件命名：标题+日期，并自动避让重名
  console.log('--- 开始测试 5：研究报告文件命名工具 ---')
  globalThis.MOCKS.tauriFs.exists = async (path) => path === 'research/AI Agent-20260607.md'
  const reportFileModule = await importTsModule('src/lib/research/report-file.ts')
  const {
    buildUniqueResearchReportTarget,
    normalizeResearchReportTitle,
    formatResearchReportDate,
    formatYamlScalar,
  } = reportFileModule

  assert.equal(formatResearchReportDate(new Date('2026-06-07T12:00:00Z')), '20260607', '日期格式应为 YYYYMMDD')
  assert.equal(normalizeResearchReportTitle('直接开始研究 AI Agent: 记忆/图谱?', ''), 'AI Agent_ 记忆_图谱', '文件名标题应清理控制词和非法字符')
  assert.equal(normalizeResearchReportTitle('针对用户"转型AI产品经理的个人学习路线', ''), '针对用户_转型AI产品经理的个人学习路线', 'Windows 双引号应从研究报告文件名中清理')
  assert.equal(formatYamlScalar('AI "Research"'), '"AI \\"Research\\""', 'YAML 标量应安全转义')

  const target = await buildUniqueResearchReportTarget({
    query: 'AI Agent',
    report: '',
    date: new Date('2026-06-07T12:00:00Z'),
  })
  assert.equal(target.fileName, 'AI Agent-20260607-2.md', '同日同题重名时应追加序号')
  assert.equal(target.sessionFileName, 'AI Agent-20260607-2.research.json', 'Session 文件应与报告文件同名')

  const quotedTarget = await buildUniqueResearchReportTarget({
    query: '针对用户"转型AI产品经理的个人学习路线',
    report: '',
    date: new Date('2026-05-15T15:00:00+08:00'),
  })
  assert.doesNotMatch(quotedTarget.relativeFilePath, /[<>:"\\|?*]/, '研究报告相对路径不应包含 Windows 非法字符')
  assert.match(quotedTarget.fileName, /^针对用户_转型AI产品经理的个人学习路线-20260515\.md$/, '带引号的研究标题应保存为可打开文件名')

  console.log('✅ 测试 5：研究报告文件命名工具成功通过。')
  console.log('\n🎉 所有深度研究重构逻辑的测试均已全部成功通过！')

} catch (error) {
  console.error('❌ 测试执行失败：', error)
  process.exitCode = 1
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
