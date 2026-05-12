import { Tool, ToolResult } from '../types'
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { getChats, getChatsByConversation, insertChat, updateChat, deleteChat, clearChatsByTagId, Chat, insertChats, updateChats, deleteChats } from '@/db/chats'
import useChatStore from '@/stores/chat'
import useArticleStore from '@/stores/article'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { fetchAi } from '@/lib/ai/chat'
import { processMarkdownFile } from '@/lib/rag'
import { getVectorDocumentKey } from '@/lib/vector-document-key'

type ExtractFormat = 'summary' | 'detail' | 'qa'

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function toIsoTimestamp(timestamp?: number) {
  if (!timestamp || Number.isNaN(timestamp)) return ''
  return new Date(timestamp).toISOString()
}

function normalizeFolderPath(folderPath: unknown): string | undefined {
  if (typeof folderPath !== 'string') return undefined
  const normalized = folderPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  return normalized || undefined
}

function sanitizeTitleToFileName(title: string): string {
  const raw = title
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  const fallback = `chat-note-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const fileName = (raw || fallback).slice(0, 80)
  return fileName.endsWith('.md') ? fileName : `${fileName}.md`
}

function normalizeContent(content: string | undefined): string {
  return (content || '').replace(/\r\n/g, '\n').trim()
}

function roleLabel(role: Chat['role']) {
  return role === 'user' ? '用户' : 'AI'
}

function buildTranscript(chats: Chat[]): string {
  return chats
    .map(chat => {
      const content = normalizeContent(chat.content)
      if (!content) return ''
      const timestamp = toIsoTimestamp(chat.createdAt)
      return `[${timestamp}] ${roleLabel(chat.role)}:\n${content}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function buildFallbackSummaryMarkdown(title: string, chats: Chat[], format: ExtractFormat): string {
  const userMessages = chats.filter(chat => chat.role === 'user').map(chat => normalizeContent(chat.content)).filter(Boolean)
  const assistantMessages = chats.filter(chat => chat.role === 'system').map(chat => normalizeContent(chat.content)).filter(Boolean)
  const latestUser = userMessages.slice(-3)
  const latestAssistant = assistantMessages.slice(-3)

  if (format === 'qa') {
    const qaPairs = []
    const limit = Math.min(chats.length, 12)
    const selected = chats.slice(-limit)

    for (let index = 0; index < selected.length; index += 1) {
      const current = selected[index]
      const next = selected[index + 1]
      if (current.role === 'user' && next?.role === 'system') {
        qaPairs.push(`### Q${qaPairs.length + 1}\n${normalizeContent(current.content)}\n\n### A${qaPairs.length + 1}\n${normalizeContent(next.content)}`)
      }
    }

    return [
      `## 对话问答整理`,
      '',
      qaPairs.length > 0 ? qaPairs.join('\n\n') : '未提取到完整问答对，请检查原始对话。',
    ].join('\n')
  }

  if (format === 'detail') {
    const transcript = buildTranscript(chats)
    return [
      `## 对话详细纪要`,
      '',
      '### 用户核心诉求',
      ...(latestUser.length > 0 ? latestUser.map(item => `- ${item}`) : ['- 无']),
      '',
      '### AI 关键信息',
      ...(latestAssistant.length > 0 ? latestAssistant.map(item => `- ${item}`) : ['- 无']),
      '',
      '### 原始对话记录',
      '',
      transcript || '暂无可用内容。',
    ].join('\n')
  }

  return [
    `## 对话摘要`,
    '',
    '### 主要问题',
    ...(latestUser.length > 0 ? latestUser.map(item => `- ${item}`) : ['- 无']),
    '',
    '### 关键结论',
    ...(latestAssistant.length > 0 ? latestAssistant.map(item => `- ${item}`) : ['- 无']),
    '',
    '### 后续行动',
    '- 可基于本摘要继续补充笔记或拆解为闪卡。',
  ].join('\n')
}

async function generateStructuredMarkdown(
  title: string,
  format: ExtractFormat,
  transcript: string,
  fallbackChats: Chat[]
) {
  const formatGuide: Record<ExtractFormat, string> = {
    summary: '请输出：背景、关键结论、待办事项（均为简短小节）。',
    detail: '请输出：背景、问题分析、决策过程、结论、后续行动，并保留必要细节。',
    qa: '请输出多组 Q/A，问题与答案一一对应，突出可复用知识点。',
  }

  const prompt = [
    '你是知识整理助手。',
    `请把下面对话整理为 Markdown，标题为《${title}》。`,
    `整理风格：${format}。${formatGuide[format]}`,
    '要求：',
    '1. 不要杜撰对话中不存在的信息。',
    '2. 保留可执行结论与关键约束。',
    '3. 输出内容必须是纯 Markdown，不要使用代码围栏。',
    '',
    '对话原文：',
    transcript,
  ].join('\n')

  const aiResult = normalizeContent(await fetchAi(prompt))
  if (aiResult) {
    return aiResult
  }

  return buildFallbackSummaryMarkdown(title, fallbackChats, format)
}

async function ensureFolderExists(relativeFolderPath?: string) {
  if (!relativeFolderPath) {
    return
  }

  const safeFolder = await ensureSafeWorkspaceRelativePath(relativeFolderPath)
  const { path, baseDir } = await getFilePathOptions(safeFolder)
  if (baseDir) {
    await mkdir(path, { baseDir, recursive: true })
  } else {
    await mkdir(path, { recursive: true })
  }
}

async function resolveUniqueFilePath(initialRelativePath: string): Promise<string> {
  const normalizedInitialPath = await ensureSafeWorkspaceRelativePath(initialRelativePath)
  const pathParts = normalizedInitialPath.split('/')
  const fileName = pathParts.pop() || normalizedInitialPath
  const folderPath = pathParts.join('/')
  const extIndex = fileName.lastIndexOf('.')
  const baseName = extIndex > 0 ? fileName.slice(0, extIndex) : fileName
  const extension = extIndex > 0 ? fileName.slice(extIndex) : ''

  let candidate = normalizedInitialPath
  for (let index = 1; index <= 99; index += 1) {
    const { path, baseDir } = await getFilePathOptions(candidate)
    const alreadyExists = baseDir ? await exists(path, { baseDir }) : await exists(path)
    if (!alreadyExists) {
      return candidate
    }

    const nextFileName = `${baseName}-${index + 1}${extension}`
    candidate = folderPath ? `${folderPath}/${nextFileName}` : nextFileName
  }

  throw new Error('无法为笔记生成唯一文件名，请稍后重试')
}

async function loadConversationChats(params: Record<string, any>): Promise<Chat[]> {
  const store = useChatStore.getState()

  if (typeof params.conversationId === 'number') {
    return await getChatsByConversation(params.conversationId)
  }

  if (store.currentConversationId) {
    return await getChatsByConversation(store.currentConversationId)
  }

  if (typeof params.tagId === 'number') {
    return await getChats(params.tagId)
  }

  return store.chats
}

export const readChatsTool: Tool = {
  name: 'read_chats',
  description: 'Read all chat records under the specified tag',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId)
      return {
        success: true,
        data: chats,
        message: `找到 ${chats.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取对话记录失败: ${error}`,
      }
    }
  },
}

