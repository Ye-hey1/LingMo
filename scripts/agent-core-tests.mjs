import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-agent-tests-'))
const compiledModules = new Set()

function toMjsRelativePath(relativePath) {
  return relativePath.replace(/\.tsx?$/, '.mjs')
}

function resolveRelativeDependency(currentRelativePath, specifier) {
  const currentDir = dirname(join(repoRoot, currentRelativePath))
  const basePath = resolve(currentDir, specifier)
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ]

  const dependencyPath = candidates.find(candidate => existsSync(candidate))
  if (!dependencyPath) {
    return null
  }

  return resolve(dependencyPath)
    .replace(resolve(repoRoot), '')
    .replace(/^[/\\]/, '')
}

function rewriteSpecifier(currentRelativePath, dependencyRelativePath) {
  const currentOutDir = dirname(toMjsRelativePath(currentRelativePath))
  const dependencyOutPath = toMjsRelativePath(dependencyRelativePath)

  let relativeSpecifier = dependencyOutPath
  if (currentOutDir && currentOutDir !== '.') {
    relativeSpecifier = dependencyOutPath
      .split(/[\\/]/)
      .join('/')
    const currentParts = currentOutDir.split(/[\\/]/).filter(Boolean)
    const dependencyParts = dependencyOutPath.split(/[\\/]/).filter(Boolean)
    while (currentParts.length && dependencyParts.length && currentParts[0] === dependencyParts[0]) {
      currentParts.shift()
      dependencyParts.shift()
    }
    relativeSpecifier = [
      ...currentParts.map(() => '..'),
      ...dependencyParts,
    ].join('/')
  }

  if (!relativeSpecifier.startsWith('.')) {
    relativeSpecifier = `./${relativeSpecifier}`
  }

  return relativeSpecifier
}

async function rewriteLocalImports(output, relativePath) {
  const dependencies = new Set()
  const rewrite = (match, prefix, specifier, suffix) => {
    if (!specifier.startsWith('.')) {
      return match
    }

    const dependencyRelativePath = resolveRelativeDependency(relativePath, specifier)
    if (!dependencyRelativePath) {
      return match
    }

    dependencies.add(dependencyRelativePath)
    return `${prefix}${rewriteSpecifier(relativePath, dependencyRelativePath)}${suffix}`
  }

  let rewritten = output.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, rewrite)
  rewritten = rewritten.replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, rewrite)

  for (const dependency of dependencies) {
    await compileTsModule(dependency)
  }

  return rewritten
}

