import { create } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, deleteChats, deleteChatsByConversationId, initChatsDb, insertChat, updateChat, updateChatsInsertedById, getAllChats, deleteAllChats, insertChats, updateChatCondensedContent, getChatsByConversation } from '@/db/chats'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { s3Upload, s3Delete, s3HeadObject, s3Download } from '@/lib/sync/s3'
import { webdavUpload, webdavDelete, webdavHeadObject, webdavDownload } from '@/lib/sync/webdav'
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { getRemoteFileContent } from '@/lib/sync/remote-file';
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';
import { type AgentEvent, type AgentState, type ToolCall } from '@/lib/agent'
import type { ResearchProgressView } from '@/lib/research/progress-status'
import type { LinkedResource } from '@/lib/files'
import type { Conversation } from '@/db/conversations'
import { S3Config, WebDAVConfig } from '@/types/sync'

const SYNC_PATH = '.data'
const SYNC_FILENAME = 'chats.json'

async function getSyncMethod(store: Store): Promise<string> {
  return (await store.get<string>('primaryBackupMethod')) || 'github'
}

async function uploadChatsToRemote(chats: Chat[]): Promise<unknown> {
  const store = await Store.load('store.json')
  const method = await getSyncMethod(store)
  const fullPath = `${SYNC_PATH}/${SYNC_FILENAME}`
  const base64Data = Buffer.from(JSON.stringify(chats, null, 2)).toString('base64')
  const jsonData = JSON.stringify(chats, null, 2)

  switch (method) {
    case 'github': {
      const repo = await getSyncRepoName('github')
      const files = await githubGetFiles({ path: fullPath, repo })
      return uploadGithubFile({ file: base64Data, repo, path: fullPath, sha: files?.sha })
    }
    case 'gitee': {
      const repo = await getSyncRepoName('gitee')
      const files = await giteeGetFiles({ path: fullPath, repo })
      return uploadGiteeFile({ file: base64Data, repo, path: fullPath, sha: files?.sha })
    }
    case 'gitlab': {
      const repo = await getSyncRepoName('gitlab')
      const files = await gitlabGetFiles({ path: SYNC_PATH, repo })
      const chatFile = Array.isArray(files)
        ? files.find(file => file.name === SYNC_FILENAME)
        : (files?.name === SYNC_FILENAME ? files : undefined)
      return uploadGitlabFile({ file: base64Data, repo, path: SYNC_PATH, filename: SYNC_FILENAME, sha: chatFile?.sha || '' })
    }
    case 'gitea': {
      const repo = await getSyncRepoName('gitea')
      const files = await giteaGetFiles({ path: SYNC_PATH, repo })
      const chatFile = Array.isArray(files)
        ? files.find(file => file.name === SYNC_FILENAME)
        : (files?.name === SYNC_FILENAME ? files : undefined)
      return uploadGiteaFile({ file: base64Data, repo, path: SYNC_PATH, filename: SYNC_FILENAME, sha: chatFile?.sha || '' })
    }
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      if (!config) return null
      const key = fullPath
      if (await s3HeadObject(config, key)) {
        await s3Delete(config, key)
      }
      return s3Upload(config, key, jsonData)
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!config) return null
      const key = fullPath
      if (await webdavHeadObject(config, key)) {
        await webdavDelete(config, key)
      }
      return webdavUpload(config, key, jsonData)
    }
    default:
      return null
  }
}

async function downloadChatsFromRemote(): Promise<Chat[]> {
  const store = await Store.load('store.json')
  const method = await getSyncMethod(store)
  const fullPath = `${SYNC_PATH}/${SYNC_FILENAME}`

  switch (method) {
    case 'github': {
      const repo = await getSyncRepoName('github')
      const files = await githubGetFiles({ path: fullPath, repo })
      const content = decodeBase64ToString(getRemoteFileContent(files, fullPath))
      return JSON.parse(content)
    }
    case 'gitee': {
      const repo = await getSyncRepoName('gitee')
      const files = await giteeGetFiles({ path: fullPath, repo })
      const content = decodeBase64ToString(getRemoteFileContent(files, fullPath))
      return JSON.parse(content)
    }
    case 'gitlab': {
      const repo = await getSyncRepoName('gitlab')
      const files = await gitlabGetFileContent({ path: fullPath, ref: 'main', repo })
      const content = decodeBase64ToString(getRemoteFileContent(files, fullPath))
      return JSON.parse(content)
    }
    case 'gitea': {
      const repo = await getSyncRepoName('gitea')
      const files = await giteaGetFileContent({ path: fullPath, ref: 'main', repo })
      const content = decodeBase64ToString(getRemoteFileContent(files, fullPath))
      return JSON.parse(content)
    }
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      if (!config) return []
      const result = await s3Download(config, fullPath)
      return result ? JSON.parse(result.content) : []
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!config) return []
      const result = await webdavDownload(config, fullPath)
      return result ? JSON.parse(result.content) : []
    }
    default:
      return []
  }
}

