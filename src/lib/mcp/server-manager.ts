import { MCPClient } from './client'
import { normalizeCallToolResult } from './result'
import { useMcpStore } from '@/stores/mcp'
import { classifyMcpToolError } from './error-message'
import type {
  MCPServerConfig,
  MCPTool,
  MCPResource,
  ServerStatus,
  CallToolResult,
} from './types'

interface MCPBatchTestResult {
  total: number
  success: number
  failed: number
  results: Array<{
    serverId: string
    success: boolean
  }>
}

/**
 * MCP 服务器管理器
 * 管理多个 MCP 服务器的连接和工具调用
 */
class MCPServerManager {
  private clients: Map<string, MCPClient> = new Map()
  private toolGeneration = 0

  getToolGeneration(): number {
    return this.toolGeneration
  }

  private bumpToolGeneration(): number {
    this.toolGeneration += 1
    return this.toolGeneration
  }

  /**
   * 连接到服务器
   */
  async connectServer(config: MCPServerConfig): Promise<void> {
    const store = useMcpStore.getState()

    if (this.clients.has(config.id)) {
      await this.disconnectServer(config.id)
    }

    // 设置连接中状态
    const connectingGeneration = this.bumpToolGeneration()
    store.setServerState(config.id, {
      id: config.id,
      status: 'connecting',
      tools: [],
      resources: [],
      lastAttemptedAt: Date.now(),
      toolGeneration: connectingGeneration,
      staleTools: true,
    })

    try {
      const client = new MCPClient(config)
      await client.connect()

      // 初始化并获取工具列表
      await client.initialize()
      const tools = await client.listTools()

      // 尝试获取资源列表（某些服务器可能不支持）
      let resources: MCPResource[] = []
      try {
        resources = await client.listResources()
      } catch {
        // 静默处理，某些服务器不支持 resources
      }

      this.clients.set(config.id, client)

      // 更新连接成功状态
      const connectedGeneration = this.bumpToolGeneration()
      store.setServerState(config.id, {
        id: config.id,
        status: 'connected',
        tools,
        resources,
        connectedAt: Date.now(),
        lastToolRefreshAt: Date.now(),
        toolGeneration: connectedGeneration,
        staleTools: false,
      })

      // 更新最后连接时间
      store.updateServer(config.id, { lastConnected: Date.now() })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorKind = classifyMcpToolError(errorMessage)
      const failedStatus: ServerStatus = errorKind === 'auth'
        ? 'needs_auth'
        : errorKind === 'invalid_arguments'
          ? 'needs_permission'
          : 'failed'

      // 静默处理错误，设置错误状态
      const failedGeneration = this.bumpToolGeneration()
      store.setServerState(config.id, {
        id: config.id,
        status: failedStatus,
        tools: [],
        resources: [],
        error: errorMessage,
        lastAttemptedAt: Date.now(),
        toolGeneration: failedGeneration,
        staleTools: true,
        authRequired: failedStatus === 'needs_auth',
        permissionRequired: failedStatus === 'needs_permission',
      })

      throw error
    }
  }

  /**
   * 断开服务器连接
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.disconnect()
      this.clients.delete(serverId)
    }

    const store = useMcpStore.getState()
    const disconnectedGeneration = this.bumpToolGeneration()
    store.setServerState(serverId, {
      id: serverId,
      status: 'disconnected',
      tools: [],
      resources: [],
      toolGeneration: disconnectedGeneration,
      staleTools: true,
    })
  }

  /**
   * 重新连接服务器
   */
  async reconnectServer(config: MCPServerConfig): Promise<void> {
    await this.disconnectServer(config.id)
    await this.connectServer(config)
  }

  async connectEnabledServers(servers: MCPServerConfig[]): Promise<void> {
    const store = useMcpStore.getState()

    for (const server of servers) {
      if (!server.enabled) {
        continue
      }

      const state = store.getServerState(server.id)
      if (state?.status === 'connected' && state.staleTools !== true) {
        continue
      }

      try {
        await this.connectServer(server)
      } catch {
        // connectServer already stores the error on the server state for the UI.
      }
    }
  }

  /**
   * 获取服务器的所有工具
   */
  getServerTools(serverId: string): MCPTool[] {
    const store = useMcpStore.getState()
    const state = store.getServerState(serverId)
    return state?.tools || []
  }

  /**
   * 获取所有已连接服务器的工具
   */
  getAllTools(): Map<string, MCPTool[]> {
    const store = useMcpStore.getState()
    const toolsMap = new Map<string, MCPTool[]>()

    for (const server of store.servers) {
      if (server.enabled) {
        const state = store.getServerState(server.id)
        if (state?.status === 'connected') {
          toolsMap.set(server.id, state.tools)
        }
      }
    }

    return toolsMap
  }

  /**
   * 调用工具
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: any = {}
  ): Promise<CallToolResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`)
    }

    return normalizeCallToolResult(await client.callTool(toolName, args))
  }

  /**
   * 获取服务器资源
   */
  getServerResources(serverId: string): MCPResource[] {
    const store = useMcpStore.getState()
    const state = store.getServerState(serverId)
    return state?.resources || []
  }

  /**
   * 读取资源
   */
  async readResource(serverId: string, uri: string): Promise<string> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`)
    }

    return await client.readResource(uri)
  }

  /**
   * 断开所有服务器
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.keys()).map(id =>
      this.disconnectServer(id)
    )
    await Promise.all(promises)
  }

  /**
   * 测试服务器连接
   * 注意：测试时不会更新 store 中的服务器状态
   */
  async testConnection(config: MCPServerConfig): Promise<boolean> {
    try {
      const testConfig: MCPServerConfig = {
        ...config,
        id: `mcp-test-${config.id}-${Date.now()}`,
      }
      const client = new MCPClient(testConfig)
      try {
        await client.connect()
        await client.initialize()
        await client.listTools()
        await client.disconnect()
        return true
      } catch (error) {
        console.error('测试连接失败:', error)
        try {
          await client.disconnect()
        } catch {
          // 静默处理清理错误
        }
        throw error
      }
    } catch {
      // 静默处理测试失败
      return false
    }
  }

  async testConnections(configs: MCPServerConfig[]): Promise<MCPBatchTestResult> {
    const results = await Promise.all(
      configs.map(async (config) => ({
        serverId: config.id,
        success: await this.testConnection(config),
      }))
    )

    const success = results.filter(result => result.success).length

    return {
      total: results.length,
      success,
      failed: results.length - success,
      results,
    }
  }
}

// 导出单例实例
export const mcpServerManager = new MCPServerManager()
