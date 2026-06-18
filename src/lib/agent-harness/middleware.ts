import type { Tool } from '@/lib/agent/types'
import { buildAgentRuntimeSnapshot, buildSkillRuntimeSnapshot, buildToolExposureSnapshot, createRuntimeWarning } from '@/lib/agent/runtime-snapshot'
import type { McpRuntimeServerSnapshot, McpRuntimeStatus } from '@/lib/agent/runtime-snapshot'
import type { SkillContent, SkillMatchSummary } from '@/lib/skills/types'
import { skillManager } from '@/lib/skills'
import type {
  AgentBeforeModelInput,
  AgentBeforeModelOutput,
  AgentBeforeRunInput,
  AgentBeforeRunOutput,
  AgentBeforeToolInput,
  AgentBeforeToolOutput,
  AgentHarnessMiddleware,
  AgentRunMiddlewareState,
  HarnessToolExecutionResult,
} from './types'

const DEFAULT_MAX_VISIBLE_TOOLS = 46
const SUPPORT_TOOL_NAMES = new Set(['tool_search', 'select_skill', 'load_skill_content', 'get_current_time', 'list_agent_run_summaries'])
const BASE_ALWAYS_VISIBLE = [
  'get_editor_content',
  'replace_editor_content',
  'read_markdown_file',
  'read_markdown_files_batch',
  'safe_grep',
  'safe_read_file',
  'safe_list_files',
  'create_file',
  'get_current_time',
  'create_reminder',
  'list_reminders',
]

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
}

function mergeMiddlewareState(
  current: AgentRunMiddlewareState,
  patch?: Partial<AgentRunMiddlewareState>,
): AgentRunMiddlewareState {
  if (!patch) return current

  return {
    ...current,
    ...patch,
    skills: patch.skills
      ? {
          forcedSkillIds: patch.skills.forcedSkillIds || current.skills?.forcedSkillIds || [],
          activeSkillIds: patch.skills.activeSkillIds || current.skills?.activeSkillIds || [],
          selectedSkillIds: patch.skills.selectedSkillIds || current.skills?.selectedSkillIds || [],
          activeSkillMatches: patch.skills.activeSkillMatches || current.skills?.activeSkillMatches || [],
          warnings: patch.skills.warnings || current.skills?.warnings || [],
        }
      : current.skills,
    mcp: patch.mcp
      ? {
          selectedServerIds: patch.mcp.selectedServerIds || current.mcp?.selectedServerIds || [],
          connectedServerIds: patch.mcp.connectedServerIds || current.mcp?.connectedServerIds || [],
          toolNames: patch.mcp.toolNames || current.mcp?.toolNames || [],
          warnings: patch.mcp.warnings || current.mcp?.warnings || [],
        }
      : current.mcp,
    runtime: patch.runtime
      ? {
          snapshot: patch.runtime.snapshot || current.runtime?.snapshot,
          skills: patch.runtime.skills || current.runtime?.skills,
          mcp: patch.runtime.mcp || current.runtime?.mcp,
          tools: patch.runtime.tools || current.runtime?.tools,
        }
      : current.runtime,
    visibleToolNames: patch.visibleToolNames || current.visibleToolNames,
    toolExposureReasons: patch.toolExposureReasons || current.toolExposureReasons,
    promptSectionIds: uniqueStrings([...(current.promptSectionIds || []), ...(patch.promptSectionIds || [])]),
    persistedMemoryIds: uniqueStrings([...(current.persistedMemoryIds || []), ...(patch.persistedMemoryIds || [])]),
  }
}

export class AgentMiddlewareRuntime {
  private state: AgentRunMiddlewareState = {}
  private runId: string | undefined

  constructor(private readonly middlewares: AgentHarnessMiddleware[]) {}

  getState(): AgentRunMiddlewareState {
    return this.state
  }

  setState(patch: Partial<AgentRunMiddlewareState>) {
    this.state = mergeMiddlewareState(this.state, patch)
    if (this.runId) {
      bindMiddlewareState(this.runId, this.state)
    }
  }

  async beforeRun(input: AgentBeforeRunInput) {
    this.runId = input.runId
    bindMiddlewareState(input.runId, this.state)
    for (const middleware of this.middlewares) {
      const result = await middleware.beforeRun?.(input)
      if (result?.state) {
        this.setState(result.state)
      }
    }
  }