function getLinkedResourceKey(resource: LinkedResource): string {
  return resource.relativePath || resource.path || resource.name
}

function normalizeLinkedResources(resources: LinkedResource[]): LinkedResource[] {
  const seen = new Set<string>()
  const normalized: LinkedResource[] = []

  for (const resource of resources) {
    const key = getLinkedResourceKey(resource)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push(resource)
  }

  return normalized
}

function buildOptimisticConversation(id: number, title = '新对话', messageCount = 0): Conversation {
  const now = Date.now()
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount,
    isPinned: false,
  }
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.updatedAt - a.updatedAt
  })
}

function upsertConversation(conversations: Conversation[], conversation: Conversation): Conversation[] {
  return sortConversations([
    conversation,
    ...conversations.filter(item => item.id !== conversation.id),
  ])
}

function shouldShowChatInCurrentConversation(
  currentConversationId: number | null,
  chat: Pick<Chat, 'conversationId'>,
): boolean {
  if (chat.conversationId === undefined || chat.conversationId === null) {
    return currentConversationId === null
  }
  return currentConversationId === chat.conversationId
}

export interface PendingQuote {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

// MCP 工具调用记录（临时，不保存到数据库）
export type ChatMode = 'chat' | 'agent' | 'research'

export interface McpToolCall {
  id: string
  chatId: number // 关联的 chat ID
  toolName: string
  serverId: string
  serverName: string
  params: Record<string, any>
  result: string
  status: 'calling' | 'success' | 'error' | 'blocked' | 'skipped' | 'adjusted' | 'cached'
  timestamp: number
}

export interface ResearchRuntimeState {
  runId?: string
  sessionId?: string
  activeChatId?: number
  query?: string
  startedAt?: number
  isRunning: boolean
  progressView: ResearchProgressView | null
  events: AgentEvent[]
  sourceCount: number
  evidenceCount: number
  cacheHits: number
  cacheMisses: number
}

function createEmptyResearchRun(): ResearchRuntimeState {
  return {
    isRunning: false,
    progressView: null,
    events: [],
    sourceCount: 0,
    evidenceCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
  }
}

interface ChatState {
  loading: boolean
  setLoading: (loading: boolean) => void
  researchRunning: boolean
  setResearchRunning: (running: boolean) => void
  researchRun: ResearchRuntimeState
  startResearchRun: (payload: {
    runId: string
    activeChatId?: number
    query?: string
    startedAt?: number
    sessionId?: string
  }) => void
  recordResearchEvent: (event: AgentEvent) => void
  updateResearchProgressView: (view: ResearchProgressView | null) => void
  finishResearchRun: () => void
  resetResearchRun: () => void
  chatMode: ChatMode
  setChatMode: (mode: ChatMode) => Promise<void>

  isCondensing: boolean // 压缩状态
  _condenseLock: boolean // 内部锁，防止并发压缩
  maybeCondense: () => void // 触发压缩检查（异步，不阻塞）

  // 兼容旧代码：按标签加载（内部映射到默认会话）
  chats: Chat[]
  init: (tagId: number) => Promise<void> // 初始化 chats
  insert: (chat: Omit<Chat, 'id' | 'createdAt'>) => Promise<Chat | null> // 插入一条 chat
  updateChat: (chat: Chat) => void // 更新一条 chat
  saveChat: (chat: Chat, isSave?: boolean) => Promise<void> // 保存一条 chat，用于动态 AI 回复结束后保存数据库
  deleteChat: (id: number) => Promise<void> // 删除一条 chat
  truncateFromChat: (id: number) => Promise<void> // 从指定消息开始截断当前会话

  locale: string
  getLocale: () => Promise<void>
  setLocale: (locale: string) => void

  clearChats: (tagId: number) => Promise<void> // 清空 chats（兼容旧代码）
  updateInsert: (id: number) => Promise<void> // 更新 inserted

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadChats: () => Promise<boolean>
  downloadChats: () => Promise<Chat[]>

  // MCP 工具调用记录（临时缓存）
  mcpToolCalls: McpToolCall[]
  addMcpToolCall: (toolCall: McpToolCall) => void
  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => void
  getMcpToolCallsByChatId: (chatId: number) => McpToolCall[]
  clearMcpToolCalls: () => void

  // Agent 模式
  agentState: AgentState
  setAgentState: (state: Partial<AgentState>) => void
  resetAgentState: () => void
  addAgentToolCall: (toolCall: ToolCall) => void
  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => void
  agentAutoApproveConversationId: number | null
  setAgentAutoApproveConversationId: (conversationId: number | null) => void
  agentAutoApproveRuntimeSkillId: string | null
  setAgentAutoApproveRuntimeSkillId: (skillId: string | null) => void

  // Placeholder 状态
  isPlaceholderEnabled: boolean
  setPlaceholderEnabled: (enabled: boolean) => void

