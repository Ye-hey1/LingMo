import { mcpIntegration } from './integration'
import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import type { MCPServerConfig } from './types'

let refreshPromise: Promise<void> | null = null

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

export async function ensureMcpReadyForAgent(): Promise<void> {
  const store = useMcpStore.getState()
  await store.initMcpData()
  await mcpIntegration.initialize()
  await refreshMcpToolsForAgent()
}