  async beforeModel(input: AgentBeforeModelInput): Promise<AgentBeforeModelOutput> {
    let tools = input.tools
    const promptSections: string[] = []

    for (const middleware of this.middlewares) {
      const result = await middleware.beforeModel?.({
        ...input,
        tools,
        state: this.getState(),
      })

      if (!result) continue
      if (result.tools) {
        tools = result.tools
      }
      if (result.promptSections?.length) {
        promptSections.push(...result.promptSections)
      }
      if (result.state) {
        this.setState(result.state)
      }
    }

    return { tools, promptSections, state: this.getState() }
  }

  async beforeTool(input: AgentBeforeToolInput): Promise<AgentBeforeToolOutput> {
    let output: AgentBeforeToolOutput = {
      allowed: true,
      requiresConfirmation: false,
      params: input.params,
      authorizedBy: [],
    }

    for (const middleware of this.middlewares) {
      const result = await middleware.beforeTool?.({
        ...input,
        params: output.params || input.params,
        state: this.getState(),
      })

      if (!result) continue
      output = {
        ...output,
        ...result,
        params: result.params || output.params,
        authorizedBy: uniqueStrings([...(output.authorizedBy || []), ...(result.authorizedBy || [])]),
      }
      if (result.state) {
        this.setState(result.state)
      }
      if (result.allowed === false) {
        break
      }
    }

    return output
  }

  async afterTool(input: AgentAfterToolInput): Promise<HarnessToolExecutionResult> {
    let execution = input.execution

    for (const middleware of this.middlewares) {
      const result = await middleware.afterTool?.({
        ...input,
        execution,
        state: this.getState(),
      })

      if (!result) continue
      if (result.execution) {
        execution = result.execution
      }
      if (result.state) {
        this.setState(result.state)
      }
    }

    return execution
  }

  async afterRun(input: AgentAfterRunInput) {
    try {
      for (const middleware of this.middlewares) {
        await middleware.afterRun?.({
          ...input,
          state: this.getState(),
        })
      }
    } finally {
      unbindMiddlewareState(input.runId)
    }
  }
}

type AgentAfterToolInput = Parameters<NonNullable<AgentHarnessMiddleware['afterTool']>>[0]
type AgentAfterRunInput = Parameters<NonNullable<AgentHarnessMiddleware['afterRun']>>[0]

function baseToolName(name: string) {
  return name.includes('__') ? name.split('__').pop() || name : name
}

function toolText(tool: Tool) {
  return [
    tool.name,
    baseToolName(tool.name),
    tool.description,
    tool.category,
    tool.capabilities?.join(' '),
    tool.parameters.map(param => `${param.name} ${param.description}`).join(' '),
  ].filter(Boolean).join(' ').toLowerCase()
}

function tokenize(input: string) {
  return uniqueStrings(
    input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_/-]+/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 2)
  )
}

