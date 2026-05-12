import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-agent-tests-'))

async function importTsModule(relativePath) {
  const sourcePath = join(repoRoot, relativePath)
  const source = await readFile(sourcePath, 'utf8')
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
  const {
    deriveIntentPolicy,
    evaluateIntentAwareToolPolicy,
    getToolRiskLevel,
  } = await importTsModule('src/lib/agent/tool-policy.ts')
  const {
    isIncompleteStructuredAgentJson,
    isStructuredThoughtOnlyJson,
    parseActionInputJson,
    parseStructuredActionJson,
    parseStructuredFinalAnswerJson,
  } = await importTsModule('src/lib/agent/parse-action-input.ts')
  const {
    createAgentEventBus,
    replayAgentEvents,
  } = await importTsModule('src/lib/agent/event-bus.ts')
  const {
    buildAgentContextSnapshot,
    formatAgentContextSnapshot,
  } = await importTsModule('src/lib/agent/context-compression.ts')

  assert.equal(deriveIntentPolicy('帮我完善当前图表').allowWrite, true)
  assert.equal(deriveIntentPolicy('AI 能进行操作吗？').allowWrite, false)
  assert.equal(deriveIntentPolicy('删除这个文件').allowDestructive, true)
  assert.equal(deriveIntentPolicy('不要删除，只总结一下').allowDestructive, false)
  assert.equal(deriveIntentPolicy('用技能导出为 pptx 文件').allowWrite, true)
  assert.equal(deriveIntentPolicy('用技能导出为 pptx 文件').allowExecute, true)
  assert.equal(deriveIntentPolicy('不要执行脚本，只给命令建议').allowExecute, false)

  assert.equal(getToolRiskLevel('read_markdown_file', 'note'), 'low')
  assert.equal(getToolRiskLevel('create_file', 'note'), 'medium')
  assert.equal(getToolRiskLevel('delete_markdown_file', 'note'), 'high')
  assert.equal(getToolRiskLevel('safe_read_file', 'filesystem'), 'low')
  assert.equal(getToolRiskLevel('safe_write_file', 'filesystem'), 'medium')

  assert.deepEqual(
    evaluateIntentAwareToolPolicy({
      toolName: 'create_file',
      category: 'note',
      intentPolicy: deriveIntentPolicy('帮我新建一篇笔记'),
    }),
    { allowed: true, requiresConfirmation: true },
  )
  assert.equal(
    evaluateIntentAwareToolPolicy({
      toolName: 'delete_markdown_file',
      category: 'note',
      intentPolicy: deriveIntentPolicy('不要删除，只总结'),
    }).allowed,
    false,
  )
  assert.equal(
    evaluateIntentAwareToolPolicy({
      toolName: 'execute_skill_script',
      category: 'system',
      intentPolicy: deriveIntentPolicy('只说明怎么做'),
    }).allowed,
    false,
  )

  assert.deepEqual(parseActionInputJson('{"filePath":"a.md","content":"ok"}'), {
    filePath: 'a.md',
    content: 'ok',
  })
  assert.deepEqual(parseActionInputJson('```json\n{"query":"agent"}\n```'), {
    query: 'agent',
  })
  assert.deepEqual(parseActionInputJson('{"query":"agent"}\nObservation: done'), {
    query: 'agent',
  })
  assert.deepEqual(parseActionInputJson('{"content":"line 1\nline 2"}'), {
    content: 'line 1\nline 2',
  })
  assert.deepEqual(parseActionInputJson('{"filePath":"a.md","content":"open'), {
    filePath: 'a.md',
    content: 'open',
  })
  assert.equal(parseActionInputJson('[{"not":"an object"}]'), null)

  assert.deepEqual(
    parseStructuredActionJson('{"thought":"search first","action":"search_markdown_files","action_input":{"query":"agent"}}'),
    {
      thought: 'search first',
      tool: 'search_markdown_files',
      params: { query: 'agent' },
    },
  )
  assert.deepEqual(
    parseStructuredActionJson('```json\n{"tool":"read_markdown_file","params":{"filePath":"a.md"}}\n```'),
    {
      thought: undefined,
      tool: 'read_markdown_file',
      params: { filePath: 'a.md' },
    },
  )
  assert.deepEqual(
    parseStructuredActionJson('{"action":"create_file","action_input":"{\\"filePath\\":\\"a.md\\",\\"content\\":\\"ok\\"}"}'),
    {
      thought: undefined,
      tool: 'create_file',
      params: { filePath: 'a.md', content: 'ok' },
    },
  )
  assert.deepEqual(
    parseStructuredActionJson('{"thought":"write note","action":"create_file","action_input":{"fileName":"a.md","content":"# Title\ntext with "quote" inside\nend"}}'),
    {
      thought: 'write note',
      tool: 'create_file',
      params: { fileName: 'a.md', content: '# Title\ntext with "quote" inside\nend' },
    },
  )
  assert.equal(
    parseStructuredActionJson('{"action":"create_file","action_input":{"fileName":"a.md","content":"# half note'),
    null,
  )
  assert.equal(parseStructuredActionJson('{"action":"Final Answer","action_input":{}}'), null)
  assert.equal(parseStructuredActionJson('{"action":"create_file","action_input":["bad"]}'), null)
  assert.equal(
    parseStructuredFinalAnswerJson('{"thought":"done","final_answer":"这是最终答案"}'),
    '这是最终答案',
  )
  assert.equal(
    parseStructuredFinalAnswerJson('{"action":"Final Answer","action_input":{"answer":"完成"}}'),
    '完成',
  )
  assert.equal(isStructuredThoughtOnlyJson('{"thought":"我需要直接总结当前笔记"}'), true)
  assert.equal(isStructuredThoughtOnlyJson('{"thought":"read first","action":"read_markdown_file","action_input":{"filePath":"a.md"}}'), false)
  assert.equal(isIncompleteStructuredAgentJson('{"thought":"only thought"}'), true)
  assert.equal(isIncompleteStructuredAgentJson('{"action":"create_file","action_input":{"fileName":"a.md","content":'), true)
  assert.equal(isIncompleteStructuredAgentJson('{"action":"Final Answer","action_input":{}}'), true)
  assert.equal(isIncompleteStructuredAgentJson('{"thought":"done","final_answer":"完成"}'), false)

  const bus = createAgentEventBus({ runId: 'test-run' })
  bus.emit('agent.started', { userInput: 'inspect notes' })
  bus.emit('thought', { content: 'Need to read a file' }, { iteration: 1 })
  bus.emit('action', { tool: 'safe_read_file', params: { filePath: 'a.md' } }, { iteration: 1 })
  bus.emit('tool', {
    toolCall: {
      id: 'tool-1',
      toolName: 'safe_read_file',
      params: { filePath: 'a.md' },
      status: 'success',
      timestamp: 1,
      result: { success: true, message: 'ok' },
    },
  })
  bus.emit('final', { content: 'done' })
  const replay = replayAgentEvents(bus.getEvents())
  assert.equal(replay.runId, 'test-run')
  assert.equal(replay.currentThought, 'Need to read a file')
  assert.equal(replay.toolCalls.length, 1)
  assert.equal(replay.finalAnswer, 'done')

  const snapshot = buildAgentContextSnapshot({
    userGoal: 'summarize note',
    steps: [{
      thought: 'Read file first',
      action: { tool: 'safe_read_file', params: { filePath: 'a.md' } },
      observation: 'Read 100 characters successfully',
    }],
    toolCalls: replay.toolCalls,
    events: bus.getEvents(),
  })
  assert.equal(snapshot.readFiles[0].path, 'a.md')
  assert.match(formatAgentContextSnapshot(snapshot), /User goal/)

  console.log('agent core tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
