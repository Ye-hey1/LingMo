import type { Tool } from './types'

/**
 * 工具相关性预筛选
 * 根据用户输入预筛选最相关的工具，减少 LLM 的选择负担
 */

// 工具关键词映射（用于快速匹配）
const TOOL_KEYWORD_MAP: Record<string, string[]> = {
  // 笔记相关
  create_file: ['创建', '新建', '写', '笔记', 'create', 'new', 'write', 'note', '文件', '文章', '草稿'],
  read_markdown_file: ['读取', '查看', '打开', '内容', 'read', 'open', 'view', 'content'],
  list_markdown_files: ['列出', '所有', '文件列表', 'list', 'all', 'files'],
  read_markdown_files_batch: ['批量读取', '多个文件', 'batch read', '读取多个'],

  // 搜索相关
  safe_grep: ['搜索', '查找', '包含', 'search', 'find', 'grep', 'contain', '关键词'],
  web_search: ['搜索', '网上', '查询', '最新', 'search', 'web', 'online', 'latest', '互联网'],
  web_fetch: ['网页', '链接', 'url', 'fetch', 'website', '抓取'],

  // 编辑相关
  replace_editor_content: ['替换', '修改', '编辑', '更新', 'replace', 'modify', 'edit', 'update'],
  insert_at_cursor: ['插入', '添加', '光标', 'insert', 'add', 'cursor'],

  // 文件管理
  rename_file: ['重命名', '改名', 'rename'],
  move_file: ['移动', '转移', 'move'],
  delete_markdown_file: ['删除', '移除', 'delete', 'remove'],
  create_files_batch: ['批量创建', '多个文件', 'batch create'],

  // 文件夹
  list_folders: ['文件夹', '目录', 'folder', 'directory'],
  check_folder_exists: ['文件夹存在', '目录存在', 'folder exists'],

  // 标签和标记
  create_tag: ['标签', '分类', 'tag', 'label', 'category'],
  read_tags: ['标签', '所有标签', 'tags'],
  create_mark: ['高亮', '标记', '摘录', 'highlight', 'mark', 'excerpt'],

  // 记忆
  create_memory: ['记住', '记忆', '偏好', 'remember', 'memory', 'preference'],
  read_memories: ['记忆', '偏好', 'memories', 'preferences'],

  // 图表
  create_diagram_file: ['图表', '流程图', '思维导图', 'diagram', 'flowchart', 'mindmap', '白板'],
  create_diagram_from_outline: ['大纲', '生成图表', 'outline', 'generate diagram'],

  // 闪卡
  create_flashcard: ['闪卡', '卡片', '复习', 'flashcard', 'card', 'review'],

  // 编辑器
  get_editor_content: ['当前内容', '编辑器', '正在编辑', 'current', 'editor'],
  get_editor_selection: ['选中', '选区', 'selection', 'selected'],

  // 活动
  get_activity_summary: ['活动', '统计', '今天', 'activity', 'summary', 'today'],

  // 知识图谱
  get_connected_notes: ['关联', '相关笔记', '链接', 'connected', 'related', 'linked'],
  get_graph_overview: ['图谱', '概览', 'graph', 'overview'],
}

// 用户意图到工具类别的映射
const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  writing: ['note', 'editor'],
  reading: ['note', 'search', 'filesystem'],
  organizing: ['note', 'tag', 'mark'],
  searching: ['search', 'web', 'filesystem'],
  managing: ['note', 'tag', 'system'],
  learning: ['note', 'mark', 'system'],
}

/**
 * 计算工具与用户输入的相关性得分
 */
function computeRelevanceScore(userInput: string, tool: Tool): number {
  const input = userInput.toLowerCase()
  let score = 0

  // 1. 关键词匹配
  const keywords = TOOL_KEYWORD_MAP[tool.name]
  if (keywords) {
    for (const keyword of keywords) {
      if (input.includes(keyword.toLowerCase())) {
        score += 10
      }
    }
  }

  // 2. 工具描述匹配
  const descWords = tool.description.toLowerCase().split(/\s+/)
  const inputWords = input.split(/\s+/)
  for (const word of inputWords) {
    if (word.length > 1 && descWords.some(d => d.includes(word))) {
      score += 3
    }
  }

  // 3. 工具名称部分匹配
  const toolNameParts = tool.name.split('_')
  for (const part of toolNameParts) {
    if (part.length > 2 && input.includes(part)) {
      score += 5
    }
  }

  // 4. Capability 匹配
  if (tool.capabilities) {
    if (tool.capabilities.includes('read') && /读|查|看|搜|find|read|search|view|list|get/.test(input)) {
      score += 2
    }
    if (tool.capabilities.includes('write') && /写|创|改|编|新|add|create|write|edit|modify/.test(input)) {
      score += 2
    }
    if (tool.capabilities.includes('delete') && /删|移除|清|remove|delete|clear/.test(input)) {
      score += 2
    }
    if (tool.capabilities.includes('network') && /网|搜索|链接|url|web|search|online|fetch/.test(input)) {
      score += 2
    }
  }

  return score
}

/**
 * 预筛选相关工具，减少发送给 LLM 的工具数量
 * 
 * 策略：
 * - 所有 read-only 工具始终包含（它们是安全的且常用）
 * - 根据相关性得分选择 top-N 的写入/执行工具
 * - 确保至少包含基础工具集
 */
export function filterRelevantTools(
  userInput: string,
  allTools: Tool[],
  maxWriteTools = 20
): Tool[] {
  if (!userInput || allTools.length <= 30) {
    return allTools // 工具数量不多时不需要筛选
  }

  const readOnlyTools: Tool[] = []
  const otherTools: Array<{ tool: Tool; score: number }> = []

  for (const tool of allTools) {
    if (tool.risk === 'low' || /^(read_|list_|get_|search_|safe_read|safe_list|safe_grep|web_search|web_fetch)/.test(tool.name)) {
      readOnlyTools.push(tool)
    } else {
      otherTools.push({
        tool,
        score: computeRelevanceScore(userInput, tool),
      })
    }
  }

  // 按得分排序，取 top-N
  otherTools.sort((a, b) => b.score - a.score)
  const selectedWriteTools = otherTools.slice(0, maxWriteTools).map(s => s.tool)

  return [...readOnlyTools, ...selectedWriteTools]
}

/**
 * 生成精简的工具描述（只包含筛选后的工具）
 */
export function getFilteredToolDescriptions(tools: Tool[]): string {
  return tools.map(tool => {
    const params = tool.parameters.map(p =>
      `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`
    ).join('\n')

    return `### ${tool.name}
${tool.description}
Parameters:
${params || '  None'}`
  }).join('\n\n')
}
