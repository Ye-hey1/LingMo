import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import type { MCPServerConfig, MCPServerState } from '@/lib/mcp/types'

const ANYSEARCH_MCP_URL = 'https://api.anysearch.com/mcp'

function isAnySearchServer(server: MCPServerConfig) {
  const args = (server.args || []).join(' ')
  const haystack = `${server.name} ${server.command || ''} ${args} ${server.url || ''}`.toLowerCase()
  return haystack.includes('anysearch') || haystack.includes('api.anysearch.com/mcp')
}

function extractAnySearchUrl(server: MCPServerConfig) {
  if (server.url?.includes('api.anysearch.com/mcp')) {
    return server.url
  }
  return (server.args || []).find(arg => typeof arg === 'string' && arg.includes('api.anysearch.com/mcp')) || ANYSEARCH_MCP_URL
}

function normalizeMcpServerConfig(server: MCPServerConfig): MCPServerConfig {
  if (server.type === 'streamable-http') {
    return server
  }

  if (isAnySearchServer(server)) {
    return {
      ...server,
      type: 'streamable-http',
      command: undefined,
      args: undefined,
      env: undefined,
      url: extractAnySearchUrl(server),
    }
  }

  return server
}

function normalizeMcpServerConfigs(servers: MCPServerConfig[]) {
  return servers.map(normalizeMcpServerConfig)
}

function hasNormalizedMcpServerChanges(
  originalServers: MCPServerConfig[],
  normalizedServers: MCPServerConfig[],
) {
  return normalizedServers.some((server, index) => server !== originalServers[index])
}

async function persistMcpConfigMigration(
  store: Store,
  originalServers: MCPServerConfig[],
  normalizedServers: MCPServerConfig[],
  originalSelectedServerIds: string[] | undefined,
  normalizedSelectedServerIds: string[],
) {
  const shouldPersistServers = hasNormalizedMcpServerChanges(originalServers, normalizedServers)
  const shouldPersistSelection = originalSelectedServerIds === undefined ||
    originalSelectedServerIds.length !== normalizedSelectedServerIds.length ||
    originalSelectedServerIds.some((id, index) => id !== normalizedSelectedServerIds[index])

  if (!shouldPersistServers && !shouldPersistSelection) {
    return
  }

  if (shouldPersistServers) {
    await store.set('mcp.servers', normalizedServers)
  }
  if (shouldPersistSelection) {
    await store.set('mcp.selectedServerIds', normalizedSelectedServerIds)
  }
  await store.save()
}

async function refreshAgentMcpTools() {
  try {
    const { refreshMcpToolsForAgent } = await import('@/lib/mcp/agent-ready')
    await refreshMcpToolsForAgent()
  } catch (error) {
    console.warn('[MCP] Failed to refresh agent tool registry:', error)
  }
}

interface MCPState {
  // 服务器配置列表
  servers: MCPServerConfig[]

  // 服务器运行时状态
  serverStates: Map<string, MCPServerState>

  // 当前选中的服务器（用于对话）
  selectedServerIds: string[]

  // 是否已初始化
  initialized: boolean

  // 服务器管理
  addServer: (server: MCPServerConfig) => void
  updateServer: (id: string, updates: Partial<MCPServerConfig>) => void
  deleteServer: (id: string) => void
  toggleServerEnabled: (id: string) => void

  // 服务器状态管理
  setServerState: (id: string, state: MCPServerState) => void
  getServerState: (id: string) => MCPServerState | undefined

  // 选中服务器管理
  setSelectedServers: (ids: string[]) => void
  toggleServerSelection: (id: string) => void
  clearSelectedServers: () => void

  // 初始化
  initMcpData: () => Promise<void>
  loadMcpConfig: () => Promise<void>
}

