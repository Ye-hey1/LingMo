import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type {
  MCPServerConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  InitializeResult,
  MCPTool,
  MCPResource,
  CallToolResult,
} from './types'
import { normalizeCallToolResult } from './result'
import { resolveMcpEnv, resolveMcpHeaders } from './config-values'

/**
 * MCP 客户端
 * 支持 stdio、HTTP 和 Streamable HTTP 传输协议
 */
export class MCPClient {
  private config: MCPServerConfig
  private requestId = 0
  private isInitialized = false
  private sessionId: string | null = null
  
  constructor(config: MCPServerConfig) {
    this.config = config
  }
  
  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this.config.type === 'stdio') {
      await this.connectStdio()
    } else {
      await this.connectHttp()
    }
  }
  
  /**
   * 连接 stdio 服务器
   */
  private async connectStdio(): Promise<void> {
    try {
      await invoke('start_mcp_stdio_server', {
        serverId: this.config.id,
        command: this.config.command,
        args: this.config.args || [],
        env: resolveMcpEnv(this.config.env),
      })
    } catch (error) {
      throw new Error(`Failed to start stdio server: ${error}`)
    }
  }
  
  /**
   * 连接 HTTP 服务器
   */
  private async connectHttp(): Promise<void> {
    // HTTP 连接不需要特殊的启动过程
    // 只需要验证 URL 是否可访问
    if (!this.config.url) {
      throw new Error(`${this.getHttpTransportLabel()} server URL is required`)
    }
    this.sessionId = null
  }
  
  /**
   * 初始化协议
   */
  async initialize(): Promise<InitializeResult> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: this.getProtocolVersion(),
      capabilities: {},
      clientInfo: {
        name: 'lingmo',
        version: '1.0.0',
      },
    })
    
    this.isInitialized = true
    await this.sendNotification('notifications/initialized', {}).catch(() => {
      // Some legacy MCP servers do not require or accept initialized notifications.
    })
    return response as InitializeResult
  }
  
  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPTool[]> {
    // HTTP 服务器可能不需要初始化
    if (this.config.type === 'stdio' && !this.isInitialized) {
      await this.initialize()
    }
    
    // 尝试不同的方法名格式
    try {
      const response = await this.sendRequest('tools/list', {})
      return response.tools || []
    } catch {
      // 如果 tools/list 不支持，尝试 listTools
      try {
        const response = await this.sendRequest('listTools', {})
        return response.tools || []
      } catch {
        // 如果都不支持，返回空数组
        return []
      }
    }
  }
  
  /**
   * 调用工具
   */
  async callTool(name: string, args: any = {}): Promise<CallToolResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })
    
    return normalizeCallToolResult(response)
  }
  
  /**
   * 列出资源
   */
  async listResources(): Promise<MCPResource[]> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('resources/list', {})
    return response.resources || []
  }
  
  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('resources/read', { uri })
    return response.contents?.[0]?.text || ''
  }
  
  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.config.type === 'stdio') {
      try {
        await invoke('stop_mcp_server', { serverId: this.config.id })
      } catch {
        // 静默处理错误
      }
    }
    this.isInitialized = false
    this.sessionId = null
  }
  
  /**
   * 发送 JSON-RPC 请求
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }
    
    if (this.config.type === 'stdio') {
      return this.sendStdioRequest(request)
    } else {
      return this.sendHttpRequest(request)
    }
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    const request = {
      jsonrpc: '2.0' as const,
      method,
      params,
    }

    if (this.config.type === 'stdio') {
      await invoke<void>('send_mcp_notification', {
        serverId: this.config.id,
        message: JSON.stringify(request),
      })
      return
    }

    await this.sendHttpNotification(request)
  }
  
  /**
   * 发送 stdio 请求
   */
  private async sendStdioRequest(request: JSONRPCRequest): Promise<any> {
    try {
      const responseStr = await invoke<string>('send_mcp_message', {
        serverId: this.config.id,
        message: JSON.stringify(request),
      })
      
      const response: JSONRPCResponse = JSON.parse(responseStr)
      
      if (response.error) {
        throw new Error(formatJsonRpcError(response.error, 'Stdio MCP error'))
      }
      
      return response.result
    } catch (error) {
      throw new Error(`Stdio request failed: ${formatUnknownError(error)}`)
    }
  }
  
  /**
   * 发送 HTTP 请求
   */
  private async sendHttpRequest(request: JSONRPCRequest): Promise<any> {
    if (!this.config.url) {
      throw new Error(`${this.getHttpTransportLabel()} server URL is required`)
    }
    
    try {
      const customHeaders = this.getHttpHeaders()
      
      const response = await tauriFetch(this.config.url, {
        method: 'POST',
        headers: {
          ...this.buildHttpHeaders(customHeaders, this.getProtocolVersion()),
        },
        body: JSON.stringify(request),
      })

      this.captureSessionId(response)
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }
      
      // 检查响应的 Content-Type
      const contentType = response.headers.get('content-type')
      
      // 如果是 SSE 流式响应，需要特殊处理
      if (contentType?.includes('text/event-stream')) {
        // 对于流式响应，读取第一个事件
        const text = await response.text()
        
        // 解析 SSE 格式，支持多种格式：
        // 1. event: message\ndata: {...}\n\n
        // 2. data: {...}\n\n
        const lines = text.split('\n')
        let jsonData = ''
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            jsonData = line.substring(6) // 移除 "data: " 前缀
            break
          }
        }
        
        if (jsonData) {
          const jsonResponse: JSONRPCResponse = JSON.parse(jsonData)
          if (jsonResponse.error) {
            throw new Error(formatJsonRpcError(jsonResponse.error, 'HTTP MCP SSE error'))
          }
          return jsonResponse.result
        }
        throw new Error('Invalid SSE response format')
      }
      
      // 标准 JSON 响应
      const responseText = await response.text()
      if (!responseText.trim()) {
        throw new Error('Empty response from MCP server')
      }

      let jsonResponse: JSONRPCResponse
      try {
        jsonResponse = JSON.parse(responseText)
      } catch {
        const preview = responseText.slice(0, 120).replace(/\s+/g, ' ').trim()
        throw new Error(`Invalid JSON response from MCP server: ${preview || 'empty body'}`)
      }
      
      if (jsonResponse.error) {
        throw new Error(formatJsonRpcError(jsonResponse.error, 'HTTP MCP error'))
      }
      
      return jsonResponse.result
    } catch (error) {
      // 静默处理错误，不在控制台输出
      throw error
    }
  }

  private async sendHttpNotification(request: Omit<JSONRPCRequest, 'id'>): Promise<void> {
    if (!this.config.url) {
      throw new Error(`${this.getHttpTransportLabel()} server URL is required`)
    }

    const customHeaders = this.getHttpHeaders()

    const response = await tauriFetch(this.config.url, {
      method: 'POST',
      headers: {
        ...this.buildHttpHeaders(customHeaders, this.getProtocolVersion()),
      },
      body: JSON.stringify(request),
    })

    this.captureSessionId(response)

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }
  }

  private getHttpHeaders(): Record<string, string> {
    try {
      return resolveMcpHeaders(this.config.headers)
    } catch (error) {
      console.warn('Failed to parse custom headers:', error)
      return {}
    }
  }

  private buildHttpHeaders(customHeaders: Record<string, string>, protocolVersion: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': protocolVersion,
      ...customHeaders,
    }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }

    return headers
  }

  private captureSessionId(response: { headers?: { get(name: string): string | null } }) {
    const sessionId = response.headers?.get('mcp-session-id') || response.headers?.get('Mcp-Session-Id')
    if (sessionId && sessionId.trim()) {
      this.sessionId = sessionId.trim()
    }
  }

  private getHttpTransportLabel(): string {
    return this.config.type === 'streamable-http' ? 'Streamable HTTP' : 'HTTP'
  }

  private getProtocolVersion(): string {
    return this.config.type === 'streamable-http' ? '2025-03-26' : '2024-11-05'
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function formatJsonRpcError(
  error: NonNullable<JSONRPCResponse['error']>,
  fallback: string,
): string {
  const parts = [
    error.message,
    error.code != null ? `code=${error.code}` : '',
    error.data == null ? '' : `data=${formatUnknownError(error.data)}`,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join('\n') : fallback
}
