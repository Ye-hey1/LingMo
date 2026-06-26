import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import { callTool } from './tools'
import type { CallToolResult } from './types'

/**
 * 初始化 MCP
 * 连接所有启用的服务器
 */
async function initialize(): Promise<void> {
  const store = useMcpStore.getState()
  await mcpServerManager.connectEnabledServers(store.servers)
}

/**
 * 处理 AI 工具调用
 * 当 AI 决定调用工具时调用此方法
 */
async function handleToolCall(
  toolName: string,
  args: any
): Promise<{
  success: boolean
  result?: CallToolResult
  error?: string
}> {
  const store = useMcpStore.getState()

  // 查找工具所属的服务器
  let targetServerId: string | null = null

  for (const serverId of store.selectedServerIds) {
    const tools = mcpServerManager.getServerTools(serverId)
    if (tools.some(t => t.name === toolName)) {
      targetServerId = serverId
      break
    }
  }

  if (!targetServerId) {
    return {
      success: false,
      error: `Tool ${toolName} not found in selected servers`,
    }
  }

  try {
    const result = await callTool(targetServerId, toolName, args)
    return {
      success: !Boolean(result?.isError),
      result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 清理资源
 */
async function cleanup(): Promise<void> {
  await mcpServerManager.disconnectAll()
}

// 导出对象，保持 API 兼容
export const mcpIntegration = {
  initialize,
  handleToolCall,
  cleanup,
}