export const createChatTool: Tool = {
  name: 'create_chat',
  description: 'Create a new chat record',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Chat content',
      required: true,
    },
    {
      name: 'role',
      type: 'string',
      description: 'Role: system or user',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Type: chat, note, clipboard, clear',
      required: false,
      default: 'chat',
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chat: Omit<Chat, 'id' | 'createdAt'> = {
        tagId: params.tagId,
        content: params.content,
        role: params.role as 'system' | 'user',
        type: (params.type || 'chat') as 'chat' | 'note' | 'clipboard' | 'clear',
        inserted: false,
      }
      const result = await insertChat(chat)
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `成功创建对话记录，ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建对话记录失败: ${error}`,
      }
    }
  },
}

export const updateChatTool: Tool = {
  name: 'update_chat',
  description: 'Update the specified chat record',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Chat record ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New chat content',
      required: false,
    },
    {
      name: 'inserted',
      type: 'boolean',
      description: 'Whether inserted into notes',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId || 1)
      const chat = chats.find(c => c.id === params.id)
      
      if (!chat) {
        return {
          success: false,
          error: `未找到ID为 ${params.id} 的对话记录`,
        }
      }
      
      const updatedChat: Chat = {
        ...chat,
        content: params.content !== undefined ? params.content : chat.content,
        inserted: params.inserted !== undefined ? params.inserted : chat.inserted,
      }
      
      await updateChat(updatedChat)
      return {
        success: true,
        message: `成功更新对话记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新对话记录失败: ${error}`,
      }
    }
  },
}