function explainToolExposure(tool: Tool, input: AgentBeforeModelInput, state: AgentRunMiddlewareState) {
  let score = 0
  const reasons: string[] = []
  const name = tool.name
  const baseName = baseToolName(name)
  const text = toolText(tool)
  const tokens = tokenize(input.userInput)

  if (SUPPORT_TOOL_NAMES.has(name)) {
    score += 100
    reasons.push('support tool')
  }
  if (BASE_ALWAYS_VISIBLE.includes(name) || BASE_ALWAYS_VISIBLE.includes(baseName)) {
    score += 80
    reasons.push('base tool')
  }
  if (tool.category === 'mcp') {
    score += 20
    reasons.push('MCP tool')
  }
  if (tool.category === 'web' && input.webSearchEnabled) {
    score += 25
    reasons.push('web search enabled')
  }
  if (!input.webSearchEnabled && tool.category === 'web') {
    score -= 100
    reasons.push('web search disabled')
  }
  if (tool.risk === 'low') {
    score += 8
    reasons.push('low risk')
  }
  if (tool.capabilities?.includes('read')) {
    score += 6
    reasons.push('read capability')
  }
  if (tool.capabilities?.includes('write')) {
    if (input.intentPolicy?.allowWrite) {
      score += 10
      reasons.push('write intent allowed')
    } else {
      reasons.push('write intent not detected')
    }
  }
  if (tool.capabilities?.includes('execute')) {
    if (input.intentPolicy?.allowExecute) {
      score += 10
      reasons.push('execute intent allowed')
    } else {
      reasons.push('execute intent not detected')
    }
  }
  if (tool.capabilities?.includes('delete')) {
    if (input.intentPolicy?.allowDestructive) {
      score += 10
      reasons.push('destructive intent allowed')
    } else {
      reasons.push('destructive intent not detected')
    }
  }

  const lastTool = input.steps[input.steps.length - 1]?.action?.tool
  if (lastTool && name !== lastTool && baseName.includes(baseToolName(lastTool).split('_')[0])) {
    score += 8
    reasons.push(`related to previous tool: ${lastTool}`)
  }

  const selectedSkills = new Set(input.selectedSkillIds)
  for (const skillId of selectedSkills) {
    const allowed = state.skills?.activeSkillMatches.find(match => match.id === skillId)
    if (allowed && text.includes(allowed.name.toLowerCase())) {
      score += 15
      reasons.push(`matched selected skill: ${allowed.name}`)
    }
  }

  const matchedTokens: string[] = []
  for (const token of tokens) {
    if (text.includes(token)) {
      score += 3
      if (matchedTokens.length < 4) matchedTokens.push(token)
    }
  }
  if (matchedTokens.length) reasons.push(`matched user tokens: ${matchedTokens.join(', ')}`)

  if (reasons.length === 0) reasons.push('low relevance to this turn')

  return { score, reasons: uniqueStrings(reasons) }
}

function buildToolScopeSection(tools: Tool[], state: AgentRunMiddlewareState) {
  const names = tools.map(tool => tool.name)
  const mcpTools = tools.filter(tool => tool.category === 'mcp').map(tool => tool.name)

  return [
    '## Harness Tool Scope',
    '',
    'Only the tools listed in the current tool protocol are visible for this model step.',
    'Do not call tools that are not listed. If a needed tool is missing, explain the missing capability or use the closest visible tool.',
    '',
    `Visible tools (${names.length}): ${names.join(', ') || 'none'}`,
    mcpTools.length > 0 ? `MCP tools exposed this step: ${mcpTools.join(', ')}` : '',
    state.mcp?.warnings?.length ? `MCP warnings: ${state.mcp.warnings.join('; ')}` : '',
  ].filter(Boolean).join('\n')
}

function formatSkillMetadataLine(match: SkillMatchSummary) {
  const reason = match.reasons?.length ? ` Reasons: ${match.reasons.slice(0, 2).join('; ')}.` : ''
  return `- ${match.id}: ${match.name} - ${match.description || ''} Match: ${match.confidence} (${match.score.toFixed(2)}).${reason}`
}

function buildSkillSection(input: AgentBeforeModelInput, state: AgentRunMiddlewareState) {
  const skills = state.skills
  if (!skills?.activeSkillMatches?.length) return ''

  const selected = new Set(input.selectedSkillIds)
  const selectedMatches = skills.activeSkillMatches.filter(match => selected.has(match.id))
  const candidateMatches = skills.activeSkillMatches.filter(match => !selected.has(match.id)).slice(0, 5)

  const lines = [
    '## Harness Skill Scope',
    '',
    'Skills are runtime guidance packages, not callable tools. Use real tools to act.',
  ]

  if (selectedMatches.length > 0) {
    lines.push('', 'Selected skills:', ...selectedMatches.map(formatSkillMetadataLine))
  }

  if (candidateMatches.length > 0 && selectedMatches.length === 0) {
    lines.push('', 'Relevant skill candidates:', ...candidateMatches.map(formatSkillMetadataLine))
    lines.push('', 'Use select_skill only when one candidate is clearly needed. Slash-invoked skills are already selected.')
  }

  if (skills.warnings?.length) {
    lines.push('', `Skill warnings: ${skills.warnings.join('; ')}`)
  }

  return lines.join('\n')
}

