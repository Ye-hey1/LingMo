import type { Tool, ToolExecutionContext, ToolResult } from '@/lib/agent/types'
import type { AgentRunControl, HarnessToolExecutionResult, ToolObservation } from './types'
import { executeHarnessTool } from './tool-runtime'
import { validateToolInput, formatValidationErrors } from '@/lib/agent/tool-input-validator'
import {
  evaluateIntentAwareToolPolicy,
  isDestructiveTool,
  isExecuteTool,
  type IntentPolicy,
} from '@/lib/agent/tool-policy'
import { getSafeGrepConvergenceMessage, formatToolObservation } from '@/lib/agent/orchestration'
import { getGlobalToolCache, extractResources } from '@/lib/agent/tool-cache'
import { isLinkedFolder, type LinkedResource } from '@/lib/files'
import useArticleStore from '@/stores/article'

export interface ConfirmationPreviewContext {
  previewParams?: Record<string, any>
  originalContent?: string
  modifiedContent?: string
  filePath?: string
}

export interface ToolGovernanceInput {
  tool: Tool
  params: Record<string, any>
  userInput: string
  steps: Array<{ action?: { tool: string; params: Record<string, any> }; observation?: string }>
  intentPolicy: IntentPolicy
  webSearchEnabled?: boolean
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
  selectedSkillIds?: Set<string>
  activeSkillIds?: string[]
  linkedResources?: LinkedResource[]
  runControl?: AgentRunControl
  context?: ToolExecutionContext
  requestConfirmation?: (toolName: string, params: Record<string, any>, context?: ConfirmationPreviewContext) => Promise<boolean>
  onEvent?: (type: string, payload?: Record<string, any>) => void
  onToolCall?: (toolCall: import('@/lib/agent/types').ToolCall) => void
}

const WEB_ACCESS_TOOL_NAMES = new Set([
  'web_search',
  'web_fetch',
  'web_extract',
  'clip_web_content',
])

function truncatePreviewContent(content: string, maxLength = 5000): string {
  if (content.length <= maxLength) return content
  return `${content.slice(0, maxLength)}\n... (${content.length - maxLength} more characters)`
}

function extractChangedRegionPreview(original: string, modified: string, contextLines = 3) {
  const originalLines = original.split('\n')
  const modifiedLines = modified.split('\n')
  let firstDiff = -1
  let lastDiff = -1
  const maxLines = Math.max(originalLines.length, modifiedLines.length)

  for (let i = 0; i < maxLines; i += 1) {
    if (originalLines[i] !== modifiedLines[i]) {
      if (firstDiff === -1) firstDiff = i
      lastDiff = i
    }
  }

  if (firstDiff === -1) {
    const previewLines = 50
    return {
      original: originalLines.slice(0, previewLines).join('\n'),
      modified: modifiedLines.slice(0, previewLines).join('\n'),
    }
  }

  const start = Math.max(0, firstDiff - contextLines)
  const end = Math.min(maxLines, lastDiff + contextLines + 1)
  return {
    original: originalLines.slice(start, end).join('\n'),
    modified: modifiedLines.slice(start, end).join('\n'),
  }
}

