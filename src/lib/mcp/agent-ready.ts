import { mcpIntegration } from './integration'
import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import type { MCPServerConfig } from './types'

let refreshPromise: Promise<void> | null = null
let warmupPromise: Promise<void> | null = null
let warmupError: string | null = null

const DEFAULT_AGENT_MCP_WARMUP_TIMEOUT_MS = 1200

export interface AgentMcpWarmupResult {
  ready: boolean
  timedOut: boolean
  degraded: boolean
  selectedServerCount: number
  connectedServerCount: number
  pendingServerCount: number
  failedServerCount: number
  toolGeneration: number
  error?: string
}

function getSelectedEnabledServerIds() {
  const store = useMcpStore.getState()
  return store.selectedServerIds.filter(id =>
    store.servers.some(server => server.id === id && server.enabled)
  )
}

function getWarmupSnapshot(timedOut: boolean): AgentMcpWarmupResult {
  const store = useMcpStore.getState()
  const selectedServerIds = getSelectedEnabledServerIds()
  const states = selectedServerIds.map(id => store.getServerState(id))

  const connectedServerCount = states.filter(state =>
    state?.status === 'connected' && state.staleTools !== true
  ).length
  const failedServerCount = states.filter(state =>
    state?.status === 'failed' ||
    state?.status === 'error' ||
    state?.status === 'needs_auth' ||
    state?.status === 'needs_permission'
  ).length
  const pendingServerCount = states.filter(state => (
    !state ||
    state.status === 'pending' ||
    state.status === 'connecting' ||
    state.status === 'disconnected' ||
    (state.status === 'connected' && state.staleTools === true)
  )).length
  const degraded = failedServerCount > 0 || Boolean(warmupError)

  return {
    ready: !timedOut && !degraded && pendingServerCount === 0,
    timedOut,
    degraded,
    selectedServerCount: selectedServerIds.length,
    connectedServerCount,
    pendingServerCount,
    failedServerCount,
    toolGeneration: mcpServerManager.getToolGeneration(),
    error: warmupError || undefined,
  }
}

function waitForWarmup(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return Promise.resolve(false)

  return new Promise(resolve => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(false)
    }, timeoutMs)

    promise.finally(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export async function refreshMcpToolsForAgent(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const { reloadMcpTools } = await import('@/lib/agent/tools')
    await reloadMcpTools()
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

function warmMcpRuntimeForAgent(): Promise<void> {
  if (warmupPromise) {
    return warmupPromise
  }

  warmupPromise = (async () => {
    warmupError = null
    const store = useMcpStore.getState()
    await store.initMcpData()
    await mcpIntegration.initialize()
    await refreshMcpToolsForAgent()
  })().catch(error => {
    warmupError = error instanceof Error ? error.message : String(error)
    console.warn('[Agent MCP] Background MCP warmup failed:', error)
  }).finally(() => {
    warmupPromise = null
  })

  return warmupPromise
}

export async function connectMcpServerForAgent(config: MCPServerConfig): Promise<void> {
  if (!config.enabled) {
    await refreshMcpToolsForAgent()
    return
  }

  await mcpServerManager.connectServer(config)
  await refreshMcpToolsForAgent()
}

export async function reconnectMcpServerForAgent(config: MCPServerConfig): Promise<void> {
  if (!config.enabled) {
    await mcpServerManager.disconnectServer(config.id).catch(() => {})
    await refreshMcpToolsForAgent()
    return
  }

  await mcpServerManager.reconnectServer(config)
  await refreshMcpToolsForAgent()
}

export async function ensureMcpReadyForAgent(options: {
  timeoutMs?: number
  background?: boolean
} = {}): Promise<AgentMcpWarmupResult> {
  const store = useMcpStore.getState()
  await store.initMcpData()

  if (getSelectedEnabledServerIds().length === 0) {
    warmupError = null
    await refreshMcpToolsForAgent()
    return getWarmupSnapshot(false)
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_MCP_WARMUP_TIMEOUT_MS
  const background = options.background !== false
  const promise = warmMcpRuntimeForAgent()

  if (!background) {
    await promise
    return getWarmupSnapshot(false)
  }

  const settled = await waitForWarmup(promise, timeoutMs)
  return getWarmupSnapshot(!settled)
}