  // 关联的文件或文件夹（用于 Agent 工具调用时判断内容是否已在上下文中）
  linkedResources: LinkedResource[]
  setLinkedResources: (resources: LinkedResource[]) => void
  addLinkedResource: (resource: LinkedResource) => void
  removeLinkedResource: (resource: LinkedResource) => void
  clearLinkedResources: () => void
  linkedResource: LinkedResource | null
  setLinkedResource: (resource: LinkedResource | null) => void

  // 关联文件的行号预览（用于 AI 对话时快速了解文件结构）
  linkedResourcePreview: string | null
  setLinkedResourcePreview: (preview: string | null) => void

  pendingQuote: PendingQuote | null
  setPendingQuote: (quote: PendingQuote | null) => void
  clearPendingQuote: () => void

  onboardingPromptDraft: string | null
  setOnboardingPromptDraft: (prompt: string | null) => void

  // === 新增：会话管理 ===
  // 当前会话
  currentConversationId: number | null
  conversations: Conversation[]
  conversationSelectionVersion: number
  suppressConversationAutoRestore: boolean

  // 会话初始化和管理
  initConversations: () => Promise<void> // 初始化会话列表
  ensureCurrentConversation: (title?: string) => Promise<number> // 确保当前已有会话，用于发送前快速切换 UI
  createConversation: (title?: string) => Promise<number> // 创建新会话
  switchConversation: (id: number) => Promise<void> // 切换会话
  updateConversationTitle: (id: number, title: string) => Promise<void> // 更新会话标题
  deleteConversation: (id: number) => Promise<void> // 删除会话
  toggleConversationPin: (id: number) => Promise<boolean> // 切换会话置顶状态
  startNewConversation: () => Promise<void> // 开始新对话（保存当前会话后创建新会话）

