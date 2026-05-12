import { Store } from '@tauri-apps/plugin-store'
import type { AgentApprovalScope, ConfirmationRecord, Tool } from './types'
import { getBaseToolName, getToolRiskLevel, isRecoverableWriteTool, READ_ONLY_TOOLS } from './tool-policy'
import { normalizeWorkspaceRelativePath } from '@/lib/workspace'

export interface PersistentAgentApprovalRule {
  id: string
  scope: Extract<AgentApprovalScope, 'always-tool' | 'always-folder' | 'always-readonly'>
  toolName?: string
  folderPath?: string
  createdAt: number
  lastUsedAt?: number
}

export interface PersistentAgentApprovalHistoryRecord extends ConfirmationRecord {
  id: string
  activeConversationId?: number | null
}

interface PersistentAgentApprovalConfig {
  rules: PersistentAgentApprovalRule[]
  history: PersistentAgentApprovalHistoryRecord[]
}

const STORE_FILE = 'agent-approvals.json'
const CONFIG_KEY = 'config'
const MAX_HISTORY = 200

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function loadStore(): Promise<Store> {
  return Store.load(STORE_FILE)
}

async function saveConfig(config: PersistentAgentApprovalConfig): Promise<void> {
  const store = await loadStore()
  await store.set(CONFIG_KEY, config)
  await (store as Store & { save?: () => Promise<void> }).save?.()
}

export async function loadPersistentAgentApprovalConfig(): Promise<PersistentAgentApprovalConfig> {
  const store = await loadStore()
  const config = await store.get<PersistentAgentApprovalConfig>(CONFIG_KEY)

  return {
    rules: Array.isArray(config?.rules) ? config.rules : [],
    history: Array.isArray(config?.history) ? config.history : [],
  }
}

function isReadOnlyToolName(toolName: string): boolean {
  const baseName = getBaseToolName(toolName)
  if (READ_ONLY_TOOLS.has(toolName) || READ_ONLY_TOOLS.has(baseName)) {
    return true
  }

  return ['read_', 'list_', 'search_', 'get_', 'fetch_', 'query_', 'describe_', 'inspect_', 'find_', 'safe_grep', 'safe_list_', 'web_search', 'web_fetch', 'web_extract']
    .some(prefix => baseName.startsWith(prefix) || toolName.startsWith(prefix))
}

function extractPathCandidates(params: Record<string, any>): string[] {
  const candidates = [
    params.filePath,
    params.folderPath,
    params.path,
    params.targetFolderPath,
    params.sourcePath,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (Array.isArray(params.filePaths)) {
    for (const filePath of params.filePaths) {
      if (typeof filePath === 'string' && filePath.trim()) {
        candidates.push(filePath)
      }
    }
  }

  return candidates.map(path => path.replace(/\\/g, '/'))
}

function folderFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const last = normalized.split('/').pop() || ''

  if (!normalized.includes('/')) {
    return /\.[a-z0-9]+$/i.test(last) ? '' : normalized
  }

  if (/\.[a-z0-9]+$/i.test(last)) {
    return normalized.split('/').slice(0, -1).join('/')
  }

  return normalized
}

async function getFolderApprovalPath(params: Record<string, any>): Promise<string | null> {
  for (const candidate of extractPathCandidates(params)) {
    const relative = await normalizeWorkspaceRelativePath(candidate)
    const folderPath = folderFromPath(relative)
    if (folderPath) {
      return folderPath
    }
  }

  return null
}

function isSameOrChildPath(candidate: string, folderPath: string): boolean {
  const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedFolder = folderPath.replace(/\\/g, '/').replace(/\/+$/, '')

  return normalizedCandidate === normalizedFolder || normalizedCandidate.startsWith(`${normalizedFolder}/`)
}