function mapMcpRuntimeStatus(status?: string): McpRuntimeStatus {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'connecting':
      return 'connecting'
    case 'failed':
    case 'error':
      return 'failed'
    case 'needs_auth':
      return 'needs_auth'
    case 'needs_permission':
      return 'needs_permission'
    case 'disabled':
      return 'disabled'
    default:
      return 'pending'
  }
}

function isObservationLarge(execution: HarnessToolExecutionResult) {
  return execution.observation.summary.length > 1800
}

function compactObservationSummary(summary: string, maxChars = 1800) {
  const cleaned = summary.replace(/\s+/g, ' ').trim()
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned
}

export function createSkillMcpMiddleware(): AgentHarnessMiddleware {
  return {
    name: 'skill-mcp-runtime',

    async beforeRun(input: AgentBeforeRunInput): Promise<AgentBeforeRunOutput> {
      const warnings: string[] = []
      let activeSkillMatches: SkillMatchSummary[] = []
      let forcedSkillIds = uniqueStrings(input.forcedSkillIds || [])
      let runtimeSkills: SkillContent[] = []

      try {
        const { useSkillsStore } = await import('@/stores/skills')
        const { ensureSkillsReadyForAgent } = await import('@/lib/skills/agent-ready')
        const { skillManager } = await import('@/lib/skills')
        const skillsStore = useSkillsStore.getState()
        await ensureSkillsReadyForAgent()
        runtimeSkills = await skillsStore.getEnabledSkills()

        const forcedMatches = forcedSkillIds
          .map(skillId => skillManager.findSkill(skillId))
          .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
          .map(skill => ({
            id: skill.metadata.id,
            name: skill.metadata.name,
            description: skill.metadata.description,
            score: 1,
            confidence: 'high' as const,
            reasons: ['用户通过 /skill 显式调用'],
            matchedSignals: [],
          }))

        forcedSkillIds = forcedMatches.map(match => match.id)

        const autoMatches = skillsStore.enabled && skillsStore.autoMatch
          ? (await skillManager.matchRelevantSkillScores(input.userInput, 5)).map(score => skillManager.toMatchSummary(score))
          : []

        const matchesById = new Map<string, SkillMatchSummary>()
        for (const match of [...forcedMatches, ...autoMatches]) {
          if (!matchesById.has(match.id)) {
            matchesById.set(match.id, match)
          }
        }
        activeSkillMatches = [...matchesById.values()]
      } catch (error) {
        warnings.push(`Skill load failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      const mcpWarnings: string[] = []
      let selectedServerIds: string[] = []
      const connectedServerIds: string[] = []
      let mcpToolNames: string[] = []
      let mcpRuntimeServers: McpRuntimeServerSnapshot[] = []
      let mcpToolGeneration: number | undefined

      try {
        const { useMcpStore } = await import('@/stores/mcp')
        const { mcpIntegration } = await import('@/lib/mcp/integration')
        const { mcpServerManager } = await import('@/lib/mcp/server-manager')
        const { reloadMcpTools, getAllToolsSync } = await import('@/lib/agent/tools')
        const mcpStore = useMcpStore.getState()
        await mcpStore.initMcpData()
        selectedServerIds = [...mcpStore.selectedServerIds]
        await mcpIntegration.initialize()
        await reloadMcpTools()
        mcpToolGeneration = mcpServerManager.getToolGeneration()
        const serverById = new Map(useMcpStore.getState().servers.map(server => [server.id, server]))
        const serverLabel = (serverId: string) => {
          const name = serverById.get(serverId)?.name
          return name ? `${name} (${serverId})` : serverId
        }

        for (const serverId of selectedServerIds) {
          const state = useMcpStore.getState().getServerState(serverId)
          if (state?.status === 'connected') {
            connectedServerIds.push(serverId)
            if (!state.tools?.length) {
              mcpWarnings.push(`${serverLabel(serverId)}: connected but returned no MCP tools`)
            }
          } else if (state?.error) {
            mcpWarnings.push(`${serverLabel(serverId)}: ${state.error}`)
          } else {
            mcpWarnings.push(`${serverLabel(serverId)}: ${state?.status || 'not connected'}`)
          }
        }

        mcpRuntimeServers = selectedServerIds.map(serverId => {
          const state = useMcpStore.getState().getServerState(serverId)
          const server = serverById.get(serverId)
          return {
            id: serverId,
            name: server?.name || serverId,
            status: mapMcpRuntimeStatus(state?.status),
            selected: true,
            enabled: server?.enabled !== false,
            toolNames: state?.tools?.map((tool: { name: string }) => tool.name) || [],
            resourceCount: state?.resources?.length || 0,
            staleTools: state?.staleTools === true,
            lastConnected: state?.connectedAt,
            lastAttemptedAt: state?.lastAttemptedAt || state?.connectedAt,
            error: state?.error,
          }
        })

        mcpToolNames = getAllToolsSync()
          .filter(tool => tool.category === 'mcp')
          .map(tool => tool.name)

        if (selectedServerIds.length > 0 && mcpToolNames.length === 0) {
          mcpWarnings.push('Selected MCP servers exposed no agent tools this turn')
        }

        for (const [serverId, tools] of mcpServerManager.getAllTools()) {
          if (tools.length > 0 && !connectedServerIds.includes(serverId)) {
            connectedServerIds.push(serverId)
          }
        }
      } catch (error) {
        mcpWarnings.push(`MCP load failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      return {
        state: {
          skills: {
            forcedSkillIds,
            activeSkillIds: activeSkillMatches.map(match => match.id),
            selectedSkillIds: forcedSkillIds,
            activeSkillMatches,
            warnings,
          },
          mcp: {
            selectedServerIds,
            connectedServerIds,
            toolNames: mcpToolNames,
            warnings: mcpWarnings,
          },
          runtime: {
            skills: buildSkillRuntimeSnapshot({
              skills: runtimeSkills,
              selectedSkillIds: forcedSkillIds,
              forcedSkillIds,
              warnings: warnings.map(message => createRuntimeWarning({
                source: 'skill',
                level: 'warn',
                message,
              })),
            }),
            mcp: {
              selectedServerIds,
              connectedServerIds,
              servers: mcpRuntimeServers,
              toolNames: mcpToolNames,
              toolGeneration: mcpToolGeneration,
              warnings: mcpWarnings.map(message => createRuntimeWarning({
                source: 'mcp',
                level: 'warn',
                message,
              })),
            },
            tools: {
              visible: [],
              blocked: [],
              maxVisibleTools: DEFAULT_MAX_VISIBLE_TOOLS,
            },
          },
        },
      }
    },

    beforeModel(input: AgentBeforeModelInput): AgentBeforeModelOutput {
      const currentState = input.state
      const maxTools = DEFAULT_MAX_VISIBLE_TOOLS
      const forcedToolNames = new Set([
        ...SUPPORT_TOOL_NAMES,
        ...BASE_ALWAYS_VISIBLE,
      ])

      for (const tool of input.tools) {
        if (tool.category === 'mcp') {
          forcedToolNames.add(tool.name)
        }
      }

      for (const skillId of input.selectedSkillIds) {
        const skill = skillManager.findSkill(skillId)
        for (const toolName of skill?.metadata.allowedTools || []) {
          forcedToolNames.add(toolName)
        }
      }

      const scored = input.tools.map(tool => ({
        tool,
        ...explainToolExposure(tool, input, currentState),
      }))
      scored.sort((a, b) => b.score - a.score)

      const selected: Tool[] = []
      const selectedNames = new Set<string>()
      const addTool = (tool?: Tool) => {
        if (!tool || selectedNames.has(tool.name)) return
        selected.push(tool)
        selectedNames.add(tool.name)
      }

      for (const name of forcedToolNames) {
        addTool(input.tools.find(tool => tool.name === name || baseToolName(tool.name) === name))
      }
      for (const { tool, score } of scored) {
        if (selected.length >= maxTools) break
        if (score < 0 && !forcedToolNames.has(tool.name)) continue
        addTool(tool)
      }

      const visibleReasons: Record<string, string[]> = {}
      const hiddenReasons: Record<string, string[]> = {}
      const selectedNameSet = new Set(selected.map(tool => tool.name))
      const scoreByToolName = new Map(scored.map(item => [item.tool.name, item]))
      for (const tool of selected) {
        const explanation = scoreByToolName.get(tool.name)
        const reasons = explanation?.reasons || ['selected']
        visibleReasons[tool.name] = forcedToolNames.has(tool.name) || forcedToolNames.has(baseToolName(tool.name))
          ? uniqueStrings([...reasons, 'forced visible'])
          : reasons
      }

      for (const { tool, score, reasons } of scored) {
        if (selectedNameSet.has(tool.name)) continue
        const hidden = [...reasons]
        if (score < 0) hidden.push('score below exposure threshold')
        if (selected.length >= maxTools) hidden.push('max visible tool count reached')
        hiddenReasons[tool.name] = uniqueStrings(hidden)
      }

      const promptSections = [
        buildToolScopeSection(selected, currentState),
        buildSkillSection(input, currentState),
      ].filter(Boolean)
      const toolExposure = buildToolExposureSnapshot({
        tools: input.tools,
        visibleToolNames: selected.map(tool => tool.name),
        exposureReasons: {
          ...hiddenReasons,
          ...visibleReasons,
        },
        maxVisibleTools: maxTools,
      })

      return {
        tools: selected,
        promptSections,
        state: {
          visibleToolNames: selected.map(tool => tool.name),
          toolExposureReasons: {
            iteration: input.iteration,
            visible: visibleReasons,
            hidden: hiddenReasons,
            maxVisibleTools: maxTools,
          },
          promptSectionIds: ['tool-scope', 'skill-scope'],
          runtime: {
            tools: toolExposure,
            snapshot: buildAgentRuntimeSnapshot({
              runId: input.runId,
              skills: currentState.runtime?.skills,
              mcp: currentState.runtime?.mcp,
              tools: toolExposure,
              permissions: {
                allowWrite: input.intentPolicy?.allowWrite,
                allowExecute: input.intentPolicy?.allowExecute,
                allowDestructive: input.intentPolicy?.allowDestructive,
                webSearchEnabled: input.webSearchEnabled,
              },
            }),
          },
        },
      }
    },

    beforeTool(input: AgentBeforeToolInput): AgentBeforeToolOutput {
      const state = input.state
      const visibleToolNames = new Set(state.visibleToolNames || [])
      if (visibleToolNames.size > 0 && !visibleToolNames.has(input.tool.name)) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `工具 ${input.tool.name} 不在本轮 Harness 暴露的工具范围内`,
        }
      }

      const authorizedBy: string[] = []
      const selectedSkillIds = new Set(input.selectedSkillIds)
      for (const skillId of selectedSkillIds) {
        const match = state.skills?.activeSkillMatches.find(item => item.id === skillId)
        if (match) {
          authorizedBy.push(match.name)
        }
      }

      const isSkillAuthorized = input.tool.requiresConfirmation === false
        || input.tool.risk === 'low'
        || authorizedBy.length > 0

      return {
        allowed: true,
        requiresConfirmation: input.tool.requiresConfirmation && !isSkillAuthorized,
        authorizedBy,
      }
    },

    afterTool(input: AgentAfterToolInput) {
      let execution = input.execution
      if (isObservationLarge(execution)) {
        execution = {
          ...execution,
          observation: {
            ...execution.observation,
            summary: compactObservationSummary(execution.observation.summary),
          },
        }
      }

      return {
        execution,
      }
    },

    async afterRun(input) {
      try {
        const { recordToolUsage, recordFileAccess, recordFailedAttempt } = await import('@/lib/agent/working-memory')
        for (const ref of input.snapshot.observationRefs) {
          if (ref.summary) {
            await recordToolUsage('harness_observation')
          }
        }
        for (const ref of input.snapshot.draftRefs) {
          await recordFileAccess(ref.path)
        }
        if (input.snapshot.status === 'failed' && input.snapshot.finalAnswer) {
          await recordFailedAttempt('agent_run', { runId: input.runId }, input.snapshot.finalAnswer)
        }
      } catch {
        // Persistence is best-effort.
      }
    },
  }
}

const runtimeStateByRunId = new Map<string, AgentRunMiddlewareState>()

export function bindMiddlewareState(runId: string, state: AgentRunMiddlewareState) {
  runtimeStateByRunId.set(runId, state)
}

export function unbindMiddlewareState(runId: string) {
  runtimeStateByRunId.delete(runId)
}