  // 会话内搜索
  chatSearchOpen: boolean
  setChatSearchOpen: (open: boolean) => void
  chatSearchQuery: string
  setChatSearchQuery: (query: string) => void
  chatSearchResults: number[] // 匹配的消息 ID
  chatSearchCurrentIndex: number
  setChatSearchCurrentIndex: (index: number) => void
}

const useChatStore = create<ChatState>((set, get) => ({
  loading: false,

  setLoading: (loading: boolean) => {
    set({ loading })
  },

  researchRunning: false,
  setResearchRunning: (researchRunning: boolean) => {
    set({ researchRunning })
  },

  researchRun: createEmptyResearchRun(),
  startResearchRun: (payload) => {
    set({
      researchRun: {
        ...createEmptyResearchRun(),
        ...payload,
        startedAt: payload.startedAt || Date.now(),
        isRunning: true,
      },
    })
  },
  recordResearchEvent: (event) => {
    const current = get().researchRun
    const payload = event.payload || {}
    const cacheStats = payload.cacheStats && typeof payload.cacheStats === 'object'
      ? payload.cacheStats as { hits?: unknown; misses?: unknown }
      : null
    const nextCacheHits = typeof cacheStats?.hits === 'number'
      ? cacheStats.hits
      : typeof payload.cacheHits === 'number'
        ? payload.cacheHits
        : current.cacheHits
    const nextCacheMisses = typeof cacheStats?.misses === 'number'
      ? cacheStats.misses
      : typeof payload.cacheMisses === 'number'
        ? payload.cacheMisses
        : current.cacheMisses
    const nextSourceCount = typeof payload.sourceCount === 'number'
      ? payload.sourceCount
      : event.type === 'research.source_added'
        ? current.sourceCount + 1
        : current.sourceCount
    const nextEvidenceCount = typeof payload.evidenceCount === 'number'
      ? payload.evidenceCount
      : event.type === 'research.evidence_added'
        ? current.evidenceCount + 1
        : current.evidenceCount

    set({
      researchRun: {
        ...current,
        runId: event.runId || current.runId,
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : current.sessionId,
        events: [...current.events, event].slice(-500),
        sourceCount: nextSourceCount,
        evidenceCount: nextEvidenceCount,
        cacheHits: nextCacheHits,
        cacheMisses: nextCacheMisses,
        isRunning: event.type === 'research.error' ? false : current.isRunning,
        progressView: current.progressView
          ? {
              ...current.progressView,
              sourceCount: Math.max(current.progressView.sourceCount, nextSourceCount),
              evidenceCount: Math.max(current.progressView.evidenceCount, nextEvidenceCount),
              cacheHits: nextCacheHits,
              cacheMisses: nextCacheMisses,
            }
          : current.progressView,
      },
    })
  },
  updateResearchProgressView: (progressView) => {
    const current = get().researchRun
    set({
      researchRun: {
        ...current,
        progressView: progressView
          ? {
              ...progressView,
              cacheHits: current.cacheHits || progressView.cacheHits,
              cacheMisses: current.cacheMisses || progressView.cacheMisses,
            }
          : null,
      },
    })
  },
  finishResearchRun: () => {
    const current = get().researchRun
    set({
      researchRun: {
        ...current,
        activeChatId: undefined,
        isRunning: false,
        progressView: null,
      },
    })
  },
  resetResearchRun: () => {
    set({ researchRun: createEmptyResearchRun() })
  },

  chatMode: 'agent',
  setChatMode: async (chatMode: ChatMode) => {
    const store = await Store.load('store.json')

    const prevMode = get().chatMode
    try {
      const settingStore = (await import('./setting')).default.getState()
      const currentModel = settingStore.primaryModel

      const modeModels = (await store.get<Record<string, string>>('chatModeModels')) || {}
      if (currentModel) {
        modeModels[prevMode] = currentModel
        await store.set('chatModeModels', modeModels)
      }

      const newModel = modeModels[chatMode]
      if (newModel) {
        const modelExists = settingStore.aiModelList.some(config =>
          config.models?.some(model => model.id === newModel) || config.key === newModel
        )
        if (modelExists) {
          await settingStore.setPrimaryModel(newModel)
        }
      }
    } catch (error) {
      console.warn('[ChatStore] Failed to save/load mode-specific model:', error)
    }

    await store.set('chatMode', chatMode)
    await store.save()
    set({ chatMode })
  },

  isCondensing: false,
  _condenseLock: false,

  maybeCondense: () => {
    const state = get()

    // 防并发：已有压缩任务在执行，直接返回
    if (state._condenseLock) {
      return
    }

    // 添加版本号引用，防止竞态条件
    const versionRef = { current: 0 }
    const currentVersion = ++versionRef.current

    const { chats } = state

    // 获取最后一次清除后的消息
    const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
    const chatsAfterClear = lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)

    // 使用 IIFE 立即执行异步函数，不等待结果
    ;(async () => {
      // 动态导入 condense 模块（避免循环依赖）
      const { shouldCondense, condenseChats } = await import('@/lib/ai/condense')

      // 版本号检查：防止被新版本覆盖
      if (currentVersion !== versionRef.current) {
        return
      }

      if (!(await shouldCondense(chatsAfterClear))) {
        return
      }

      // 再次检查版本号
      if (currentVersion !== versionRef.current) {
        return
      }

      // 设置锁和压缩状态
      set({ _condenseLock: true, isCondensing: true })

      try {
        // 为每条消息生成摘要并存储
        const condensedResults = await condenseChats(chatsAfterClear)

        // 版本号检查：防止在压缩过程中被新版本覆盖
        if (currentVersion !== versionRef.current) {
          return
        }

        for (const result of condensedResults) {
          if (result.summary) {
            // 更新数据库中的摘要内容
            await updateChatCondensedContent(result.chatId, result.summary)

            // 更新 state 中的消息
            set({
              chats: get().chats.map(c =>
                c.id === result.chatId
                  ? { ...c, condensedContent: result.summary || undefined, condensedAt: Date.now() }
                  : c
              )
            })
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
        console.error('[ChatStore] 压缩失败:', error)
      } finally {
        set({ _condenseLock: false, isCondensing: false })
      }
    })()
  },

  agentState: {
    agentRunId: undefined,
    agentEventCursor: undefined,
    activeChatId: undefined,
    isRunning: false,
    isThinking: false,
    currentThought: '',
    thoughtHistory: [],
    completedSteps: [],
    currentAction: undefined,
    currentObservation: undefined,
    toolCalls: [],
    agentEvents: [],
    maxIterations: 15,
    currentIteration: 0,
    pendingConfirmation: undefined,
    confirmationHistory: [],
    loadedSkills: undefined,
    selectedSkills: undefined,
    currentStepStartTime: undefined,
    ragSources: undefined,
    ragSourceDetails: undefined,
    agentContextSnapshot: undefined,
    agentPartSnapshot: undefined,
    agentParts: [],
    activity: undefined,
    telemetry: undefined,
    taskPlan: undefined,
  },

  setAgentState: (state: Partial<AgentState>) => {
    set({ agentState: { ...get().agentState, ...state } })
  },

  resetAgentState: () => {
    const currentState = get().agentState
    set({
      agentState: {
        agentRunId: undefined,
        agentEventCursor: undefined,
        activeChatId: undefined,
        isRunning: false,
        isThinking: false,
        currentThought: '',
        thoughtHistory: [],
        completedSteps: [],
        currentAction: '',
        currentObservation: '',
        toolCalls: [],
        agentEvents: [],
        maxIterations: 15,
        currentIteration: 0,
        pendingConfirmation: undefined,
        confirmationHistory: [],
        loadedSkills: undefined,
        selectedSkills: undefined,
        currentStepStartTime: undefined,
        // 保留 RAG 字段，因为它们应该在整个 Agent 执行期间显示
        ragSources: currentState.ragSources,
        ragSourceDetails: currentState.ragSourceDetails,
        agentContextSnapshot: undefined,
        agentPartSnapshot: undefined,
        agentParts: [],
        activity: undefined,
        telemetry: undefined,
        // 重置 Final Answer 模式
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
        taskPlan: undefined,
      }
    })
  },

  addAgentToolCall: (toolCall: ToolCall) => {
    const agentState = get().agentState
    set({
      agentState: {
        ...agentState,
        toolCalls: [...agentState.toolCalls, toolCall]
      }
    })
  },

  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => {
    const agentState = get().agentState
    set({
      agentState: {
        ...agentState,
        toolCalls: agentState.toolCalls.map(call =>
          call.id === id ? { ...call, ...updates } : call
        )
      }
    })
  },

  agentAutoApproveConversationId: null,
  setAgentAutoApproveConversationId: (conversationId: number | null) => {
    set({ agentAutoApproveConversationId: conversationId })
  },
  agentAutoApproveRuntimeSkillId: null,
  setAgentAutoApproveRuntimeSkillId: (skillId: string | null) => {
    set({ agentAutoApproveRuntimeSkillId: skillId })
  },

  isPlaceholderEnabled: true,
  setPlaceholderEnabled: (enabled: boolean) => {
    set({ isPlaceholderEnabled: enabled })
  },

  linkedResource: null,
  setLinkedResource: (resource: LinkedResource | null) => {
    const resources = resource ? [resource] : []
    set({ linkedResource: resource, linkedResources: resources })
  },
  linkedResources: [],
  setLinkedResources: (resources: LinkedResource[]) => {
    const normalized = normalizeLinkedResources(resources)
    set({
      linkedResources: normalized,
      linkedResource: normalized[0] || null,
    })
  },
  addLinkedResource: (resource: LinkedResource) => {
    const state = get()
    const current = state.linkedResources.length > 0
      ? state.linkedResources
      : state.linkedResource
        ? [state.linkedResource]
        : []
    const resourceKey = getLinkedResourceKey(resource)
    const normalized = normalizeLinkedResources([
      ...current.filter(item => getLinkedResourceKey(item) !== resourceKey),
      resource,
    ])

    set({
      linkedResources: normalized,
      linkedResource: normalized[0] || null,
    })
  },
  removeLinkedResource: (resource: LinkedResource) => {
    const resourceKey = getLinkedResourceKey(resource)
    const normalized = normalizeLinkedResources(get().linkedResources)
      .filter(item => getLinkedResourceKey(item) !== resourceKey)

    set({
      linkedResources: normalized,
      linkedResource: normalized[0] || null,
      linkedResourcePreview: null,
    })
  },
  clearLinkedResources: () => {
    set({
      linkedResources: [],
      linkedResource: null,
      linkedResourcePreview: null,
    })
  },

  linkedResourcePreview: null,
  setLinkedResourcePreview: (preview: string | null) => {
    set({ linkedResourcePreview: preview })
  },

  pendingQuote: null,
  setPendingQuote: (pendingQuote: PendingQuote | null) => {
    set({ pendingQuote })
  },
  clearPendingQuote: () => {
    set({ pendingQuote: null })
  },

  onboardingPromptDraft: null,
  setOnboardingPromptDraft: (prompt: string | null) => {
    set({ onboardingPromptDraft: prompt })
  },

  chatSearchOpen: false,
  setChatSearchOpen: (open: boolean) => {
    if (!open) {
      set({ chatSearchOpen: false, chatSearchQuery: '', chatSearchResults: [], chatSearchCurrentIndex: 0 })
    } else {
      set({ chatSearchOpen: true })
    }
  },
  chatSearchQuery: '',
  setChatSearchQuery: (query: string) => {
    const { chats } = get()
    if (!query.trim()) {
      set({ chatSearchQuery: query, chatSearchResults: [], chatSearchCurrentIndex: 0 })
      return
    }
    const lowerQuery = query.toLowerCase().trim()
    const results = chats
      .filter((chat) => {
        if (chat.content && chat.content.toLowerCase().includes(lowerQuery)) return true
        if (chat.thinking && chat.thinking.toLowerCase().includes(lowerQuery)) return true
        return false
      })
      .map((chat) => chat.id)
    set({
      chatSearchQuery: query,
      chatSearchResults: results,
      chatSearchCurrentIndex: results.length > 0 ? 0 : -1,
    })
  },
  chatSearchResults: [],
  chatSearchCurrentIndex: 0,
  setChatSearchCurrentIndex: (index: number) => {
    set({ chatSearchCurrentIndex: index })
  },

  chats: [],
  // 兼容旧代码：init 方法现在会初始化会话列表并切换到第一个会话
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  init: async (_tagId: number) => {
    const initSelectionVersion = get().conversationSelectionVersion
    await initChatsDb()
    const store = await Store.load('store.json')
    const savedChatMode = await store.get<ChatMode>('chatMode')
    if (savedChatMode === 'chat' || savedChatMode === 'agent' || savedChatMode === 'research') {
      set({ chatMode: savedChatMode })
    } else {
      await store.set('chatMode', get().chatMode)
      await store.save()
    }
    // 先初始化会话列表
    await get().initConversations()

    if (initSelectionVersion !== get().conversationSelectionVersion) {
      return
    }

    const { currentConversationId, conversations, suppressConversationAutoRestore } = get()

    // 如果没有当前会话
    if (!currentConversationId) {
      if (!suppressConversationAutoRestore && conversations.length > 0) {
        // 有历史会话，切换到第一个
        await get().switchConversation(conversations[0].id)
      }
      // 如果没有历史会话，保持空状态，不创建新会话
    } else {
      // 加载当前会话的聊天记录
      const data = await getChatsByConversation(currentConversationId)
      if (initSelectionVersion === get().conversationSelectionVersion && get().currentConversationId === currentConversationId) {
        set({ chats: data })
      }
    }
  },
  insert: async (chat) => {
    const { currentConversationId } = get()

    // 确保有 conversationId，如果没有则创建新会话
    let conversationId = chat.conversationId || currentConversationId
    if (!conversationId) {
      // 没有当前会话，创建一个新会话
      const { createConversation } = await import('@/db/conversations')
      conversationId = await createConversation('新对话')
      const optimisticConversation = buildOptimisticConversation(conversationId)
      const selectionVersion = get().conversationSelectionVersion + 1
      set({
        currentConversationId: conversationId,
        suppressConversationAutoRestore: false,
        conversationSelectionVersion: selectionVersion,
        conversations: upsertConversation(get().conversations, optimisticConversation),
      })
      void get().initConversations().catch(error => {
        console.error('[ChatStore] Failed to refresh conversations after creating fallback conversation:', error)
      })
    }

    const res = await insertChat({ ...chat, conversationId })
    let data: Chat
    if (res.lastInsertId) {
      data =  {
        id: res.lastInsertId,
        createdAt: Date.now(),
        ...chat,
        conversationId
      }
      const chats = get().chats
      const shouldUpdateCurrentChats = shouldShowChatInCurrentConversation(get().currentConversationId, data)
      const newChats = shouldUpdateCurrentChats ? [...chats, data] : chats
      const now = Date.now()
      const existingConversation = get().conversations.find(item => item.id === conversationId)
      const shouldUseUserTitle = (existingConversation?.messageCount || 0) === 0 && chat.role === 'user' && chat.content
      const optimisticTitle = shouldUseUserTitle
        ? chat.content!.replace(/\n/g, ' ').trim().slice(0, 30) || existingConversation?.title || '新对话'
        : existingConversation?.title || '新对话'
      const optimisticConversation: Conversation = {
        ...(existingConversation || buildOptimisticConversation(conversationId)),
        title: optimisticTitle,
        updatedAt: now,
        messageCount: (existingConversation?.messageCount || 0) + 1,
      }

      set({
        chats: newChats,
        conversations: upsertConversation(get().conversations, optimisticConversation),
      })

      // 更新会话的消息数量和更新时间
      if (conversationId) {
        void (async () => {
          const { updateConversationMessageCount, updateConversationTime, updateConversationTitle, getConversation } = await import('@/db/conversations')
          await updateConversationMessageCount(conversationId!, 1)
          await updateConversationTime(conversationId!)

          // 如果是当前会话的第一条用户消息，用消息内容作为标题
          // 从数据库获取最新的会话状态，而不是使用内存中的旧数据
          const currentConv = await getConversation(conversationId!)
          if (currentConv && currentConv.messageCount === 1 && chat.role === 'user' && chat.content) {
            // 直接使用用户输入的前30个字符作为标题
            const title = chat.content
              .replace(/\n/g, ' ')  // 移除换行符
              .trim()
              .slice(0, 30)

            if (title && title !== currentConv.title) {
              await updateConversationTitle(conversationId!, title)
            }
          }

          // 刷新会话列表
          await get().initConversations()
        })().catch(error => {
          console.error('[ChatStore] Failed to update conversation metadata after inserting chat:', error)
        })
      }

      return data
    }
    return null
  },
  updateChat: (chat) => {
    if (!shouldShowChatInCurrentConversation(get().currentConversationId, chat)) {
      return
    }
    const chats = get().chats
    const newChats = chats.map(item => {
      if (item.id === chat.id) {
        // 合并更新，只覆盖非 undefined 的字段，保留已存在的字段（如 ragSources）
        const result = { ...item }
        for (const key in chat) {
          if ((chat as any)[key] !== undefined) {
            (result as any)[key] = (chat as any)[key]
          }
        }
        return result
      }
      return item
    })
    set({ chats: newChats })
  },
  saveChat: async (chat, isSave = false) => {
    if (shouldShowChatInCurrentConversation(get().currentConversationId, chat)) {
      get().updateChat(chat)
    }
    if (isSave) {
      await updateChat(chat)
    }
  },
  deleteChat: async (id) => {
    const chats = get().chats
    const newChats = chats.filter(item => item.id !== id)
    set({ chats: newChats })
    await deleteChat(id)

    // 更新会话的消息数量
    const { currentConversationId } = get()
    if (currentConversationId) {
      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -1)
      await get().initConversations()
    }
  },

  truncateFromChat: async (id) => {
    const chats = get().chats
    const targetIndex = chats.findIndex(item => item.id === id)
    if (targetIndex < 0) return

    const removedChats = chats.slice(targetIndex)
    if (removedChats.length === 0) return

    const removedIds = new Set(removedChats.map(item => item.id))
    const remainingChats = chats.slice(0, targetIndex)
    const chatSearchResults = get().chatSearchResults.filter(item => !removedIds.has(item))
    const chatSearchCurrentIndex = chatSearchResults.length > 0
      ? Math.min(get().chatSearchCurrentIndex, chatSearchResults.length - 1)
      : -1

    set({
      chats: remainingChats,
      mcpToolCalls: get().mcpToolCalls.filter(call => !removedIds.has(call.chatId)),
      chatSearchResults,
      chatSearchCurrentIndex,
    })
    get().resetAgentState()

    await deleteChats([...removedIds])

    const { currentConversationId } = get()
    if (currentConversationId) {
      const { syncConversationMessageCount, updateConversationTime } = await import('@/db/conversations')
      await syncConversationMessageCount(currentConversationId)
      await updateConversationTime(currentConversationId)
      await get().initConversations()
    }
  },


  locale: locales[0],
  getLocale: async () => {
    const store = await Store.load('store.json');
    const res = (await store.get<string>('note_locale')) || locales[0]
    set({ locale: res })
  },
  setLocale: async (locale) => {
    set({ locale })
    const store = await Store.load('store.json');
    await store.set('note_locale', locale)
  },

  // 兼容旧代码：clearChats 现在会清空当前会话的聊天记录
  clearChats: async (tagId) => {
    set({ chats: [] })
    // 清空聊天记录时同步清理 Agent 状态
    get().resetAgentState()
    get().clearMcpToolCalls()
    get().clearPendingQuote()

    // 更新会话的消息数量
    const { currentConversationId } = get()
    if (currentConversationId) {
      // 获取当前消息数量
      const { chats } = get()
      const count = chats.length

      // 删除数据库中的记录
      await deleteChatsByConversationId(currentConversationId)

      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -count)
      await get().initConversations()
    } else {
      // 兼容旧代码：如果没有 conversationId，使用 tagId
      await clearChatsByTagId(tagId)
    }
  },

  updateInsert: async (id) => {
    await updateChatsInsertedById(id)
    const chats = get().chats
    const newChats = chats.map(item => {
      if (item.id === id) {
        item.inserted = true
      }
      return item
    })
    set({ chats: newChats })
  },

  // 同步
  syncState: false,
  setSyncState: (syncState) => {
    set({ syncState })
  },
  lastSyncTime: '',
  setLastSyncTime: (lastSyncTime) => {
    set({ lastSyncTime })
  },
  uploadChats: async () => {
    set({ syncState: true })
    const chats = await getAllChats()
    const res = await uploadChatsToRemote(chats)
    set({ syncState: false })
    return !!res
  },
  // MCP 工具调用记录
  mcpToolCalls: [],

  addMcpToolCall: (toolCall: McpToolCall) => {
    const mcpToolCalls = get().mcpToolCalls
    set({ mcpToolCalls: [...mcpToolCalls, toolCall] })
  },

  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => {
    const mcpToolCalls = get().mcpToolCalls.map(call =>
      call.id === id ? { ...call, ...updates } : call
    )
    set({ mcpToolCalls })
  },

  getMcpToolCallsByChatId: (chatId: number) => {
    return get().mcpToolCalls.filter(call => call.chatId === chatId)
  },

  clearMcpToolCalls: () => {
    set({ mcpToolCalls: [] })
  },

  downloadChats: async () => {
    const result = await downloadChatsFromRemote()
    if (result.length > 0) {
      await deleteAllChats()
      await insertChats(result)
    }
    set({ syncState: false })
    return result
  },

  // === 新增：会话管理方法 ===
  currentConversationId: null,
  conversations: [],
  conversationSelectionVersion: 0,
  suppressConversationAutoRestore: false,

  initConversations: async () => {
    const { getAllConversations } = await import('@/db/conversations')
    const conversations = await getAllConversations()
    set({ conversations })
  },

  ensureCurrentConversation: async (title = '新对话') => {
    const existingId = get().currentConversationId
    if (existingId) return existingId

    const { createConversation: createConv } = await import('@/db/conversations')
    const id = await createConv(title)
    const optimisticConversation = buildOptimisticConversation(id, title)
    const selectionVersion = get().conversationSelectionVersion + 1
    set({
      currentConversationId: id,
      chats: [],
      pendingQuote: null,
      suppressConversationAutoRestore: false,
      conversationSelectionVersion: selectionVersion,
      chatSearchOpen: false,
      chatSearchQuery: '',
      chatSearchResults: [],
      chatSearchCurrentIndex: 0,
      conversations: upsertConversation(get().conversations, optimisticConversation),
    })
    void get().initConversations().catch(error => {
      console.error('[ChatStore] Failed to refresh conversations after ensuring current conversation:', error)
    })
    return id
  },

  createConversation: async (title = '新对话') => {
    const { createConversation: createConv } = await import('@/db/conversations')
    const id = await createConv(title)
    // 设置为当前会话并刷新会话列表
    const optimisticConversation = buildOptimisticConversation(id, title)
    const selectionVersion = get().conversationSelectionVersion + 1
    set({
      currentConversationId: id,
      chats: [],
      pendingQuote: null,
      suppressConversationAutoRestore: false,
      conversationSelectionVersion: selectionVersion,
      chatSearchOpen: false,
      chatSearchQuery: '',
      chatSearchResults: [],
      chatSearchCurrentIndex: 0,
      conversations: upsertConversation(get().conversations, optimisticConversation),
    })
    void get().initConversations().catch(error => {
      console.error('[ChatStore] Failed to refresh conversations after creating conversation:', error)
    })
    return id
  },

  switchConversation: async (id: number) => {
    if (get().currentConversationId === id) {
      return
    }

    const selectionVersion = get().conversationSelectionVersion + 1
    set({
      currentConversationId: id,
      chats: [],
      pendingQuote: null,
      suppressConversationAutoRestore: false,
      conversationSelectionVersion: selectionVersion,
      chatSearchOpen: false,
      chatSearchQuery: '',
      chatSearchResults: [],
      chatSearchCurrentIndex: 0,
    })
    get().resetAgentState()
    get().clearMcpToolCalls()

    const { getChatsByConversation } = await import('@/db/chats')
    const data = await getChatsByConversation(id)
    if (get().conversationSelectionVersion !== selectionVersion || get().currentConversationId !== id) {
      return
    }
    set({ chats: data })
    // 后台同步消息数量和列表，避免阻塞历史切换的即时反馈。
    void (async () => {
      const { syncConversationMessageCount } = await import('@/db/conversations')
      await syncConversationMessageCount(id)
      if (get().conversationSelectionVersion === selectionVersion && get().currentConversationId === id) {
        await get().initConversations()
      }
    })().catch(error => {
      console.error('[ChatStore] Failed to refresh conversations after switching:', error)
    })
  },

  updateConversationTitle: async (id: number, title: string) => {
    const { updateConversationTitle: updateTitle } = await import('@/db/conversations')
    await updateTitle(id, title)
    // 刷新会话列表
    await get().initConversations()
  },

  deleteConversation: async (id: number) => {
    const { deleteConversation: deleteConv } = await import('@/db/conversations')
    await deleteConv(id)

    const { currentConversationId } = get()

    // 如果删除的是当前会话，回到首页空状态，不自动切换到其他历史会话
    if (id === currentConversationId) {
      set({
        currentConversationId: null,
        chats: [],
        pendingQuote: null,
        suppressConversationAutoRestore: true,
        conversationSelectionVersion: get().conversationSelectionVersion + 1,
        agentAutoApproveConversationId: null,
        agentAutoApproveRuntimeSkillId: null,
        chatSearchOpen: false,
        chatSearchQuery: '',
        chatSearchResults: [],
        chatSearchCurrentIndex: 0,
      })
      get().resetAgentState()
      get().clearMcpToolCalls()
    }

    // 刷新会话列表
    await get().initConversations()
  },

  toggleConversationPin: async (id: number) => {
    const { toggleConversationPin: togglePin } = await import('@/db/conversations')
    const isPinned = await togglePin(id)
    // 刷新会话列表
    await get().initConversations()
    return isPinned
  },

  startNewConversation: async () => {
    const { currentConversationId } = get()
    const selectionVersion = get().conversationSelectionVersion + 1

    // 先进入显式空白新会话状态，避免异步 DB/初始化任务晚到后把 UI 拉回历史会话。
    set({
      currentConversationId: null,
      chats: [],
      pendingQuote: null,
      suppressConversationAutoRestore: true,
      conversationSelectionVersion: selectionVersion,
      agentAutoApproveConversationId: null,
      agentAutoApproveRuntimeSkillId: null,
      chatSearchOpen: false,
      chatSearchQuery: '',
      chatSearchResults: [],
      chatSearchCurrentIndex: 0,
    })
    get().resetAgentState()
    get().clearMcpToolCalls()

    // 如果当前会话无消息，删除它（从数据库查询最新状态）
    if (currentConversationId) {
      const { getConversation } = await import('@/db/conversations')
      const currentConv = await getConversation(currentConversationId)
      if (currentConv && currentConv.messageCount === 0) {
        // 空会话，直接删除
        const { deleteConversation: deleteConv } = await import('@/db/conversations')
        await deleteConv(currentConversationId)
      }
      // 刷新会话列表
      await get().initConversations()
    }
  },
}))

export default useChatStore