export function getPersistentApprovalOptions(
  toolName: string,
  tool: Tool | undefined,
  params: Record<string, any>
): AgentApprovalScope[] {
  const category = tool?.category || 'system'
  const risk = getToolRiskLevel(toolName, category)
  const options: AgentApprovalScope[] = []

  if (isReadOnlyToolName(toolName)) {
    options.push('always-readonly')
  }

  if (tool && isRecoverableWriteTool(toolName, tool.category) && risk === 'medium') {
    options.push('always-tool')

    if (extractPathCandidates(params).length > 0) {
      options.push('always-folder')
    }
  }

  return options
}

export async function findMatchingPersistentAgentApproval(
  toolName: string,
  tool: Tool | undefined,
  params: Record<string, any>
): Promise<PersistentAgentApprovalRule | null> {
  const config = await loadPersistentAgentApprovalConfig()
  const allowedScopes = new Set(getPersistentApprovalOptions(toolName, tool, params))

  for (const rule of config.rules) {
    if (!allowedScopes.has(rule.scope)) {
      continue
    }

    if (rule.scope === 'always-readonly' && isReadOnlyToolName(toolName)) {
      await touchRule(rule.id, config)
      return rule
    }

    if (rule.scope === 'always-tool' && rule.toolName === toolName) {
      await touchRule(rule.id, config)
      return rule
    }

    if (rule.scope === 'always-folder' && rule.toolName === toolName && rule.folderPath) {
      const paths = []
      for (const candidate of extractPathCandidates(params)) {
        paths.push(await normalizeWorkspaceRelativePath(candidate))
      }

      if (paths.some(path => isSameOrChildPath(path, rule.folderPath || ''))) {
        await touchRule(rule.id, config)
        return rule
      }
    }
  }

  return null
}

export async function matchesPersistentAgentApproval(
  toolName: string,
  tool: Tool | undefined,
  params: Record<string, any>
): Promise<boolean> {
  return Boolean(await findMatchingPersistentAgentApproval(toolName, tool, params))
}

async function touchRule(ruleId: string, config: PersistentAgentApprovalConfig): Promise<void> {
  const nextConfig = {
    ...config,
    rules: config.rules.map(rule =>
      rule.id === ruleId ? { ...rule, lastUsedAt: Date.now() } : rule
    ),
  }

  await saveConfig(nextConfig)
}

export async function rememberPersistentAgentApproval(
  scope: AgentApprovalScope,
  toolName: string,
  params: Record<string, any>
): Promise<PersistentAgentApprovalRule | null> {
  if (scope !== 'always-tool' && scope !== 'always-folder' && scope !== 'always-readonly') {
    return null
  }

  const config = await loadPersistentAgentApprovalConfig()
  const now = Date.now()
  let rule: PersistentAgentApprovalRule | null = null

  if (scope === 'always-readonly') {
    rule = {
      id: createId('readonly'),
      scope,
      createdAt: now,
    }
  } else if (scope === 'always-tool') {
    rule = {
      id: createId('tool'),
      scope,
      toolName,
      createdAt: now,
    }
  } else {
    const folderPath = await getFolderApprovalPath(params)
    if (!folderPath) {
      return null
    }

    rule = {
      id: createId('folder'),
      scope,
      toolName,
      folderPath,
      createdAt: now,
    }
  }

  const duplicate = config.rules.some(existing =>
    existing.scope === rule?.scope &&
    existing.toolName === rule?.toolName &&
    existing.folderPath === rule?.folderPath
  )

  if (!duplicate) {
    await saveConfig({
      ...config,
      rules: [...config.rules, rule],
    })
  }

  return rule
}

export async function recordPersistentApprovalHistory(
  record: ConfirmationRecord,
  activeConversationId?: number | null
): Promise<void> {
  const config = await loadPersistentAgentApprovalConfig()
  const historyRecord: PersistentAgentApprovalHistoryRecord = {
    ...record,
    id: createId('approval'),
    activeConversationId,
  }

  await saveConfig({
    ...config,
    history: [...config.history, historyRecord].slice(-MAX_HISTORY),
  })
}
