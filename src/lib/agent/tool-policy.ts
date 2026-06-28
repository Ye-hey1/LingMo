export type ToolRiskLevel = 'low' | 'medium' | 'high'

export interface IntentPolicy {
  allowWrite: boolean
  allowFileCreation?: boolean
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
  'github_unstar_repo',
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
  'create_drawio_diagram_from_cells',
  'create_diagram_from_outline',
  'append_drawio_diagram_cells',
  'edit_drawio_diagram',
  'update_diagram_file',
  'export_drawio_diagram',
  'create_visual_report',
  'safe_write_file',
  'github_star_repo',
  'github_update_star_category',
  'github_update_star_notes_tags',
  'github_subscribe_star_releases',
  // Phase 1 #A 文件管理工作流：批量改 frontmatter，影响多个文件但可逆
  'tag_files',
  'set_note_status',
  'bulk_ensure_frontmatter',
])

export const LOW_RISK_WRITE_TOOLS = new Set([
  'create_reminder',
  'cancel_reminder',
  'complete_reminder',
])

export const READ_ONLY_TOOLS = new Set([
  'tool_search',
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'git_blame',
  'code_search_symbols',
  'code_file_outline',
  'code_find_definition',
  'code_find_references',
  'code_read_context',
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
  'validate_drawio_diagram',
  'get_drawio_shape_library',
  'list_visual_report_files',
  'read_visual_report_file',
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
  'list_reminders',
  'search_knowledge_objects',
  'get_knowledge_object_overview',
  'get_current_note_context',
  // Phase 1 #A/#C 只读工具
  'find_unindexed_notes',
  'reindex_knowledge_objects',
  'query_agent_runs',
  'query_self_failures',
  'get_agent_run_detail',
  'github_sync_starred',
  'github_list_starred',
  'github_summarize_recent_stars',
  'github_search_my_stars',
  'github_list_star_releases',
  'github_list_my_forks',
  'github_mark_release_read',
])

const directEditPatterns = [
  /(帮我|请|麻烦|替我|直接|现在|把|将|给).{0,20}(优化|精简|简化|润色|调整|补充|增加|添加|补全|扩写|完善|丰富|重写|改写)/,
  /(优化|精简|简化|润色|调整|补充|增加|添加|补全|扩写|完善|丰富|重写|改写).{0,30}(当前|这个|这段|这篇|这些|本项目|项目中|文件|笔记|代码|图表|内容|文本|文章|提示词|prompt)/i,
  /\b(?:optimize|improve|refine|polish|simplify|rewrite|revise|adjust)\b.{0,40}\b(?:this|current|these|file|note|document|code|project|prompt|content|text|article|chart)\b/i,
]

const fileCreationToolNames = new Set([
  'create_file',
  'create_files_batch',
  'safe_write_file',
  'create_diagram_file',
  'create_drawio_diagram_from_cells',
  'create_diagram_from_outline',
  'create_visual_report',
])

const recoverableWriteToolNames = new Set([
  ...MEDIUM_RISK_TOOLS,
  ...LOW_RISK_WRITE_TOOLS,
])

const intentGatedWriteToolNames = new Set([
  'create_file',
  'create_files_batch',
  'safe_write_file',
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
  'tag_files',
  'set_note_status',
  'bulk_ensure_frontmatter',
])

const writePatterns = [
  /写入|改写|修改|编辑|更新|重写|插入|替换|保存/,
  /(?:创建|新建|新增).{0,24}(?:文件|笔记|文档|目录|文件夹|标签|记录|提醒|记忆|mark|chat|folder|directory|file|note|document|tag|reminder)/i,
  ...directEditPatterns,
  /重新规划|输出到笔记|保存到笔记|写入笔记|整理成笔记/,
  /重命名|改名|命名为|移动|移到|移动到|挪动|挪到|搬到|转移|迁移|复制|拷贝/,
  /(整理|归档|分类|收纳|移动|移到|移动到|挪到|放到|放进|放入).*(文件|目录|文件夹|folder|directory)/i,
  /(把|将).*(文件|笔记|目录|文件夹|内容).*(移动|移到|移动到|挪到|放到|放进|放入|归档|分类|整理|复制|拷贝)/,
  /(?:输出|保存|写入|整理成|存成|存为|导出|导出为|生成|创建|新建).{0,20}(?:笔记|文档|文件|markdown|md|pptx|pdf|docx|xlsx)/i,
  /(?:笔记|文档|文件|markdown|md|pptx|pdf|docx|xlsx).{0,20}(?:输出|保存|写入|整理成|存成|存为|导出|生成|创建|新建)/i,
  /(?:规划|设计|制定|重新规划|生成|整理).{0,30}(?:攻略|方案|行程|路线|计划|旅游|旅行).{0,24}(?:输出|保存|写入|存成|存为|导出|笔记|文档|文件)/,
  /提醒|通知|定时|闹钟|计时器|倒计时/,
  /生成(文件|笔记|文档|图表|流程图|思维导图|白板|幻灯片|ppt|pdf|docx|xlsx)/,
  /(改成|改为|整理成|转换成).{0,24}(当前|这个|这段|这篇|这些|文件|笔记|代码|图表|内容|文本|文章|提示词|prompt)/i,
  /\b(?:save|write|export|create|generate|produce).{0,40}(?:note|document|file|presentation|pptx|pdf|docx|xlsx)\b/i,
  /\b(?:plan|design|draft|write|create|generate|produce).{0,40}(?:itinerary|travel plan|trip plan|route|guide|proposal|report).{0,40}(?:save|write|export|file|note|document)\b/i,
  /\b(?:modify|edit|update|insert|replace|save|rename|move|copy)\b/i,
  /\b(?:organize|archive|classify|sort|relocate)\b.{0,60}\b(?:file|files|note|notes|folder|directory|archive)\b/i,
]

