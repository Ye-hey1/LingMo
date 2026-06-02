/**
 * 增强确认机制模块
 *
 * 改进点：
 * 1. 批量确认 - 一次性确认多个操作
 * 2. 会话级允许 - "本会话全部允许此工具"
 * 3. 确认超时机制
 * 4. 确认历史记录
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfirmationScope = 'once' | 'session' | 'always'

export interface ConfirmationRequest {
  id: string
  toolName: string
  params: Record<string, any>
  context?: {
    previewParams?: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
  }
  timestamp: number
  expiresAt?: number
}

export interface ConfirmationResponse {
  requestId: string
  approved: boolean
  scope: ConfirmationScope
  timestamp: number
}

export interface BatchConfirmationRequest {
  id: string
  requests: ConfirmationRequest[]
  timestamp: number
  expiresAt?: number
}

export interface SessionPermission {
  toolName: string
  grantedAt: number
  expiresAt?: number
}

// ---------------------------------------------------------------------------
// Confirmation Manager
// ---------------------------------------------------------------------------

export class ConfirmationManager {
  private pendingRequests = new Map<string, ConfirmationRequest>()
  private sessionPermissions = new Map<string, SessionPermission>()
  private confirmationHistory: ConfirmationResponse[] = []
  private timeoutMs: number
  private onTimeout?: (requestId: string) => void

  constructor(options: {
    timeoutMs?: number
    onTimeout?: (requestId: string) => void
  } = {}) {
    this.timeoutMs = options.timeoutMs || 30000 // 30 seconds default
    this.onTimeout = options.onTimeout
  }

  // ---------------------------------------------------------------------------
  // Single confirmation
  // ---------------------------------------------------------------------------

  /**
   * 创建确认请求
   */
  createRequest(
    toolName: string,
    params: Record<string, any>,
    context?: ConfirmationRequest['context']
  ): ConfirmationRequest {
    const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const request: ConfirmationRequest = {
      id,
      toolName,
      params,
      context,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.timeoutMs,
    }

    this.pendingRequests.set(id, request)

    // 设置超时
    setTimeout(() => {
      if (this.pendingRequests.has(id)) {
        this.pendingRequests.delete(id)
        this.onTimeout?.(id)
      }
    }, this.timeoutMs)

    return request
  }

  /**
   * 响应确认请求
   */
  respond(requestId: string, approved: boolean, scope: ConfirmationScope = 'once'): boolean {
    const request = this.pendingRequests.get(requestId)
    if (!request) return false

    this.pendingRequests.delete(requestId)

    const response: ConfirmationResponse = {
      requestId,
      approved,
      scope,
      timestamp: Date.now(),
    }

    this.confirmationHistory.push(response)

    // 如果是会话级或永久级允许，记录权限
    if (approved && (scope === 'session' || scope === 'always')) {
      this.sessionPermissions.set(request.toolName, {
        toolName: request.toolName,
        grantedAt: Date.now(),
        expiresAt: scope === 'session' ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
      })
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Permission checking
  // ---------------------------------------------------------------------------

  /**
   * 检查工具是否已有会话级权限
   */
  hasSessionPermission(toolName: string): boolean {
    const permission = this.sessionPermissions.get(toolName)
    if (!permission) return false

    // 检查是否过期
    if (permission.expiresAt && Date.now() > permission.expiresAt) {
      this.sessionPermissions.delete(toolName)
      return false
    }

    return true
  }

  /**
   * 检查是否需要确认
   */
  requiresConfirmation(toolName: string): boolean {
    // 如果有会话级权限，不需要确认
    if (this.hasSessionPermission(toolName)) {
      return false
    }

    return true
  }

  /**
   * 授予会话级权限
   */
  grantSessionPermission(toolName: string): void {
    this.sessionPermissions.set(toolName, {
      toolName,
      grantedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    })
  }

  /**
   * 撤销会话级权限
   */
  revokeSessionPermission(toolName: string): void {
    this.sessionPermissions.delete(toolName)
  }

  /**
   * 清除所有会话权限
   */
  clearSessionPermissions(): void {
    this.sessionPermissions.clear()
  }

  // ---------------------------------------------------------------------------
  // Batch confirmation
  // ---------------------------------------------------------------------------

  /**
   * 创建批量确认请求
   */
  createBatchRequest(requests: Array<{
    toolName: string
    params: Record<string, any>
    context?: ConfirmationRequest['context']
  }>): BatchConfirmationRequest {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const batchRequests = requests.map(req => this.createRequest(req.toolName, req.params, req.context))

    return {
      id: batchId,
      requests: batchRequests,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.timeoutMs,
    }
  }

  /**
   * 批量响应
   */
  respondBatch(requestIds: string[], approved: boolean, scope: ConfirmationScope = 'once'): number {
    let successCount = 0
    for (const requestId of requestIds) {
      if (this.respond(requestId, approved, scope)) {
        successCount++
      }
    }
    return successCount
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * 获取确认历史
   */
  getHistory(limit = 50): ConfirmationResponse[] {
    return this.confirmationHistory.slice(-limit)
  }

  /**
   * 获取工具的确认统计
   */
  getToolStats(toolName: string): {
    totalRequests: number
    approved: number
    rejected: number
    lastUsed?: number
  } {
    const toolHistory = this.confirmationHistory.filter(h => {
      const request = this.pendingRequests.get(h.requestId)
      return request?.toolName === toolName
    })

    return {
      totalRequests: toolHistory.length,
      approved: toolHistory.filter(h => h.approved).length,
      rejected: toolHistory.filter(h => !h.approved).length,
      lastUsed: toolHistory.length > 0 ? toolHistory[toolHistory.length - 1].timestamp : undefined,
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * 清除过期的请求
   */
  cleanup(): void {
    const now = Date.now()
    for (const [id, request] of this.pendingRequests.entries()) {
      if (request.expiresAt && now > request.expiresAt) {
        this.pendingRequests.delete(id)
      }
    }

    // 清除过期的会话权限
    for (const [toolName, permission] of this.sessionPermissions.entries()) {
      if (permission.expiresAt && now > permission.expiresAt) {
        this.sessionPermissions.delete(toolName)
      }
    }
  }

  /**
   * 获取待处理的请求数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size
  }

  /**
   * 获取所有待处理的请求
   */
  getPendingRequests(): ConfirmationRequest[] {
    return Array.from(this.pendingRequests.values())
  }
}

// ---------------------------------------------------------------------------
// Confirmation UI helpers
// ---------------------------------------------------------------------------

/**
 * 格式化确认请求为用户友好的描述
 */
export function formatConfirmationDescription(request: ConfirmationRequest): string {
  const { toolName, params, context } = request

  // 根据工具类型生成描述
  if (toolName.includes('delete')) {
    const filePath = context?.filePath || params.filePath || params.folderPath
    return `删除 ${filePath || '文件'}`
  }

  if (toolName.includes('create')) {
    const fileName = params.fileName || params.name
    return `创建 ${fileName || '新文件'}`
  }

  if (toolName.includes('update') || toolName.includes('replace')) {
    const filePath = context?.filePath || params.filePath
    return `修改 ${filePath || '文件'}`
  }

  if (toolName.includes('move') || toolName.includes('rename')) {
    return `移动/重命名 ${params.filePath || '文件'}`
  }

  return `执行 ${toolName}`
}

/**
 * 生成确认按钮选项
 */
export function getConfirmationOptions(toolName: string): Array<{
  label: string
  scope: ConfirmationScope
  variant: 'default' | 'destructive' | 'outline'
}> {
  const options: Array<{
    label: string
    scope: ConfirmationScope
    variant: 'default' | 'destructive' | 'outline'
  }> = [
    { label: '允许这次', scope: 'once', variant: 'default' },
    { label: '本会话都允许', scope: 'session', variant: 'outline' },
  ]

  // 对于只读工具，添加"总是允许"选项
  if (toolName.startsWith('read_') || toolName.startsWith('get_') || toolName.startsWith('list_') || toolName.startsWith('search_')) {
    options.push({ label: '总是允许此工具', scope: 'always', variant: 'outline' })
  }

  return options
}
