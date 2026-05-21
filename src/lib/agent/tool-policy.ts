export type ToolRiskLevel = 'low' | 'medium' | 'high'

export interface IntentPolicy {
  allowWrite: boolean
  allowDestructive: boolean
  allowExecute: boolean
}

export interface ToolPolicyEvaluationInput {
  toolName: string
  category: string
  intentPolicy: IntentPolicy
}

export interface ToolPolicyEvaluationResult {
  allowed: boolean
  requiresConfirmation: boolean
  reason?: string
}

export const HIGH_RISK_TOOLS = new Set([
  'execute_skill_script',
  'delete_markdown_file',
  'delete_markdown_files_batch',
  'delete_folder',
  'delete_folders_batch',
  'delete_tag',
  'delete_mark',
  'delete_marks_batch',
  'delete_chat',
  'delete_chats_batch',
  'clear_chats',
  'clear_all_memories',
  'delete_memory',
])

export const MEDIUM_RISK_TOOLS = new Set([
  'create_file',
  'create_files_batch',
  'create_mark',
  'create_marks_batch',
  'update_mark',
  'update_marks_batch',
  'create_tag',
  'update_tag',
  'create_chat',
  'create_chats_batch',
  'update_chat',
  'update_chats_batch',
  'insert_at_cursor',
  'replace_editor_content',
  'rename_file',
  'move_file',
  'copy_file',
  'rename_files_batch',
  'move_files_batch',
  'copy_files_batch',
  'create_diagram_file',
  'create_diagram_from_outline',
  'update_diagram_file',
  'safe_write_file',
])

export const READ_ONLY_TOOLS = new Set([
  'select_skill',
  'load_skill_content',
  'get_editor_selection',
  'get_editor_content',
  'get_current_time',
  'check_folder_exists',
  'list_folders',
  'list_markdown_files',
  'read_markdown_file',
  'list_diagram_files',
  'read_diagram_file',
  'read_marks',
  'read_chats',
  'read_tags',
  'safe_list_files',
  'safe_read_file',
  'safe_grep',
  'web_fetch',
  'web_search',
  'web_extract',
  'list_favorites',
  'get_connected_notes',
  'get_graph_overview',
  'get_note_backlinks',
  'find_path_between_notes',
  'discover_note_clusters',
  'suggest_links_for_note',
  'list_agent_run_summaries',
])

const writePatterns = [
  /创建|新建|新增|写入|改写|修改|编辑|更新|重写|插入|替换|保存/,
  /优化|精简|简化|润色|调整|补充|增加|添加|补全|扩写|完善|丰富/,
  /重命名|改名|命名为|移动|复制|草拟|起草/,
  /写(一篇|个|份)?(关于|有关|主题为)?/,
  /生成(文章|内容|文件|笔记|文档|图表|流程图|思维导图|白板|幻灯片|ppt|pdf|docx|xlsx)/,
  /改成|改为|整理成|转换成/,
  /\b(create|write|draft|modify|edit|update|insert|replace|save|rename|move|copy)\b/i,
]

const destructivePatterns = [
  /删除|删掉|移除|清空|清除/,
  /\b(delete|remove|clear|wipe|purge)\b/i,
]

const executePatterns = [
  /执行|运行|命令|脚本|终端|shell|bash|python|node|npm|pnpm|npx/,
  /\b(run|execute|command|script|terminal|shell|bash|python|node|npm|pnpm|npx)\b/i,
]

const generativeExecutionPatterns = [
  /(用|使用).*(skill|技能).*(生成|导出|转换|渲染|构建|产出|输出|保存为)/,
  /(生成|导出|转换|渲染|构建|产出|输出).*(文件|演示文稿|幻灯片|ppt|pptx|pdf|docx|xlsx)/,
  /(保存为|输出为|导出为|转换为).*(文件|ppt|pptx|pdf|docx|xlsx)/,
  /\b(use .*skill.*(?:generate|export|convert|render|build|produce|save))\b/i,
  /\b(?:generate|export|convert|render|build|produce).*(?:file|presentation|slides|ppt|pptx|pdf|docx|xlsx)\b/i,
  /\b(?:save as|export as|convert to).*(?:ppt|pptx|pdf|docx|xlsx|file)\b/i,
]

const skillExecutionPatterns = [
  /(用|使用).*(skill|技能).*(生成|导出|转换|制作|渲染|输出)/,
  /(生成|导出|转换|制作|渲染|输出).*(pptx|pdf|docx|xlsx|图片|演示文稿|文件)/,
  /\b(use .*skill.*(?:generate|export|convert|render|build))\b/i,
]