async function compileTsModule(relativePath) {
  if (compiledModules.has(relativePath)) {
    return
  }
  compiledModules.add(relativePath)

  const sourcePath = join(repoRoot, relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const output = await rewriteLocalImports(ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText, relativePath)
  const outPath = join(tempDir, toMjsRelativePath(relativePath))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
}

async function importTsModule(relativePath) {
  await compileTsModule(relativePath)
  const outPath = join(tempDir, toMjsRelativePath(relativePath))
  return import(pathToFileURL(outPath).href)
}

try {
  const {
    deriveIntentPolicy,
    evaluateIntentAwareToolPolicy,
    getToolRiskLevel,
  } = await importTsModule('src/lib/agent/tool-policy.ts')
  const {
    extractVisibleFinalAnswer,
    findLooseFinalAnswerJsonField,
    isIncompleteStructuredAgentJson,
    isInternalAgentInstruction,
    isStructuredThoughtOnlyJson,
    parseActionInputJson,
    parseStructuredActionJson,
    parseStructuredFinalAnswerJson,
    sanitizeVisibleAssistantContent,
  } = await importTsModule('src/lib/agent/parse-action-input.ts')
  const {
    createAgentEventBus,
    replayAgentEvents,
  } = await importTsModule('src/lib/agent/event-bus.ts')
  const {
    getConcreteToolCompletionBlockReason,
    isConcreteArtifactRequest,
  } = await importTsModule('src/lib/agent/final-answer.ts')
  const {
    isSupportOnlyObservationText,
    isSupportOnlyToolName,
  } = await importTsModule('src/lib/agent/support-tools.ts')
  const {
    buildAgentContextSnapshot,
    formatAgentContextSnapshot,
  } = await importTsModule('src/lib/agent/context-compression.ts')
  const {
    calculateSkillMatchScore,
  } = await importTsModule('src/lib/skills/matcher.ts')
  const {
    parseSkillFile,
    serializeSkillFile,
  } = await importTsModule('src/lib/skills/parser.ts')
  const {
    validateSkillContent,
    validateSkillYamlMetadata,
  } = await importTsModule('src/lib/skills/validator.ts')
  const {
    resolveSkillRuntimeProfile,
    skillRuntimeNeedsAgentMode,
  } = await importTsModule('src/lib/skills/runtime-profile.ts')

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
  assert.equal(getToolRiskLevel('github_sync_starred', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_list_starred', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_summarize_recent_stars', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_search_my_stars', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_list_star_releases', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_list_my_forks', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_mark_release_read', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_star_repo', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_update_star_category', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_update_star_notes_tags', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_subscribe_star_releases', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_unstar_repo', 'web'), 'high')

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
  assert.deepEqual(
    evaluateIntentAwareToolPolicy({
      toolName: 'github_star_repo',
      category: 'web',
      intentPolicy: deriveIntentPolicy('帮我 Star facebook/react'),
    }),
    { allowed: true, requiresConfirmation: true },
  )
  assert.equal(
    evaluateIntentAwareToolPolicy({
      toolName: 'github_unstar_repo',
      category: 'web',
      intentPolicy: deriveIntentPolicy('只总结我的 GitHub Star，不要删除'),
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
    parseStructuredFinalAnswerJson('{"thought":"done","final_answer":"## Done\\n- a"}'),
    '## Done\n- a',
  )
  assert.equal(
    parseStructuredFinalAnswerJson('{"action":"Final Answer","action_input":{"answer":"完成"}}'),
    '完成',
  )
  assert.equal(
    parseStructuredFinalAnswerJson('{"action":"create_file","action_input":{"content":"not final"}}'),
    null,
  )
  assert.deepEqual(
    findLooseFinalAnswerJsonField('{"thought":"done","final_answer":"## Done\\n- a'),
    { value: '## Done\n- a', complete: false },
  )
  assert.equal(
    extractVisibleFinalAnswer(', ","final_answer":"✅ 图表已创建完成！\\n\\n基于数据整理如下'),
    '✅ 图表已创建完成！\n\n基于数据整理如下',
  )
  assert.equal(
    sanitizeVisibleAssistantContent('{"thought":"done","final_answer":"## Done\\n- a"}'),
    '## Done\n- a',
  )
  assert.equal(
    sanitizeVisibleAssistantContent('{"thought":"search first","action":"search_markdown_files","action_input":{"query":"agent"}}'),
    'search first',
  )
  assert.equal(
    isInternalAgentInstruction('你已经获得了工具执行结果，现在请直接用 Final Answer 输出最终分析报告。格式：\n{"final_answer": "你的完整回答（Markdown 格式）"}'),
    true,
  )
  assert.equal(
    sanitizeVisibleAssistantContent('你已经获得了工具执行结果，现在请直接用 Final Answer 输出最终分析报告。格式：\n{"final_answer": "你的完整回答（Markdown 格式）"}'),
    '',
  )
  assert.equal(
    sanitizeVisibleAssistantContent('尚未获得创建/编辑/图表/导出类工具成功结果，不能把文件、图表、导出或可视化任务判定为已完成。对于图表/思维导图/Excalidraw 任务，请继续输出 JSON Action，优先使用 create_diagram_from_outline；需要空白或自定义画布时使用 create_diagram_file。'),
    '',
  )
  assert.equal(isSupportOnlyToolName('select_skill'), true)
  assert.equal(isSupportOnlyToolName('mcp__safe_read_file'), false)
  assert.equal(isSupportOnlyObservationText('已选择 1 个 Skills: excalidraw-diagram。这些 Skills 的完整说明已加载。'), true)
  assert.equal(isConcreteArtifactRequest('根据文章核心要点生成一张思维导图', false), true)
  assert.equal(isConcreteArtifactRequest('解释一下这篇文章的重点', false), false)
  assert.match(
    getConcreteToolCompletionBlockReason({
      userInput: '根据文章核心要点生成一张 Excalidraw 思维导图',
      actionLikeRequest: false,
      hasConcreteSuccessfulAction: false,
      hasOnlySupportProgress: true,
    }) || '',
    /create_diagram_from_outline/,
  )
  assert.equal(
    getConcreteToolCompletionBlockReason({
      userInput: '根据文章核心要点生成一张 Excalidraw 思维导图',
      actionLikeRequest: false,
      hasConcreteSuccessfulAction: true,
      hasOnlySupportProgress: false,
    }),
    null,
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

  const supportBus = createAgentEventBus({ runId: 'support-run' })
  supportBus.emit('agent.started', { userInput: 'draw diagram' })
  supportBus.emit('action.parsed', { tool: 'select_skill', params: { skill_ids: ['excalidraw-diagram'] } }, { iteration: 1 })
  supportBus.emit('tool.updated', {
    toolCall: {
      id: 'support-tool-1',
      toolName: 'select_skill',
      params: { skill_ids: ['excalidraw-diagram'] },
      status: 'success',
      timestamp: 2,
      result: { success: true, message: '已选择 1 个 Skills: excalidraw-diagram。' },
    },
  })
  supportBus.emit('observation.created', {
    toolName: 'select_skill',
    observation: '已选择 1 个 Skills: excalidraw-diagram。这些 Skills 的完整说明已加载。',
  })
  supportBus.emit('step.completed', {
    toolName: 'select_skill',
    observation: '已选择 1 个 Skills: excalidraw-diagram。这些 Skills 的完整说明已加载。',
  })
  supportBus.emit('skills.selected', { skillIds: ['excalidraw-diagram'] })
  const supportReplay = replayAgentEvents(supportBus.getEvents())
  assert.equal(supportReplay.toolCalls.length, 0)
  assert.equal(supportReplay.observations.length, 0)
  assert.equal(supportReplay.telemetry.toolCallCount, 0)
  assert.equal(supportReplay.telemetry.completedStepCount, 0)

  const rejectedFinalBus = createAgentEventBus({ runId: 'rejected-final-run' })
  rejectedFinalBus.emit('agent.started', { userInput: 'draw diagram' })
  rejectedFinalBus.emit('final.answer.rendered', { content: '图已经创建完成。', streaming: true })
  rejectedFinalBus.emit('final.answer.rejected', { reason: '尚未获得创建/编辑/图表/导出类工具成功结果，不能把文件、图表、导出或可视化任务判定为已完成。' })
  const rejectedFinalReplay = replayAgentEvents(rejectedFinalBus.getEvents())
  assert.equal(rejectedFinalReplay.finalAnswer, undefined)
  assert.equal(rejectedFinalReplay.telemetry.currentPhase, 'thinking')

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

  const pptxSkill = {
    metadata: {
      id: 'pptx-exporter',
      name: 'pptx-exporter',
      description: 'Generate polished PowerPoint presentations from notes and outlines',
      scope: 'project',
      createdAt: 1,
      updatedAt: 1,
    },
    instructions: [
      '# PPTX Exporter',
      '',
      '## When To Use',
      'Use when the user wants to create slides, export a deck, or turn notes into a presentation.',
      '',
      '## Workflow',
      'Build a concise slide outline before generating the file.',
    ].join('\n'),
    scripts: [{ name: 'build-presentation.js', path: 'scripts/build-presentation.js', type: 'javascript' }],
    references: [{ name: 'pptxgenjs.md', path: 'pptxgenjs.md' }],
    assets: [],
  }
  const writingSkill = {
    metadata: {
      id: 'fiction-style',
      name: 'fiction-style',
      description: 'Guide creative fiction prose and narrative style',
      scope: 'project',
      createdAt: 1,
      updatedAt: 1,
    },
    instructions: '# Fiction Style\n\n## When To Use\nUse for story drafts and narrative prose.',
    scripts: [],
    references: [],
    assets: [],
  }
  const pptxMatch = calculateSkillMatchScore(pptxSkill, '帮我把这篇笔记导出成 PPT 演示文稿')
  const writingMatch = calculateSkillMatchScore(writingSkill, '帮我把这篇笔记导出成 PPT 演示文稿')
  assert.equal(pptxMatch.confidence, 'high')
  assert.ok(pptxMatch.score > writingMatch.score)
  assert.ok(pptxMatch.reasons.some(reason => reason.includes('描述') || reason.includes('使用场景') || reason.includes('参考文件')))

  assert.equal(resolveSkillRuntimeProfile(pptxSkill).profile, 'agent')
  assert.equal(resolveSkillRuntimeProfile(writingSkill).profile, 'writer')
  assert.equal(skillRuntimeNeedsAgentMode(resolveSkillRuntimeProfile(pptxSkill).profile), true)
  assert.equal(skillRuntimeNeedsAgentMode(resolveSkillRuntimeProfile(writingSkill).profile), false)

  const parsedRuntimeSkill = parseSkillFile(`---
name: writing-skills
description: writing support
runtimeProfile: writer
capabilities: [generate_text, revise_text]
contextPolicy:
  load: summary-first
  references: on-demand
---
# Writing Skills
`)
  assert.equal(parsedRuntimeSkill.metadata.runtimeProfile, 'writer')
  assert.deepEqual(parsedRuntimeSkill.metadata.capabilities, ['generate_text', 'revise_text'])
  assert.deepEqual(parsedRuntimeSkill.metadata.contextPolicy, {
    load: 'summary-first',
    references: 'on-demand',
  })
  assert.equal(validateSkillYamlMetadata(parsedRuntimeSkill.metadata).valid, true)
  assert.equal(validateSkillYamlMetadata({
    name: 'writing-skills',
    description: 'writing support',
    runtimeProfile: 'invalid-profile',
  }).valid, false)
  assert.equal(validateSkillContent({
    metadata: {
      id: 'writing-skills',
      name: 'writing-skills',
      description: 'writing support',
      runtimeProfile: 'writer',
      capabilities: ['generate_text'],
      contextPolicy: { load: 'summary-first', references: 'on-demand' },
      scope: 'project',
      createdAt: 1,
      updatedAt: 1,
    },
    instructions: 'Use this Skill to draft, revise, and polish long-form writing with visible prose.',
    scripts: [],
    references: [],
    assets: [],
  }).valid, true)
  assert.match(serializeSkillFile(parsedRuntimeSkill.metadata, parsedRuntimeSkill.content), /runtimeProfile: writer/)
  assert.match(serializeSkillFile(parsedRuntimeSkill.metadata, parsedRuntimeSkill.content), /capabilities: generate_text revise_text/)
  const githubStarToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/github-star-tools.ts'), 'utf8')
  assert.equal(resolveSkillRuntimeProfile({
    metadata: {
      id: 'writing-skills',
      name: 'writing-skills',
      description: 'writing support',
      runtimeProfile: 'writer',
      scope: 'project',
      createdAt: 1,
      updatedAt: 1,
    },
    instructions: 'Write an article outline and draft.',
    scripts: [],
    references: [],
    assets: [],
  }).profile, 'writer')

  const slashBridgeSource = await readFile(join(repoRoot, 'src/lib/ai-doc-commands/slash-bridge.ts'), 'utf8')
  assert.match(slashBridgeSource, /resolveSkillRuntimeProfile/)
  assert.match(slashBridgeSource, /skillRuntimeNeedsAgentMode\(runtime\.profile\)/)
  assert.match(slashBridgeSource, /skill\.metadata\.runtimeProfile/)
  assert.match(slashBridgeSource, /skill\.metadata\.capabilities/)
  assert.doesNotMatch(slashBridgeSource, /function skillNeedsAgentMode/)
  assert.doesNotMatch(slashBridgeSource, /create\|modify\|edit\|update\|delete\|move\|rename\|copy\|save\|export\|execute\|run/)

  const writerExecutorSource = await readFile(join(repoRoot, 'src/lib/agent/writer-executor.ts'), 'utf8')
  assert.match(writerExecutorSource, /export async function runWriterSkill/)
  assert.match(writerExecutorSource, /Do not use ReAct JSON/)

  const harnessTypesSource = await readFile(join(repoRoot, 'src/lib/agent-harness/types.ts'), 'utf8')
  assert.match(harnessTypesSource, /export interface AgentRunSnapshot/)
  assert.match(harnessTypesSource, /export interface ContextPack/)
  assert.match(harnessTypesSource, /export interface ToolObservation/)
  assert.match(harnessTypesSource, /export interface ApprovalRequest/)
  const runIdSource = await readFile(join(repoRoot, 'src/lib/agent-harness/run-id.ts'), 'utf8')
  assert.match(runIdSource, /export function createAgentRunId/)
  const vfsSource = await readFile(join(repoRoot, 'src/lib/agent-harness/vfs.ts'), 'utf8')
  assert.match(vfsSource, /export async function writeAgentVfsText/)
  assert.match(vfsSource, /export async function readAgentVfsText/)
  assert.match(vfsSource, /agent:\/\//)
  const toolRuntimeSource = await readFile(join(repoRoot, 'src/lib/agent-harness/tool-runtime.ts'), 'utf8')
  assert.match(toolRuntimeSource, /export async function executeHarnessTool/)
  assert.match(toolRuntimeSource, /ToolObservation/)
  assert.match(toolRuntimeSource, /retryable/)
  const approvalSource = await readFile(join(repoRoot, 'src/lib/agent-harness/approval-gate.ts'), 'utf8')
  assert.match(approvalSource, /export function shouldInterruptForTool/)
  assert.match(approvalSource, /approvalScope/)
  assert.match(approvalSource, /diffPreview/)
  const contextEngineSource = await readFile(join(repoRoot, 'src/lib/agent-harness/context-engine.ts'), 'utf8')
  assert.match(contextEngineSource, /export function buildContextPack/)
  assert.match(contextEngineSource, /priority/)
  assert.match(contextEngineSource, /deferred/)
  const snapshotSource = await readFile(join(repoRoot, 'src/lib/agent-harness/run-snapshot-store.ts'), 'utf8')
  assert.match(snapshotSource, /export async function saveRunSnapshot/)
  assert.match(snapshotSource, /export async function loadRunSnapshot/)
  assert.match(snapshotSource, /agent-harness-runs\.json/)
  const orchestratorSource = await readFile(join(repoRoot, 'src/lib/agent-harness/orchestrator.ts'), 'utf8')
  assert.match(orchestratorSource, /export class AgentOrchestrator/)
  assert.match(orchestratorSource, /route/)
  assert.match(orchestratorSource, /legacyAgentExecutor/)

  const chatInputSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-input.tsx'), 'utf8')
  assert.match(chatInputSource, /buildWriterSkillInstruction/)
  assert.match(chatInputSource, /routeOverride:\s*slashCommand\.runtimeProfile/)
  assert.match(chatInputSource, /const isAgentSkill = slashCommand\.executionMode === 'agent'/)

  const chatSendSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-send.tsx'), 'utf8')
  assert.match(chatSendSource, /routeOverride\?: 'writer' \| 'advisor' \| 'agent' \| 'workflow' \| 'chat' \| 'research'/)
  assert.match(chatSendSource, /handleWriterMode/)
  assert.match(chatSendSource, /const effectiveRoute = options\?\.routeOverride \|\| effectiveMode/)
  assert.match(chatSendSource, /const effectiveMode = options\?\.modeOverride \|\| chatMode/)
  for (const toolName of [
    'github_sync_starred',
    'github_list_starred',
    'github_summarize_recent_stars',
    'github_search_my_stars',
    'github_list_star_releases',
    'github_list_my_forks',
    'github_star_repo',
    'github_unstar_repo',
    'github_update_star_category',
    'github_update_star_notes_tags',
    'github_subscribe_star_releases',
    'github_mark_release_read',
  ]) {
    assert.match(githubStarToolsSource, new RegExp(`name:\\s*['"]${toolName}['"]`))
  }
  assert.match(githubStarToolsSource, /name:\s*['"]refresh['"]/)
  assert.match(githubStarToolsSource, /refresh:\s*params\.refresh !== false/)
  assert.match(githubStarToolsSource, /maxSyncPages:\s*numberParam\(params\.max_sync_pages,\s*2,\s*1,\s*1000\)/)
  assert.match(githubStarToolsSource, /已先同步 GitHub Star/)

  const toolIndexSource = await readFile(join(repoRoot, 'src/lib/agent/tools/index.ts'), 'utf8')
  assert.match(toolIndexSource, /import \{ githubStarTools \} from '\.\/github-star-tools'/)
  assert.match(toolIndexSource, /\.\.\.githubStarTools/)
  assert.match(toolIndexSource, /export \* from '\.\/github-star-tools'/)

  console.log('agent core tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