export const deleteChatTool: Tool = {
  name: 'delete_chat',
  description: 'Delete the specified chat record',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'ID of the chat record to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await deleteChat(params.id)
      return {
        success: true,
        message: `成功删除对话记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除对话记录失败: ${error}`,
      }
    }
  },
}

export const clearChatsTool: Tool = {
  name: 'clear_chats',
  description: 'Clear all chat records under the specified tag',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await clearChatsByTagId(params.tagId)
      return {
        success: true,
        message: `成功清空标签 ${params.tagId} 下的所有对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `清空对话记录失败: ${error}`,
      }
    }
  },
}

export const searchChatsTool: Tool = {
  name: 'search_chats',
  description: 'Search chat records for content containing keywords',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword',
      required: true,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Optional: limit search to specified tag',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId || 1)
      const results = chats.filter(chat => 
        chat.content?.toLowerCase().includes(params.query.toLowerCase())
      )
      
      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 条匹配的对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索对话记录失败: ${error}`,
      }
    }
  },
}

export const extractToNoteTool: Tool = {
  name: 'extract_to_note',
  description: `Extract key knowledge from the current chat and save as a structured Markdown note.

Supports summary/detail/qa modes and automatically updates vector index after saving.
Use this when valuable conclusions appear in a conversation and should be reusable in future RAG retrieval.`,
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'title',
      type: 'string',
      description: 'Optional note title. If omitted, the tool derives a title from latest user messages.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional destination folder relative to workspace root, e.g. "agent-notes/project-a".',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      description: 'Optional format: summary (default) | detail | qa',
      required: false,
    },
    {
      name: 'maxMessages',
      type: 'number',
      description: 'Optional max number of latest chat messages to extract (6-120, default 40).',
      required: false,
    },
    {
      name: 'conversationId',
      type: 'number',
      description: 'Optional specific conversation ID. Defaults to current active conversation.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const sourceChats = await loadConversationChats(params)
      const validChats = sourceChats
        .filter(chat => chat.type !== 'clear')
        .filter(chat => normalizeContent(chat.content).length > 0)

      if (validChats.length === 0) {
        return {
          success: false,
          error: '当前会话没有可提取的有效内容',
        }
      }

      const maxMessages = clampNumber(params.maxMessages, 6, 120, 40)
      const selectedChats = validChats.slice(-maxMessages)
      const format = (['summary', 'detail', 'qa'] as const).includes(params.format as ExtractFormat)
        ? (params.format as ExtractFormat)
        : 'summary'

      const suggestedTitle = normalizeContent(params.title)
        || normalizeContent(selectedChats.find(chat => chat.role === 'user')?.content)?.slice(0, 32)
        || `chat-note-${new Date().toISOString().slice(0, 10)}`

      const noteTitle = suggestedTitle.replace(/\r?\n/g, ' ').trim()
      const fileName = sanitizeTitleToFileName(noteTitle)
      const relativeFolder = normalizeFolderPath(params.folderPath) || 'agent-notes'

      await ensureFolderExists(relativeFolder)

      const initialPath = await ensureSafeWorkspaceRelativePath(`${relativeFolder}/${fileName}`)
      const uniqueRelativePath = await resolveUniqueFilePath(initialPath)
      const transcript = buildTranscript(selectedChats)
      const bodyMarkdown = await generateStructuredMarkdown(noteTitle, format, transcript, selectedChats)

      const headerLines = [
        `# ${noteTitle}`,
        '',
        `> 来源: Agent 对话提炼`,
        `> 提取时间: ${new Date().toLocaleString()}`,
        `> 对话条数: ${selectedChats.length}`,
        `> 模式: ${format}`,
        '',
      ]
      const finalMarkdown = `${headerLines.join('\n')}${bodyMarkdown.trim()}\n`

      const { path, baseDir } = await getFilePathOptions(uniqueRelativePath)
      if (baseDir) {
        await writeTextFile(path, finalMarkdown, { baseDir })
      } else {
        await writeTextFile(path, finalMarkdown)
      }

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(uniqueRelativePath, false)
      await articleStore.ensurePathExpanded(uniqueRelativePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      const indexed = await processMarkdownFile(uniqueRelativePath, finalMarkdown)
      if (indexed) {
        const latestState = useArticleStore.getState()
        const nextMap = new Map(latestState.vectorIndexedFiles)
        nextMap.set(getVectorDocumentKey(uniqueRelativePath), Date.now())
        useArticleStore.setState({ vectorIndexedFiles: nextMap })
      }

      const workspace = await getWorkspacePath()
      const fullPath = workspace.isCustom
        ? `${workspace.path}/${uniqueRelativePath}`
        : `${await appDataDir()}/article/${uniqueRelativePath}`

      return {
        success: true,
        data: {
          filePath: uniqueRelativePath,
          fullPath,
          format,
          indexed,
        },
        message: indexed
          ? `已提取对话并保存为笔记: ${uniqueRelativePath}（已更新向量索引）`
          : `已提取对话并保存为笔记: ${uniqueRelativePath}（向量索引更新失败，可稍后手动重建）`,
      }
    } catch (error) {
      return {
        success: false,
        error: `提取对话到笔记失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const createChatsBatchTool: Tool = {
  name: 'create_chats_batch',
  description: 'Batch create multiple chat records to avoid loop calls. Use for scenarios requiring multiple chat records to be created at once.',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'chats',
      type: 'array',
      description: 'Array of chat records to create, each record contains tagId, content, role, type and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.chats) || params.chats.length === 0) {
        return {
          success: false,
          error: '参数 chats 必须是非空数组',
        }
      }

      const chatsToInsert: Chat[] = params.chats.map((chat: any) => ({
        id: 0,
        tagId: chat.tagId,
        content: chat.content,
        role: chat.role as 'system' | 'user',
        type: (chat.type || 'chat') as 'chat' | 'note' | 'clipboard' | 'clear',
        inserted: false,
        createdAt: Date.now(),
      }))

      await insertChats(chatsToInsert)
      
      return {
        success: true,
        data: { count: chatsToInsert.length },
        message: `成功批量创建 ${chatsToInsert.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量创建对话记录失败: ${error}`,
      }
    }
  },
}

export const updateChatsBatchTool: Tool = {
  name: 'update_chats_batch',
  description: 'Batch update multiple chat records to avoid loop calls. Each record must include the id field.',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'chats',
      type: 'array',
      description: 'Array of chat records to update, each record must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.chats) || params.chats.length === 0) {
        return {
          success: false,
          error: '参数 chats 必须是非空数组',
        }
      }

      const chatsToUpdate: Chat[] = params.chats.map((chat: any) => ({
        id: chat.id,
        tagId: chat.tagId,
        content: chat.content,
        role: chat.role,
        type: chat.type,
        inserted: chat.inserted ?? false,
        createdAt: chat.createdAt || Date.now(),
        image: chat.image,
        images: chat.images,
        ragSources: chat.ragSources,
        agentHistory: chat.agentHistory,
        thinking: chat.thinking,
        quoteData: chat.quoteData,
      }))

      await updateChats(chatsToUpdate)
      
      return {
        success: true,
        data: { count: chatsToUpdate.length },
        message: `成功批量更新 ${chatsToUpdate.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量更新对话记录失败: ${error}`,
      }
    }
  },
}

export const deleteChatsBatchTool: Tool = {
  name: 'delete_chats_batch',
  description: 'Batch delete multiple chat records to avoid loop calls.',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of chat record IDs to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.ids) || params.ids.length === 0) {
        return {
          success: false,
          error: '参数 ids 必须是非空数组',
        }
      }

      await deleteChats(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `成功批量删除 ${params.ids.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除对话记录失败: ${error}`,
      }
    }
  },
}

export const chatTools: Tool[] = [
  readChatsTool,
  createChatTool,
  updateChatTool,
  deleteChatTool,
  clearChatsTool,
  searchChatsTool,
  extractToNoteTool,
  createChatsBatchTool,
  updateChatsBatchTool,
  deleteChatsBatchTool,
]
