/**
 * 斜杠命令统一桥接
 *
 * 将内置命令 + 已安装 Skills 统一为 SlashCommandItem，
 * 供 chat-input 和 ai-doc-command-popover 消费。
 *
 * 设计参考 claude-code-source：
 * - 内置命令 (builtin) = AiDocCommand
 * - Skill 命令 (skill) = 已安装的 userInvocable Skills
 * - 统一按 category 分组显示
 */

import { Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  AI_DOC_COMMANDS,
  CATEGORY_LABELS,
  type CommandCategory,
} from '@/lib/ai-doc-commands'
import { skillManager } from '@/lib/skills'
import {
  resolveSkillRuntimeProfile,
  skillRuntimeNeedsAgentMode,
} from '@/lib/skills/runtime-profile'
import type { SkillContent } from '@/lib/skills/types'

// ---------------------------------------------------------------------------
// 统一类型
// ---------------------------------------------------------------------------

export type SlashCommandSource = 'builtin' | 'skill'

export interface SlashCommandItem {
  /** 唯一标识，builtin 用 AiDocCommandId，skill 用 `skill:${id}` */
  id: string
  /** 显示名 */
  title: string
  /** 简短描述 */
  description: string
  /** 图标 */
  icon: LucideIcon
  /** 分组 */
  category: CommandCategory | 'skill'
  /** 来源 */
  source: SlashCommandSource
  /** 需要 agent 模式 */
  executionMode?: 'chat' | 'agent'
  /** 搜索词 */
  searchTerms: string[]
  /** 原始 Skill（仅 source=skill） */
  skillContent?: SkillContent
}

// ---------------------------------------------------------------------------
// 缓存
// ---------------------------------------------------------------------------

let cachedSkillItems: SlashCommandItem[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000 // 30 秒

/**
 * 获取已安装 Skills 转换后的 SlashCommandItem 列表
 * 带 30s 内存缓存，避免每次输入都遍历
 */
async function getSkillSlashItems(): Promise<SlashCommandItem[]> {
  const now = Date.now()
  if (cachedSkillItems && now - cacheTimestamp < CACHE_TTL) {
    return cachedSkillItems
  }

  await skillManager.initialize()
  const skills = skillManager.getUserInvocableSkills()

  cachedSkillItems = skills.map((skill) => {
    const runtime = resolveSkillRuntimeProfile(skill)

    return {
      id: `skill:${skill.metadata.id}`,
      title: skill.metadata.name,
      description: skill.metadata.description || '',
      icon: Sparkles,
      category: 'skill' as const,
      source: 'skill' as SlashCommandSource,
      executionMode: skillRuntimeNeedsAgentMode(runtime.profile) ? 'agent' as const : 'chat' as const,
      searchTerms: [
        skill.metadata.id,
        skill.metadata.name,
        skill.metadata.description,
        skill.metadata.runtimeProfile,
        ...(skill.metadata.capabilities || []),
        ...(skill.metadata.author ? [skill.metadata.author] : []),
      ].filter((term): term is string => Boolean(term)),
      skillContent: skill,
    }
  })

  cacheTimestamp = now
  return cachedSkillItems
}

/** 强制刷新缓存（安装/卸载 Skill 后调用） */
export function invalidateSkillSlashCache() {
  cachedSkillItems = null
  cacheTimestamp = 0
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/**
 * 获取所有可用的斜杠命令（内置 + Skills）
 */
export async function getAllSlashCommands(): Promise<SlashCommandItem[]> {
  const builtinItems: SlashCommandItem[] = AI_DOC_COMMANDS.map((cmd) => ({
    id: cmd.id,
    title: cmd.title,
    description: cmd.description,
    icon: cmd.icon,
    category: cmd.category,
    source: 'builtin' as SlashCommandSource,
    executionMode: cmd.executionMode,
    searchTerms: cmd.searchTerms,
  }))

  const skillItems = await getSkillSlashItems()
  return [...builtinItems, ...skillItems]
}

/**
 * 按查询过滤斜杠命令
 */
export async function filterSlashCommands(query: string): Promise<SlashCommandItem[]> {
  const all = await getAllSlashCommands()
  if (!query) return all

  const q = query.toLowerCase()
  return all.filter((item) =>
    item.title.toLowerCase().includes(q)
    || item.description.toLowerCase().includes(q)
    || item.searchTerms.some((t) => t.toLowerCase().includes(q)),
  )
}

/**
 * 按 ID 查找（兼容 builtin id 和 skill:xxx）
 */
export async function findSlashCommand(id: string): Promise<SlashCommandItem | undefined> {
  const all = await getAllSlashCommands()
  return all.find((item) => item.id === id)
}

// ---------------------------------------------------------------------------
// 分类标签（扩展版）
// ---------------------------------------------------------------------------

export const EXTENDED_CATEGORY_LABELS: Record<CommandCategory | 'skill', string> = {
  ...CATEGORY_LABELS,
  skill: '⚡ Skills',
}
