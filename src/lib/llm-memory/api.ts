import { invoke } from '@tauri-apps/api/core'

export type LlmMemoryPlatform = 'claude' | 'codex' | 'opencode' | 'lingmo'

export interface LlmMemoryPathOverrides {
  claudeHome?: string | null
  codexHome?: string | null
  codexProjectRoot?: string | null
  opencodeDbPath?: string | null
  lingmoHome?: string | null
}

export interface LlmMemorySessionListItem {
  platform: LlmMemoryPlatform
  sessionKey: string
  sessionId: string
  title: string
  preview: string
  updatedAt: string
  cwd: string
}

export interface LlmMemorySessionListResult {
  total: number
  items: LlmMemorySessionListItem[]
}

export interface LlmMemoryMessage {
  id: string
  role: string
  content: string
  timestamp?: string
  editable: boolean
  editTarget: string
}

export interface LlmMemorySessionDetail {
  platform: LlmMemoryPlatform
  sessionKey: string
  sessionId: string
  title: string
  cwd: string
  commands: Record<string, string>
  messages: LlmMemoryMessage[]
}

export interface LlmMemoryEditLogItem {
  id: number
  platform: LlmMemoryPlatform
  sessionKey: string
  sessionId: string
  cwd: string
  editTarget: string
  oldContent: string
  newContent: string
  createdAt: number
}

function normalizePaths(paths?: LlmMemoryPathOverrides | null) {
  if (!paths) return null

  return {
    claudeHome: paths.claudeHome?.trim() ? paths.claudeHome.trim() : null,
    codexHome: paths.codexHome?.trim() ? paths.codexHome.trim() : null,
    codexProjectRoot: paths.codexProjectRoot?.trim() ? paths.codexProjectRoot.trim() : null,
    opencodeDbPath: paths.opencodeDbPath?.trim() ? paths.opencodeDbPath.trim() : null,
    lingmoHome: paths.lingmoHome?.trim() ? paths.lingmoHome.trim() : null,
  }
}

export async function listLlmMemorySessions(params: {
  platform: LlmMemoryPlatform
  query?: string
  limit?: number
  offset?: number
  paths?: LlmMemoryPathOverrides | null
}) {
  return invoke<LlmMemorySessionListResult>('llm_memory_list_sessions', {
    platform: params.platform,
    query: params.query?.trim() || null,
    limit: params.limit ?? null,
    offset: params.offset ?? 0,
    paths: normalizePaths(params.paths),
  })
}

export async function getLlmMemorySessionDetail(params: {
  platform: LlmMemoryPlatform
  sessionKey: string
  paths?: LlmMemoryPathOverrides | null
}) {
  return invoke<LlmMemorySessionDetail>('llm_memory_get_session_detail', {
    platform: params.platform,
    sessionKey: params.sessionKey,
    paths: normalizePaths(params.paths),
  })
}

export async function updateLlmMemoryMessage(params: {
  platform: LlmMemoryPlatform
  editTarget: string
  newContent: string
  sessionKey?: string
  sessionId?: string
  cwd?: string
  paths?: LlmMemoryPathOverrides | null
}) {
  return invoke<string>('llm_memory_update_message', {
    platform: params.platform,
    editTarget: params.editTarget,
    newContent: params.newContent,
    sessionKey: params.sessionKey ?? null,
    sessionId: params.sessionId ?? null,
    cwd: params.cwd ?? null,
    paths: normalizePaths(params.paths),
  })
}

export async function deleteLlmMemorySession(params: {
  platform: LlmMemoryPlatform
  sessionKey: string
  paths?: LlmMemoryPathOverrides | null
}) {
  return invoke<string>('llm_memory_delete_session', {
    platform: params.platform,
    sessionKey: params.sessionKey,
    paths: normalizePaths(params.paths),
  })
}

export async function deleteLlmMemoryMessage(params: {
  platform: LlmMemoryPlatform
  editTarget: string
  sessionKey?: string
  sessionId?: string
  cwd?: string
  paths?: LlmMemoryPathOverrides | null
}) {
  return invoke<string>('llm_memory_delete_message', {
    platform: params.platform,
    editTarget: params.editTarget,
    sessionKey: params.sessionKey ?? null,
    sessionId: params.sessionId ?? null,
    cwd: params.cwd ?? null,
    paths: normalizePaths(params.paths),
  })
}

export async function listLlmMemoryEditLogs(params: {
  platform: LlmMemoryPlatform
  sessionKey: string
  limit?: number
}) {
  return invoke<LlmMemoryEditLogItem[]>('llm_memory_list_edit_logs', {
    platform: params.platform,
    sessionKey: params.sessionKey,
    limit: params.limit ?? null,
  })
}

export async function restoreLlmMemoryMessage(params: {
  logId: number
  paths?: LlmMemoryPathOverrides | null
}) {
  return invoke<string>('llm_memory_restore_message', {
    logId: params.logId,
    paths: normalizePaths(params.paths),
  })
}