const fileCreationPatterns = [
  /(?:输出|保存|写入|整理成|存成|存为|导出|导出为).{0,24}(?:笔记|文档|文件|markdown|md|pptx|pdf|docx|xlsx)/i,
  /(?:笔记|文档|文件|markdown|md|pptx|pdf|docx|xlsx).{0,24}(?:输出|保存|写入|整理成|存成|存为|导出|生成|创建|新建)/i,
  /(?:创建|新建|新增|生成).{0,24}(?:文件|笔记|文档|markdown|md)/i,
  /(?:规划|设计|制定|重新规划|生成|整理).{0,30}(?:攻略|方案|行程|路线|计划|旅游|旅行).{0,24}(?:输出|保存|写入|存成|存为|导出|笔记|文档|文件)/,
  /\b(?:save|write|export|create|generate|produce).{0,40}(?:note|document|file|presentation|pptx|pdf|docx|xlsx)\b/i,
  /\b(?:itinerary|travel plan|trip plan|guide|proposal|report|plan).{0,40}(?:save|write|export|file|note|document)\b/i,
]

const conceptualWriteQuestionPatterns = [
  /^(什么是|啥是|何为|为什么|怎么|怎样|如何|解释|介绍|讲讲|说说).{0,30}(优化|精简|简化|润色|调整|补充|增加|添加|补全|扩写|完善|丰富|重写|改写|创建|生成|写入|编辑|修改)/,
  /\b(?:what is|why|how to|how can|explain|describe|tell me about|tips for|ways to)\b.{0,60}\b(?:optimize|improve|refine|polish|simplify|rewrite|revise|create|write|edit|modify)\b/i,
]

const concreteTargetPatterns = [
  /(当前|这个|这段|这篇|这些|本项目|项目中|当前项目|文件|笔记|代码|图表|内容|文本|文章|src\/|docs\/)/,
  /\b(?:this|current|these|file|note|document|code|project|workspace|repo|repository|content|text|article|chart)\b/i,
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
  const rawWriteIntent = matchesAny(writePatterns, input) || skillExecutionIntent
  const rawFileCreationIntent = matchesAny(fileCreationPatterns, input) || skillExecutionIntent
  const isConceptualWriteQuestion =
    matchesAny(conceptualWriteQuestionPatterns, input) &&
    !matchesAny(concreteTargetPatterns, input)

  return {
    allowWrite: rawWriteIntent && !isConceptualWriteQuestion,
    allowFileCreation: rawFileCreationIntent && !isConceptualWriteQuestion,
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
  const fileCreationMode = intentPolicy.allowFileCreation ? 'enabled' : 'disabled'
  const destructiveMode = intentPolicy.allowDestructive ? 'enabled' : 'disabled'
  const executeMode = intentPolicy.allowExecute ? 'enabled' : 'disabled'

  return [
    `Modes: write=${writeMode}; fileCreation=${fileCreationMode}; destructive=${destructiveMode}; execute=${executeMode}.`,
    'Read/search tools are allowed when relevant.',
    writeMode === 'enabled'
      ? 'Write/edit/move tools may proceed through the normal confirmation flow.'
      : 'No clear write/move/edit target was detected; ask for the missing target before write tools.',
    fileCreationMode === 'enabled'
      ? 'New file/note creation may proceed through the normal confirmation flow.'
      : 'Do not create new files or notes; ask whether the user wants a saved file first.',
    destructiveMode === 'enabled'
      ? 'Delete/clear tools still require normal high-risk confirmation.'
      : 'Do not delete or clear content; ask for explicit destructive confirmation first.',
    executeMode === 'enabled'
      ? 'Command/script tools still require normal high-risk confirmation.'
      : 'Do not run commands or scripts; ask for explicit execution confirmation first.',
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

  if (LOW_RISK_WRITE_TOOLS.has(toolName) || LOW_RISK_WRITE_TOOLS.has(baseName)) {
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
  const baseName = getBaseToolName(toolName)
  const isDestructive = isDestructiveTool(toolName)
  const isExecute = isExecuteTool(toolName)
  const isRecoverableWrite = recoverableWriteToolNames.has(toolName) || recoverableWriteToolNames.has(baseName)
  const isIntentGatedWrite = intentGatedWriteToolNames.has(toolName) || intentGatedWriteToolNames.has(baseName)

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

  if ((fileCreationToolNames.has(toolName) || fileCreationToolNames.has(baseName)) && !intentPolicy.allowFileCreation) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: '用户未明确要求保存、写入、导出或新建文件；请先询问是否需要生成文件',
    }
  }

  if (isRecoverableWrite && isIntentGatedWrite && risk !== 'low' && !intentPolicy.allowWrite) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: '用户未明确要求写入、编辑、移动或保存内容',
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