function normalizeLinkedCandidate(candidate: unknown): string {
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getLinkedFileName(path: unknown): string {
  const normalized = normalizeLinkedCandidate(path)
  return normalized.split('/').pop() || normalized
}

function matchesLinkedFileCandidate(
  candidate: unknown,
  linkedResource: { relativePath?: string; name?: string; path?: string },
): boolean {
  const normalized = normalizeLinkedCandidate(candidate)
  if (!normalized) return false

  const linkedPaths = new Set([
    linkedResource.relativePath,
    linkedResource.name,
    linkedResource.path,
    getLinkedFileName(linkedResource.relativePath),
    getLinkedFileName(linkedResource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function shouldBlockRedundantLinkedFileRead(
  toolName: string,
  params: Record<string, any>,
  linkedResources: Array<{ relativePath?: string; name?: string; path?: string }>,
): boolean {
  if (toolName === 'read_markdown_file') {
    return typeof params.filePath === 'string' &&
      linkedResources.some(resource => matchesLinkedFileCandidate(params.filePath, resource))
  }

  if (toolName === 'read_markdown_files_batch') {
    return Array.isArray(params.filePaths) &&
      params.filePaths.length > 0 &&
      params.filePaths.every((filePath: unknown) =>
        typeof filePath === 'string' &&
        linkedResources.some(resource => matchesLinkedFileCandidate(filePath, resource)),
      )
  }

  if (toolName === 'check_folder_exists') {
    return typeof params.folderPath === 'string' &&
      linkedResources.some(resource => matchesLinkedFileCandidate(params.folderPath, resource))
  }

  return false
}

function isExplicitTagOrMarkIntent(userInput: string): boolean {
  return /标签|標籤|tag|记录|紀錄|mark|摘录|摘錄|收集箱|inbox/i.test(userInput)
}

function shouldKeepFocusOnLinkedNote(
  userInput: string,
  linkedResource: { relativePath?: string; name?: string; path?: string },
  toolName: string,
): boolean {
  const tagMarkToolNames = new Set([
    'list_tags',
    'search_tags',
    'read_marks',
    'search_marks',
    'search_all_marks',
  ])

  if (!tagMarkToolNames.has(toolName) || isExplicitTagOrMarkIntent(userInput)) return false
  const linkedPath = linkedResource.relativePath || linkedResource.path || linkedResource.name || ''
  return /\.md$/i.test(linkedPath)
}

function getPolicyAdjustmentMessage(toolName: string, reason: string): string {
  if (reason.includes('Markdown 文件路径')) {
    return `已调整工具选择：Markdown 文件会按笔记文件读取，而不是按文件夹处理。不要再次调用 ${toolName}，请改用 read_markdown_file。`
  }
  if (reason.includes('完整内容已在上下文中')) {
    return '已直接使用关联文件上下文：这篇笔记的完整内容已经在当前对话中，无需再次读取。'
  }
  if (reason.includes('聚焦关联笔记文件内容')) {
    return '已保持任务聚焦：当前应先基于关联笔记文件继续分析或整理，不要切换到标签/记录工具。'
  }
  if (reason.includes('已经获得足够的笔记文件内容')) {
    return '已避免重复探索：你已经拿到足够的笔记内容，请直接基于已读取内容继续整理，并给出最终答案。'
  }
  if (reason.includes('safe_grep 结果已截断')) {
    return '已避免重复宽泛检索：safe_grep 结果已截断。请读取上一轮候选文件，或使用更具体的 query、folderPath、includeExtensions 收窄检索。'
  }
  if (reason.includes('replace_editor_content')) {
    return '已切换到编辑器写入路径：当前打开的文件请使用 replace_editor_content，而不是直接覆盖磁盘文件。'
  }
  if (reason.includes('get_editor_content')) {
    return '已切换到编辑器读取路径：当前打开的文件请使用 get_editor_content，而不是读取可能过时的磁盘内容。'
  }
  if (reason.includes('执行命令或脚本')) return '已保持分析模式：不会执行命令或脚本。'
  if (reason.includes('删除或清空')) return '已避免高风险操作：当前不会删除或清空内容。'
  if (reason.includes('默认只读模式') || reason.includes('修改意图')) return '已保持分析优先：先分析内容，需要修改时再确认。'
  return '已调整工具选择，继续采用更合适的处理方式。'
}

function shouldBlockRepeatedNoteExploration(
  toolName: string,
  steps: ToolGovernanceInput['steps'],
): boolean {
  if (!['list_markdown_files', 'read_markdown_file', 'read_markdown_files_batch', 'search_markdown_files'].includes(toolName)) {
    return false
  }

  const successfulNoteReads = steps.filter(step => (
    step.action &&
    ['read_markdown_file', 'read_markdown_files_batch', 'get_editor_content'].includes(step.action.tool) &&
    step.observation &&
    !/失败|错误|failed|error/i.test(step.observation)
  ))

  return successfulNoteReads.length >= 3 && toolName === 'list_markdown_files'
}

function normalizeCreateFileParams(params: Record<string, any>, selectedSkillIds?: Set<string>) {
  if (!selectedSkillIds || selectedSkillIds.size !== 1) return params
  const rawFileName = typeof params.fileName === 'string' ? params.fileName.trim() : ''
  if (!rawFileName) return params

  const rawFolderPath = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
  const scriptPattern = /\.(?:js|mjs|cjs|ts|py|sh|bash)$/i
  const selectedSkillId = Array.from(selectedSkillIds)[0]
  const runtimeFolder = `skills/${selectedSkillId}/runtime`
  const runtimePrefix = `${runtimeFolder}/`

  if (!scriptPattern.test(rawFileName) && !scriptPattern.test(rawFolderPath)) return params
  const normalizedParams = { ...params }

  if (rawFileName.startsWith(runtimePrefix)) {
    normalizedParams.fileName = rawFileName.slice(runtimePrefix.length)
    normalizedParams.folderPath = runtimeFolder
  } else if (rawFileName.includes('/')) {
    const segments = rawFileName.split('/').filter(Boolean)
    const extractedFileName = segments.pop()
    if (extractedFileName) {
      normalizedParams.fileName = extractedFileName
      normalizedParams.folderPath = segments.join('/')
    }
  }

  const currentFolderPath = typeof normalizedParams.folderPath === 'string'
    ? normalizedParams.folderPath.trim()
    : ''
  if (!currentFolderPath || currentFolderPath === `skills/${selectedSkillId}` || currentFolderPath === 'runtime') {
    normalizedParams.folderPath = runtimeFolder
  } else if (currentFolderPath.startsWith('runtime/')) {
    normalizedParams.folderPath = `${runtimeFolder}/${currentFolderPath.slice('runtime/'.length)}`
  }

  return normalizedParams
}

function getQuotedInsertDirective(userInput: string): 'before' | 'after' | 'around' | null {
  if (!/插入|添加|补充|加入|增加/.test(userInput)) return null
  const hasBefore = /前面|前边|上面|之前|前方/.test(userInput)
  const hasAfter = /后面|后边|下面|之后|后方/.test(userInput)
  if (hasBefore && hasAfter) return 'around'
  if (hasBefore) return 'before'
  if (hasAfter) return 'after'
  return null
}

function buildQuotedInsertContent(
  directive: 'before' | 'after' | 'around',
  insertedContent: string,
  quoteContent?: string,
): string {
  const normalizedInserted = insertedContent.trim()
  const normalizedQuote = quoteContent?.trim()
  if (!normalizedQuote || normalizedInserted.includes(normalizedQuote)) return normalizedInserted
  if (directive === 'before') return `${normalizedInserted}\n${normalizedQuote}`
  if (directive === 'around') {
    const structuredAround = normalizedInserted.match(/^<<BEFORE>>\s*([\s\S]*?)\s*<<AFTER>>\s*([\s\S]*)$/i)
    if (structuredAround) {
      return [structuredAround[1].trim(), normalizedQuote, structuredAround[2].trim()].filter(Boolean).join('\n\n')
    }
    return `${normalizedQuote}\n\n${normalizedInserted}`
  }
  return `${normalizedQuote}\n${normalizedInserted}`
}

export function normalizeHarnessToolParams(input: {
  toolName: string
  params: Record<string, any>
  userInput: string
  currentQuote?: ToolGovernanceInput['currentQuote']
  selectedSkillIds?: Set<string>
}) {
  const { toolName, params, currentQuote, userInput } = input
  if (toolName === 'create_file') {
    return normalizeCreateFileParams(params, input.selectedSkillIds)
  }

  if (toolName !== 'replace_editor_content' || !currentQuote) {
    return params
  }

  if (currentQuote.from < 0 || currentQuote.to < currentQuote.from) {
    return params
  }

  const normalizedParams = { ...params }
  const insertDirective = getQuotedInsertDirective(userInput)
  const rawContent = typeof normalizedParams.content === 'string'
    ? normalizedParams.content
    : typeof normalizedParams.replaceContent === 'string'
      ? normalizedParams.replaceContent
      : ''

  delete normalizedParams.startLine
  delete normalizedParams.endLine
  delete normalizedParams.searchContent
  delete normalizedParams.occurrence

  normalizedParams.from = currentQuote.from
  normalizedParams.to = currentQuote.to

  if (insertDirective && rawContent.trim().length > 0) {
    delete normalizedParams.replaceContent
    normalizedParams.content = buildQuotedInsertContent(insertDirective, rawContent, currentQuote.fullContent)
    return normalizedParams
  }

  if (normalizedParams.replaceContent !== undefined && normalizedParams.content === undefined) {
    normalizedParams.content = normalizedParams.replaceContent
  }

  return normalizedParams
}

export function evaluateHarnessToolPolicy(input: {
  toolName: string
  tool: Tool
  params: Record<string, any>
  userInput: string
  steps: ToolGovernanceInput['steps']
  intentPolicy: IntentPolicy
  linkedResources?: LinkedResource[]
}) {
  const { toolName, tool, params, userInput, steps, intentPolicy } = input
  const folderPath = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
  const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
  const articleStore = useArticleStore.getState()
  const linkedFiles = (input.linkedResources || []).filter(resource => !isLinkedFolder(resource))

  if (toolName === 'check_folder_exists' && /\.md$/i.test(folderPath)) {
    return { allowed: false, requiresConfirmation: false, reason: 'Markdown 文件路径应使用 read_markdown_file，而不是 check_folder_exists' }
  }

  if (toolName === 'update_markdown_file' && filePath && articleStore.activeFilePath === filePath) {
    return { allowed: false, requiresConfirmation: false, reason: '当前打开的文件应使用 replace_editor_content 进行修改，以避免覆盖编辑器中的实时内容' }
  }

  if ((toolName === 'read_markdown_file' || toolName === 'read_markdown_files_batch') && articleStore.activeFilePath) {
    const activePath = articleStore.activeFilePath
    if (toolName === 'read_markdown_file' && filePath === activePath) {
      return { allowed: false, requiresConfirmation: false, reason: '当前打开的文件应使用 get_editor_content 读取，以避免读取到过时的磁盘内容' }
    }
    if (toolName === 'read_markdown_files_batch' && Array.isArray(params.filePaths) && params.filePaths.includes(activePath)) {
      return { allowed: false, requiresConfirmation: false, reason: '批量读取包含当前打开的文件时，应先使用 get_editor_content 获取实时内容，再单独读取其他文件' }
    }
  }

  if (linkedFiles.some(resource => shouldKeepFocusOnLinkedNote(userInput, resource, toolName))) {
    return { allowed: false, requiresConfirmation: false, reason: '当前任务应聚焦关联笔记文件内容，不应切换到标签或记录工具' }
  }

  if (shouldBlockRepeatedNoteExploration(toolName, steps)) {
    return { allowed: false, requiresConfirmation: false, reason: '已经获得足够的笔记文件内容，无需重复列出或读取，请直接基于已有内容继续整理并给出最终答案' }
  }

  const safeGrepConvergenceMessage = getSafeGrepConvergenceMessage(
    toolName,
    params,
    steps.map(step => ({
      thought: '',
      ...step,
    })),
  )
  if (safeGrepConvergenceMessage) {
    return { allowed: false, requiresConfirmation: false, reason: safeGrepConvergenceMessage }
  }

  if (shouldBlockRedundantLinkedFileRead(toolName, params, linkedFiles)) {
    return { allowed: false, requiresConfirmation: false, reason: '当前关联文件的完整内容已在上下文中，无需再次读取或检查' }
  }

  return evaluateIntentAwareToolPolicy({
    toolName,
    category: tool.category,
    intentPolicy,
  })
}

async function buildConfirmationContext(toolName: string, params: Record<string, any>): Promise<ConfirmationPreviewContext> {
  const confirmContext: ConfirmationPreviewContext = {}

  if (toolName === 'delete_markdown_file' && typeof params.filePath === 'string') {
    confirmContext.filePath = params.filePath
    confirmContext.previewParams = { filePath: params.filePath }
  }

  if (toolName === 'delete_markdown_files_batch' && Array.isArray(params.filePaths)) {
    const filePaths = params.filePaths.filter((value): value is string => typeof value === 'string')
    confirmContext.previewParams = { count: filePaths.length, filesPreview: filePaths.slice(0, 10) }
  }

  if (toolName === 'delete_folder' && typeof params.folderPath === 'string') {
    try {
      const { getAllMarkdownFiles } = await import('@/lib/files')
      const folderPath = params.folderPath.replace(/\/+$/, '')
      const files = (await getAllMarkdownFiles())
        .map((file) => file.relativePath)
        .filter((path) => path === folderPath || path.startsWith(`${folderPath}/`))
      confirmContext.filePath = folderPath
      confirmContext.previewParams = { folderPath, fileCount: files.length, filesPreview: files.slice(0, 10) }
    } catch {
      confirmContext.previewParams = { folderPath: params.folderPath }
    }
  }

  if (toolName === 'delete_folders_batch' && Array.isArray(params.folderPaths)) {
    const folderPaths = params.folderPaths.filter((value): value is string => typeof value === 'string')
    confirmContext.previewParams = { count: folderPaths.length, foldersPreview: folderPaths.slice(0, 10) }
  }

  if (toolName === 'create_diagram_file') {
    const content = typeof params.content === 'string' ? params.content : ''
    confirmContext.previewParams = {
      kind: params.kind || 'drawio',
      fileName: params.fileName,
      folderPath: params.folderPath,
      contentPreview: content ? truncatePreviewContent(content) : 'Blank diagram template',
      openAfterCreate: params.openAfterCreate !== false,
    }
  }

  if (toolName === 'create_diagram_from_outline') {
    confirmContext.previewParams = {
      title: params.title,
      kind: params.kind || 'mindmap',
      layout: params.layout || 'mindmap',
      fileName: params.fileName,
      folderPath: params.folderPath,
      outline: typeof params.outline === 'string' ? params.outline : '',
    }
  }

  if (toolName === 'create_visual_report') {
    const content = typeof params.content === 'string' ? params.content : ''
    confirmContext.previewParams = {
      title: params.title,
      reportType: params.reportType || 'general',
      templateId: params.templateId || 'article-report',
      sourceFormat: params.sourceFormat || undefined,
      fileName: params.fileName,
      folderPath: params.folderPath,
      sourceLabel: params.sourceLabel,
      contentPreview: content ? truncatePreviewContent(content, 1600) : 'Structured sections only',
      openAfterCreate: params.openAfterCreate !== false,
    }
  }

  if (toolName === 'update_diagram_file' && typeof params.filePath === 'string' && typeof params.content === 'string') {
    confirmContext.filePath = params.filePath
    try {
      const { getFilePathOptions } = await import('@/lib/workspace')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const { path, baseDir } = await getFilePathOptions(params.filePath)
      const originalContent = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
      const changedRegion = extractChangedRegionPreview(originalContent, params.content)
      confirmContext.originalContent = changedRegion.original
      confirmContext.modifiedContent = changedRegion.modified
    } catch {
      confirmContext.previewParams = {
        filePath: params.filePath,
        contentPreview: truncatePreviewContent(params.content),
        expectedModifiedAt: params.expectedModifiedAt,
      }
    }
  }

  return confirmContext
}

function formatExecutionObservation(toolName: string, tool: Tool, result: ToolResult, dataRef?: string): string {
  const formattedObservation = formatToolObservation(toolName, result)
  let observation = formattedObservation || result.message || (result.success ? `工具 ${toolName} 执行成功。` : `工具 ${toolName} 执行失败：${result.error || '未知错误'}`)

  if (result.success && result.data && !formattedObservation) {
    if (Array.isArray(result.data)) {
      if (result.data.length > 0) observation += `\n\n数据详情：\n${JSON.stringify(result.data, null, 2)}`
    } else if (tool.category === 'mcp') {
      observation += `\n\nMCP 数据：\n${JSON.stringify(result.data, null, 2)}`
    } else {
      observation += `\n\n数据详情：\n${JSON.stringify(result.data, null, 2)}`
    }
  }

  if (dataRef) {
    observation += `\n\n[完整输出已保存到 ${dataRef}]`
  }

  return observation
}

function makeObservationFromResult(tool: Tool, result: ToolResult, observation: ToolObservation): string {
  const text = formatExecutionObservation(tool.name, tool, result, observation.dataRef)
  return text.length > 12000 ? `${text.slice(0, 12000)}\n\n[observation compressed]` : text
}

function isStaleMcpToolRegistryResult(execution: HarnessToolExecutionResult) {
  const result = execution.result
  const message = `${result.error || ''}\n${result.message || ''}\n${execution.observation.summary || ''}`
  return !result.success && /STALE_MCP_TOOL_REGISTRY/i.test(message)
}

async function executeToolWithRuntimeRecovery(input: {
  tool: Tool
  params: Record<string, any>
  context?: ToolExecutionContext
  runControl?: AgentRunControl
  onEvent?: ToolGovernanceInput['onEvent']
}): Promise<HarnessToolExecutionResult> {
  const executeOnce = () => input.runControl
    ? input.runControl.executeTool({ tool: input.tool, params: input.params, context: input.context })
    : executeHarnessTool(input.tool, input.params, input.context)

  let execution = await executeOnce()
  if (input.tool.category !== 'mcp' || !isStaleMcpToolRegistryResult(execution)) {
    return execution
  }

  input.onEvent?.('tool.execution.started', {
    toolName: input.tool.name,
    params: input.params,
    retry: {
      reason: 'STALE_MCP_TOOL_REGISTRY',
      recovery: 'refresh_mcp_tools',
    },
  })

  try {
    const { refreshMcpToolsForAgent } = await import('@/lib/mcp/agent-ready')
    await refreshMcpToolsForAgent()
  } catch {
    const { reloadMcpTools } = await import('@/lib/agent/tools')
    await reloadMcpTools()
  }

  execution = await executeOnce()
  if (execution.result.success) {
    return {
      ...execution,
      observation: {
        ...execution.observation,
        summary: `MCP 工具列表已刷新，重试成功。\n\n${execution.observation.summary}`,
        retryable: false,
      },
    }
  }

  return execution
}

export async function executeGovernedHarnessTool(input: ToolGovernanceInput): Promise<{
  execution: HarnessToolExecutionResult
  params: Record<string, any>
  observationText: string
  cached: boolean
  policyBlocked: boolean
  cancelled: boolean
}> {
  const { tool, userInput } = input
  let params = normalizeHarnessToolParams({
    toolName: tool.name,
    params: input.params || {},
    userInput,
    currentQuote: input.currentQuote,
    selectedSkillIds: input.selectedSkillIds,
  })

  const validation = validateToolInput(tool, params)
  if (!validation.valid) {
    const error = formatValidationErrors(tool.name, validation)
    return {
      execution: {
        result: { success: false, error },
        observation: {
          toolName: tool.name,
          success: false,
          summary: error,
          errorKind: 'validation',
          retryable: false,
        },
      },
      params,
      observationText: error,
      cached: false,
      policyBlocked: true,
      cancelled: false,
    }
  }
  params = validation.correctedParams || params

  if ((tool.category === 'web' || WEB_ACCESS_TOOL_NAMES.has(tool.name)) && !input.webSearchEnabled) {
    const message = '联网功能未开启。请先点击聊天输入框中的联网按钮，再重新发送需要联网的请求。'
    return {
      execution: {
        result: { success: false, error: 'WEB_ACCESS_DISABLED', message },
        observation: {
          toolName: tool.name,
          success: false,
          summary: message,
          errorKind: 'permission',
          retryable: false,
        },
      },
      params,
      observationText: message,
      cached: false,
      policyBlocked: true,
      cancelled: false,
    }
  }

  const cache = getGlobalToolCache()
  const cached = cache.get(tool.name, params)
  if (cached) {
    const result: ToolResult = {
      success: true,
      message: cached,
      data: { cached: true },
    }
    return {
      execution: {
        result,
        observation: {
          toolName: tool.name,
          success: true,
          summary: cached,
          retryable: false,
        },
      },
      params,
      observationText: `[cached] ${cached}`,
      cached: true,
      policyBlocked: false,
      cancelled: false,
    }
  }

  const policyCheck = evaluateHarnessToolPolicy({
    toolName: tool.name,
    tool,
    params,
    userInput,
    steps: input.steps,
    intentPolicy: input.intentPolicy,
    linkedResources: input.linkedResources,
  })
  if (!policyCheck.allowed) {
    const message = getPolicyAdjustmentMessage(tool.name, policyCheck.reason || '已调整工具选择')
    const adjusted = Boolean(
      policyCheck.reason?.includes('完整内容已在上下文中') ||
      policyCheck.reason?.includes('safe_grep 结果已截断'),
    )
    return {
      execution: {
        result: {
          success: adjusted,
          status: adjusted ? 'adjusted' : 'blocked',
          error: adjusted ? undefined : `BLOCKED_BY_POLICY: ${policyCheck.reason}`,
          message,
        },
        observation: {
          toolName: tool.name,
          success: adjusted,
          summary: message,
          errorKind: adjusted ? undefined : 'permission',
          retryable: false,
        },
      },
      params,
      observationText: message,
      cached: false,
      policyBlocked: !adjusted,
      cancelled: false,
    }
  }

  const harnessPolicy = input.runControl
    ? await input.runControl.authorizeTool({
        tool,
        params,
        context: input.context,
        selectedSkillIds: Array.from(input.selectedSkillIds || []),
        activeSkillIds: input.activeSkillIds || [],
        intentPolicy: input.intentPolicy,
        webSearchEnabled: input.webSearchEnabled,
      })
    : { allowed: true, requiresConfirmation: false, params }
  params = harnessPolicy.params || params

  if (harnessPolicy.allowed === false) {
    const reason = harnessPolicy.reason || '已被 Harness 工具策略阻止'
    const message = getPolicyAdjustmentMessage(tool.name, reason)
    return {
      execution: {
        result: {
          success: false,
          error: `BLOCKED_BY_HARNESS: ${reason}`,
          message,
        },
        observation: {
          toolName: tool.name,
          success: false,
          summary: message,
          errorKind: 'permission',
          retryable: false,
        },
      },
      params,
      observationText: message,
      cached: false,
      policyBlocked: true,
      cancelled: false,
    }
  }

  const requiresConfirmation = Boolean(harnessPolicy.requiresConfirmation) || policyCheck.requiresConfirmation || tool.requiresConfirmation
  if (requiresConfirmation && !input.requestConfirmation) {
    const error = '这个操作需要你的确认，当前先不执行。'
    return {
      execution: {
        result: { success: false, error: 'BLOCKED_BY_POLICY: 操作需要确认，但未配置确认回调' },
        observation: {
          toolName: tool.name,
          success: false,
          summary: error,
          errorKind: 'permission',
          retryable: false,
        },
      },
      params,
      observationText: error,
      cached: false,
      policyBlocked: true,
      cancelled: false,
    }
  }

  if (requiresConfirmation && input.requestConfirmation) {
    const confirmContext = await buildConfirmationContext(tool.name, params)
    input.onEvent?.('approval', { status: 'requested', toolName: tool.name, params, context: confirmContext })
    input.onEvent?.('confirmation.waiting', { toolName: tool.name, params, context: confirmContext })
    const confirmed = await input.requestConfirmation(tool.name, params, confirmContext)
    if (!confirmed) {
      input.onEvent?.('approval', { status: 'rejected', toolName: tool.name, params })
      input.onEvent?.('confirmation.resolved', { status: 'rejected', toolName: tool.name, params })
      const message = '用户取消了操作，任务已停止。'
      return {
        execution: {
          result: { success: false, error: '用户取消了操作' },
          observation: {
            toolName: tool.name,
            success: false,
            summary: message,
            errorKind: 'permission',
            retryable: false,
          },
        },
        params,
        observationText: message,
        cached: false,
        policyBlocked: true,
        cancelled: true,
      }
    }
    input.onEvent?.('approval', { status: 'confirmed', toolName: tool.name, params })
    input.onEvent?.('confirmation.resolved', { status: 'confirmed', toolName: tool.name, params })
  }

  const execution = await executeToolWithRuntimeRecovery({
    tool,
    params,
    context: input.context,
    runControl: input.runControl,
    onEvent: input.onEvent,
  })

  const observationText = makeObservationFromResult(tool, execution.result, execution.observation)
  if (execution.result.success) {
    cache.set(tool.name, params, observationText)
  } else {
    try {
      const { recordFailedAttempt } = await import('@/lib/agent/working-memory')
      recordFailedAttempt(tool.name, params, execution.result.error || execution.result.message || 'unknown')
    } catch {
      // Non-critical.
    }
  }

  const mutatesResources = Boolean(
    tool.capabilities?.some(capability => capability === 'write' || capability === 'delete' || capability === 'execute') ||
    isDestructiveTool(tool.name) ||
    isExecuteTool(tool.name),
  )
  if (execution.result.success && mutatesResources) {
    const dirty = extractResources(tool.name, params)
    if (dirty.length > 0) cache.invalidateByResources(dirty)
    if (isDestructiveTool(tool.name) || isExecuteTool(tool.name)) cache.invalidateAll()
  }

  return {
    execution,
    params,
    observationText,
    cached: false,
    policyBlocked: false,
    cancelled: false,
  }
}