export const useMcpStore = create<MCPState>((set, get) => ({
  servers: [],
  serverStates: new Map(),
  selectedServerIds: [],
  initialized: false,
  
  addServer: async (server: MCPServerConfig) => {
    const store = await Store.load('store.json')
    const normalizedServer = normalizeMcpServerConfig(server)
    const servers = [...get().servers, normalizedServer]
    const selectedServerIds = normalizedServer.enabled
      ? Array.from(new Set([...get().selectedServerIds, normalizedServer.id]))
      : get().selectedServerIds
    await store.set('mcp.servers', servers)
    await store.set('mcp.selectedServerIds', selectedServerIds)
    await store.save()
    set({ servers, selectedServerIds })
    await refreshAgentMcpTools()
  },
  
  updateServer: async (id: string, updates: Partial<MCPServerConfig>) => {
    const store = await Store.load('store.json')
    const servers = get().servers.map(s =>
      s.id === id ? normalizeMcpServerConfig({ ...s, ...updates }) : s
    )
    await store.set('mcp.servers', servers)
    await store.save()
    set({ servers })
    await refreshAgentMcpTools()
  },
  
  deleteServer: async (id: string) => {
    const store = await Store.load('store.json')
    const servers = get().servers.filter(s => s.id !== id)
    const selectedServerIds = get().selectedServerIds.filter(sid => sid !== id)
    await store.set('mcp.servers', servers)
    await store.set('mcp.selectedServerIds', selectedServerIds)
    await store.save()
    
    // 同时清理状态和选中
    const serverStates = new Map(get().serverStates)
    serverStates.delete(id)
    
    set({ servers, serverStates, selectedServerIds })
    await refreshAgentMcpTools()
  },
  
  toggleServerEnabled: async (id: string) => {
    const store = await Store.load('store.json')
    const servers = get().servers.map(s =>
      s.id === id ? normalizeMcpServerConfig({ ...s, enabled: !s.enabled }) : s
    )
    const target = servers.find(server => server.id === id)
    const selectedServerIds = target?.enabled
      ? Array.from(new Set([...get().selectedServerIds, id]))
      : get().selectedServerIds.filter(serverId => serverId !== id)
    await store.set('mcp.servers', servers)
    await store.set('mcp.selectedServerIds', selectedServerIds)
    await store.save()
    set({ servers, selectedServerIds })
    await refreshAgentMcpTools()
  },
  
  setServerState: (id: string, state: MCPServerState) => {
    const serverStates = new Map(get().serverStates)
    serverStates.set(id, state)
    set({ serverStates })
  },
  
  getServerState: (id: string) => {
    return get().serverStates.get(id)
  },
  
  setSelectedServers: async (ids: string[]) => {
    const store = await Store.load('store.json')
    await store.set('mcp.selectedServerIds', ids)
    await store.save()
    set({ selectedServerIds: ids })
    await refreshAgentMcpTools()
  },
  
  toggleServerSelection: async (id: string) => {
    const selectedServerIds = get().selectedServerIds
    const newSelected = selectedServerIds.includes(id)
      ? selectedServerIds.filter(sid => sid !== id)
      : [...selectedServerIds, id]
    
    const store = await Store.load('store.json')
    await store.set('mcp.selectedServerIds', newSelected)
    await store.save()
    set({ selectedServerIds: newSelected })
    await refreshAgentMcpTools()
  },
  
  clearSelectedServers: async () => {
    const store = await Store.load('store.json')
    await store.set('mcp.selectedServerIds', [])
    await store.save()
    set({ selectedServerIds: [] })
    await refreshAgentMcpTools()
  },
  
  loadMcpConfig: async () => {
    try {
      const store = await Store.load('store.json')
      const servers = await store.get<MCPServerConfig[]>('mcp.servers')
      const rawServers = servers ?? []
      const selectedServerIds = await store.get<string[]>('mcp.selectedServerIds')
      const loadedServers = normalizeMcpServerConfigs(rawServers)
      const loadedSelection = selectedServerIds === undefined
        ? loadedServers.filter(server => server.enabled).map(server => server.id)
        : selectedServerIds.filter(id => loadedServers.some(server => server.id === id && server.enabled))

      await persistMcpConfigMigration(store, rawServers, loadedServers, selectedServerIds, loadedSelection)

      set({
        servers: loadedServers,
        selectedServerIds: loadedSelection,
      })
    } catch (error) {
      console.error('Failed to load MCP config:', error)
    }
  },

  initMcpData: async () => {
    // 如果已经初始化过，只加载配置不重新连接
    if (get().initialized) {
      await get().loadMcpConfig()
      return
    }

    try {
      const store = await Store.load('store.json')
      const servers = await store.get<MCPServerConfig[]>('mcp.servers')
      const rawServers = servers ?? []
      const selectedServerIds = await store.get<string[]>('mcp.selectedServerIds')
      const loadedServers = normalizeMcpServerConfigs(rawServers)
      const loadedSelection = selectedServerIds === undefined
        ? loadedServers.filter(server => server.enabled).map(server => server.id)
        : selectedServerIds.filter(id => loadedServers.some(server => server.id === id && server.enabled))

      await persistMcpConfigMigration(store, rawServers, loadedServers, selectedServerIds, loadedSelection)

      set({
        servers: loadedServers,
        selectedServerIds: loadedSelection,
        initialized: true,
      })
    } catch (error) {
      console.error('Failed to initialize MCP data:', error)
    }
  },
}))