const denyDestructivePatterns = [
  /不要删除|别删除|禁止删除|不删|不要清空|别清空|禁止清空/,
  /\b(do not delete|don't delete|no delete|do not remove|don't remove|do not clear|don't clear)\b/i,
]

const denyExecutePatterns = [
  /不要执行|别执行|不运行|禁止执行/,
  /\b(do not execute|don't execute|do not run|don't run)\b/i,
]

function matchesAny(patterns: RegExp[], input: string): boolean {
  return patterns.some((pattern) => pattern.test(input))
}

export function deriveIntentPolicy(userInput: string): IntentPolicy {
  const input = userInput.toLowerCase()
  const skillExecutionIntent = matchesAny(skillExecutionPatterns, input)

  return {
    allowWrite: matchesAny(writePatterns, input) || skillExecutionIntent,
    allowDestructive:
      matchesAny(destructivePatterns, input) &&
      !matchesAny(denyDestructivePatterns, input),
    allowExecute:
      (matchesAny(executePatterns, input) ||
        matchesAny(generativeExecutionPatterns, input) ||
        skillExecutionIntent) &&
      !matchesAny(denyExecutePatterns, input),
  }
}

export function formatIntentPolicyForPrompt(intentPolicy: IntentPolicy): string {
  const writeMode = intentPolicy.allowWrite ? 'enabled' : 'disabled'
  const destructiveMode = intentPolicy.allowDestructive ? 'enabled' : 'disabled'
  const executeMode = intentPolicy.allowExecute ? 'enabled' : 'disabled'

  return [
    `- Write mode: ${writeMode}`,
    `- Destructive mode: ${destructiveMode}`,
    `- Execute mode: ${executeMode}`,
    '- If a mode is disabled, do not call related tools; give Final Answer and ask for explicit user confirmation instead.',
    '- High-risk tools always require confirmation before execution.',
  ].join('\n')
}

export function getBaseToolName(toolName: string): string {
  const separatorIndex = toolName.indexOf('__')
  return separatorIndex === -1 ? toolName : toolName.slice(separatorIndex + 2)
}

export function isExecuteTool(toolName: string): boolean {
  const baseName = getBaseToolName(toolName)
  return baseName === 'execute_skill_script'
    || /(^|_)(execute|run|shell|terminal|command|script|spawn|eval)(_|$)/i.test(baseName)
    || /\b(execute|run|shell|terminal|command|script|spawn|eval)\b/i.test(baseName)
}

export function isDestructiveTool(toolName: string): boolean {
  const baseName = getBaseToolName(toolName)
  return (
    baseName.startsWith('delete_') ||
    baseName.includes('_delete_') ||
    baseName.startsWith('clear_') ||
    baseName.includes('remove') ||
    baseName.includes('purge') ||
    baseName.includes('destroy')
  )
}

function isReadOnlyTool(toolName: string): boolean {
  const baseName = getBaseToolName(toolName)
  if (READ_ONLY_TOOLS.has(toolName) || READ_ONLY_TOOLS.has(baseName)) {
    return true
  }

  const readPrefixes = ['read_', 'list_', 'search_', 'get_', 'fetch_', 'query_', 'describe_', 'inspect_', 'find_']
  return readPrefixes.some((prefix) => baseName.startsWith(prefix))
}

export function getToolRiskLevel(toolName: string, category: string): ToolRiskLevel {
  const baseName = getBaseToolName(toolName)

  if (HIGH_RISK_TOOLS.has(toolName) || HIGH_RISK_TOOLS.has(baseName)) {
    return 'high'
  }

  if (MEDIUM_RISK_TOOLS.has(toolName) || MEDIUM_RISK_TOOLS.has(baseName)) {
    return 'medium'
  }

  if (READ_ONLY_TOOLS.has(toolName) || READ_ONLY_TOOLS.has(baseName)) {
    return 'low'
  }

  if (isExecuteTool(toolName) || isDestructiveTool(toolName)) {
    return 'high'
  }

  if (category === 'editor') {
    if (toolName === 'get_editor_selection' || toolName === 'get_editor_content') {
      return 'low'
    }
    return 'medium'
  }

  if (category === 'filesystem') {
    return toolName === 'safe_write_file' ? 'medium' : 'low'
  }

  if (category === 'web') {
    return 'low'
  }

  if (category === 'mcp') {
    if (isReadOnlyTool(toolName)) {
      return 'low'
    }

    if (/(^|_)(create|write|update|edit|insert|replace|save|upload|post|put|patch|copy|move|rename|send)(_|$)/i.test(baseName)) {
      return 'medium'
    }

    return 'medium'
  }

  if (isReadOnlyTool(toolName)) {
    return 'low'
  }

  return 'medium'
}

export function evaluateIntentAwareToolPolicy(
  input: ToolPolicyEvaluationInput
): ToolPolicyEvaluationResult {
  const { toolName, category, intentPolicy } = input
  const risk = getToolRiskLevel(toolName, category)
  const isDestructive = isDestructiveTool(toolName)
  const isExecute = isExecuteTool(toolName)

  if (isExecute && !intentPolicy.allowExecute) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: '用户未明确要求执行命令或脚本',
    }
  }

  if (isDestructive && !intentPolicy.allowDestructive) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: '用户未明确要求删除或清空操作',
    }
  }

  if (risk === 'medium') {
    return {
      allowed: true,
      requiresConfirmation: true,
    }
  }

  if (risk === 'high' && !isDestructive && !isExecute && !intentPolicy.allowWrite) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: '高风险写入操作需要用户明确修改意图',
    }
  }

  return {
    allowed: true,
    requiresConfirmation: risk === 'high',
  }
}

export function isRecoverableWriteTool(toolName: string, category: string): boolean {
  const risk = getToolRiskLevel(toolName, category)

  return risk === 'medium' && !isDestructiveTool(toolName) && !isExecuteTool(toolName)
}
