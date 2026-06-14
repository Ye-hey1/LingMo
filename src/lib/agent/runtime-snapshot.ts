import type { Tool } from './types'
import type { SkillContent, SkillFileInfo } from '../skills/types'

export type RuntimeWarningLevel = 'info' | 'warn' | 'error'

export interface RuntimeWarning {
  id: string
  source: 'skill' | 'mcp' | 'tool' | 'permission' | 'runtime'
  level: RuntimeWarningLevel
  message: string
  detail?: string
}

export type SkillRuntimeSource = 'project' | 'global' | 'bundled' | 'remote' | 'unknown'

export interface SkillRuntimeEntry {
  id: string
  name: string
  description?: string
  source: SkillRuntimeSource
  baseDir?: string
  mainFile?: string
  enabled: boolean
  userInvocable: boolean
  selected: boolean
  allowedTools: string[]
  scriptCount: number
  referenceCount: number
  assetCount: number
  warnings: string[]
}

export interface SkillRuntimeSnapshot {
  forcedSkillIds: string[]
  activeSkillIds: string[]
  selectedSkillIds: string[]
  skills: SkillRuntimeEntry[]
  warnings: RuntimeWarning[]
}

export type McpRuntimeStatus =
  | 'disabled'
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'needs_auth'
  | 'needs_permission'

export interface McpRuntimeServerSnapshot {
  id: string
  name?: string
  status: McpRuntimeStatus
  selected: boolean
  enabled: boolean
  toolNames: string[]
  resourceCount: number
  staleTools: boolean
  lastConnected?: number
  lastAttemptedAt?: number
  error?: string
}

export interface McpRuntimeSnapshot {
  selectedServerIds: string[]
  connectedServerIds: string[]
  servers: McpRuntimeServerSnapshot[]
  toolNames: string[]
  warnings: RuntimeWarning[]
}

export interface ToolExposureEntry {
  name: string
  category?: Tool['category']
  risk?: Tool['risk']
  visible: boolean
  blocked: boolean
  reason?: string
  authorizedBy: string[]
}

export interface ToolExposureSnapshot {
  visible: ToolExposureEntry[]
  blocked: ToolExposureEntry[]
  maxVisibleTools: number
}

export interface RuntimePermissionSnapshot {
  allowWrite?: boolean
  allowExecute?: boolean
  allowDestructive?: boolean
  webSearchEnabled?: boolean
}

export interface AgentRuntimeSnapshot {
  runId: string
  createdAt: number
  skills: SkillRuntimeSnapshot
  mcp: McpRuntimeSnapshot
  tools: ToolExposureSnapshot
  permissions: RuntimePermissionSnapshot
  visibleToolNames: string[]
  warnings: RuntimeWarning[]
}

export function createInitialAgentRuntimeSnapshot(runId: string): AgentRuntimeSnapshot {
  return {
    runId,
    createdAt: Date.now(),
    skills: {
      forcedSkillIds: [],
      activeSkillIds: [],
      selectedSkillIds: [],
      skills: [],
      warnings: [],
    },
    mcp: {
      selectedServerIds: [],
      connectedServerIds: [],
      servers: [],
      toolNames: [],
      warnings: [],
    },
    tools: {
      visible: [],
      blocked: [],
      maxVisibleTools: 0,
    },
    permissions: {},
    visibleToolNames: [],
    warnings: [],
  }
}

export function mergeRuntimeWarnings(...groups: Array<RuntimeWarning[] | undefined>): RuntimeWarning[] {
  const warnings = new Map<string, RuntimeWarning>()
  for (const group of groups) {
    for (const warning of group || []) {
      warnings.set(warning.id, warning)
    }
  }
  return [...warnings.values()]
}

export function createRuntimeWarning(input: Omit<RuntimeWarning, 'id'> & { id?: string }): RuntimeWarning {
  return {
    ...input,
    id: input.id || `${input.source}:${input.level}:${input.message}`,
  }
}

export function buildSkillRuntimeSnapshot(input: {
  skills: SkillContent[]
  selectedSkillIds?: string[]
  forcedSkillIds?: string[]
  warnings?: RuntimeWarning[]
  fileInfoById?: Map<string, SkillFileInfo>
}): SkillRuntimeSnapshot {
  const selected = new Set([...(input.selectedSkillIds || []), ...(input.forcedSkillIds || [])])
  const skills: SkillRuntimeEntry[] = input.skills.map(skill => {
    const fileInfo = input.fileInfoById?.get(skill.metadata.id)
    const source: SkillRuntimeSource = skill.metadata.scope === 'project'
      ? 'project'
      : skill.metadata.scope === 'global'
        ? 'global'
        : 'unknown'
    return {
      id: skill.metadata.id,
      name: skill.metadata.name,
      description: skill.metadata.description,
      source,
      baseDir: fileInfo?.directory,
      mainFile: fileInfo?.mainFile,
      enabled: skill.metadata.enabled !== false,
      userInvocable: skill.metadata.userInvocable !== false,
      selected: selected.has(skill.metadata.id),
      allowedTools: skill.metadata.allowedTools || [],
      scriptCount: skill.scripts?.length || 0,
      referenceCount: skill.references?.length || 0,
      assetCount: skill.assets?.length || 0,
      warnings: [
        ...(fileInfo?.error ? [fileInfo.error] : []),
        ...(skill.metadata.runtimeProfile ? [] : []),
      ],
    }
  })

  return {
    forcedSkillIds: [...new Set(input.forcedSkillIds || [])],
    activeSkillIds: skills.filter(skill => skill.enabled).map(skill => skill.id),
    selectedSkillIds: [...selected],
    skills,
    warnings: input.warnings || [],
  }
}

export function buildToolExposureSnapshot(input: {
  tools: Tool[]
  visibleToolNames: string[]
  blockedToolNames?: Array<{ name: string; reason: string }>
  maxVisibleTools: number
}): ToolExposureSnapshot {
  const visibleNames = new Set(input.visibleToolNames)
  const blockedReasons = new Map((input.blockedToolNames || []).map(item => [item.name, item.reason]))
  const entries = input.tools.map(tool => ({
    name: tool.name,
    category: tool.category,
    risk: tool.risk,
    visible: visibleNames.has(tool.name),
    blocked: blockedReasons.has(tool.name),
    reason: blockedReasons.get(tool.name),
    authorizedBy: [],
  }))

  return {
    visible: entries.filter(entry => entry.visible && !entry.blocked),
    blocked: entries.filter(entry => entry.blocked),
    maxVisibleTools: input.maxVisibleTools,
  }
}

export function buildAgentRuntimeSnapshot(input: {
  runId: string
  createdAt?: number
  skills?: SkillRuntimeSnapshot
  mcp?: McpRuntimeSnapshot
  tools?: ToolExposureSnapshot
  permissions?: RuntimePermissionSnapshot
  warnings?: RuntimeWarning[]
}): AgentRuntimeSnapshot {
  const initial = createInitialAgentRuntimeSnapshot(input.runId)
  const skills = input.skills || initial.skills
  const mcp = input.mcp || initial.mcp
  const tools = input.tools || initial.tools
  const warnings = mergeRuntimeWarnings(input.warnings, skills.warnings, mcp.warnings)

  return {
    ...initial,
    createdAt: input.createdAt || initial.createdAt,
    skills,
    mcp,
    tools,
    permissions: input.permissions || {},
    visibleToolNames: tools.visible.map(tool => tool.name),
    warnings,
  }
}
