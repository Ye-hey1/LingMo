/**
 * Skill 运行时画像解析
 *
 * 将 Skill 的声明式元数据和兼容性信号统一成可执行路线：
 * writer/advisor 走普通对话生成，agent/workflow 走工具编排。
 */

import type { SkillContent, SkillRuntimeProfile } from './types'

export interface SkillRuntimeResolution {
  profile: SkillRuntimeProfile
  explicit: boolean
  reason: string
}

const AGENT_ACTION_TERMS = [
  'create',
  'modify',
  'edit',
  'update',
  'delete',
  'move',
  'rename',
  'copy',
  'save',
  'export',
  'execute',
  'run',
  'file',
  'script',
  'command',
  'tool',
  'diagram',
  'presentation',
  'deck',
  'pptx',
  'pdf',
  'docx',
  'xlsx',
  '创建',
  '写入',
  '修改',
  '编辑',
  '更新',
  '删除',
  '移动',
  '重命名',
  '复制',
  '保存',
  '导出',
  '执行',
  '运行',
  '脚本',
  '工具',
  '文件',
  '图表',
  '思维导图',
  '演示文稿',
  '命令',
]

const WRITER_TERMS = [
  'write',
  'writing',
  'draft',
  'article',
  'essay',
  'blog',
  'prose',
  'revise',
  'polish',
  'copywriting',
  '文案',
  '写作',
  '文章',
  '草稿',
  '改写',
  '润色',
  '梳理',
  '创作',
]

const ADVISOR_TERMS = [
  'advise',
  'advisor',
  'review',
  'analyze',
  'explain',
  'guide',
  '建议',
  '分析',
  '解释',
  '评审',
  '指导',
]

function skillText(skill: SkillContent): string {
  return [
    skill.metadata.id,
    skill.metadata.name,
    skill.metadata.description,
    skill.metadata.capabilities?.join(' '),
    skill.instructions,
  ].filter(Boolean).join('\n').toLowerCase()
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const normalized = term.toLowerCase()
    if (/^[a-z0-9-]+$/.test(normalized)) {
      return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'i').test(text)
    }
    return text.includes(normalized)
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasAgentArtifacts(skill: SkillContent): boolean {
  return Boolean(
    skill.metadata.allowedTools?.length ||
    skill.scripts?.length
  )
}

export function resolveSkillRuntimeProfile(skill: SkillContent): SkillRuntimeResolution {
  if (skill.metadata.runtimeProfile) {
    return {
      profile: skill.metadata.runtimeProfile,
      explicit: true,
      reason: `declared runtimeProfile=${skill.metadata.runtimeProfile}`,
    }
  }

  if (hasAgentArtifacts(skill)) {
    return {
      profile: 'agent',
      explicit: false,
      reason: 'uses tools, scripts, or assets',
    }
  }

  const text = skillText(skill)

  if (includesAny(text, AGENT_ACTION_TERMS)) {
    return {
      profile: 'agent',
      explicit: false,
      reason: 'contains file/tool execution signals',
    }
  }

  if (includesAny(text, WRITER_TERMS)) {
    return {
      profile: 'writer',
      explicit: false,
      reason: 'contains writing generation signals',
    }
  }

  if (includesAny(text, ADVISOR_TERMS)) {
    return {
      profile: 'advisor',
      explicit: false,
      reason: 'contains advisory signals',
    }
  }

  return {
    profile: 'advisor',
    explicit: false,
    reason: 'default no-tool conversational skill',
  }
}

export function skillRuntimeNeedsAgentMode(profile: SkillRuntimeProfile): boolean {
  return profile === 'agent' || profile === 'workflow'
}
