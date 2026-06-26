import { mcpIntegration } from './integration'
import { ensureMcpReadyForAgent } from './agent-ready'
import { useMcpStore } from '@/stores/mcp'

/**
 * 初始化 MCP
 * 在应用启动时调用
 */
export async function initMcp() {
  try {
    await useMcpStore.getState().initMcpData()
    await ensureMcpReadyForAgent({ timeoutMs: 600, background: true })
  } catch {
    // 静默处理初始化错误
  }
}

/**
 * 清理 MCP 资源
 * 在应用关闭时调用
 */
export async function cleanupMcp() {
  try {
    await mcpIntegration.cleanup()
    // MCP 清理成功
  } catch {
    // 静默处理清理错误
  }
}
