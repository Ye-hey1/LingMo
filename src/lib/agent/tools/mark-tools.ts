import { Tool, ToolResult } from '../types'
import { getMarks, getAllMarks, insertMark, updateMark, delMark, restoreMark, Mark, insertMarks, updateMarks, deleteMarks, restoreMarks } from '@/db/marks'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import emitter, { type TodoDraftPayload } from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'

/**
 * 获取当前选中的标签ID
 * 如果用户没有明确指定标签，使用当前选中的标签
 */
function getCurrentTagId(tagId?: number): number {
  // 如果明确传入了 tagId，使用传入的值
  if (tagId !== undefined && tagId !== null) {
    return tagId
  }
  // 否则使用当前选中的标签
  return useTagStore.getState().currentTagId
}

async function refreshRecordState() {
  await useTagStore.getState().fetchTags()
  useTagStore.getState().getCurrentTag()
  await useMarkStore.getState().refreshVisibleMarks()
  emitter.emit(EmitterRecordEvents.refreshMarks)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTodoPriority(value: unknown): TodoDraftPayload['priority'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

function normalizeTodoSubtasks(value: unknown): TodoDraftPayload['subtasks'] {
  if (!Array.isArray(value)) return undefined

  const subtasks = value
    .map((item) => {
      if (typeof item === 'string') {
        return { title: item.trim() }
      }

      if (item && typeof item === 'object' && 'title' in item) {
        return {
          title: normalizeText((item as { title?: unknown }).title),
          completed: (item as { completed?: unknown }).completed === true,
        }
      }

      return { title: '' }
    })
    .filter((item) => item.title)

  return subtasks.length > 0 ? subtasks : undefined
}

export const readMarksTool: Tool = {
  name: 'read_marks',
  description: 'Read all content records (marks) under a specific tag. Uses current selected tag if tagId not specified.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID (optional, uses current selected tag if not specified)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tagId = getCurrentTagId(params.tagId)
      const marks = await getMarks(tagId)
      const activeMarks = marks.filter(m => m.deleted === 0)
      return {
        success: true,
        data: activeMarks,
        message: `找到 ${activeMarks.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取记录失败: ${error}`,
      }
    }
  },
}

export const createMarkTool: Tool = {
  name: 'create_mark',
  description: 'Create a new content record (mark) under a specific tag.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID (use list_tags first to get available tags)',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Mark type: scan (OCR), text, image, link, file, recording',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Main content of the mark (text, OCR result, etc.)',
      required: false,
    },
    {
      name: 'url',
      type: 'string',
      description: 'Related URL or file path',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: 'Brief description or title',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const mark: Partial<Mark> = {
        tagId: params.tagId,
        type: params.type as 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording',
        content: params.content,
        url: params.url || '',
        desc: params.desc,
      }
      const result = await insertMark(mark)
      await refreshRecordState()
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `成功创建记录，ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建记录失败: ${error}`,
      }
    }
  },
}

export const openTodoDraftTool: Tool = {
  name: 'open_todo_draft',
  description: 'Open the LingMo todo quick panel with AI-filled draft content for the user to review and save. Use this when the user asks to set, add, create, or plan a todo/task in the record panel.',
  category: 'mark',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  parameters: [
    {
      name: 'title',
      type: 'string',
      description: 'Todo title to prefill. Keep it short and action-oriented.',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: 'Optional note, context, requirement, or source text to prefill.',
      required: false,
    },
    {
      name: 'priority',
      type: 'string',
      description: 'Priority: low, medium, or high. Defaults to medium.',
      required: false,
    },
    {
      name: 'dueDate',
      type: 'string',
      description: 'Optional due date in YYYY-MM-DD format.',
      required: false,
    },
    {
      name: 'reminderAt',
      type: 'string',
      description: 'Optional reminder time in datetime-local format, for example 2026-06-08T09:00.',
      required: false,
    },
    {
      name: 'subtasks',
      type: 'array',
      description: 'Optional subtasks as strings or objects with title and completed.',
      required: false,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Optional tag ID. Defaults to the current selected tag.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    const title = normalizeText(params.title)
    if (!title) {
      return {
        success: false,
        error: '待办标题不能为空',
      }
    }

    const draft: TodoDraftPayload = {
      title,
      description: normalizeText(params.description) || undefined,
      priority: normalizeTodoPriority(params.priority),
      dueDate: normalizeText(params.dueDate) || undefined,
      reminderAt: normalizeText(params.reminderAt) || undefined,
      reminderEnabled: Boolean(normalizeText(params.reminderAt)),
      subtasks: normalizeTodoSubtasks(params.subtasks),
      tagId: typeof params.tagId === 'number' ? params.tagId : undefined,
    }

    emitter.emit('toolbar-shortcut-todo', draft)

    return {
      success: true,
      data: draft,
      message: '已打开待办面板，请在弹窗中确认并保存。',
    }
  },
}

export const updateMarkTool: Tool = {
  name: 'update_mark',
  description: 'Update content of an existing mark.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Mark ID (use read_marks first to get mark IDs)',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: 'New description',
      required: false,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Move to new tag (optional)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const marks = await getAllMarks()
      const mark = marks.find(m => m.id === params.id)

      if (!mark) {
        return {
          success: false,
          error: `未找到ID为 ${params.id} 的记录`,
        }
      }

      const updatedMark: Mark = {
        ...mark,
        content: params.content !== undefined ? params.content : mark.content,
        desc: params.desc !== undefined ? params.desc : mark.desc,
        tagId: params.tagId !== undefined ? params.tagId : mark.tagId,
      }

      await updateMark(updatedMark)
      await refreshRecordState()
      return {
        success: true,
        message: `成功更新记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新记录失败: ${error}`,
      }
    }
  },
}

