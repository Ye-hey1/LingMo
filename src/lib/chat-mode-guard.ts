const LOCAL_RESOURCE_TERMS = [
  '文件',
  '笔记',
  '目录',
  '文件夹',
  '编辑器',
  '当前文档',
  '当前笔记',
  'markdown',
  'md',
  'file',
  'note',
  'folder',
  'directory',
  'editor',
]

const OPERATION_TERMS = [
  '创建',
  '新建',
  '生成',
  '写入',
  '保存',
  '修改',
  '改写',
  '替换',
  '插入',
  '追加',
  '删除',
  '移动',
  '重命名',
  '执行',
  '运行',
  '调用工具',
  '建立链接',
  '双向链接',
  '转图',
  '思维导图',
  '闪卡',
  'create',
  'write',
  'save',
  'edit',
  'modify',
  'replace',
  'insert',
  'append',
  'delete',
  'move',
  'rename',
  'run',
  'execute',
  'call tool',
  'wikilink',
  'mindmap',
  'flashcard',
]

const EXPLANATION_TERMS = [
  '解释',
  '介绍',
  '说明',
  '讲讲',
  '什么是',
  '如何',
  '怎么',
  '为什么',
  '区别',
  '原理',
  '建议',
  '方案',
  'explain',
  'what is',
  'how to',
  'why',
  'difference',
]

function includesAny(input: string, terms: string[]) {
  return terms.some(term => input.includes(term))
}

function isSlashCommand(input: string) {
  return /^\/\S+/.test(input.trim())
}

export function requiresAgentModeForLocalAction(input: string) {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return false

  if (isSlashCommand(normalized)) {
    return false
  }

  const hasOperation = includesAny(normalized, OPERATION_TERMS)
  if (!hasOperation) {
    return false
  }

  const hasLocalResource = includesAny(normalized, LOCAL_RESOURCE_TERMS)
  const hasExplicitTool = /(?:调用|使用|执行|run|execute|call)\s*(?:工具|tool)/i.test(input)
  if (!hasLocalResource && !hasExplicitTool) {
    return false
  }

  const isConceptQuestion = includesAny(normalized, EXPLANATION_TERMS)
  const hasDirectActionTone = /^(?:请|帮我|给我|把|将|为|替我|直接|please|help me|create|write|edit|modify|delete|run|execute)\b/i.test(input.trim())

  return hasDirectActionTone || !isConceptQuestion
}
