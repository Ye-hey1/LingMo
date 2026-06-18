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
    formatIntentPolicyForPrompt,
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
    isProgressOnlyFinalAnswer,
    isConcreteArtifactRequest,
    validateFinalAnswer,
  } = await importTsModule('src/lib/agent/final-answer.ts')
  const {
    classifyError,
    formatFriendlyError,
  } = await importTsModule('src/lib/agent/friendly-errors.ts')
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
    classifySkillScriptPath,
  } = await importTsModule('src/lib/skills/runtime-paths.ts')
  const {
    validateSkillContent,
    validateSkillYamlMetadata,
  } = await importTsModule('src/lib/skills/validator.ts')
  const {
    resolveSkillRuntimeProfile,
    skillRuntimeNeedsAgentMode,
  } = await importTsModule('src/lib/skills/runtime-profile.ts')
  const {
    decodeSkillScriptOutput,
    decodeSkillScriptOutputChunks,
  } = await importTsModule('src/lib/skills/output-decoder.ts')
  const {
    createAiStreamContentProcessor,
  } = await importTsModule('src/lib/ai/sanitize.ts')
  const {
    getConfiguredProviderDisplayTitle,
  } = await importTsModule('src/lib/ai/provider-display.ts')
  const {
    classifyError: classifyAiError,
    formatError: formatAiError,
  } = await importTsModule('src/lib/ai/error-handler.ts')
  const {
    getAiRateLimitUserMessage,
    isAiRateLimitError,
    isAiTpmLimitError,
  } = await importTsModule('src/lib/ai/rate-limit.ts')
  const {
    isRetryableTransientError,
  } = await importTsModule('src/lib/agent/transient-retry.ts')
  const {
    classifyAgentTask,
    shouldBypassAgentRuntime,
  } = await importTsModule('src/lib/agent/task-router.ts')
  const {
    createConfiguredModelSelectionId,
    matchesConfiguredModelSelection,
    parseConfiguredModelSelectionId,
  } = await importTsModule('src/lib/ai/model-selection.ts')
  const {
    inferModelTypeFromId,
  } = await importTsModule('src/lib/ai/model-type.ts')
  const {
    CLAW_SPINNER_FRAMES,
    getClawStatusGlyph,
    getClawStreamVisibleMarkdown,
    normalizeClawNestedFences,
  } = await importTsModule('src/app/core/main/chat/claw-stream-format.ts')
  const {
    normalizeCallToolResult,
  } = await importTsModule('src/lib/mcp/result.ts')
  const {
    buildResearchHistoryIndex,
    evaluateResearchBenchmark,
    searchResearchHistory,
    scoreResearchSession,
  } = await importTsModule('src/lib/research/history-index.ts')
  const {
    buildAgentRuntimeSnapshot,
    buildSkillRuntimeSnapshot,
    buildToolExposureSnapshot,
    createInitialAgentRuntimeSnapshot,
    createRuntimeWarning,
    mergeRuntimeWarnings,
  } = await importTsModule('src/lib/agent/runtime-snapshot.ts')
  const {
    createInitialAgentPartSnapshot,
    reduceAgentPartSnapshot,
  } = await importTsModule('src/lib/agent/part-reducer.ts')
  const {
    buildDistillRecommendations,
    buildDreamCandidates,
  } = await importTsModule('src/lib/agent/dream.ts')
  const {
    appendAgentSessionEntry,
    createAgentSessionLog,
    getAgentSessionBranch,
    reduceAgentSessionLogFromEvents,
  } = await importTsModule('src/lib/agent-harness/session-log.ts')
  const {
    AgentLifecycleController,
    createAgentTurnState,
  } = await importTsModule('src/lib/agent-harness/turn-lifecycle.ts')
  const {
    getMutationQueueSize,
    getToolMutationTargets,
    withMutationQueue,
  } = await importTsModule('src/lib/agent-harness/mutation-queue.ts')

  assert.equal(deriveIntentPolicy('帮我完善当前图表').allowWrite, true)
  assert.equal(deriveIntentPolicy('AI 能进行操作吗？').allowWrite, false)
  assert.equal(deriveIntentPolicy('帮我把这些文件整理到素材文件夹').allowWrite, true)
  assert.equal(deriveIntentPolicy('把这篇笔记挪到旅行目录').allowWrite, true)
  assert.equal(deriveIntentPolicy('请归档这些 draft 文件').allowWrite, true)
  assert.equal(deriveIntentPolicy('分类到已完成文件夹').allowWrite, true)
  assert.equal(deriveIntentPolicy('organize these notes into archive folder').allowWrite, true)
  assert.equal(deriveIntentPolicy('根据上面3天行程重新规划旅游攻略，并输出到笔记中').allowWrite, true)
  assert.equal(deriveIntentPolicy('帮我设计一份19日到21日出行方案并保存到笔记').allowWrite, true)
  assert.equal(deriveIntentPolicy('删除这个文件').allowDestructive, true)
  assert.equal(deriveIntentPolicy('不要删除，只总结一下').allowDestructive, false)
  assert.equal(deriveIntentPolicy('用技能导出为 pptx 文件').allowWrite, true)
  assert.equal(deriveIntentPolicy('用技能导出为 pptx 文件').allowExecute, true)
  assert.equal(deriveIntentPolicy('不要执行脚本，只给命令建议').allowExecute, false)
  const disabledWritePrompt = formatIntentPolicyForPrompt({
    allowWrite: false,
    allowDestructive: false,
    allowExecute: false,
  })
  assert.match(disabledWritePrompt, /did not contain a clear write\/move\/edit intent/)
  assert.match(disabledWritePrompt, /explicit write or move target is needed/)
  assert.match(disabledWritePrompt, /normal confirmation flow/)
  assert.doesNotMatch(disabledWritePrompt, /Agent cannot write files/)
  assert.doesNotMatch(disabledWritePrompt, /system policy/i)
  assert.equal(classifyError('STALE_MCP_TOOL_REGISTRY'), 'mcp_registry')
  assert.equal(classifyError('Final Answer 内容不能为空'), 'model_output')
  assert.equal(classifyError('TypeError: Cannot read properties of undefined'), 'runtime')
  assert.equal(classifyError('AI_HTTP_ERROR status=402 retryable=false body={"error":{"message":"Insufficient Balance"}}'), 'billing')
  const agentBillingError = formatFriendlyError('AI_HTTP_ERROR status=402 retryable=false body={"error":{"message":"Insufficient Balance"}}')
  assert.equal(agentBillingError.title, '余额不足')
  assert.equal(agentBillingError.retryable, false)
  const upstreamError = 'AI_HTTP_ERROR status=500 retryable=true body={"error":{"message":"upstream error: do request failed","code":"do_request_failed"}}'
  assert.equal(classifyError(upstreamError), 'server')
  const agentServerError = formatFriendlyError(upstreamError)
  assert.equal(agentServerError.title, '上游服务异常')
  assert.equal(agentServerError.retryable, true)
  assert.equal(classifyAiError('AI_HTTP_ERROR status=402 retryable=false body={"error":{"message":"Insufficient Balance"}}'), 'billing')
  const billingError = formatAiError('AI_HTTP_ERROR status=402 retryable=false body={"error":{"message":"Insufficient Balance"}}')
  assert.equal(billingError.title, '余额不足')
  assert.equal(billingError.retryable, false)
  const tpmError = 'AI_HTTP_ERROR status=429 retryable=true body={"message":"Request was rejected due to rate limiting. Details: TPM limit reached.","data":null}'
  assert.equal(classifyAiError(tpmError), 'rate_limit')
  assert.equal(isAiRateLimitError(tpmError), true)
  assert.equal(isAiTpmLimitError(tpmError), true)
  assert.equal(isRetryableTransientError(new Error(tpmError)).retryable, false)
  assert.match(getAiRateLimitUserMessage(tpmError), /TPM/)
  const generic429 = 'AI_HTTP_ERROR status=429 retryable=true body={"message":"Too many requests"}'
  assert.equal(isRetryableTransientError(new Error(generic429)).retryable, true)

  const tauriClientSource = await readFile(join(repoRoot, 'src/lib/ai/tauri-client.ts'), 'utf8')
  assert.match(tauriClientSource, /extractHttpErrorMessage/)
  assert.match(tauriClientSource, /message=\$\{JSON\.stringify\(message\)\}/)

  const greetingRoute = classifyAgentTask({ userInput: '你好' })
  assert.equal(greetingRoute.route, 'direct_static')
  assert.equal(shouldBypassAgentRuntime(greetingRoute), true)
  const simpleRoute = classifyAgentTask({ userInput: '什么是 MCP？' })
  assert.equal(simpleRoute.route, 'quick_answer')
  assert.equal(simpleRoute.requiresRuntime, false)
  assert.equal(shouldBypassAgentRuntime(simpleRoute), true)
  const simpleDesignRoute = classifyAgentTask({ userInput: '什么是系统设计？' })
  assert.equal(simpleDesignRoute.route, 'quick_answer')
  assert.equal(simpleDesignRoute.requiresRuntime, false)
  const latestRoute = classifyAgentTask({ userInput: '帮我搜索今天的 AI 新闻并总结来源' })
  assert.equal(latestRoute.requiresRuntime, true)
  assert.notEqual(latestRoute.route, 'quick_answer')
  const editRoute = classifyAgentTask({ userInput: '请修复当前项目里的类型错误' })
  assert.equal(editRoute.requiresRuntime, true)
  assert.notEqual(editRoute.route, 'quick_answer')
  const forcedSkillRoute = classifyAgentTask({ userInput: '润色这段文字', forcedSkillIds: ['renwei-writing'] })
  assert.equal(forcedSkillRoute.route, 'standard_agent')
  assert.equal(forcedSkillRoute.requiresRuntime, true)
  const travelNoteRoute = classifyAgentTask({ userInput: '根据上面3天行程，重新规划旅游攻略，出行时间19日-21日，规划设计一份出行方案，并输出到笔记中' })
  assert.equal(travelNoteRoute.requiresRuntime, true)
  assert.notEqual(travelNoteRoute.route, 'quick_answer')
  assert.equal(shouldBypassAgentRuntime(travelNoteRoute), false)
  assert.equal(createConfiguredModelSelectionId('provider-a', 'model-b'), 'provider-a:model-b')
  assert.deepEqual(parseConfiguredModelSelectionId('provider-a:model-b'), {
    configKey: 'provider-a',
    modelId: 'model-b',
  })
  assert.equal(matchesConfiguredModelSelection({
    configKey: 'provider-a',
    modelId: 'model-b',
    selectionId: 'provider-a:model-b',
  }), true)
  assert.equal(matchesConfiguredModelSelection({
    configKey: 'provider-a',
    modelId: 'model-b',
    selectionId: 'model-b',
  }), true)
  assert.equal(matchesConfiguredModelSelection({
    configKey: 'provider-a',
    modelId: 'model-b',
    selectionId: 'provider-a-model-b',
  }), true)
  assert.equal(matchesConfiguredModelSelection({
    configKey: 'provider-a',
    modelId: 'model-b',
    selectionId: 'provider-c:model-b',
  }), false)
  assert.equal(getConfiguredProviderDisplayTitle({
    key: 'groq-asr',
    title: 'OpenAI',
    baseURL: 'https://api.groq.com/openai/v1',
  }), 'Groq')
  assert.equal(getConfiguredProviderDisplayTitle({
    key: 'siliconflow-asr',
    title: '',
    baseURL: 'https://api.siliconflow.cn/v1',
  }), 'SiliconFlow')
  assert.equal(inferModelTypeFromId('FunAudioLLM/SenseVoiceSmall'), 'stt')
  assert.equal(inferModelTypeFromId('TeleAI/TeleSpeechASR'), 'stt')
  assert.equal(inferModelTypeFromId('mimo-v2.5-asr'), 'stt')
  assert.equal(inferModelTypeFromId('FunAudioLLM/CosyVoice2-0.5B'), 'tts')
  const unknownFriendlyError = formatFriendlyError('low level failure: route planner crashed')
  assert.equal(unknownFriendlyError.title, '执行异常')
  assert.match(unknownFriendlyError.message, /route planner crashed/)
  assert.doesNotMatch(unknownFriendlyError.message, /^遇到了意外错误。$/)

  const runtimeSnapshot = createInitialAgentRuntimeSnapshot('run-1')
  assert.equal(runtimeSnapshot.runId, 'run-1')
  assert.deepEqual(runtimeSnapshot.visibleToolNames, [])
  assert.deepEqual(runtimeSnapshot.skills.skills, [])
  assert.deepEqual(runtimeSnapshot.mcp.servers, [])
  assert.deepEqual(runtimeSnapshot.warnings, [])
  const warning = createRuntimeWarning({
    source: 'mcp',
    level: 'warn',
    message: 'server unavailable',
  })
  assert.deepEqual(mergeRuntimeWarnings([warning], [warning]), [warning])
  const skillRuntimeSnapshot = buildSkillRuntimeSnapshot({
    selectedSkillIds: ['daily-report'],
    forcedSkillIds: ['daily-report'],
    skills: [{
      metadata: {
        id: 'daily-report',
        name: 'daily-report',
        description: 'Generate daily reports',
        scope: 'project',
        allowedTools: ['create_file'],
        userInvocable: true,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      instructions: 'Write reports',
      scripts: [{ name: 'fetch.sh', path: 'scripts/fetch.sh', type: 'bash' }],
      references: [{ name: 'style.md', path: 'references/style.md' }],
      assets: [],
    }],
  })
  assert.equal(skillRuntimeSnapshot.skills[0].source, 'project')
  assert.equal(skillRuntimeSnapshot.skills[0].selected, true)
  assert.deepEqual(skillRuntimeSnapshot.skills[0].allowedTools, ['create_file'])
  assert.equal(skillRuntimeSnapshot.skills[0].scriptCount, 1)
  assert.equal(skillRuntimeSnapshot.skills[0].referenceCount, 1)
  assert.deepEqual(normalizeCallToolResult(undefined), {
    content: [{ type: 'text', text: '' }],
    isError: true,
  })
  assert.deepEqual(normalizeCallToolResult({ content: 'bad' }), {
    content: [],
    isError: false,
  })
  const decodedSkillOutput = decodeSkillScriptOutput(new Uint8Array([0xff, 0x61]))
  assert.equal(decodedSkillOutput.output.includes('a'), true)
  assert.equal(decodedSkillOutput.outputEncoding, 'utf8-replacement')
  assert.equal(decodedSkillOutput.warnings.length, 1)
  const decodedSkillChunks = decodeSkillScriptOutputChunks([
    new Uint8Array([0xff]),
    'hello',
  ])
  assert.equal(decodedSkillChunks.output.includes('hello'), true)
  assert.equal(decodedSkillChunks.outputEncoding, 'utf8-replacement')
  assert.equal(decodedSkillChunks.warnings.length, 1)
  const decodedArrayBuffer = decodeSkillScriptOutput(new Uint8Array([0x68, 0x69]).buffer)
  assert.equal(decodedArrayBuffer.output, 'hi')
  const decodedNumberArray = decodeSkillScriptOutput([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd])
  assert.equal(decodedNumberArray.output, '你好')
  assert.deepEqual(CLAW_SPINNER_FRAMES, ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'])
  assert.equal(getClawStatusGlyph('done', 0), '✔')
  assert.equal(getClawStatusGlyph('error', 0), '✘')
  assert.equal(getClawStreamVisibleMarkdown('# Heading', true), '')
  assert.equal(getClawStreamVisibleMarkdown('# Heading\n\nParagraph\n\n', true), '# Heading\n\nParagraph\n\n')
  assert.equal(getClawStreamVisibleMarkdown('```ts\nconst x = 1\n', true), '')
  assert.equal(getClawStreamVisibleMarkdown('```ts\nconst x = 1\n```\n', true), '```ts\nconst x = 1\n```\n')
  assert.match(normalizeClawNestedFences('```markdown\n```ts\nx\n```\n```'), /^````markdown/)
  assert.equal(isConcreteArtifactRequest('使用 aihot 技能获取最新 AI 信息并直接输出文字', true), false)
  assert.equal(isConcreteArtifactRequest('根据上面3天行程重新规划旅游攻略，并输出到笔记中', true), true)
  assert.equal(isConcreteArtifactRequest('规划设计一份19日-21日出行方案', true), true)
  assert.equal(isProgressOnlyFinalAnswer('收到。我现在先确认行程核心数据，然后输出到笔记中。'), true)
  assert.equal(isProgressOnlyFinalAnswer('充分理解。原图存在问题，我会重新规划一版完整方案。'), true)
  assert.equal(
    validateFinalAnswer('收到。我现在先确认行程核心数据，然后输出到笔记中。', '根据上面3天行程重新规划旅游攻略，并输出到笔记中', false).ok,
    false,
  )
  assert.equal(
    getConcreteToolCompletionBlockReason({
      userInput: '使用 aihot 技能获取最新 AI 信息并直接输出文字',
      actionLikeRequest: true,
      hasConcreteSuccessfulAction: false,
      hasOnlySupportProgress: false,
    }),
    null,
  )
  assert.match(
    getConcreteToolCompletionBlockReason({
      userInput: '根据上面3天行程重新规划旅游攻略，并输出到笔记中',
      actionLikeRequest: true,
      hasConcreteSuccessfulAction: false,
      hasOnlySupportProgress: false,
    }) || '',
    /create_file|replace_editor_content/,
  )
  const toolExposure = buildToolExposureSnapshot({
    tools: [
      { name: 'safe_read_file', category: 'filesystem', risk: 'low', description: '', parameters: [], requiresConfirmation: false, execute: async () => ({ success: true }) },
      { name: 'web_fetch', category: 'web', risk: 'low', description: '', parameters: [], requiresConfirmation: false, execute: async () => ({ success: true }) },
    ],
    visibleToolNames: ['safe_read_file'],
    blockedToolNames: [{ name: 'web_fetch', reason: 'web disabled' }],
    exposureReasons: { safe_read_file: ['base tool', 'read capability'] },
    maxVisibleTools: 1,
  })
  assert.deepEqual(toolExposure.visible.map(tool => tool.name), ['safe_read_file'])
  assert.equal(toolExposure.visible[0].reason, 'base tool; read capability')
  assert.deepEqual(toolExposure.blocked.map(tool => tool.reason), ['web disabled'])
  const combinedRuntimeSnapshot = buildAgentRuntimeSnapshot({
    runId: 'run-2',
    skills: skillRuntimeSnapshot,
    tools: toolExposure,
    mcp: {
      selectedServerIds: ['server-1'],
      connectedServerIds: ['server-1'],
      servers: [],
      toolNames: ['server-1__search'],
      toolGeneration: 7,
      warnings: [],
    },
  })
  assert.deepEqual(combinedRuntimeSnapshot.visibleToolNames, ['safe_read_file'])
  assert.equal(combinedRuntimeSnapshot.skills.selectedSkillIds[0], 'daily-report')
  assert.equal(combinedRuntimeSnapshot.mcp.toolGeneration, 7)

  let sessionLog = createAgentSessionLog('session-run')
  sessionLog = appendAgentSessionEntry(sessionLog, {
    entry: {
      type: 'run_started',
      route: 'agent',
      userGoal: '审计一次 agent 执行',
      timestamp: 100,
    },
  })
  const sessionRootId = sessionLog.leafId
  sessionLog = appendAgentSessionEntry(sessionLog, {
    entry: {
      type: 'turn_started',
      iteration: 1,
      visibleToolNames: ['safe_read_file'],
      timestamp: 110,
    },
  })
  const firstTurnId = sessionLog.leafId
  sessionLog = appendAgentSessionEntry(sessionLog, {
    entry: {
      type: 'custom',
      customType: 'side-branch',
      parentId: sessionRootId,
      timestamp: 120,
    },
  })
  assert.equal(sessionLog.entries.at(-1).parentId, sessionRootId)
  assert.deepEqual(getAgentSessionBranch(sessionLog).map(entry => entry.id), [sessionRootId, sessionLog.leafId])
  assert.deepEqual(getAgentSessionBranch(sessionLog, firstTurnId).map(entry => entry.type), ['run_started', 'turn_started'])

  const reducedSessionLog = reduceAgentSessionLogFromEvents({
    runId: 'event-run',
    route: 'agent',
    userGoal: '执行工具并回答',
    events: [
      {
        type: 'iteration.started',
        runId: 'event-run',
        sequence: 1,
        timestamp: 100,
        iteration: 1,
        payload: { visibleToolNames: ['safe_read_file'] },
      },
      {
        type: 'tool.execution.started',
        runId: 'event-run',
        sequence: 2,
        timestamp: 115,
        iteration: 1,
        payload: {
          toolName: 'safe_read_file',
          toolCallId: 'tool-1',
          params: { filePath: 'daily.md' },
        },
      },
      {
        type: 'tool.execution.finished',
        runId: 'event-run',
        sequence: 3,
        timestamp: 120,
        iteration: 1,
        payload: {
          toolName: 'safe_read_file',
          toolCallId: 'tool-1',
          success: true,
          status: 'completed',
          message: '读取完成',
          dataRef: 'agent://event-run/observation/file.txt',
          retryable: false,
        },
      },
      {
        type: 'model.response.received',
        runId: 'event-run',
        sequence: 4,
        timestamp: 130,
        iteration: 1,
        payload: { finishReason: 'stop', toolCallCount: 0 },
      },
      {
        type: 'final.answer.rendered',
        runId: 'event-run',
        sequence: 5,
        timestamp: 140,
        iteration: 1,
        payload: { content: '最终回答' },
      },
      {
        type: 'agent.completed',
        runId: 'event-run',
        sequence: 6,
        timestamp: 150,
        payload: { result: '最终回答' },
      },
    ],
  })
  assert.deepEqual(
    reducedSessionLog.entries.map(entry => entry.type),
    ['run_started', 'turn_started', 'tool_call_started', 'tool_result', 'turn_finished', 'message', 'run_finished'],
  )
  assert.equal(reducedSessionLog.entries[2].paramsSummary, '{"filePath":"daily.md"}')
  assert.equal(reducedSessionLog.entries[3].parentId, reducedSessionLog.entries[2].id)
  assert.equal(reducedSessionLog.entries[3].dataRef, 'agent://event-run/observation/file.txt')
  assert.equal(reducedSessionLog.entries.at(-1).status, 'completed')

  const failedSessionLog = reduceAgentSessionLogFromEvents({
    runId: 'failed-run',
    route: 'agent',
    userGoal: '失败路径',
    events: [{
      type: 'error',
      runId: 'failed-run',
      sequence: 1,
      timestamp: 100,
      level: 'error',
      payload: { error: 'boom' },
    }],
  })
  assert.equal(failedSessionLog.entries.at(-1).type, 'run_finished')
  assert.equal(failedSessionLog.entries.at(-1).status, 'failed')
  assert.equal(failedSessionLog.entries.at(-1).error, 'boom')

  const pausedSessionLog = reduceAgentSessionLogFromEvents({
    runId: 'paused-run',
    route: 'agent',
    userGoal: '暂停路径',
    events: [{
      type: 'agent.stopped',
      runId: 'paused-run',
      sequence: 1,
      timestamp: 100,
      payload: { reason: 'USER_STOPPED' },
    }],
  })
  assert.equal(pausedSessionLog.entries.at(-1).status, 'paused')

  const lifecycleTool = {
    name: 'safe_read_file',
    category: 'filesystem',
    risk: 'low',
    description: '',
    parameters: [],
    requiresConfirmation: false,
    execute: async () => ({ success: true }),
  }
  const turnStateA = createAgentTurnState({
    runId: 'life-run',
    iteration: 1,
    route: 'agent',
    userGoal: '读取文件',
    systemPrompt: 'system',
    tools: [lifecycleTool],
    runtimeSnapshot,
  })
  const turnStateB = createAgentTurnState({
    runId: 'life-run',
    iteration: 1,
    route: 'agent',
    userGoal: '读取文件',
    systemPrompt: 'system',
    tools: [lifecycleTool],
    runtimeSnapshot,
  })
  assert.equal(turnStateA.checksum, turnStateB.checksum)
  assert.deepEqual(turnStateA.visibleToolNames, ['safe_read_file'])

  const lifecycle = new AgentLifecycleController('life-run')
  lifecycle.startRun({ route: 'agent', userGoal: '读取文件' })
  lifecycle.createTurn({
    runId: 'life-run',
    iteration: 1,
    route: 'agent',
    userGoal: '读取文件',
    systemPrompt: 'system',
    tools: [lifecycleTool],
    runtimeSnapshot,
  })
  assert.equal(lifecycle.getSnapshot().phase, 'turn')
  assert.equal(lifecycle.getSnapshot().pendingEntryCount, 1)
  lifecycle.savePoint({ finishReason: 'tool_calls', toolCallCount: 1 })
  assert.equal(lifecycle.getSnapshot().phase, 'save_point')
  assert.equal(lifecycle.getSnapshot().pendingEntryCount, 0)
  assert.deepEqual(
    lifecycle.getSessionLog().entries.map(entry => entry.type),
    ['run_started', 'turn_started', 'runtime_snapshot', 'turn_finished'],
  )
  lifecycle.enqueueEntry({
    type: 'tool_result',
    iteration: 1,
    toolName: 'safe_read_file',
    toolCallId: 'tool-1',
    success: true,
    status: 'success',
    summary: '读取完成',
    retryable: false,
  })
  lifecycle.savePoint({ finishReason: 'tool_calls', toolCallCount: 1 })
  assert.deepEqual(
    lifecycle.getSessionLog().entries.map(entry => entry.type),
    ['run_started', 'turn_started', 'runtime_snapshot', 'turn_finished', 'tool_result'],
  )
  lifecycle.enterToolPhase()
  assert.equal(lifecycle.getPhase(), 'tool')
  lifecycle.createTurn({
    runId: 'life-run',
    iteration: 2,
    route: 'agent',
    userGoal: '读取文件',
    systemPrompt: 'system v2',
    tools: [lifecycleTool],
  })
  lifecycle.savePoint({ finishReason: 'stop', toolCallCount: 0 })
  lifecycle.finish({ status: 'completed', finalAnswer: '完成' })
  assert.equal(lifecycle.getPhase(), 'settled')
  assert.equal(lifecycle.getSnapshot().savePointCount, 2)
  assert.deepEqual(
    lifecycle.getSessionLog().entries.map(entry => entry.type),
    ['run_started', 'turn_started', 'runtime_snapshot', 'turn_finished', 'tool_result', 'turn_started', 'turn_finished', 'run_finished'],
  )

  assert.deepEqual(getToolMutationTargets('replace_editor_content', {}), ['editor:active'])
  assert.deepEqual(getToolMutationTargets('create_file', {
    folderPath: 'Notes/../Notes',
    fileName: 'Daily.md',
    path: '.\\Notes\\Archive\\..\\Summary.md',
  }), ['notes', 'notes/summary.md', 'notes/daily.md'])
  const mutationOrder = []
  const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))
  const firstMutation = withMutationQueue(['Notes/Daily.md'], async () => {
    mutationOrder.push('first-start')
    await delay(25)
    mutationOrder.push('first-end')
    return 'first'
  })
  const secondMutation = withMutationQueue(['notes\\daily.md'], async () => {
    mutationOrder.push('second-start')
    mutationOrder.push('second-end')
    return 'second'
  })
  assert.deepEqual(await Promise.all([firstMutation, secondMutation]), ['first', 'second'])
  assert.deepEqual(mutationOrder, ['first-start', 'first-end', 'second-start', 'second-end'])
  assert.equal(getMutationQueueSize(), 0)

  let statusSnapshot = createInitialAgentPartSnapshot('status-run')
  statusSnapshot = reduceAgentPartSnapshot(statusSnapshot, {
    type: 'iteration.started',
    runId: 'status-run',
    sequence: 2,
    timestamp: 120,
    payload: {},
  })
  assert.equal(statusSnapshot.visibleStatus.label, '思考中')
  statusSnapshot = reduceAgentPartSnapshot(statusSnapshot, {
    type: 'agent.started',
    runId: 'status-run',
    sequence: 1,
    timestamp: 100,
    payload: { userInput: 'latest ai news' },
  })
  assert.equal(statusSnapshot.visibleStatus.label, '思考中')

  let partSnapshot = createInitialAgentPartSnapshot('tool-run')
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'action.parsed',
    runId: 'tool-run',
    sequence: 1,
    timestamp: 100,
    payload: { tool: 'execute_skill_script', params: { skill_id: 'aihot' } },
  })
  assert.equal(partSnapshot.parts.length, 0)
  assert.equal(partSnapshot.visibleStatus.label, '准备调用工具')
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'tool.updated',
    runId: 'tool-run',
    sequence: 2,
    timestamp: 120,
    payload: {
      toolCall: {
        id: 'tool-1',
        toolName: 'execute_skill_script',
        params: { skill_id: 'aihot' },
        status: 'error',
        timestamp: 120,
        result: { success: false, error: 'invalid utf-8 sequence of 1 bytes' },
      },
    },
  })
  assert.equal(partSnapshot.status, 'running')
  assert.equal(partSnapshot.visibleStatus.label, '工具步骤失败，正在恢复')
  assert.equal(partSnapshot.recoverableErrors.length, 1)
  assert.equal(partSnapshot.fatalErrors.length, 0)
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'tool.execution.finished',
    runId: 'tool-run',
    sequence: 3,
    timestamp: 140,
    payload: {
      toolName: 'maps_geo',
      toolCallId: 'tool-2',
      params: { address: '白音敖包沙地云杉景区' },
      success: false,
      error: 'ENGINE_RESPONSE_DATA_ERROR',
      message: 'Geocoding failed',
    },
  })
  assert.equal(partSnapshot.status, 'running')
  assert.equal(partSnapshot.visibleStatus.label, '工具步骤失败，正在恢复')
  assert.equal(partSnapshot.recoverableErrors.length, 2)
  assert.equal(partSnapshot.fatalErrors.length, 0)
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'model.request.started',
    runId: 'tool-run',
    sequence: 4,
    timestamp: 150,
    payload: {},
  })
  assert.equal(partSnapshot.status, 'running')
  assert.equal(partSnapshot.visibleStatus.label, '思考中')
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'tool.execution.finished',
    runId: 'tool-run',
    sequence: 5,
    timestamp: 180,
    payload: {
      toolCall: {
        id: 'tool-3',
        toolName: 'safe_read_file',
        params: { filePath: 'daily.md' },
        status: 'skipped',
        timestamp: 180,
        result: {
          success: false,
          status: 'skipped',
          error: 'SKIPPED_TOOL_CALL',
          message: 'Skipped extra tool call',
        },
      },
      status: 'skipped',
      success: false,
      message: 'Skipped extra tool call',
      error: 'SKIPPED_TOOL_CALL',
    },
  })
  assert.equal(partSnapshot.parts.at(-1)?.status, 'skipped')
  assert.equal(partSnapshot.visibleStatus.label, '已跳过额外工具调用')
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'final.answer.rendered',
    runId: 'tool-run',
    sequence: 6,
    timestamp: 160,
    payload: { content: '日报正文', streaming: true },
  })
  assert.equal(partSnapshot.finalAnswerContent, '日报正文')
  assert.equal(partSnapshot.visibleStatus.label, '正在写答案')
  const finalTextPart = partSnapshot.parts.find(part => part.type === 'text')
  assert.equal(finalTextPart?.text, '日报正文')
  assert.equal(finalTextPart?.status, 'completed')
  partSnapshot = reduceAgentPartSnapshot(partSnapshot, {
    type: 'agent.started',
    runId: 'tool-run',
    sequence: 5,
    timestamp: 200,
    payload: { userInput: 'late duplicate start' },
  })
  assert.equal(partSnapshot.visibleStatus.label, '正在写答案')
  const repeatedSummary = {
    id: 'agent-run-1',
    userGoal: '生成 AI 日报',
    result: '已生成日报',
    stopped: false,
    completedAt: Date.now(),
    iterations: 2,
    toolsUsed: [{ toolName: 'execute_skill_script', count: 1, success: 1, error: 0 }],
    filesTouched: ['daily.md'],
    failures: [],
  }
  const dreamCandidates = buildDreamCandidates({
    summaries: [repeatedSummary],
    memories: [],
    workingMemory: {
      recentFiles: ['daily.md'],
      recentFolders: [],
      failedAttempts: [],
      toolUsageStats: { execute_skill_script: 3 },
      lastActiveAt: Date.now(),
    },
  })
  assert.ok(dreamCandidates.some(candidate => candidate.kind === 'workflow'))
  const distillRecommendations = buildDistillRecommendations({
    summaries: [repeatedSummary, { ...repeatedSummary, id: 'agent-run-2' }],
  })
  assert.equal(distillRecommendations.length, 1)
  assert.deepEqual(distillRecommendations[0].requiredTools, ['execute_skill_script'])


  assert.equal(getToolRiskLevel('read_markdown_file', 'note'), 'low')
  assert.equal(getToolRiskLevel('create_file', 'note'), 'medium')
  assert.equal(getToolRiskLevel('delete_markdown_file', 'note'), 'high')
  assert.equal(getToolRiskLevel('safe_read_file', 'filesystem'), 'low')
  assert.equal(getToolRiskLevel('safe_write_file', 'filesystem'), 'medium')
  assert.equal(getToolRiskLevel('tool_search', 'system'), 'low')
  assert.equal(getToolRiskLevel('git_status', 'system'), 'low')
  assert.equal(getToolRiskLevel('git_diff', 'system'), 'low')
  assert.equal(getToolRiskLevel('git_log', 'system'), 'low')
  assert.equal(getToolRiskLevel('git_show', 'system'), 'low')
  assert.equal(getToolRiskLevel('git_blame', 'system'), 'low')
  assert.equal(getToolRiskLevel('code_search_symbols', 'filesystem'), 'low')
  assert.equal(getToolRiskLevel('code_file_outline', 'filesystem'), 'low')
  assert.equal(getToolRiskLevel('code_find_definition', 'filesystem'), 'low')
  assert.equal(getToolRiskLevel('code_find_references', 'filesystem'), 'low')
  assert.equal(getToolRiskLevel('code_read_context', 'filesystem'), 'low')
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

  const observedEvents = []
  const observedBus = createAgentEventBus({
    runId: 'observed-run',
    onEvent: (event) => observedEvents.push(event),
  })
  observedBus.emit('research.progress', { stage: 'searching', cacheStats: { hits: 1, misses: 2 } })
  assert.equal(observedEvents.length, 1)
  assert.equal(observedEvents[0].type, 'research.progress')

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
  const parsedAihotSkill = parseSkillFile(await readFile(join(repoRoot, 'skills/ai-hots/SKILL.md'), 'utf8'))
  assert.equal(parsedAihotSkill.metadata.name, 'aihot')
  assert.ok(parsedAihotSkill.metadata.allowedTools.includes('execute_skill_script'))
  assert.ok(parsedAihotSkill.metadata.allowedTools.includes('web_fetch'))
  assert.equal(parsedAihotSkill.metadata.runtimeProfile, 'agent')
  const parsedAmapSkill = parseSkillFile(await readFile(join(repoRoot, 'skills/amap-jsapi-skill/SKILL.md'), 'utf8'))
  assert.equal(parsedAmapSkill.metadata.name, 'amap-jsapi-skill')
  assert.match(parsedAmapSkill.metadata.description, /高德地图 JSAPI/)
  assert.equal(parsedAmapSkill.metadata.license, 'MIT')
  assert.equal(parsedAmapSkill.metadata.version, '1.0.0')
  assert.equal(validateSkillYamlMetadata(parsedAmapSkill.metadata).valid, true)
  assert.deepEqual(classifySkillScriptPath('skills/aihot/runtime/fetch_aihot.sh'), {
    kind: 'generated-runtime-script',
    normalizedArg: 'fetch_aihot.sh',
  })
  assert.deepEqual(classifySkillScriptPath('skills/ai-hots/runtime/fetch_aihot.sh'), {
    kind: 'generated-runtime-script',
    normalizedArg: 'fetch_aihot.sh',
  })
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

  const streamProcessor = createAiStreamContentProcessor()
  const splitStart = streamProcessor.push('<think>先判断文章结构</think>正文')
  const splitEnd = streamProcessor.flush()
  assert.equal(`${splitStart.thinking}${splitEnd.thinking}`, '先判断文章结构')
  assert.equal(`${splitStart.content}${splitEnd.content}`, '正文')

  const splitChunkProcessor = createAiStreamContentProcessor()
  const chunked = [
    splitChunkProcessor.push('<thi'),
    splitChunkProcessor.push('nk>内部思考</think>'),
    splitChunkProcessor.push('可见正文'),
    splitChunkProcessor.flush(),
  ]
  assert.equal(chunked.map(part => part.thinking).join(''), '内部思考')
  assert.equal(chunked.map(part => part.content).join(''), '可见正文')

  const researchSessionFixture = {
    id: 'research-history-fixture',
    query: 'AI Agent memory tool workflow cache evaluation',
    strategy: 'technical',
    startedAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-02T00:00:00.000Z',
    searchProviders: ['tavily', 'duckduckgo'],
    sources: [
      { id: 'S1', title: 'LangGraph memory guide', url: 'https://langchain-ai.github.io/langgraph/concepts/memory/', engine: 'tavily', retrievedAt: '', publishedAt: '2026-06-01T00:00:00.000Z', credibilityScore: 0.9 },
      { id: 'S2', title: 'OpenAI tool guide', url: 'https://platform.openai.com/docs/guides/tools', engine: 'tavily', retrievedAt: '', publishedAt: '2026-06-01T00:00:00.000Z', credibilityScore: 0.88 },
      { id: 'S3', title: 'Agent evaluation notes', url: 'https://example.com/agent-eval', engine: 'duckduckgo', retrievedAt: '', publishedAt: '2026-05-20T00:00:00.000Z', credibilityScore: 0.7 },
    ],
    evidences: [
      { id: 'E1', sourceId: 'S1', sourceUrl: 'https://langchain-ai.github.io/langgraph/concepts/memory/', claim: 'Agent memory separates thread state from durable knowledge.', relevanceScore: 0.9, confidence: 'high' },
      { id: 'E2', sourceId: 'S2', sourceUrl: 'https://platform.openai.com/docs/guides/tools', claim: 'Tool execution should use structured schemas and explicit observation handling.', relevanceScore: 0.86, confidence: 'high' },
      { id: 'E3', sourceId: 'S3', sourceUrl: 'https://example.com/agent-eval', claim: 'Evaluation loops should measure cache hit rate, source quality, recency, and accuracy.', relevanceScore: 0.8, confidence: 'medium' },
      { id: 'E4', sourceId: 'S1', sourceUrl: 'https://langchain-ai.github.io/langgraph/concepts/memory/', claim: 'Research history can become reusable retrieval context.', relevanceScore: 0.78, confidence: 'medium' },
    ],
    learnings: [
      'Research history index makes prior reports searchable for future Agent work.',
      'Cache hit rate and provider health help diagnose unstable deep research runs.',
    ],
    visitedUrls: [],
    cacheStats: { hits: 2, misses: 3, writes: 3, bypasses: 0 },
    providerHealth: [
      { name: 'tavily', failureCount: 0, lastFailureTime: 0, isBroken: false, responseTime: 300 },
    ],
  }
  const researchMetrics = scoreResearchSession(researchSessionFixture, new Date('2026-06-09T00:00:00.000Z').getTime())
  assert.ok(researchMetrics.sourceQualityScore >= 50)
  assert.equal(researchMetrics.cacheHitRate, 0.4)
  const researchIndex = buildResearchHistoryIndex([researchSessionFixture], { now: new Date('2026-06-09T00:00:00.000Z').getTime() })
  const researchHits = searchResearchHistory(researchIndex, 'agent memory cache evaluation', { limit: 1 })
  assert.equal(researchHits[0].document.sessionId, 'research-history-fixture')
  const benchmark = evaluateResearchBenchmark(researchIndex, [{
    id: 'agent-memory-cache',
    question: 'How should AI Agent memory, tool workflow, and cache evaluation work?',
    expectedKeywords: ['agent', 'memory', 'tool', 'cache', 'evaluation'],
    requiredDomains: ['langchain-ai.github.io', 'platform.openai.com'],
    freshnessDays: 30,
    minSources: 3,
    minEvidence: 4,
    minKeywordCoverage: 0.6,
    minSourceQuality: 50,
  }])
  assert.equal(benchmark.passCount, 1)
  assert.ok(benchmark.averageAccuracyProxy >= 60)

  const slashBridgeSource = await readFile(join(repoRoot, 'src/lib/ai-doc-commands/slash-bridge.ts'), 'utf8')
  assert.match(slashBridgeSource, /resolveSkillRuntimeProfile/)
  assert.match(slashBridgeSource, /skillRuntimeNeedsAgentMode\(runtime\.profile\)/)
  assert.match(slashBridgeSource, /skill\.metadata\.runtimeProfile/)
  assert.match(slashBridgeSource, /skill\.metadata\.capabilities/)
  assert.match(slashBridgeSource, /useSkillsStore\.getState\(\)\.initSkills\(\)/)
  assert.match(slashBridgeSource, /skillManager\.getUserInvocableSkills\(\)/)
  assert.doesNotMatch(slashBridgeSource, /function skillNeedsAgentMode/)
  assert.doesNotMatch(slashBridgeSource, /create\|modify\|edit\|update\|delete\|move\|rename\|copy\|save\|export\|execute\|run/)

  const chatDictationSource = await readFile(join(repoRoot, 'src/app/core/main/chat/use-chat-dictation.ts'), 'utf8')
  assert.match(chatDictationSource, /formatError\(error\)/)
  assert.match(chatDictationSource, /EXPECTED_DICTATION_ERROR_KINDS/)
  assert.match(chatDictationSource, /"billing"/)
  assert.match(chatDictationSource, /console\.warn\("聊天语音识别未完成:"/)

  const settingModelSelectSource = await readFile(join(repoRoot, 'src/app/core/setting/components/model-select.tsx'), 'utf8')
  assert.match(settingModelSelectSource, /createConfiguredModelSelectionId/)
  assert.match(settingModelSelectSource, /matchesConfiguredModelSelection/)
  assert.match(settingModelSelectSource, /getConfiguredProviderDisplayTitle\(config\)/)
  assert.match(settingModelSelectSource, /dedupeGroupedModels/)
  assert.match(settingModelSelectSource, /getModelDedupKey/)
  assert.doesNotMatch(settingModelSelectSource, /getCachedProviderTemplates/)

  const settingConfigSource = await readFile(join(repoRoot, 'src/app/core/setting/config.tsx'), 'utf8')
  assert.match(settingConfigSource, /shouldAutoMergeTemplateModel/)
  assert.match(settingConfigSource, /model\.modelType !== 'stt'/)
  assert.match(settingConfigSource, /model\.modelType !== 'tts'/)
  assert.match(settingConfigSource, /cleanupConfiguredModels/)
  assert.match(settingConfigSource, /inferModelTypeFromId/)
  assert.match(settingConfigSource, /normalizeConfiguredModelType/)
  assert.match(settingConfigSource, /model\.modelType === 'chat' && inferredType !== 'chat'/)
  assert.match(settingConfigSource, /seen\.has\(key\)/)
  assert.doesNotMatch(settingConfigSource, /LEGACY_TEMPLATE_AUDIO_MODEL_KEYS/)
  assert.doesNotMatch(settingConfigSource, /model:\s*'glm-asr-2512'/)
  assert.doesNotMatch(settingConfigSource, /model:\s*'FunAudioLLM\/SenseVoiceSmall'/)
  assert.doesNotMatch(settingConfigSource, /model:\s*'whisper-1'/)

  const audioSource = await readFile(join(repoRoot, 'src/lib/audio.ts'), 'utf8')
  assert.match(audioSource, /transcriptionModel = sttConfig\.model\.trim\(\)/)
  assert.doesNotMatch(audioSource, /model: sttConfig\.model \|\| 'FunAudioLLM\/SenseVoiceSmall'/)

  const skillManagerSource = await readFile(join(repoRoot, 'src/lib/skills/manager.ts'), 'utf8')
  assert.match(skillManagerSource, /await this\.discoverProjectSkills\(\)/)
  assert.doesNotMatch(skillManagerSource, /await this\.discoverGlobalSkills\(\)/)
  assert.match(skillManagerSource, /generateSkillId\(existingSkill\.metadata\.name\) === generateSkillId\(skill\.metadata\.name\)/)
  assert.match(skillManagerSource, /this\.unregisterSkill\(nameDuplicate\.metadata\.id\)/)
  assert.match(skillManagerSource, /getSkillCompletenessWeight/)
  assert.match(skillManagerSource, /existing\.metadata\.scope === 'project' && candidate\.metadata\.scope === 'global'/)

  const skillsV2PathsSource = await readFile(join(repoRoot, 'src-tauri/src/skills_v2/paths.rs'), 'utf8')
  assert.match(skillsV2PathsSource, /workspacePath/)
  assert.match(skillsV2PathsSource, /app_data_dir\.join\("article"\)/)
  assert.match(skillsV2PathsSource, /workspace_dir\(app_data_dir\)\.join\("skills"\)/)
  assert.match(skillsV2PathsSource, /app_data_dir\.join\("skills-v2"\)\.join\("skills"\)/)

  const skillsV2InstallerSource = await readFile(join(repoRoot, 'src-tauri/src/skills_v2/installer.rs'), 'utf8')
  assert.match(skillsV2InstallerSource, /workspace_skills_dir\(app_data_dir\)/)
  assert.doesNotMatch(skillsV2InstallerSource, /app_data_dir\.join\("skills"\)/)

  const skillsV2DbSource = await readFile(join(repoRoot, 'src-tauri/src/skills_v2/db.rs'), 'utf8')
  assert.match(skillsV2DbSource, /workspace_skills_dir\(app_data_dir\)/)
  assert.match(skillsV2DbSource, /migrate_installed_skill_roots/)
  assert.match(skillsV2DbSource, /sync_workspace_skill_inventory/)
  assert.match(skillsV2DbSource, /parse_skill_md\(&skill_dir\)/)
  assert.match(skillsV2DbSource, /source_type: "workspace"\.into\(\)/)

  const skillsV2CommandsSource = await readFile(join(repoRoot, 'src-tauri/src/skills_v2/commands.rs'), 'utf8')
  assert.match(skillsV2CommandsSource, /sync_workspace_skill_inventory\(&app_data_dir\)/)

  const skillsV2MetadataSource = await readFile(join(repoRoot, 'src-tauri/src/skills_v2/skill_metadata.rs'), 'utf8')
  assert.match(skillsV2MetadataSource, /parse_markdown_table_metadata/)

  const legacySkillImportSource = await readFile(join(repoRoot, 'src-tauri/src/skills.rs'), 'utf8')
  assert.match(legacySkillImportSource, /workspace_skills_dir\(&app_data_dir\)/)
  assert.doesNotMatch(legacySkillImportSource, /app_data_dir\.join\("skills"\)/)

  const writerExecutorSource = await readFile(join(repoRoot, 'src/lib/agent/writer-executor.ts'), 'utf8')
  assert.match(writerExecutorSource, /export async function runWriterSkill/)
  assert.match(writerExecutorSource, /Do not use ReAct JSON/)

  const harnessTypesSource = await readFile(join(repoRoot, 'src/lib/agent-harness/types.ts'), 'utf8')
  assert.match(harnessTypesSource, /export interface AgentRunSnapshot/)
  assert.match(harnessTypesSource, /export interface ContextPack/)
  assert.match(harnessTypesSource, /export type ContextLayerId/)
  assert.match(harnessTypesSource, /export interface ContextLayerUsage/)
  assert.match(harnessTypesSource, /export interface ToolExposureRecord/)
  assert.match(harnessTypesSource, /export interface AgentRunMetrics/)
  assert.match(harnessTypesSource, /export interface ToolObservation/)
  assert.match(harnessTypesSource, /export interface ApprovalRequest/)
  assert.match(harnessTypesSource, /export interface AgentHarnessMiddleware/)
  assert.match(harnessTypesSource, /beforeRun/)
  assert.match(harnessTypesSource, /beforeModel/)
  assert.match(harnessTypesSource, /beforeTool/)
  assert.match(harnessTypesSource, /afterTool/)
  assert.match(harnessTypesSource, /afterRun/)
  assert.match(harnessTypesSource, /export interface AgentRunControl/)
  assert.match(harnessTypesSource, /getMiddlewareState/)
  assert.match(harnessTypesSource, /prepareModel/)
  assert.match(harnessTypesSource, /authorizeTool/)
  assert.match(harnessTypesSource, /setContextPack/)
  assert.match(harnessTypesSource, /writeDraft/)
  const middlewareSource = await readFile(join(repoRoot, 'src/lib/agent-harness/middleware.ts'), 'utf8')
  assert.match(middlewareSource, /export class AgentMiddlewareRuntime/)
  assert.match(middlewareSource, /createSkillMcpMiddleware/)
  assert.match(middlewareSource, /beforeRun/)
  assert.match(middlewareSource, /beforeModel/)
  assert.match(middlewareSource, /beforeTool/)
  assert.match(middlewareSource, /afterTool/)
  assert.match(middlewareSource, /afterRun/)
  assert.match(middlewareSource, /reloadMcpTools/)
  assert.match(middlewareSource, /matchRelevantSkillScores/)
  assert.match(middlewareSource, /Visible tools/)
  assert.match(middlewareSource, /Harness Skill Scope/)
  assert.match(middlewareSource, /SUPPORT_TOOL_NAMES[\s\S]*tool_search/)
  const runIdSource = await readFile(join(repoRoot, 'src/lib/agent-harness/run-id.ts'), 'utf8')
  assert.match(runIdSource, /export function createAgentRunId/)
  const vfsSource = await readFile(join(repoRoot, 'src/lib/agent-harness/vfs.ts'), 'utf8')
  assert.match(vfsSource, /export async function writeAgentVfsText/)
  assert.match(vfsSource, /export async function readAgentVfsText/)
  assert.match(vfsSource, /agent:\/\//)
  const toolRuntimeSource = await readFile(join(repoRoot, 'src/lib/agent-harness/tool-runtime.ts'), 'utf8')
  assert.match(toolRuntimeSource, /export async function executeHarnessTool/)
  assert.match(toolRuntimeSource, /ToolObservation/)
  assert.match(toolRuntimeSource, /HarnessToolExecutionResult/)
  assert.match(toolRuntimeSource, /executeWithTimeout/)
  assert.match(toolRuntimeSource, /compressToolResult/)
  assert.match(toolRuntimeSource, /retryable/)
  assert.match(toolRuntimeSource, /isResultMarkedRetryable/)
  assert.match(toolRuntimeSource, /STALE_MCP_TOOL_REGISTRY/)
  assert.match(toolRuntimeSource, /MAX_INLINE_OBSERVATION_CHARS/)
  assert.match(toolRuntimeSource, /writeAgentVfsText/)
  assert.match(toolRuntimeSource, /dataRef/)
  assert.match(toolRuntimeSource, /sleepWithAbort/)
  assert.match(toolRuntimeSource, /assertNotAborted\(context\.abortSignal\)/)
  assert.equal(existsSync(join(repoRoot, 'src/lib/agent-harness/approval-gate.ts')), false)
  const contextEngineSource = await readFile(join(repoRoot, 'src/lib/agent-harness/context-engine.ts'), 'utf8')
  assert.match(contextEngineSource, /export function buildContextPack/)
  assert.match(contextEngineSource, /CONTEXT_LAYER_ORDER/)
  assert.match(contextEngineSource, /buildLayerBudgets/)
  assert.match(contextEngineSource, /inferContextLayer/)
  assert.match(contextEngineSource, /priority/)
  assert.match(contextEngineSource, /deferred/)
  const snapshotSource = await readFile(join(repoRoot, 'src/lib/agent-harness/run-snapshot-store.ts'), 'utf8')
  assert.match(snapshotSource, /export async function saveRunSnapshot/)
  assert.match(snapshotSource, /export async function loadRunSnapshot/)
  assert.match(snapshotSource, /agent-harness-runs\.json/)
  const orchestratorSource = await readFile(join(repoRoot, 'src/lib/agent-harness/orchestrator.ts'), 'utf8')
  assert.match(orchestratorSource, /export class AgentOrchestrator/)
  assert.match(orchestratorSource, /route/)
  assert.match(orchestratorSource, /agentExecutor/)
  assert.doesNotMatch(orchestratorSource, /legacyAgentExecutor/)
  assert.match(orchestratorSource, /AgentMiddlewareRuntime/)
  assert.match(orchestratorSource, /createSkillMcpMiddleware/)
  assert.match(orchestratorSource, /middlewareRuntime\.beforeRun/)
  assert.match(orchestratorSource, /prepareModel:\s*async/)
  assert.match(orchestratorSource, /authorizeTool:\s*async/)
  assert.match(orchestratorSource, /middlewareRuntime\.afterRun/)
  assert.match(orchestratorSource, /executeTool:\s*async/)
  assert.match(orchestratorSource, /executeHarnessTool/)
  assert.match(orchestratorSource, /saveRunSnapshot/)
  assert.match(orchestratorSource, /context-pack\.json/)
  assert.match(orchestratorSource, /todos\.json/)
  assert.match(orchestratorSource, /observationRefs/)
  assert.match(orchestratorSource, /eventWriteQueue/)
  assert.match(orchestratorSource, /setSessionLog:\s*\(log\)/)
  assert.match(orchestratorSource, /latestSessionLog/)
  assert.match(orchestratorSource, /input\.sessionLog \|\| reduceAgentSessionLogFromEvents/)
  assert.match(orchestratorSource, /runAfterRunMiddleware/)
  assert.match(orchestratorSource, /afterRun middleware failed/)

  const harnessRunnerSource = await readFile(join(repoRoot, 'src/lib/agent-harness/harness-agent-runner.ts'), 'utf8')
  assert.match(harnessRunnerSource, /export class HarnessAgentRunner/)
  assert.match(harnessRunnerSource, /tools:\s*input\.tools\.map\(toolToOpenAiTool\)/)
  assert.match(harnessRunnerSource, /tool_choice\s*=\s*'auto'/)
  assert.match(harnessRunnerSource, /prepareHarnessModelStep/)
  assert.match(harnessRunnerSource, /runControl\.prepareModel/)
  assert.match(harnessRunnerSource, /executeGovernedHarnessTool/)
  assert.match(harnessRunnerSource, /readOnlyBatch/)
  assert.match(harnessRunnerSource, /setContextPack/)
  assert.match(harnessRunnerSource, /flushLifecycleSessionLog/)
  assert.match(harnessRunnerSource, /setSessionLog/)
  assert.match(harnessRunnerSource, /buildContextPack/)
  assert.match(harnessRunnerSource, /contextPackRef/)
  assert.match(harnessRunnerSource, /tool_call_started/)
  assert.match(harnessRunnerSource, /tool_result/)
  assert.match(harnessRunnerSource, /getGlobalToolCache|cached/)
  assert.match(harnessRunnerSource, /buildSkippedToolResultMessage/)
  assert.match(harnessRunnerSource, /callsToSkip/)
  assert.match(harnessRunnerSource, /onAnswerDelta\?:/)
  assert.match(harnessRunnerSource, /this\.config\.onAnswerDelta\?\.\(content\)/)
  assert.match(harnessRunnerSource, /streamAnswerDelta:\s*true/)
  assert.match(harnessRunnerSource, /getFinalAnswerRejectionDisplayReason/)
  assert.match(harnessRunnerSource, /buildFinalAnswerRecoveryPrompt/)
  assert.match(harnessRunnerSource, /buildMaxIterationFallback/)
  assert.match(harnessRunnerSource, /buildForcedFinalAnswerPrompt/)
  assert.match(harnessRunnerSource, /synthesizeFinalAnswer/)
  assert.match(harnessRunnerSource, /FINAL_ANSWER_RESERVE_ITERATIONS/)
  assert.match(harnessRunnerSource, /REPEATED_TOOL_CALL_THRESHOLD/)
  assert.match(harnessRunnerSource, /OUTPUT_LENGTH_CONTINUATION_LIMIT/)
  assert.match(harnessRunnerSource, /INVALID_OUTPUT_CONTINUATION_LIMIT/)
  assert.match(harnessRunnerSource, /MAX_DYNAMIC_REACT_ITERATIONS/)
  assert.match(harnessRunnerSource, /BUDGET_EXHAUSTION_TEXT_PATTERN/)
  assert.match(harnessRunnerSource, /resolveReActMaxIterations/)
  assert.match(harnessRunnerSource, /buildReActBudgetPrompt/)
  assert.match(harnessRunnerSource, /buildOutputLengthContinuationPrompt/)
  assert.match(harnessRunnerSource, /stableStringify/)
  assert.match(harnessRunnerSource, /countRecentMatchingToolSteps/)
  assert.match(harnessRunnerSource, /sanitizeFinalAnswerContent/)
  assert.match(harnessRunnerSource, /isReadOnlyHarnessTool/)
  assert.match(harnessRunnerSource, /estimateInformationLookupDensity/)
  assert.match(harnessRunnerSource, /countUsefulReadOnlySteps/)
  assert.match(harnessRunnerSource, /resolveReadOnlyBatchLimit/)
  assert.match(harnessRunnerSource, /DEFAULT_READ_ONLY_BATCH_LIMIT/)
  assert.match(harnessRunnerSource, /MAX_READ_ONLY_BATCH_LIMIT/)
  assert.match(harnessRunnerSource, /requestedToolCallCount/)
  assert.match(harnessRunnerSource, /completedReadOnlySteps/)
  assert.match(harnessRunnerSource, /remainingToolIterations/)
  assert.match(harnessRunnerSource, /maxToolIterations/)
  assert.doesNotMatch(harnessRunnerSource, /CRITICAL - MAXIMUM AGENT STEPS REACHED/)
  assert.match(harnessRunnerSource, /REPEATED_TOOL_CALL/)
  assert.match(harnessRunnerSource, /tools:\s*\[\]/)
  assert.match(harnessRunnerSource, /delete requestParams\.tools/)
  assert.doesNotMatch(harnessRunnerSource, /isRoutePlanningRequest/)
  assert.doesNotMatch(harnessRunnerSource, /model requested \$\{response\.toolCalls\.length\} more tool call\(s\) at the tool budget limit/)
  assert.doesNotMatch(harnessRunnerSource, /已达到最大迭代次数，任务可能未完全完成。/)
  assert.doesNotMatch(harnessRunnerSource, /此段因工具调用次数耗尽未能逐段驾车规划/)
  assert.doesNotMatch(harnessRunnerSource, /candidate \|\| validation\.reason/)
  assert.doesNotMatch(harnessRunnerSource, /this\.config\.onThought\?\(content\)/)
  assert.doesNotMatch(harnessRunnerSource, /emitEvent\('thought\.updated', \{ content, streaming: true \}\)/)
  assert.doesNotMatch(harnessRunnerSource, /parseStructuredActionJson/)
  assert.doesNotMatch(harnessRunnerSource, /ReActAgent/)
  assert.equal(existsSync(join(repoRoot, 'src/lib/agent/react.ts')), false)
  assert.equal(existsSync(join(repoRoot, 'src/lib/agent/base-agent.ts')), false)

  const toolGovernanceSource = await readFile(join(repoRoot, 'src/lib/agent-harness/tool-governance.ts'), 'utf8')
  assert.match(toolGovernanceSource, /export async function executeGovernedHarnessTool/)
  assert.match(toolGovernanceSource, /validateToolInput/)
  assert.match(toolGovernanceSource, /evaluateIntentAwareToolPolicy/)
  assert.match(toolGovernanceSource, /getGlobalToolCache/)
  assert.match(toolGovernanceSource, /runControl\.authorizeTool/)
  assert.match(toolGovernanceSource, /requestConfirmation/)
  assert.match(toolGovernanceSource, /formatToolObservation/)
  assert.match(toolGovernanceSource, /normalizeHarnessToolParams/)
  assert.match(toolGovernanceSource, /executeToolWithRuntimeRecovery/)
  assert.match(toolGovernanceSource, /refreshMcpToolsForAgent/)
  assert.match(toolGovernanceSource, /STALE_MCP_TOOL_REGISTRY/)
  assert.match(toolGovernanceSource, /WEB_ACCESS_DISABLED/)
  assert.ok(
    toolGovernanceSource.indexOf('WEB_ACCESS_DISABLED') < toolGovernanceSource.indexOf('const cache = getGlobalToolCache()'),
    'web access must be checked before cache lookup'
  )

  const xiaomoPromptSource = await readFile(join(repoRoot, 'src/lib/ai/xiaomo-prompt.ts'), 'utf8')
  assert.match(xiaomoPromptSource, /Role name: 小墨/)
  assert.match(xiaomoPromptSource, /first principles/)
  assert.match(xiaomoPromptSource, /Feynman technique/)
  assert.match(xiaomoPromptSource, /clickable Markdown link/)
  assert.match(xiaomoPromptSource, /human briefing/)

  const aiUtilsSource = await readFile(join(repoRoot, 'src/lib/ai/utils.ts'), 'utf8')
  assert.match(aiUtilsSource, /buildXiaoMoChatSystemPrompt/)
  assert.match(aiUtilsSource, /\[promptContent,\s*existingContent\]/)

  const deepResearchSource = await readFile(join(repoRoot, 'src/lib/research/deep-research.ts'), 'utf8')
  assert.match(deepResearchSource, /buildXiaoMoDeepResearchSystemPrompt/)
  assert.match(deepResearchSource, /Your visible role is 小墨/)
  assert.match(deepResearchSource, /clickable Markdown link/)
  assert.match(deepResearchSource, /SEARCH_CACHE_TTL_MS/)
  assert.match(deepResearchSource, /researchSearchInflight/)
  assert.match(deepResearchSource, /searchProviderWithCache/)
  assert.match(deepResearchSource, /cacheStats:\s*snapshotSearchCacheStats/)
  assert.match(deepResearchSource, /researchStrategyRegistry/)
  assert.match(deepResearchSource, /registerResearchStrategy/)
  assert.match(deepResearchSource, /providerHealth/)

  const researchHistoryIndexSource = await readFile(join(repoRoot, 'src/lib/research/history-index.ts'), 'utf8')
  assert.match(researchHistoryIndexSource, /RESEARCH_HISTORY_INDEX_VERSION/)
  assert.match(researchHistoryIndexSource, /searchResearchHistory/)
  assert.match(researchHistoryIndexSource, /evaluateResearchBenchmark/)
  assert.match(researchHistoryIndexSource, /cacheHitRate/)

  const researchHistoryStoreSource = await readFile(join(repoRoot, 'src/lib/research/history-index-store.ts'), 'utf8')
  assert.match(researchHistoryStoreSource, /RESEARCH_HISTORY_INDEX_PATH/)
  assert.match(researchHistoryStoreSource, /upsertResearchHistorySession/)
  assert.match(researchHistoryStoreSource, /rebuildResearchHistoryIndexFromReports/)

  const promptAssemblerSource = await readFile(join(repoRoot, 'src/lib/agent/prompt-assembler.ts'), 'utf8')
  assert.match(promptAssemblerSource, /Harness Output Format/)
  assert.match(promptAssemblerSource, /buildXiaoMoIdentityPrompt/)
  assert.match(promptAssemblerSource, /clickable Markdown link/)
  assert.match(promptAssemblerSource, /sharp human briefing/)
  assert.match(promptAssemblerSource, /Do not emit ReAct JSON/)
  assert.doesNotMatch(promptAssemblerSource, /ReAct Output Format/)

  const agentHandlerSource = await readFile(join(repoRoot, 'src/lib/agent/agent-handler.ts'), 'utf8')
  assert.match(agentHandlerSource, /runControl\?: AgentRunControl/)
  assert.match(agentHandlerSource, /createAgentRunId\('agent'\)/)
  assert.match(agentHandlerSource, /agentRunId:\s*runId/)
  assert.match(agentHandlerSource, /getMiddlewareState/)
  assert.match(agentHandlerSource, /loadLegacyRuntimeState/)
  assert.match(agentHandlerSource, /HarnessAgentRunner/)
  assert.match(agentHandlerSource, /new HarnessAgentRunner/)
  assert.match(agentHandlerSource, /onAnswerDelta/)
  assert.match(agentHandlerSource, /currentAction:\s*undefined/)
  assert.match(agentHandlerSource, /currentObservation:\s*undefined/)
  assert.match(agentHandlerSource, /isFinalAnswerMode:\s*false/)
  assert.match(agentHandlerSource, /finalAnswerContent:\s*undefined/)
  assert.match(agentHandlerSource, /finishWithErrorState/)
  assert.match(agentHandlerSource, /pendingConfirmation:\s*undefined/)
  assert.match(agentHandlerSource, /await this\.config\.onError/)
  assert.ok(
    agentHandlerSource.indexOf('await this.config.onError?.(errorMessage)') < agentHandlerSource.indexOf('throw error'),
    'agent handler must publish the user-visible error and stop UI state before rethrowing to orchestrator'
  )
  assert.doesNotMatch(agentHandlerSource, /onThought\?\(finalAnswerContent \|\| visibleThought\)/)
  assert.doesNotMatch(agentHandlerSource, /new ReActAgent/)
  assert.doesNotMatch(agentHandlerSource, /ReActConfig/)
  assert.doesNotMatch(agentHandlerSource, /runControl\?\.recordEvent\(event\)/)
  assert.equal(existsSync(join(repoRoot, 'src/app/core/main/chat/agent-history.tsx')), false)

  const chatInputSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-input.tsx'), 'utf8')
  assert.match(chatInputSource, /routeOverride:\s*slashCommand\.runtimeProfile/)
  assert.match(chatInputSource, /\[SlashSkill\] route/)
  assert.match(chatInputSource, /runtimeProfile:\s*slashCommand\.runtimeProfile/)
  assert.match(chatInputSource, /ResearchDepthControl/)
  assert.match(chatInputSource, /getResearchDepthConfig/)
  assert.match(chatInputSource, /researchBreadth:\s*depthConfig\.breadth/)
  assert.match(chatInputSource, /researchDepth:\s*depthConfig\.depth/)
  assert.match(chatInputSource, /const isAgentSkill = slashCommand\.executionMode === 'agent'/)
  assert.match(chatInputSource, /forcedSkillIds:\s*\[slashCommand\.skillContent\.metadata\.id\]/)
  assert.match(chatInputSource, /modeOverride:\s*isAgentSkill \? 'agent' : 'chat'/)

  const writerChatSendSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-send.tsx'), 'utf8')
  assert.match(writerChatSendSource, /buildWriterSkillInstruction/)
  assert.match(writerChatSendSource, /async function handleWriterMode/)
  assert.match(writerChatSendSource, /writerExecutor:\s*async \(\) => handleWriterMode/)

  const researchDepthControlSource = await readFile(join(repoRoot, 'src/app/core/main/chat/research-depth-control.tsx'), 'utf8')
  assert.match(researchDepthControlSource, /export type ResearchDepthPreset = "auto" \| "quick" \| "deep"/)
  assert.match(researchDepthControlSource, /breadth:\s*6/)
  assert.match(researchDepthControlSource, /depth:\s*4/)
  assert.match(researchDepthControlSource, /SlidersHorizontal/)

  const popoverSource = await readFile(join(repoRoot, 'src/app/core/main/chat/ai-doc-command-popover.tsx'), 'utf8')
  assert.match(popoverSource, /runtimeProfile/)
  assert.doesNotMatch(popoverSource, /agent\s*之类|Agent badge placeholder/)

  const chatSendSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-send.tsx'), 'utf8')
  assert.match(chatSendSource, /routeOverride\?: 'writer' \| 'advisor' \| 'agent' \| 'workflow' \| 'chat' \| 'research'/)
  assert.match(chatSendSource, /researchBreadth\?: number/)
  assert.match(chatSendSource, /researchDepth\?: number/)
  assert.match(chatSendSource, /handleWriterMode/)
  assert.match(chatSendSource, /const effectiveRoute = options\?\.routeOverride \|\| effectiveMode/)
  assert.match(chatSendSource, /const effectiveMode = options\?\.modeOverride \|\| chatMode/)
  assert.match(chatSendSource, /breadth:\s*options\.researchBreadth/)
  assert.match(chatSendSource, /depth:\s*options\.researchDepth/)
  assert.match(chatSendSource, /handleClarifiedResearchMode\(effectiveInstruction, options\)/)
  assert.match(chatSendSource, /buildHarnessContextItems/)
  assert.match(chatSendSource, /agentExecutor:\s*async \(runControl\)/)
  assert.doesNotMatch(chatSendSource, /legacyAgentExecutor:\s*async \(runControl\)/)
  assert.match(chatSendSource, /runControl\.setContextPack/)
  assert.match(chatSendSource, /runControl\.writeDraft\('final-answer\.md'/)
  assert.match(chatSendSource, /harnessSnapshot:\s*runControl\.getSnapshot\(\)/)
  assert.match(chatSendSource, /可点击 Markdown 链接/)
  assert.match(chatSendSource, /少用官方腔和学术腔/)
  assert.match(chatSendSource, /function formatEmptyAiResponseMessage/)
  assert.match(chatSendSource, /没有返回可展示正文/)
  assert.match(chatSendSource, /createAgentEventBus/)
  assert.match(chatSendSource, /onError:\s*async \(error\)/)
  assert.match(chatSendSource, /function formatUserVisibleError/)
  assert.match(chatSendSource, /isLikelyErrorContent\(finalContent\)/)
  assert.doesNotMatch(chatSendSource, /content:\s*`Error: \$\{error\}`/)
  assert.doesNotMatch(chatSendSource, /const errorContent = `Error:/)
  assert.match(chatSendSource, /isRunning:\s*false/)
  assert.match(chatSendSource, /isThinking:\s*false/)
  assert.match(chatSendSource, /pendingConfirmation:\s*undefined/)
  assert.match(chatSendSource, /startResearchRun/)
  assert.match(chatSendSource, /updateResearchProgressView/)
  assert.match(chatSendSource, /finishResearchRun/)
  assert.match(chatSendSource, /search_cache_hit_rate/)
  assert.match(chatSendSource, /search_provider_health/)
  assert.match(chatSendSource, /upsertResearchHistorySession/)

  const packageSource = await readFile(join(repoRoot, 'package.json'), 'utf8')
  assert.match(packageSource, /research:index/)
  assert.match(packageSource, /research:benchmark/)

  const researchEvalSource = await readFile(join(repoRoot, 'scripts/research-eval.mjs'), 'utf8')
  assert.match(researchEvalSource, /buildResearchHistoryIndex/)
  assert.match(researchEvalSource, /evaluateResearchBenchmark/)
  assert.match(researchEvalSource, /--fixture/)

  const chatContentSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-content.tsx'), 'utf8')
  assert.match(chatContentSource, /import \{ AgentThinkingSummary \}/)
  assert.match(chatContentSource, /storedThinkingSummary/)
  assert.match(chatContentSource, /<AgentThinkingSummary/)
  assert.match(chatContentSource, /clawFormat/)
  assert.match(chatContentSource, /researchRun\.progressView/)
  assert.match(chatContentSource, /visibleResearchProgress/)
  assert.doesNotMatch(chatContentSource, /<AgentRunView/)

  const chatStoreSource = await readFile(join(repoRoot, 'src/stores/chat.ts'), 'utf8')
  assert.match(chatStoreSource, /ResearchRuntimeState/)
  assert.match(chatStoreSource, /recordResearchEvent/)
  assert.match(chatStoreSource, /updateResearchProgressView/)
  assert.match(chatStoreSource, /conversationSelectionVersion/)
  assert.match(chatStoreSource, /suppressConversationAutoRestore/)
  assert.match(chatStoreSource, /initSelectionVersion !== get\(\)\.conversationSelectionVersion/)
  assert.match(chatStoreSource, /!suppressConversationAutoRestore && conversations\.length > 0/)
  assert.match(chatStoreSource, /shouldShowChatInCurrentConversation/)
  assert.match(chatStoreSource, /void \(async \(\) => \{\s*const \{ syncConversationMessageCount \}/)

  const taskPlanProgressSource = await readFile(join(repoRoot, 'src/app/core/main/chat/task-plan-progress.tsx'), 'utf8')
  assert.match(taskPlanProgressSource, /view\?: ResearchProgressView/)
  assert.match(taskPlanProgressSource, /cacheHits/)

  const agentLiveStreamSource = await readFile(join(repoRoot, 'src/app/core/main/chat/agent-live-stream.tsx'), 'utf8')
  assert.match(agentLiveStreamSource, /formatClawStatusLabel/)
  assert.match(agentLiveStreamSource, /getClawStatusGlyph/)
  assert.match(agentLiveStreamSource, /formatThinkingElapsedSeconds/)
  assert.match(agentLiveStreamSource, /useLiveElapsedMs/)
  assert.match(agentLiveStreamSource, /\.toFixed\(1\)\}s/)
  assert.match(agentLiveStreamSource, /activity\?\.phase === "answering"/)
  assert.match(agentLiveStreamSource, /activity\?\.phase === "completed"/)
  assert.match(agentLiveStreamSource, /tone:\s*"done" as const/)
  assert.doesNotMatch(agentLiveStreamSource, /正在输出回答/)
  assert.match(agentLiveStreamSource, /Collapse details/)
  assert.match(agentLiveStreamSource, /function ToolSummaryStrip/)
  assert.match(agentLiveStreamSource, /Expand tool details/)
  assert.match(agentLiveStreamSource, /upstream error\|do_request_failed/)
  assert.doesNotMatch(agentLiveStreamSource, /md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/)
  assert.doesNotMatch(agentLiveStreamSource, /收起思考详情|展开思考详情/)
  assert.doesNotMatch(agentLiveStreamSource, /Agent 正在执行|执行时间线|任务清单/)

  const agentThinkingSummarySource = await readFile(join(repoRoot, 'src/app/core/main/chat/agent-thinking-summary.tsx'), 'utf8')
  assert.match(agentThinkingSummarySource, /export function AgentThinkingSummary/)
  assert.match(agentThinkingSummarySource, /getClawStatusGlyph/)
  assert.match(agentThinkingSummarySource, /formatThinkingElapsedSeconds/)
  assert.match(agentThinkingSummarySource, /\.toFixed\(1\)\}s/)
  assert.match(agentThinkingSummarySource, /Done/)
  assert.doesNotMatch(agentThinkingSummarySource, /已思考/)
  assert.match(agentThinkingSummarySource, /CompactToolCalls/)

  const compactToolCallsSource = await readFile(join(repoRoot, 'src/app/core/main/chat/compact-tool-calls.tsx'), 'utf8')
  assert.match(compactToolCallsSource, /getClawStatusGlyph/)
  assert.match(compactToolCallsSource, /getHarnessResultMeta/)
  assert.match(compactToolCallsSource, /dataRef/)
  assert.match(compactToolCallsSource, /retryable/)
  assert.match(compactToolCallsSource, /errorKind/)
  assert.match(compactToolCallsSource, /defaultExpanded && !isStreaming/)
  assert.doesNotMatch(compactToolCallsSource, /group\.calls\.some\(c => c\.status === "error"\)\s*\|\|/)
  assert.doesNotMatch(compactToolCallsSource, /defaultExpanded=\{call\.status === "error"\}/)

  const harnessToolRuntimeSource = await readFile(join(repoRoot, 'src/lib/agent-harness/tool-runtime.ts'), 'utf8')
  assert.match(harnessToolRuntimeSource, /invalid\[_\\s-\]\?api/)
  assert.match(harnessToolRuntimeSource, /return false/)

  const agentPartReducerSource = await readFile(join(repoRoot, 'src/lib/agent/part-reducer.ts'), 'utf8')
  assert.match(agentPartReducerSource, /invalid\[_\\s-\]\?api/)
  assert.doesNotMatch(agentPartReducerSource, /truncated\|firecrawl\|web_fetch\|stale/)
  assert.doesNotMatch(agentPartReducerSource, /status:\s*status === 'error' && !recoverable \? 'error' : 'running'/)
  assert.doesNotMatch(agentPartReducerSource, /fatalErrors:\s*status === 'error' && !recoverable/)
  assert.match(agentPartReducerSource, /status:\s*'running'/)

  assert.match(agentHandlerSource, /Recovering from/)
  assert.match(agentHandlerSource, /showTechnicalDetails/)
  assert.match(agentHandlerSource, /!\['billing', 'rate_limit', 'server'\]\.includes/)
  assert.doesNotMatch(agentHandlerSource, /payload\.success === false \? 'error' : 'tool'/)
  assert.doesNotMatch(agentHandlerSource, /toolCall\.status === 'error'[\s\S]{0,240}'error'/)

  const agentEventBusSource = await readFile(join(repoRoot, 'src/lib/agent/event-bus.ts'), 'utf8')
  assert.doesNotMatch(agentEventBusSource, /payload\.success === false[\s\S]{0,160}\? 'error' : 'tool'/)

  const mcpToolCallSource = await readFile(join(repoRoot, 'src/app/core/main/chat/mcp-tool-call.tsx'), 'utf8')
  assert.match(mcpToolCallSource, /useState\(false\)/)
  assert.doesNotMatch(mcpToolCallSource, /useState\(toolCall\.status === 'error'\)/)

  const agentPlanSource = await readFile(join(repoRoot, 'src/components/ui/agent-plan.tsx'), 'utf8')
  assert.match(agentPlanSource, /item\.kind === "error" && item\.status === "failed"/)
  assert.doesNotMatch(agentPlanSource, /eventTimeline\.some\(item => item\.status === "failed"\) \|\|\s*displaySteps\.some\(step => step\.status === "failed"\) \|\|\s*\(!isRunning && toolCalls\.some/)

  const safeListFilesSource = await readFile(join(repoRoot, 'src/lib/agent/tools/safe-tools.ts'), 'utf8')
  assert.match(safeListFilesSource, /isMissingDirectoryError/)
  assert.match(safeListFilesSource, /missingFolder/)
  assert.match(safeListFilesSource, /does not exist\. Listed 0 entries/)

  const chatPreviewSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-preview.tsx'), 'utf8')
  assert.match(chatPreviewSource, /clawFormat/)
  assert.match(chatPreviewSource, /getClawStreamVisibleMarkdown/)
  assert.match(chatPreviewSource, /normalizeClawNestedFences/)
  assert.match(chatPreviewSource, /claw-code-block/)
  assert.match(chatPreviewSource, /claw_table_format/)

  const clawStreamFormatSource = await readFile(join(repoRoot, 'src/app/core/main/chat/claw-stream-format.ts'), 'utf8')
  assert.match(clawStreamFormatSource, /CLAW_SPINNER_FRAMES/)
  assert.match(clawStreamFormatSource, /findClawStreamSafeBoundary/)
  assert.match(clawStreamFormatSource, /claw-code\/rust\/crates\/rusty-claude-cli\/src\/render\.rs/)

  const chatSource = await readFile(join(repoRoot, 'src/lib/ai/chat.ts'), 'utf8')
  assert.match(chatSource, /createAiStreamContentProcessor/)
  assert.match(chatSource, /streamProcessor\.flush\(\)/)

  const safeToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/safe-tools.ts'), 'utf8')
  assert.match(safeToolsSource, /name:\s*['"]web_search['"]/)
  assert.match(safeToolsSource, /name:\s*['"]timeRange['"]/)
  assert.match(safeToolsSource, /name:\s*['"]days['"]/)
  assert.match(safeToolsSource, /name:\s*['"]startDate['"]/)
  assert.match(safeToolsSource, /name:\s*['"]endDate['"]/)
  assert.match(safeToolsSource, /getLocalDateString\(addLocalDays\(new Date\(\), -days\)\)/)
  assert.match(safeToolsSource, /outsideWindowCount/)
  assert.match(safeToolsSource, /withinDateWindow/)
  assert.match(safeToolsSource, /date-unverified/)
  assert.match(safeToolsSource, /sourceLink/)
  assert.match(safeToolsSource, /\$\{index \+ 1\}\. \$\{sourceLink\}/)

  const tavilySource = await readFile(join(repoRoot, 'src/lib/tavily.ts'), 'utf8')
  assert.match(tavilySource, /body\.time_range = timeRange/)
  assert.doesNotMatch(tavilySource, /body\.days = days/)
  assert.match(tavilySource, /body\.start_date = startDate/)
  assert.match(tavilySource, /body\.end_date = endDate/)
  assert.match(tavilySource, /body\.topic = topic/)

  const githubStarToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/github-star-tools.ts'), 'utf8')
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
  assert.match(githubStarToolsSource, /不代表 GitHub 全站趋势/)
  assert.match(githubStarToolsSource, /user\\'s own collection and attention pattern only/)
  assert.doesNotMatch(githubStarToolsSource, /### 高频主题/)
  assert.doesNotMatch(githubStarToolsSource, /### 值得关注/)

  const toolSearchToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/tool-search-tools.ts'), 'utf8')
  assert.match(toolSearchToolsSource, /name:\s*['"]tool_search['"]/)
  assert.match(toolSearchToolsSource, /getAllToolsSync/)
  assert.match(toolSearchToolsSource, /maxResults/)
  assert.match(toolSearchToolsSource, /category/)
  assert.match(toolSearchToolsSource, /requiresConfirmation:\s*false/)
  assert.match(toolSearchToolsSource, /capabilities:\s*\[\s*['"]read['"]\s*\]/)

  const gitToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/git-tools.ts'), 'utf8')
  for (const toolName of [
    'git_status',
    'git_diff',
    'git_log',
    'git_show',
    'git_blame',
  ]) {
    assert.match(gitToolsSource, new RegExp(`name:\\s*['"]${toolName}['"]`))
  }
  assert.match(gitToolsSource, /PYTHON_GIT_RUNNER/)
  assert.match(gitToolsSource, /subprocess\.run\(/)
  assert.match(gitToolsSource, /shell=False/)
  assert.match(gitToolsSource, /\["git", \*args\]/)
  assert.match(gitToolsSource, /validateRevision/)
  assert.match(gitToolsSource, /normalizeOptionalRepoPath/)
  assert.match(gitToolsSource, /truncateText/)
  assert.doesNotMatch(gitToolsSource, /name:\s*['"]command['"]/)
  assert.doesNotMatch(gitToolsSource, /shell:\s*true/)

  const codeNavigationToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/code-navigation-tools.ts'), 'utf8')
  for (const toolName of [
    'code_search_symbols',
    'code_file_outline',
    'code_find_definition',
    'code_find_references',
    'code_read_context',
  ]) {
    assert.match(codeNavigationToolsSource, new RegExp(`name:\\s*['"]${toolName}['"]`))
  }
  assert.match(codeNavigationToolsSource, /SYMBOL_PATTERNS/)
  assert.match(codeNavigationToolsSource, /extractSymbols/)
  assert.match(codeNavigationToolsSource, /symbolReferencePattern/)
  assert.match(codeNavigationToolsSource, /ensureSafeWorkspaceRelativePath/)
  assert.match(codeNavigationToolsSource, /capabilities:\s*\[\s*['"]read['"]\s*\]/)
  assert.doesNotMatch(codeNavigationToolsSource, /Command\.create/)
  assert.doesNotMatch(codeNavigationToolsSource, /writeTextFile/)

  const toolIndexSource = await readFile(join(repoRoot, 'src/lib/agent/tools/index.ts'), 'utf8')
  assert.match(toolIndexSource, /import \{ githubStarTools \} from '\.\/github-star-tools'/)
  assert.match(toolIndexSource, /\.\.\.githubStarTools/)
  assert.match(toolIndexSource, /export \* from '\.\/github-star-tools'/)
  assert.match(toolIndexSource, /import \{ toolSearchTools \} from '\.\/tool-search-tools'/)
  assert.match(toolIndexSource, /\.\.\.toolSearchTools/)
  assert.match(toolIndexSource, /export \* from '\.\/tool-search-tools'/)
  assert.match(toolIndexSource, /import \{ gitTools \} from '\.\/git-tools'/)
  assert.match(toolIndexSource, /\.\.\.gitTools/)
  assert.match(toolIndexSource, /export \* from '\.\/git-tools'/)
  assert.match(toolIndexSource, /import \{ codeNavigationTools \} from '\.\/code-navigation-tools'/)
  assert.match(toolIndexSource, /\.\.\.codeNavigationTools/)
  assert.match(toolIndexSource, /export \* from '\.\/code-navigation-tools'/)

  console.log('agent core tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