export const deleteMarkTool: Tool = {
  name: 'delete_mark',
  description: 'Soft delete a mark. Can be restored with restore_mark.',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Mark ID to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await delMark(params.id)
      await refreshRecordState()
      return {
        success: true,
        message: `成功删除记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除记录失败: ${error}`,
      }
    }
  },
}

export const restoreMarkTool: Tool = {
  name: 'restore_mark',
  description: 'Restore deleted marks',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'ID of the mark to restore',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await restoreMark(params.id)
      await refreshRecordState()
      return {
        success: true,
        message: `成功恢复记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `恢复记录失败: ${error}`,
      }
    }
  },
}

export const searchMarksTool: Tool = {
  name: 'search_marks',
  description: 'Search content within marks (database records). Uses current selected tag if tagId not specified.',
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
      description: 'Tag ID (optional, uses current selected tag if not specified)',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Optional: filter by mark type (scan, text, image, link, file, recording)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tagId = getCurrentTagId(params.tagId)
      const marks = await getMarks(tagId)
      let results = marks.filter(mark =>
        mark.deleted === 0 &&
        (mark.content?.toLowerCase().includes(params.query.toLowerCase()) ||
         mark.desc?.toLowerCase().includes(params.query.toLowerCase()))
      )

      if (params.type) {
        results = results.filter(mark => mark.type === params.type)
      }

      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 条匹配的记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索记录失败: ${error}`,
      }
    }
  },
}

export const searchAllMarksTool: Tool = {
  name: 'search_all_marks',
  description: 'Search ALL marks across ALL tags for keywords.',
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
      name: 'mode',
      type: 'string',
      description: 'Search mode: fuzzy (default, contains keyword) or exact (exact match)',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Optional: filter by mark type (scan, text, image, link, file, recording)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const allMarks = await getAllMarks()
      const queryLower = params.query.toLowerCase()

      let results = allMarks.filter(mark => {
        if (mark.deleted === 1) return false

        const contentMatch = params.mode === 'exact'
          ? mark.content?.toLowerCase() === queryLower
          : mark.content?.toLowerCase().includes(queryLower)
        const descMatch = params.mode === 'exact'
          ? mark.desc?.toLowerCase() === queryLower
          : mark.desc?.toLowerCase().includes(queryLower)

        return contentMatch || descMatch
      })

      if (params.type) {
        results = results.filter(mark => mark.type === params.type)
      }

      return {
        success: true,
        data: results,
        message: `在所有标签中找到 ${results.length} 条匹配的记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索所有记录失败: ${error}`,
      }
    }
  },
}

export const createMarksBatchTool: Tool = {
  name: 'create_marks_batch',
  description: 'Batch create multiple marks to avoid loop calls. Use for scenarios requiring multiple marks to be created at once.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: 'Array of marks to create, each mark contains tagId, type, content, url, desc and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.marks) || params.marks.length === 0) {
        return {
          success: false,
          error: '参数 marks 必须是非空数组',
        }
      }

      const marksToInsert: Partial<Mark>[] = params.marks.map((mark: any) => ({
        tagId: mark.tagId,
        type: mark.type as 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording',
        content: mark.content,
        url: mark.url || '',
        desc: mark.desc,
        createdAt: Date.now(),
        deleted: 0,
      }))

      await insertMarks(marksToInsert)
      await refreshRecordState()

      return {
        success: true,
        data: { count: marksToInsert.length },
        message: `成功批量创建 ${marksToInsert.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量创建记录失败: ${error}`,
      }
    }
  },
}

export const updateMarksBatchTool: Tool = {
  name: 'update_marks_batch',
  description: 'Batch update multiple marks to avoid loop calls. Each mark must include the id field.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: 'Array of marks to update, each mark must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.marks) || params.marks.length === 0) {
        return {
          success: false,
          error: '参数 marks 必须是非空数组',
        }
      }

      const marksToUpdate: Mark[] = params.marks.map((mark: any) => ({
        id: mark.id,
        tagId: mark.tagId,
        type: mark.type,
        content: mark.content,
        url: mark.url,
        desc: mark.desc,
        deleted: mark.deleted ?? 0,
        createdAt: mark.createdAt || Date.now(),
      }))

      await updateMarks(marksToUpdate)
      await refreshRecordState()

      return {
        success: true,
        data: { count: marksToUpdate.length },
        message: `成功批量更新 ${marksToUpdate.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量更新记录失败: ${error}`,
      }
    }
  },
}

export const deleteMarksBatchTool: Tool = {
  name: 'delete_marks_batch',
  description: 'Batch delete multiple marks (soft delete, can be restored) to avoid loop calls.',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of mark IDs to delete',
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

      await deleteMarks(params.ids)
      await refreshRecordState()

      return {
        success: true,
        data: { count: params.ids.length },
        message: `成功批量删除 ${params.ids.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除记录失败: ${error}`,
      }
    }
  },
}

export const restoreMarksBatchTool: Tool = {
  name: 'restore_marks_batch',
  description: 'Batch restore deleted marks to avoid loop calls.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of mark IDs to restore',
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

      await restoreMarks(params.ids)
      await refreshRecordState()

      return {
        success: true,
        data: { count: params.ids.length },
        message: `成功批量恢复 ${params.ids.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量恢复记录失败: ${error}`,
      }
    }
  },
}

export const markTools: Tool[] = [
  readMarksTool,
  createMarkTool,
  openTodoDraftTool,
  updateMarkTool,
  deleteMarkTool,
  restoreMarkTool,
  searchMarksTool,
  searchAllMarksTool,
  createMarksBatchTool,
  updateMarksBatchTool,
  deleteMarksBatchTool,
  restoreMarksBatchTool,
]
