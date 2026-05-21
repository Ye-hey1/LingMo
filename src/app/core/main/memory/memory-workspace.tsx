'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, subDays } from 'date-fns'
import { confirm as confirmDialog, open as openDialog, type OpenDialogOptions } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { Badge } from '@/components/ui/badge'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { MemoryList } from '@/components/memories/memory-list'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { createOpenAIClient, getAISettings, validateAIService } from '@/lib/ai/utils'
import { estimateTokens } from '@/lib/ai/token-counter'
import emitter from '@/lib/emitter'
import { highlightTextReact } from '@/lib/highlight'
import {
  deleteLlmMemoryMessage,
  deleteLlmMemorySession,
  getLlmMemorySessionDetail,
  listLlmMemoryEditLogs,
  listLlmMemorySessions,
  restoreLlmMemoryMessage,
  type LlmMemoryEditLogItem,
  type LlmMemoryMessage,
  type LlmMemoryPathOverrides,
  type LlmMemoryPlatform,
  type LlmMemorySessionDetail,
  type LlmMemorySessionListItem,
  updateLlmMemoryMessage,
} from '@/lib/llm-memory/api'
import { consumePendingMemorySessionTarget, type MemorySessionTarget } from './memory-navigation'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'
import {
  Activity,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Brain,
  Bot,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FolderOpen,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
  User,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'

const PATH_STORE_KEY = 'llmMemoryPathOverrides'
const LIST_DENSITY_STORE_KEY = 'llmMemoryListDensity'
const SORT_ORDER_STORE_KEY = 'llmMemorySortOrder'
const SESSION_META_STORE_KEY = 'llmMemorySessionMeta'
const NOTE_FOLDER = 'memory-notes'
const GENERATED_ALIAS_MAX_CHARS = 42
const GENERATED_ALIAS_SUMMARY_MAX_CHARS = 140
const ALIAS_USER_MESSAGE_MAX_CHARS = 220
const ALIAS_SOURCE_MAX_CHARS = 24_000
const PAGE_SIZE = 500
const SEARCH_PAGE_SIZE = 1000
const EDIT_LOG_PAGE_SIZE = 200
const BATCH_DELETE_SESSION_KEY = '__batch_delete__'
type SessionListDensity = 'comfortable' | 'compact'
type SessionSortOrder = 'newest' | 'oldest'
type MessageRoleFilter = 'all' | 'user' | 'assistant' | 'thinking'

type SessionMetaRecord = {
  aliasTitle?: string
  favorite?: boolean
}

type SessionMetaStore = Record<string, SessionMetaRecord>
type PathOverrideField = keyof LlmMemoryPathOverrides

type PlatformSessionViewCache = {
  sessions: LlmMemorySessionListItem[]
  total: number
  selectedSessionKey: string
  detail: LlmMemorySessionDetail | null
  editLogs: LlmMemoryEditLogItem[]
  queryInput: string
  query: string
  favoritesOnly: boolean
  dateFrom: string
  dateTo: string
  selectedProjectKeys: string[]
}

const platformSessionViewCache: Partial<Record<LlmMemoryPlatform, PlatformSessionViewCache>> = {}
const platformSessionLoadedCache: Partial<Record<LlmMemoryPlatform, boolean>> = {}

function PathInputWithPicker({
  value,
  onChange,
  onPick,
  placeholder,
  pickLabel = '选择文件夹',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  onPick: () => void
  placeholder: string
  pickLabel?: string
  className?: string
}) {
  return (
    <div className={`flex w-full min-w-0 items-center gap-1.5 ${className}`}>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 px-2 text-xs"
      />
      <Button type="button" variant="outline" size="icon" className="size-7 shrink-0" onClick={onPick} title={pickLabel}>
        <FolderOpen className="size-3.5" />
        <span className="sr-only">{pickLabel}</span>
      </Button>
    </div>
  )
}

function toSafeSegment(value: string, fallback: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return sanitized || fallback
}

function timestampToDate(value: string | number) {
  let num: number

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    num = Number(trimmed)
    if (Number.isNaN(num)) {
      const parsed = new Date(trimmed)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  } else {
    num = value
  }

  if (Number.isNaN(num)) return null
  if (num > 10 ** 17) {
    return new Date(num / 1_000_000)
  }
  if (num > 10 ** 15) {
    return new Date(num / 1_000)
  }
  if (num > 10 ** 12) {
    return new Date(num)
  }
  return new Date(num * 1_000)
}

function formatDateTime(date: Date, withSeconds = false) {
  const seconds = withSeconds ? `:${String(date.getSeconds()).padStart(2, '0')}` : ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}${seconds}`
}

function formatTimestamp(value: string | number) {
  const date = timestampToDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  return formatDateTime(date)
}

function formatMessageTimestamp(value?: string | number) {
  if (value === undefined || value === null) return ''
  const date = timestampToDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  return formatDateTime(date, true)
}

function parseTimestampMillis(value: string | number) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const numeric = Number(trimmed)
    if (!Number.isNaN(numeric)) {
      return parseTimestampMillis(numeric)
    }
    const date = new Date(trimmed)
    const time = date.getTime()
    return Number.isNaN(time) ? 0 : time
  }

  const num = value
  if (Number.isNaN(num)) return 0
  if (num > 10 ** 17) return Math.floor(num / 1_000_000)
  if (num > 10 ** 15) return Math.floor(num / 1_000)
  if (num > 10 ** 12) return num
  return num * 1_000
}

function dateInputStartMs(value: string) {
  if (!value) return 0
  const date = new Date(`${value}T00:00:00`)
  const time = date.getTime()
  return Number.isNaN(time) ? 0 : time
}

function dateInputEndMs(value: string) {
  if (!value) return Number.MAX_SAFE_INTEGER
  const date = new Date(`${value}T23:59:59.999`)
  const time = date.getTime()
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time
}

function roleLabel(role: string) {
  if (role === 'assistant') return '助手'
  if (role === 'user') return '用户'
  if (role === 'thinking') return '思考'
  if (role === 'tool') return '工具'
  return role
}

function roleCardClass(role: string) {
  if (role === 'user') return 'bg-primary/[0.02] dark:bg-primary/[0.04]'
  if (role === 'assistant') return ''
  if (role === 'thinking') return 'bg-muted/40'
  if (role === 'tool') return 'bg-muted/20'
  return ''
}

function roleBadgeClass(role: string) {
  if (role === 'user') return 'bg-primary/10 text-foreground/80 border-primary/15'
  if (role === 'assistant') return 'bg-foreground/[0.07] text-foreground/70 border-foreground/10'
  if (role === 'thinking') return 'bg-muted text-muted-foreground border-border'
  return ''
}

function truncateText(content: string, maxChars = 120) {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}...`
}

function buildSessionDisplayTitle(session: LlmMemorySessionListItem) {
  const title = (session.title || '').trim()
  if (title && title !== session.sessionId) {
    return title
  }

  const preview = (session.preview || '').trim().replace(/\s+/g, ' ')
  if (preview) {
    return truncateText(preview, 52)
  }

  const time = formatTimestamp(session.updatedAt)
  if (time) {
    return `会话 ${time}`
  }

  return '未命名会话'
}

function buildMetaKey(platform: LlmMemoryPlatform, sessionKey: string) {
  return `${platform}::${sessionKey}`
}

function commandDisplayLabel(name: string) {
  if (name === 'resume') return '继续会话'
  if (name === 'fork') return '派生会话'
  return name
}

function platformDisplayName(platform: string) {
  if (platform === 'claude') return 'Claude'
  if (platform === 'codex') return 'Codex'
  if (platform === 'opencode') return 'OpenCode'
  if (platform === 'lingmo') return 'LingMo'
  return platform || 'Unknown'
}

function formatDateForTitle(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizeProjectPath(cwd: string) {
  return (cwd || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '')
}

function getProjectFolderName(cwd: string) {
  const normalized = normalizeProjectPath(cwd)
  if (!normalized) return '未知项目'
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) || normalized
}

function getProjectFilterKey(cwd: string) {
  return getProjectFolderName(cwd).toLocaleLowerCase('zh-CN')
}

function normalizeAlias(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 60)
}

function cleanGeneratedAliasText(raw: string) {
  return raw
    .replace(/```(?:json|JSON)?/g, ' ')
    .replace(/```/g, ' ')
    .replace(/`+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
}

function stripAliasMetaPreamble(value: string) {
  return value
    .replace(/^(我们|我来|以下|根据|本次|该用户|系统).{0,40}?[：:]\s*/i, '')
    .replace(/^(这个|本次)?会话(主要)?(围绕|关于|讨论|解决|用于)\s*/i, '')
    .replace(/^(用户在|用户希望|用户想要|用户需要|用户询问|用户多次提问关于|用户的问题是|用户主要想解决|用户)\s*/i, '')
    .replace(/^(我想要|我希望|我需要|请帮我|帮我|麻烦|请)\s*/i, '')
    .replace(/和\s*AI\s*助手/g, '')
    .replace(/迭代修改一个/g, '迭代优化')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeGeneratedAlias(raw: string, maxChars = GENERATED_ALIAS_MAX_CHARS) {
  const cleaned = cleanGeneratedAliasText(raw)
  if (!cleaned) return ''

  const titleFromJson = raw
    .replace(/```(?:json|JSON)?/g, '')
    .replace(/```/g, '')
    .match(/["“]?(?:title|shortTitle|标题|短标题|会话标题)["”]?\s*[:：]\s*["“]?([^"\n,}”]+)/i)?.[1]?.trim()
  const source = titleFromJson || cleaned
  const first = source
    .split(/\n|。|！|？|；|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1) || source

  return stripAliasMetaPreamble(first)
    .replace(/^(title|shortTitle|标题|短标题|会话标题|别名|候选标题)[:：]\s*/i, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
    .slice(0, maxChars)
}

function extractJsonObjectText(raw: string) {
  const unfenced = raw
    .replace(/```(?:json|JSON)?/g, '')
    .replace(/```/g, '')
    .trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) return ''
  return unfenced.slice(start, end + 1)
}

function normalizeAliasSummary(value: string, maxChars = GENERATED_ALIAS_SUMMARY_MAX_CHARS) {
  return cleanGeneratedAliasText(value)
    .replace(/^(summary|userProblemSummary|问题总结|用户问题总结)[:：]\s*/i, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
    .slice(0, maxChars)
}

function parseGeneratedAliasPayload(raw: string) {
  const jsonText = extractJsonObjectText(raw)
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>
      const getString = (...keys: string[]) => {
        for (const key of keys) {
          if (typeof parsed[key] === 'string') return parsed[key] as string
        }
        return ''
      }
      const title = getString('title', 'shortTitle', '标题', '短标题', '会话标题')
      const summary = getString('userProblemSummary', 'problemSummary', 'summary', '用户问题总结', '问题总结')
      return {
        title: normalizeGeneratedAlias(title || raw, GENERATED_ALIAS_MAX_CHARS),
        summary: normalizeAliasSummary(summary),
      }
    } catch {
      // Fall through to tolerant text parsing for providers that wrap or repair JSON.
    }
  }

  return {
    title: normalizeGeneratedAlias(raw, GENERATED_ALIAS_MAX_CHARS),
    summary: normalizeAliasSummary(
      cleanGeneratedAliasText(raw).match(/["“]?(?:userProblemSummary|problemSummary|summary|问题总结|用户问题总结)["”]?\s*[:：]\s*["“]([^"”]+)["”]/i)?.[1] || '',
    ),
  }
}

function extractAssistantTextFromCompletion(completion: unknown) {
  const firstChoice = (completion as any)?.choices?.[0]
  const message = firstChoice?.message

  const contentValue = message?.content
  let contentText = ''
  if (typeof contentValue === 'string') {
    contentText = contentValue
  } else if (Array.isArray(contentValue)) {
    contentText = contentValue
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text
          if (part.type === 'text' && typeof part.content === 'string') return part.content
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (contentText.trim()) return contentText

  const fallbackText = firstChoice?.text
  if (typeof fallbackText === 'string' && fallbackText.trim()) {
    return fallbackText
  }

  return ''
}

function sanitizeMessageForAlias(content: string) {
  return (content || '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ensureProblemTitleAlias(text: string, maxChars = GENERATED_ALIAS_MAX_CHARS) {
  let value = text.trim().replace(/[。！？!?,，；;：:]+$/g, '')
  if (!value) return ''
  value = stripAliasMetaPreamble(value)
    .replace(/^(总结|分析|讨论)\s*(关于|一下)?\s*/i, '')
    .replace(/\b(conversation|chat|session)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return value.slice(0, maxChars)
}

function buildUserQuestionAliasSource(detail: LlmMemorySessionDetail) {
  const userMessages = detail.messages.filter((message) => message.role === 'user')
  const blocks: string[] = []
  let usedChars = 0

  for (const [index, message] of userMessages.entries()) {
    const content = truncateText(sanitizeMessageForAlias(message.content || ''), ALIAS_USER_MESSAGE_MAX_CHARS)
    if (!content) continue
    const block = `用户问题 ${index + 1}：${content}`
    const nextChars = usedChars + block.length + 2
    if (nextChars > ALIAS_SOURCE_MAX_CHARS) {
      blocks.push(`（其余 ${userMessages.length - index} 条用户问题因上下文过长未展开，请综合已列问题提炼主线。）`)
      break
    }
    blocks.push(block)
    usedChars = nextChars
  }

  return blocks.join('\n\n')
}

function buildAliasSource(detail: LlmMemorySessionDetail) {
  return buildUserQuestionAliasSource(detail)
}

function buildLocalAliasFallback(detail: LlmMemorySessionDetail) {
  const userTexts = detail.messages
    .filter((message) => message.role === 'user')
    .map((message) => sanitizeMessageForAlias(message.content || ''))
    .filter(Boolean)

  if (!userTexts.length) return ''

  const actionPattern = /(集成|实现|优化|修复|改造|生成|总结|分析|完善|添加|接入|解决|整理|设计)[^，。！？；;.!?\n]{4,80}/
  const candidateSource =
    userTexts.find((text) => actionPattern.test(text)) ||
    [...userTexts].reverse().find((text) => text.length > 8) ||
    userTexts[0]
  const actionMatch = candidateSource.match(actionPattern)
  const candidate = actionMatch?.[0] || candidateSource.split(/[。！？；;.!?\n]/).find(Boolean) || candidateSource

  return normalizeAlias(ensureProblemTitleAlias(candidate, GENERATED_ALIAS_MAX_CHARS))
}

function buildAliasRetryPrompt(detail: LlmMemorySessionDetail) {
  const userQuestions = buildUserQuestionAliasSource(detail)

  return [
    '请根据下面所有用户问题生成一个中文会话标题。',
    '只输出标题一行，不要解释，不要 JSON，不要 Markdown。',
    '标题约30字，说明这个会话主要在做什么、解决什么问题。',
    '不要出现“用户”“会话”“聊天”“根据”等元描述词。',
    '',
    userQuestions || '(empty)',
  ].join('\n')
}

function buildSessionSummaryPrompt(detail: LlmMemorySessionDetail) {
  const lines = detail.messages
    .slice(-120)
    .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
    .join('\n\n')
    .slice(0, 50_000)

  return [
    '你是资深知识管理助手。请把下面的 AI 会话整理成结构化 Markdown 笔记。',
    '要求：',
    '1. 使用简体中文。',
    '2. 只输出 Markdown，不要输出 JSON。',
    '3. 必须包含这些章节：会话目标、核心事实与上下文、关键决策与原因、关键操作（命令/工具/代码变更）、待办事项、风险与注意事项。',
    '4. 每个章节使用简洁要点，避免空话。',
    '5. 如果信息不足，明确标注“信息不足”。',
    '',
    `会话平台：${detail.platform}`,
    `会话 ID：${detail.sessionId}`,
    `工作目录：${detail.cwd || '(unknown)'}`,
    '',
    '会话内容：',
    lines || '(empty)',
  ].join('\n')
}

function buildCombinedSessionSummaryPrompt(details: LlmMemorySessionDetail[]) {
  const blocks = details
    .map((detail, index) => {
      const lines = detail.messages
        .slice(-80)
        .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
        .join('\n\n')
        .slice(0, 20_000)
      return [
        `### 会话 ${index + 1}`,
        `平台：${detail.platform}`,
        `会话 ID：${detail.sessionId}`,
        `工作目录：${detail.cwd || '(unknown)'}`,
        '',
        lines || '(empty)',
      ].join('\n')
    })
    .join('\n\n---\n\n')

  return [
    '你是资深知识管理助手。请把下面多个 AI 会话整理成一份统一的结构化 Markdown 笔记。',
    '要求：',
    '1. 使用简体中文。',
    '2. 只输出 Markdown，不要输出 JSON。',
    '3. 按“主题/项目”聚合重复信息，提炼共同结论与差异点。',
    '4. 必须包含章节：总体目标、关键事实、关键决策、关键操作、待办清单、风险与后续建议。',
    '5. 如果某条会话信息不足，标注“信息不足”。',
    '',
    `会话数量：${details.length}`,
    '',
    blocks,
  ].join('\n')
}

function buildAliasPrompt(detail: LlmMemorySessionDetail) {
  const userQuestions = buildUserQuestionAliasSource(detail)

  return [
    '你是会话标题生成助手。请从用户消息里归纳“用户到底想完成什么、遇到什么问题、希望解决什么”，并生成一个清晰中文短标题。',
    '要求：',
    '1. 必须只依据“用户问题清单”归纳标题。',
    '2. 需要综合用户所有问题形成主线，不要只抓最后一句，也不要照抄单句追问。',
    '3. 标题要让人一眼看出这个会话在做什么、解决什么问题，使用“动作 + 对象/问题”的短语。',
    '4. 标题控制在30字左右；如果30字说不清，可以适当放宽，但不要冗长。',
    '5. 不要使用“用户”“会话”“聊天”“根据”“我们分析”等元描述词；只有功能对象本身包含 AI 时才可使用“AI”。',
    '6. 如果有多个问题，选择贯穿最多或最后明确推进的核心问题。',
    '7. 只输出最终标题一行，不要输出 JSON、Markdown、解释、引号或思考过程。',
    '',
    `平台：${detail.platform}`,
    `工作目录：${detail.cwd || '(unknown)'}`,
    '',
    '用户问题清单：',
    userQuestions || '(empty)',
  ].join('\n')
}

function buildSummaryNoteContent(detail: LlmMemorySessionDetail, summaryMarkdown: string) {
  const now = new Date()
  const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  const commands = Object.entries(detail.commands || {})
    .map(([name, command]) => `- ${name}: \`${command}\``)
    .join('\n')

  return `# ${detail.title || detail.sessionId}

- 平台: \`${detail.platform}\`
- 会话 ID: \`${detail.sessionId}\`
- 工作目录: \`${detail.cwd || 'N/A'}\`
- 生成时间: ${createdAt}

## AI 总结

${summaryMarkdown.trim()}

## 继续会话命令

${commands || '- N/A'}
`
}

function buildCombinedSummaryNoteContent(details: LlmMemorySessionDetail[], summaryMarkdown: string) {
  const now = new Date()
  const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  const sessionList = details
    .map(
      (detail, index) =>
        `${index + 1}. [${detail.platform}] ${detail.sessionId} (${detail.cwd || 'N/A'})`,
    )
    .join('\n')

  return `# 多会话 AI 总结\n\n- 会话数量: ${details.length}\n- 生成时间: ${createdAt}\n\n## 会话清单\n\n${sessionList}\n\n## AI 总结\n\n${summaryMarkdown.trim()}\n`
}

function getExportableMessages(detail: LlmMemorySessionDetail) {
  return detail.messages.filter((message) => ['user', 'assistant', 'thinking'].includes(message.role))
}

function getMessageTimeRange(messages: LlmMemoryMessage[]) {
  const times = messages
    .map((message) => (message.timestamp ? parseTimestampMillis(message.timestamp) : 0))
    .filter((time) => time > 0)
    .sort((a, b) => a - b)

  if (!times.length) {
    return {
      label: 'N/A',
      start: null as Date | null,
    }
  }

  const start = new Date(times[0])
  const end = new Date(times[times.length - 1])
  const startLabel = formatDateTime(start, true)
  const endLabel = formatDateTime(end, true)

  return {
    label: startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`,
    start,
  }
}

function exportRoleLabel(role: string) {
  if (role === 'user') return '用户'
  if (role === 'assistant') return 'AI'
  if (role === 'thinking') return '思考'
  return role
}

function escapeMarkdownHtml(content: string) {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildExportTitle(detail: LlmMemorySessionDetail, messages: LlmMemoryMessage[]) {
  const range = getMessageTimeRange(messages)
  const date = range.start || new Date()
  return `${platformDisplayName(detail.platform)}-${formatDateForTitle(date)}-${messages.length}条记录`
}

function buildExportMarkdown(detail: LlmMemorySessionDetail): string {
  const lines: string[] = []
  const exportableMessages = getExportableMessages(detail)
  const sessionTitle = buildExportTitle(detail, exportableMessages)
  const timeRange = getMessageTimeRange(exportableMessages)

  lines.push(`# ${sessionTitle}`)
  lines.push('')
  lines.push(`- **平台**: ${platformDisplayName(detail.platform)}`)
  lines.push(`- **会话 ID**: ${detail.sessionId}`)
  lines.push(`- **工作目录**: ${detail.cwd}`)
  lines.push(`- **会话时间（时间段）**: ${timeRange.label}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const message of exportableMessages) {
    const roleLabel = exportRoleLabel(message.role)
    const timestamp = message.timestamp ? ` \`${formatMessageTimestamp(message.timestamp)}\`` : ''

    lines.push(`## ${roleLabel}${timestamp}`)
    lines.push('')
    lines.push(escapeMarkdownHtml(message.content || '（空内容）'))
    lines.push('')
  }

  return lines.join('\n')
}

async function ensureWorkspaceFolder(relativeFolderPath: string) {
  const workspace = await getWorkspacePath()
  const folderOptions = await getFilePathOptions(relativeFolderPath)

  if (workspace.isCustom) {
    if (!(await exists(folderOptions.path))) {
      await mkdir(folderOptions.path, { recursive: true })
    }
    return
  }

  if (!(await exists(folderOptions.path, { baseDir: folderOptions.baseDir }))) {
    await mkdir(folderOptions.path, { baseDir: folderOptions.baseDir, recursive: true })
  }
}

async function writeWorkspaceNote(relativePath: string, content: string) {
  const workspace = await getWorkspacePath()
  const fileOptions = await getFilePathOptions(relativePath)

  if (workspace.isCustom) {
    await writeTextFile(fileOptions.path, content)
    return
  }

  await writeTextFile(fileOptions.path, content, { baseDir: fileOptions.baseDir })
}

async function noteExists(relativePath: string) {
  const workspace = await getWorkspacePath()
  const fileOptions = await getFilePathOptions(relativePath)

  if (workspace.isCustom) {
    return exists(fileOptions.path)
  }

  return exists(fileOptions.path, { baseDir: fileOptions.baseDir })
}

async function createSummaryNoteFile(detail: LlmMemorySessionDetail, summaryMarkdown: string) {
  await ensureWorkspaceFolder(NOTE_FOLDER)

  const now = new Date()
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const sessionPart = toSafeSegment(detail.sessionId, 'session')
  const baseName = `${detail.platform}-${sessionPart}-${datePart}`

  let filePath = `${NOTE_FOLDER}/${baseName}.md`
  let index = 2
  while (await noteExists(filePath)) {
    filePath = `${NOTE_FOLDER}/${baseName}-${index}.md`
    index += 1
  }

  const content = buildSummaryNoteContent(detail, summaryMarkdown)
  await writeWorkspaceNote(filePath, content)
  return filePath
}

async function createCombinedSummaryNoteFile(details: LlmMemorySessionDetail[], summaryMarkdown: string) {
  await ensureWorkspaceFolder(NOTE_FOLDER)

  const now = new Date()
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const baseName = `multi-session-summary-${datePart}`

  let filePath = `${NOTE_FOLDER}/${baseName}.md`
  let index = 2
  while (await noteExists(filePath)) {
    filePath = `${NOTE_FOLDER}/${baseName}-${index}.md`
    index += 1
  }

  const content = buildCombinedSummaryNoteContent(details, summaryMarkdown)
  await writeWorkspaceNote(filePath, content)
  return filePath
}

async function exportSessionToMarkdown(detail: LlmMemorySessionDetail) {
  await ensureWorkspaceFolder(NOTE_FOLDER)

  const exportableMessages = getExportableMessages(detail)
  const baseName = toSafeSegment(buildExportTitle(detail, exportableMessages), 'session-export')

  let filePath = `${NOTE_FOLDER}/${baseName}.md`
  let index = 2
  while (await noteExists(filePath)) {
    filePath = `${NOTE_FOLDER}/${baseName}-${index}.md`
    index += 1
  }

  await writeWorkspaceNote(filePath, buildExportMarkdown(detail))
  return filePath
}

const HEATMAP_LEVEL_CLASSES = [
  'bg-border hover:bg-border/80',
  'bg-emerald-300 dark:bg-emerald-800/80',
  'bg-emerald-500 dark:bg-emerald-600',
  'bg-emerald-700 dark:bg-emerald-400',
  'bg-emerald-800 dark:bg-emerald-300',
]

const WEEKDAY_LABELS = ['1', '2', '3', '4', '5', '6', '7']
const CELL = 10
const GAP = 2
const COL = CELL + GAP

function getIntensityLevel(count: number) {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  return 4
}

function formatDayDate(cellDate: Date) {
  return `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`
}

function MiniActivityHeatmap({ sessions }: { sessions: LlmMemorySessionListItem[] }) {
  const { weeks, monthLabels } = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayOfWeek = today.getDay()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - dayOfWeek - 7 * 11)

    const dayCounts = new Map<string, number>()
    for (const session of sessions) {
      const ms = parseTimestampMillis(session.updatedAt)
      if (!ms) continue
      const d = new Date(ms)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      dayCounts.set(key, (dayCounts.get(key) || 0) + 1)
    }

    const result: { days: { dateStr: string; count: number }[] }[] = []
    const monthRanges: { startWeek: number; endWeek: number; label: string }[] = []
    let lastMonth = -1
    let startWeek = 0

    for (let w = 0; w < 12; w++) {
      const days: { dateStr: string; count: number }[] = []
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(startDate)
        cellDate.setDate(cellDate.getDate() + w * 7 + d)
        const key = `${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`
        days.push({ dateStr: formatDayDate(cellDate), count: dayCounts.get(key) || 0 })
        if (d === 0 && cellDate.getMonth() !== lastMonth) {
          if (lastMonth !== -1) {
            monthRanges.push({ startWeek, endWeek: w - 1, label: `${cellDate.getMonth() + 1}月` })
          }
          startWeek = w
          lastMonth = cellDate.getMonth()
        }
      }
      result.push({ days })
    }
    // 最后一个月份
    if (lastMonth !== -1) {
      monthRanges.push({ startWeek, endWeek: 11, label: `${new Date(startDate.getFullYear(), startDate.getMonth(), 1).getMonth() === lastMonth ? startDate.getMonth() + 1 : lastMonth + 1}月` })
    }
    // 修正：重新计算每个月的 label
    const finalLabels: { startWeek: number; endWeek: number; label: string }[] = []
    let lm = -1
    let sw = 0
    for (let w = 0; w < 12; w++) {
      const cellDate = new Date(startDate)
      cellDate.setDate(cellDate.getDate() + w * 7)
      if (cellDate.getMonth() !== lm) {
        if (lm !== -1) {
          finalLabels.push({ startWeek: sw, endWeek: w - 1, label: `${lm + 1}月` })
        }
        sw = w
        lm = cellDate.getMonth()
      }
    }
    if (lm !== -1) {
      finalLabels.push({ startWeek: sw, endWeek: 11, label: `${lm + 1}月` })
    }
    return { weeks: result, monthLabels: finalLabels }
  }, [sessions])

  // 月份标签居中位置计算
  const gridWidth = weeks.length * COL - GAP

  return (
    <div className="flex flex-col items-center">
      {/* 月份标签 - 居中于对应月份的列范围 */}
      <div className="relative h-4" style={{ width: gridWidth }}>
        {monthLabels.map((ml) => {
          const centerWeek = (ml.startWeek + ml.endWeek) / 2
          return (
            <span
              key={ml.label}
              className="absolute text-[10px] text-muted-foreground/70 leading-none whitespace-nowrap"
              style={{ left: centerWeek * COL, transform: 'translateX(-50%)' }}
            >
              {ml.label}
            </span>
          )
        })}
      </div>
      <div className="flex">
        {/* 星期标签 */}
        <div className="flex flex-col shrink-0" style={{ gap: GAP, width: 22 }}>
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} className="flex items-center justify-end leading-none pr-1.5" style={{ height: CELL }}>
              <span className="text-[10px] text-muted-foreground/50">{label}</span>
            </div>
          ))}
        </div>
        {/* 热力方块网格 */}
        <div className="flex" style={{ gap: GAP }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
              {week.days.map((day) => (
                <div
                  key={day.dateStr}
                  className={`rounded-[2px] transition-colors cursor-default ${HEATMAP_LEVEL_CLASSES[getIntensityLevel(day.count)]}`}
                  style={{ width: CELL, height: CELL }}
                  title={`${day.dateStr}: ${day.count} 会话`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* 图例 */}
      <div className="flex items-center gap-1 mt-2">
        <span className="text-[10px] text-muted-foreground/50">少</span>
        {HEATMAP_LEVEL_CLASSES.map((_, i) => (
          <div key={i} className={`rounded-[2px] ${HEATMAP_LEVEL_CLASSES[i]}`} style={{ width: 8, height: 8 }} />
        ))}
        <span className="text-[10px] text-muted-foreground/50">多</span>
      </div>
    </div>
  )
}

export function MemoryWorkspace() {
  const { loadFileTree, setActiveFilePath } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()

  const [platform, setPlatform] = useState<LlmMemoryPlatform>('lingmo')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [paths, setPaths] = useState<LlmMemoryPathOverrides>({
    claudeHome: '',
    codexHome: '',
    codexProjectRoot: '',
    opencodeDbPath: '',
    lingmoHome: '',
  })
  const [appliedPaths, setAppliedPaths] = useState<LlmMemoryPathOverrides>({
    claudeHome: '',
    codexHome: '',
    codexProjectRoot: '',
    opencodeDbPath: '',
    lingmoHome: '',
  })
  const [viewMode, setViewMode] = useState<'sessions' | 'ai-memories'>('sessions')
  const [pathsReady, setPathsReady] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const [sessions, setSessions] = useState<LlmMemorySessionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loadingSessions, setLoadingSessions] = useState(false)

  const [selectedSessionKey, setSelectedSessionKey] = useState('')
  const [detail, setDetail] = useState<LlmMemorySessionDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [editingId, setEditingId] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())
  const [messageSearchQuery, setMessageSearchQuery] = useState('')
  const [messageSearchIndex, setMessageSearchIndex] = useState(0)
  const messageSearchInputRef = useRef<HTMLInputElement>(null)
  const [savingMessage, setSavingMessage] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [generatingAlias, setGeneratingAlias] = useState(false)
  const [deletingSessionKey, setDeletingSessionKey] = useState<string | null>(null)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<string[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectedProjectKeys, setSelectedProjectKeys] = useState<string[]>([])
  const [aliasInput, setAliasInput] = useState('')
  const [messageRoleFilter, setMessageRoleFilter] = useState<MessageRoleFilter>('all')

  const [historyOpen, setHistoryOpen] = useState(false)
  const [editLogs, setEditLogs] = useState<LlmMemoryEditLogItem[]>([])
  const [loadingEditLogs, setLoadingEditLogs] = useState(false)
  const [restoringLogId, setRestoringLogId] = useState<number | null>(null)
  const [showPathSettings, setShowPathSettings] = useState(false)
  const [listDensity, setListDensity] = useState<SessionListDensity>('comfortable')
  const [sortOrder, setSortOrder] = useState<SessionSortOrder>('newest')
  const [sessionMeta, setSessionMeta] = useState<SessionMetaStore>({})
  const [dateFilterOpen, setDateFilterOpen] = useState(false)
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const skipNextSessionsReloadRef = useRef(false)
  const skipNextDetailReloadRef = useRef(false)
  const skipNextEditLogsReloadRef = useRef(false)
  const pendingPlatformHydrationRef = useRef<LlmMemoryPlatform | null>(null)
  const pendingSessionTargetRef = useRef<MemorySessionTarget | null>(null)

  useEffect(() => {
    const loadPaths = async () => {
      const store = await Store.load('store.json')
      const saved = await store.get<LlmMemoryPathOverrides>(PATH_STORE_KEY)
      const savedDensity = await store.get<SessionListDensity>(LIST_DENSITY_STORE_KEY)
      const savedSortOrder = await store.get<SessionSortOrder>(SORT_ORDER_STORE_KEY)
      const savedMeta = await store.get<SessionMetaStore>(SESSION_META_STORE_KEY)
      if (saved) {
        const normalized = {
          claudeHome: saved.claudeHome || '',
          codexHome: saved.codexHome || '',
          codexProjectRoot: saved.codexProjectRoot || '',
          opencodeDbPath: saved.opencodeDbPath || '',
          lingmoHome: saved.lingmoHome || '',
        }
        setPaths(normalized)
        setAppliedPaths(normalized)
      }
      if (savedDensity === 'compact' || savedDensity === 'comfortable') {
        setListDensity(savedDensity)
      }
      if (savedSortOrder === 'newest' || savedSortOrder === 'oldest') {
        setSortOrder(savedSortOrder)
      }
      if (savedMeta && typeof savedMeta === 'object') {
        setSessionMeta(savedMeta)
      }
      setPathsReady(true)
    }

    void loadPaths()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  useEffect(() => {
    if (!pathsReady) return
    const persistDensity = async () => {
      const store = await Store.load('store.json')
      await store.set(LIST_DENSITY_STORE_KEY, listDensity)
      await store.save()
    }
    void persistDensity()
  }, [listDensity, pathsReady])

  useEffect(() => {
    if (!pathsReady) return
    const persistSortOrder = async () => {
      const store = await Store.load('store.json')
      await store.set(SORT_ORDER_STORE_KEY, sortOrder)
      await store.save()
    }
    void persistSortOrder()
  }, [pathsReady, sortOrder])

  useEffect(() => {
    if (!pathsReady) return
    const persistSessionMeta = async () => {
      const store = await Store.load('store.json')
      await store.set(SESSION_META_STORE_KEY, sessionMeta)
      await store.save()
    }
    void persistSessionMeta()
  }, [sessionMeta, pathsReady])

  useEffect(() => {
    if (!dateFilterOpen) return
    setDraftDateFrom(dateFrom)
    setDraftDateTo(dateTo)
  }, [dateFilterOpen, dateFrom, dateTo])

  const reloadEditLogs = useCallback(
    async (sessionKey?: string) => {
      const effectiveSessionKey = sessionKey || selectedSessionKey
      if (!effectiveSessionKey) {
        setEditLogs([])
        return
      }

      setLoadingEditLogs(true)
      try {
        const logs = await listLlmMemoryEditLogs({
          platform,
          sessionKey: effectiveSessionKey,
          limit: EDIT_LOG_PAGE_SIZE,
        })
        setEditLogs(logs)
      } catch (error) {
        console.error('Failed to load edit logs:', error)
        toast({
          title: '加载编辑历史失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      } finally {
        setLoadingEditLogs(false)
      }
    },
    [platform, selectedSessionKey],
  )

  const reloadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const isSearch = query.trim().length > 0
      const result = await listLlmMemorySessions({
        platform,
        query,
        limit: isSearch ? SEARCH_PAGE_SIZE : PAGE_SIZE,
        offset: 0,
        paths: appliedPaths,
      })
      platformSessionLoadedCache[platform] = true
      setSessions(result.items)
      setTotal(result.total)

      if (result.items.length === 0) {
        setSelectedSessionKey('')
        setDetail(null)
        setEditLogs([])
        return
      }

      setSelectedSessionKey((prev) => {
        if (!prev) return result.items[0].sessionKey
        const matched = result.items.find((item) => item.sessionKey === prev)
        return matched ? prev : result.items[0].sessionKey
      })
    } catch (error) {
      console.error('Failed to load memory sessions:', error)
      toast({
        title: '加载会话失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoadingSessions(false)
    }
  }, [appliedPaths, platform, query])

  useEffect(() => {
    if (!pathsReady || viewMode !== 'sessions') return
    if (pendingPlatformHydrationRef.current === platform) {
      return
    }
    if (skipNextSessionsReloadRef.current) {
      skipNextSessionsReloadRef.current = false
      return
    }
    void reloadSessions()
  }, [pathsReady, reloadSessions, refreshToken, viewMode])

  useEffect(() => {
    if (pendingPlatformHydrationRef.current === platform) {
      setLoadingDetail(false)
      return
    }
    if (!selectedSessionKey) {
      setDetail(null)
      setEditLogs([])
      setLoadingDetail(false)
      return
    }

    if (skipNextDetailReloadRef.current) {
      skipNextDetailReloadRef.current = false
      setLoadingDetail(false)
      if (skipNextEditLogsReloadRef.current) {
        skipNextEditLogsReloadRef.current = false
      } else {
        void reloadEditLogs(selectedSessionKey)
      }
      return
    }

    let cancelled = false
    const loadDetail = async () => {
      setLoadingDetail(true)
      try {
        const data = await getLlmMemorySessionDetail({
          platform,
          sessionKey: selectedSessionKey,
          paths: appliedPaths,
        })
        if (cancelled) return
        setDetail(data)
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('Session file not found')) {
          setSelectedSessionKey('')
          void reloadSessions()
          toast({
            title: '会话文件不存在',
            description: '该会话可能已被删除或移动，已自动刷新列表。',
            variant: 'destructive',
          })
          return
        }
        console.error('Failed to load memory session detail:', error)
        toast({
          title: '加载会话详情失败',
          description: message,
          variant: 'destructive',
        })
      } finally {
        if (cancelled) return
        setLoadingDetail(false)
      }
    }

    void loadDetail()
    if (skipNextEditLogsReloadRef.current) {
      skipNextEditLogsReloadRef.current = false
    } else {
      void reloadEditLogs(selectedSessionKey)
    }
    return () => {
      cancelled = true
    }
  }, [appliedPaths, platform, reloadSessions, selectedSessionKey, refreshToken, reloadEditLogs])

  const enrichedSessions = useMemo(() => {
    return sessions.map((session) => {
      const meta = sessionMeta[buildMetaKey(session.platform, session.sessionKey)]
      const aliasTitle = normalizeAlias(meta?.aliasTitle || '')
      return {
        ...session,
        title: aliasTitle || session.title,
        _favorite: Boolean(meta?.favorite),
      }
    })
  }, [sessions, sessionMeta])

  const projectOptions = useMemo(() => {
    const optionMap = new Map<string, { key: string; label: string; cwd: string; count: number }>()
    enrichedSessions.forEach((session) => {
      const key = getProjectFilterKey(session.cwd)
      const existing = optionMap.get(key)
      if (existing) {
        existing.count += 1
        return
      }
      optionMap.set(key, {
        key,
        label: getProjectFolderName(session.cwd),
        cwd: session.cwd || 'cwd: N/A',
        count: 1,
      })
    })

    return Array.from(optionMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.label.localeCompare(b.label, 'zh-CN')
    })
  }, [enrichedSessions])

  const selectedProjectSet = useMemo(() => new Set(selectedProjectKeys), [selectedProjectKeys])
  const hasProjectFilter = selectedProjectKeys.length > 0

  const filteredSessions = useMemo(() => {
    const hasCompleteDateRange = Boolean(dateFrom && dateTo)
    const fromMs = hasCompleteDateRange ? dateInputStartMs(dateFrom) : 0
    const toMs = hasCompleteDateRange ? dateInputEndMs(dateTo) : Number.MAX_SAFE_INTEGER
    return enrichedSessions.filter((session) => {
      const updatedMs = parseTimestampMillis(session.updatedAt)
      if (!updatedMs) return false
      if (hasCompleteDateRange && (updatedMs < fromMs || updatedMs > toMs)) return false
      if (favoritesOnly && !session._favorite) return false
      if (hasProjectFilter) {
        const projectKey = getProjectFilterKey(session.cwd)
        if (!selectedProjectSet.has(projectKey)) return false
      }
      return true
    })
  }, [dateFrom, dateTo, enrichedSessions, favoritesOnly, hasProjectFilter, selectedProjectSet])

  const activeSession = useMemo(
    () => filteredSessions.find((session) => session.sessionKey === selectedSessionKey) || null,
    [filteredSessions, selectedSessionKey],
  )

  const selectedSessionSet = useMemo(() => new Set(selectedSessionKeys), [selectedSessionKeys])

  const hasAppliedPathConfig = useMemo(
    () =>
      Boolean(
        appliedPaths.claudeHome?.trim() ||
          appliedPaths.codexHome?.trim() ||
          appliedPaths.codexProjectRoot?.trim() ||
          appliedPaths.opencodeDbPath?.trim() ||
          appliedPaths.lingmoHome?.trim(),
      ),
    [appliedPaths],
  )

  const hasPendingPathChanges = useMemo(() => {
    const normalize = (value?: string | null) => value?.trim() || ''
    return (
      normalize(paths.claudeHome) !== normalize(appliedPaths.claudeHome) ||
      normalize(paths.codexHome) !== normalize(appliedPaths.codexHome) ||
      normalize(paths.codexProjectRoot) !== normalize(appliedPaths.codexProjectRoot) ||
      normalize(paths.opencodeDbPath) !== normalize(appliedPaths.opencodeDbPath) ||
      normalize(paths.lingmoHome) !== normalize(appliedPaths.lingmoHome)
    )
  }, [paths, appliedPaths])

  useEffect(() => {
    if (platform !== 'lingmo' && viewMode === 'ai-memories') {
      setViewMode('sessions')
      return
    }

    if (viewMode !== 'sessions') return

    const hasPendingSessionTarget = pendingSessionTargetRef.current?.platform === platform
    const cached = platformSessionViewCache[platform]
    if (!hasPendingSessionTarget && platformSessionLoadedCache[platform] && cached) {
      skipNextSessionsReloadRef.current = true
      skipNextDetailReloadRef.current = Boolean(
        cached.detail &&
        cached.selectedSessionKey &&
        cached.detail.platform === platform &&
        cached.detail.sessionKey === cached.selectedSessionKey,
      )
      skipNextEditLogsReloadRef.current = Boolean(
        cached.editLogs.length > 0 &&
        cached.selectedSessionKey,
      )
      setQueryInput(cached.queryInput)
      setQuery(cached.query)
      setFavoritesOnly(cached.favoritesOnly)
      setDateFrom(cached.dateFrom)
      setDateTo(cached.dateTo)
      setDraftDateFrom(cached.dateFrom)
      setDraftDateTo(cached.dateTo)
      setSelectedProjectKeys(cached.selectedProjectKeys)
      setSelectedSessionKey(cached.selectedSessionKey)
      setSelectedSessionKeys([])
      setSelectionMode(false)
      setSessions(cached.sessions)
      setTotal(cached.total)
      setDetail(cached.detail)
      setEditLogs(cached.editLogs)
      pendingPlatformHydrationRef.current = null
      return
    }

    skipNextSessionsReloadRef.current = false
    skipNextDetailReloadRef.current = false
    skipNextEditLogsReloadRef.current = false
    setQueryInput('')
    setQuery('')
    setFavoritesOnly(false)
    setDateFrom('')
    setDateTo('')
    setDraftDateFrom('')
    setDraftDateTo('')
    setSelectedProjectKeys([])
    setSelectedSessionKey('')
    setSelectedSessionKeys([])
    setSelectionMode(false)
    setSessions([])
    setTotal(0)
    setDetail(null)
    setEditLogs([])
    pendingPlatformHydrationRef.current = null
    setRefreshToken((current) => current + 1)
  }, [platform, viewMode])

  useEffect(() => {
    if (viewMode !== 'sessions') return

    platformSessionViewCache[platform] = {
      sessions,
      total,
      selectedSessionKey,
      detail,
      editLogs,
      queryInput,
      query,
      favoritesOnly,
      dateFrom,
      dateTo,
      selectedProjectKeys,
    }
  }, [
    dateFrom,
    dateTo,
    detail,
    editLogs,
    favoritesOnly,
    platform,
    query,
    queryInput,
    selectedProjectKeys,
    selectedSessionKey,
    sessions,
    total,
    viewMode,
  ])

  useEffect(() => {
    const allowed = new Set(projectOptions.map((project) => project.key))
    setSelectedProjectKeys((prev) => {
      const next = prev.filter((key) => allowed.has(key))
      return next.length === prev.length ? prev : next
    })
  }, [projectOptions])

  useEffect(() => {
    const allowed = new Set(sessions.map((session) => session.sessionKey))
    setSelectedSessionKeys((prev) => prev.filter((key) => allowed.has(key)))
  }, [sessions])

  useEffect(() => {
    if (!filteredSessions.length) {
      setSelectedSessionKey('')
      setDetail(null)
      return
    }

    const pendingTarget = pendingSessionTargetRef.current
    if (pendingTarget && pendingTarget.platform === platform) {
      const matchedTarget = filteredSessions.find((session) => session.sessionKey === pendingTarget.sessionKey)
      if (matchedTarget) {
        pendingSessionTargetRef.current = null
        if (selectedSessionKey !== matchedTarget.sessionKey) {
          setSelectedSessionKey(matchedTarget.sessionKey)
        }
        return
      }
    }

    const exists = filteredSessions.some((session) => session.sessionKey === selectedSessionKey)
    if (!exists) {
      setSelectedSessionKey(filteredSessions[0].sessionKey)
    }
  }, [filteredSessions, platform, selectedSessionKey])

  useEffect(() => {
    if (!activeSession) {
      setAliasInput('')
      return
    }
    const meta = sessionMeta[buildMetaKey(activeSession.platform, activeSession.sessionKey)]
    setAliasInput(normalizeAlias(meta?.aliasTitle || ''))
  }, [activeSession, sessionMeta])

  useEffect(() => {
    setMessageRoleFilter('all')
  }, [selectedSessionKey])

  const handlePickPath = useCallback(
    async (field: PathOverrideField, options: { title: string; directory?: boolean }) => {
      try {
        const dialogOptions: OpenDialogOptions = {
          title: options.title,
          directory: options.directory ?? true,
          multiple: false,
          defaultPath: paths[field]?.trim() || undefined,
        }
        const selected = await openDialog(dialogOptions)
        if (!selected || Array.isArray(selected)) {
          return
        }
        setPaths((prev) => ({ ...prev, [field]: selected }))
      } catch (error) {
        toast({
          title: '选择路径失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
    },
    [paths],
  )

  const handlePlatformChange = useCallback((value: string) => {
    const nextPlatform = value as LlmMemoryPlatform
    if (nextPlatform === platform) return
    pendingPlatformHydrationRef.current = nextPlatform
    skipNextSessionsReloadRef.current = true
    skipNextDetailReloadRef.current = false
    skipNextEditLogsReloadRef.current = false
    setPlatform(nextPlatform)
  }, [platform])

  const openSessionTarget = useCallback((target: MemorySessionTarget) => {
    pendingSessionTargetRef.current = target
    setViewMode('sessions')
    setQueryInput('')
    setQuery('')
    setFavoritesOnly(false)
    setDateFrom('')
    setDateTo('')
    setDraftDateFrom('')
    setDraftDateTo('')
    setSelectedProjectKeys([])
    setSelectedSessionKeys([])
    setSelectionMode(false)

    if (platform !== target.platform) {
      handlePlatformChange(target.platform)
      return
    }

    setSelectedSessionKey(target.sessionKey)
  }, [handlePlatformChange, platform])

  useEffect(() => {
    const initialTarget = consumePendingMemorySessionTarget()
    if (initialTarget) {
      openSessionTarget(initialTarget)
    }

    const handleMemoryOpenSession = (target: MemorySessionTarget) => {
      consumePendingMemorySessionTarget()
      openSessionTarget(target)
    }

    emitter.on('memory-open-session', handleMemoryOpenSession)
    return () => {
      emitter.off('memory-open-session', handleMemoryOpenSession)
    }
  }, [openSessionTarget])

  const handleSavePaths = useCallback(async () => {
    const normalized: LlmMemoryPathOverrides = {
      claudeHome: paths.claudeHome?.trim() || null,
      codexHome: paths.codexHome?.trim() || null,
      codexProjectRoot: paths.codexProjectRoot?.trim() || null,
      opencodeDbPath: paths.opencodeDbPath?.trim() || null,
      lingmoHome: paths.lingmoHome?.trim() || null,
    }

    const store = await Store.load('store.json')
    await store.set(PATH_STORE_KEY, normalized)
    await store.save()

    const value = {
      claudeHome: normalized.claudeHome || '',
      codexHome: normalized.codexHome || '',
      codexProjectRoot: normalized.codexProjectRoot || '',
      opencodeDbPath: normalized.opencodeDbPath || '',
      lingmoHome: normalized.lingmoHome || '',
    }

    delete platformSessionViewCache[platform]
    delete platformSessionLoadedCache[platform]
    skipNextSessionsReloadRef.current = false
    skipNextDetailReloadRef.current = false
    skipNextEditLogsReloadRef.current = false
    setPaths(value)
    setAppliedPaths(value)
    setRefreshToken((current) => current + 1)
  }, [paths, platform])

  const handleCopyCommand = useCallback(async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
    } catch (error) {
      toast({
        title: '复制失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [])

  const toggleSessionSelected = useCallback((sessionKey: string) => {
    setSelectedSessionKeys((prev) => {
      if (prev.includes(sessionKey)) {
        return prev.filter((key) => key !== sessionKey)
      }
      return [...prev, sessionKey]
    })
  }, [])

  const toggleSelectAllFiltered = useCallback(() => {
    const filteredKeys = filteredSessions.map((session) => session.sessionKey)
    if (!filteredKeys.length) return

    setSelectedSessionKeys((prev) => {
      const prevSet = new Set(prev)
      const allSelected = filteredKeys.every((key) => prevSet.has(key))
      if (allSelected) {
        return prev.filter((key) => !filteredKeys.includes(key))
      }
      const merged = new Set(prev)
      filteredKeys.forEach((key) => merged.add(key))
      return Array.from(merged)
    })
  }, [filteredSessions])

  const invertSelectFiltered = useCallback(() => {
    const filteredKeys = filteredSessions.map((session) => session.sessionKey)
    if (!filteredKeys.length) return
    setSelectedSessionKeys((prev) => {
      const next = new Set(prev)
      filteredKeys.forEach((key) => {
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
      })
      return Array.from(next)
    })
  }, [filteredSessions])

  const toggleProjectFilter = useCallback((projectKey: string) => {
    setSelectedProjectKeys((prev) => {
      if (prev.includes(projectKey)) {
        return prev.filter((key) => key !== projectKey)
      }
      const next = [...prev, projectKey]
      return next.length >= projectOptions.length ? [] : next
    })
  }, [projectOptions.length])

  const selectAllProjects = useCallback(() => {
    setSelectedProjectKeys([])
  }, [])

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedSessionKeys([])
  }, [])

  const setSessionFavorite = useCallback((session: LlmMemorySessionListItem, favorite: boolean) => {
    const metaKey = buildMetaKey(session.platform, session.sessionKey)
    setSessionMeta((prev) => ({
      ...prev,
      [metaKey]: {
        ...(prev[metaKey] || {}),
        favorite,
      },
    }))
  }, [])

  const toggleSessionFavorite = useCallback(
    (session: LlmMemorySessionListItem) => {
      const metaKey = buildMetaKey(session.platform, session.sessionKey)
      const current = Boolean(sessionMeta[metaKey]?.favorite)
      setSessionFavorite(session, !current)
    },
    [sessionMeta, setSessionFavorite],
  )

  const handleBatchFavorite = useCallback(
    (favorite: boolean) => {
      if (!selectedSessionKeys.length) return
      const selectedKeySet = new Set(selectedSessionKeys)
      const targetSessions = enrichedSessions.filter((session) => selectedKeySet.has(session.sessionKey))
      if (!targetSessions.length) return

      setSessionMeta((prev) => {
        const next = { ...prev }
        targetSessions.forEach((session) => {
          const metaKey = buildMetaKey(session.platform, session.sessionKey)
          next[metaKey] = {
            ...(next[metaKey] || {}),
            favorite,
          }
        })
        return next
      })

    },
    [enrichedSessions, selectedSessionKeys],
  )

  const handleCopySessionCwd = useCallback(async (session: LlmMemorySessionListItem) => {
    const cwd = session.cwd?.trim()
    if (!cwd) {
      toast({
        title: '复制项目路径失败',
        description: '这条会话没有记录所属项目路径。',
        variant: 'destructive',
      })
      return
    }

    try {
      await navigator.clipboard.writeText(cwd)
    } catch (error) {
      toast({
        title: '复制项目路径失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [])

  const handleCopySessionCommand = useCallback(
    async (session: LlmMemorySessionListItem, commandName: string) => {
      try {
        const targetDetail =
          detail?.sessionKey === session.sessionKey && detail.platform === session.platform
            ? detail
            : await getLlmMemorySessionDetail({
                platform: session.platform,
                sessionKey: session.sessionKey,
                paths: appliedPaths,
              })
        const command = targetDetail.commands?.[commandName]
        if (!command) {
          throw new Error(`未找到${commandDisplayLabel(commandName)}命令。`)
        }
        await handleCopyCommand(command)
      } catch (error) {
        toast({
          title: `复制${commandDisplayLabel(commandName)}失败`,
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
    },
    [appliedPaths, detail, handleCopyCommand],
  )

  const handleOpenSessionProjectFolder = useCallback(async (session: LlmMemorySessionListItem) => {
    const cwd = session.cwd?.trim()
    if (!cwd) {
      toast({
        title: '打开项目文件夹失败',
        description: '这条会话没有记录所属项目路径。',
        variant: 'destructive',
      })
      return
    }

    try {
      await openPath(cwd)
    } catch (error) {
      toast({
        title: '打开项目文件夹失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [])

  const removeDeletedSessionsFromUi = useCallback(
    (deletedSessions: LlmMemorySessionListItem[]) => {
      if (!deletedSessions.length) return

      const deletedKeys = new Set(deletedSessions.map((session) => session.sessionKey))
      const deletedMetaKeys = new Set(
        deletedSessions.map((session) => buildMetaKey(session.platform, session.sessionKey)),
      )

      setSessions((prev) => prev.filter((session) => !deletedKeys.has(session.sessionKey)))
      setTotal((prev) => Math.max(0, prev - deletedKeys.size))
      setSessionMeta((prev) => {
        let changed = false
        const next = { ...prev }
        deletedMetaKeys.forEach((metaKey) => {
          if (metaKey in next) {
            delete next[metaKey]
            changed = true
          }
        })
        return changed ? next : prev
      })
      setSelectedSessionKeys((prev) => prev.filter((key) => !deletedKeys.has(key)))

      if (selectedSessionKey && deletedKeys.has(selectedSessionKey)) {
        setSelectedSessionKey('')
        setDetail(null)
        setEditLogs([])
      }
    },
    [selectedSessionKey],
  )

  const handleDeleteSession = useCallback(
    async (session: LlmMemorySessionListItem) => {
      const title = buildSessionDisplayTitle(session)
      const confirmed = await confirmDialog(
        `确认删除这条会话记录吗？\n\n${title}\n${session.cwd || 'cwd: N/A'}\n\n此操作会删除源会话记录，无法从列表中恢复。`,
        {
          title: '删除会话记录',
          kind: 'warning',
          okLabel: '删除',
          cancelLabel: '取消',
        },
      )
      if (!confirmed) return

      setDeletingSessionKey(session.sessionKey)
      try {
        await deleteLlmMemorySession({
          platform: session.platform,
          sessionKey: session.sessionKey,
          paths: appliedPaths,
        })

        removeDeletedSessionsFromUi([session])
        setRefreshToken((value) => value + 1)
      } catch (error) {
        toast({
          title: '删除会话失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      } finally {
        setDeletingSessionKey(null)
      }
    },
    [appliedPaths, removeDeletedSessionsFromUi],
  )

  const handleBatchDeleteSessions = useCallback(async () => {
    if (!selectedSessionKeys.length || deletingSessionKey) return

    const selectedKeySet = new Set(selectedSessionKeys)
    const targetSessions = enrichedSessions.filter((session) => selectedKeySet.has(session.sessionKey))
    if (!targetSessions.length) return

    const previewLines = targetSessions
      .slice(0, 5)
      .map((session) => `- ${buildSessionDisplayTitle(session)}`)
      .join('\n')
    const moreText = targetSessions.length > 5 ? `\n... 另有 ${targetSessions.length - 5} 条` : ''
    const confirmed = await confirmDialog(
      `确认删除已选 ${targetSessions.length} 条会话记录吗？\n\n${previewLines}${moreText}\n\n此操作会删除源会话记录，无法从列表中恢复。`,
      {
        title: '批量删除会话记录',
        kind: 'warning',
        okLabel: '删除',
        cancelLabel: '取消',
      },
    )
    if (!confirmed) return

    setDeletingSessionKey(BATCH_DELETE_SESSION_KEY)
    const deletedSessions: LlmMemorySessionListItem[] = []
    const failures: string[] = []

    try {
      for (const session of targetSessions) {
        try {
          await deleteLlmMemorySession({
            platform: session.platform,
            sessionKey: session.sessionKey,
            paths: appliedPaths,
          })
          deletedSessions.push(session)
        } catch (error) {
          failures.push(`${buildSessionDisplayTitle(session)}：${error instanceof Error ? error.message : String(error)}`)
        }
      }

      removeDeletedSessionsFromUi(deletedSessions)
      setRefreshToken((value) => value + 1)

      if (failures.length) {
        toast({
          title: deletedSessions.length ? '部分会话删除失败' : '批量删除失败',
          description: failures.slice(0, 3).join('\n'),
          variant: 'destructive',
        })
      }
    } finally {
      setDeletingSessionKey(null)
    }
  }, [appliedPaths, deletingSessionKey, enrichedSessions, removeDeletedSessionsFromUi, selectedSessionKeys])

  const handleSaveAlias = useCallback(() => {
    if (!activeSession) return
    const alias = normalizeAlias(aliasInput)
    const metaKey = buildMetaKey(activeSession.platform, activeSession.sessionKey)
    setSessionMeta((prev) => ({
      ...prev,
      [metaKey]: {
        ...(prev[metaKey] || {}),
        aliasTitle: alias,
      },
    }))
    setAliasInput(alias)
  }, [activeSession, aliasInput])

  const handleGenerateAlias = useCallback(async () => {
    if (!detail) return
    setGeneratingAlias(true)
    try {
      const aiConfig = await getAISettings('primaryModel')
      const validated = await validateAIService(aiConfig?.baseURL)
      if (!validated) return
      const openai = await createOpenAIClient(aiConfig)
      const prompt = buildAliasPrompt(detail)
      const source = buildAliasSource(detail)
      if (!source.trim()) {
        throw new Error('当前会话中没有可用的用户提问内容。')
      }
      const completion = await openai.chat.completions.create({
        model: aiConfig?.model || '',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 512,
      })
      let raw = extractAssistantTextFromCompletion(completion)

      if (!raw.trim()) {
        console.warn('[memory-title] primary title generation returned empty content', {
          model: aiConfig?.model,
          finishReason: (completion as any)?.choices?.[0]?.finish_reason,
        })
        const retryCompletion = await openai.chat.completions.create({
          model: aiConfig?.model || '',
          messages: [{ role: 'user', content: buildAliasRetryPrompt(detail) }],
          temperature: 0,
          max_tokens: 256,
        })
        raw = extractAssistantTextFromCompletion(retryCompletion)
      }

      const generated = parseGeneratedAliasPayload(raw)
      let finalAlias = normalizeAlias(ensureProblemTitleAlias(generated.title, GENERATED_ALIAS_MAX_CHARS))

      if (!finalAlias || finalAlias.length < 2) {
        finalAlias = buildLocalAliasFallback(detail)
      }

      if (!finalAlias || finalAlias.length < 2) {
        throw new Error('当前会话中没有足够的用户问题内容可生成标题。')
      }

      setAliasInput(finalAlias)
    } catch (error) {
      toast({
        title: '生成短标题失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setGeneratingAlias(false)
    }
  }, [detail])

  const startEdit = useCallback((targetId: string, content: string) => {
    setEditingId(targetId)
    setEditingContent(content)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId('')
    setEditingContent('')
  }, [])

  const saveEdit = useCallback(async () => {
    if (!detail || !editingId) return
    setSavingMessage(true)
    try {
      await updateLlmMemoryMessage({
        platform,
        editTarget: editingId,
        newContent: editingContent,
        sessionKey: detail.sessionKey,
        sessionId: detail.sessionId,
        cwd: detail.cwd,
        paths: appliedPaths,
      })

      const nextMessages = detail.messages.map((message) =>
        message.editTarget === editingId || message.id === editingId
          ? { ...message, content: editingContent }
          : message,
      )
      setDetail({ ...detail, messages: nextMessages })
      cancelEdit()
      await reloadEditLogs(detail.sessionKey)
    } catch (error) {
      console.error('Failed to update memory message:', error)
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setSavingMessage(false)
    }
  }, [appliedPaths, cancelEdit, detail, editingContent, editingId, platform, reloadEditLogs])

  const handleDeleteMessage = useCallback(
    async (message: LlmMemoryMessage) => {
      if (!detail || !message.editTarget) return
      const confirmed = window.confirm(
        `确认删除这条${roleLabel(message.role)}记录吗？\n\n${truncateText(message.content || '(empty)', 180)}\n\n此操作会修改源会话记录。`,
      )
      if (!confirmed) return

      setDeletingMessageId(message.id)
      try {
        await deleteLlmMemoryMessage({
          platform,
          editTarget: message.editTarget,
          sessionKey: detail.sessionKey,
          sessionId: detail.sessionId,
          cwd: detail.cwd,
          paths: appliedPaths,
        })

        setDetail({
          ...detail,
          messages: detail.messages.filter((item) => item.id !== message.id && item.editTarget !== message.editTarget),
        })
        if (editingId === message.editTarget || editingId === message.id) {
          cancelEdit()
        }
        await reloadEditLogs(detail.sessionKey)
        setRefreshToken((value) => value + 1)
      } catch (error) {
        toast({
          title: '删除消息失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      } finally {
        setDeletingMessageId(null)
      }
    },
    [appliedPaths, cancelEdit, detail, editingId, platform, reloadEditLogs],
  )

  const handleRestoreLog = useCallback(
    async (log: LlmMemoryEditLogItem) => {
      if (!window.confirm('确认回滚到这条历史版本吗？回滚操作会再记录一条新的编辑历史。')) {
        return
      }

      setRestoringLogId(log.id)
      try {
        await restoreLlmMemoryMessage({
          logId: log.id,
          paths: appliedPaths,
        })
        setRefreshToken((current) => current + 1)
      } catch (error) {
        console.error('Failed to restore memory message:', error)
        toast({
          title: '回滚失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      } finally {
        setRestoringLogId(null)
      }
    },
    [appliedPaths],
  )

  const handleExportSession = useCallback(async () => {
    if (!detail) {
      return
    }

    setExporting(true)
    try {
      const filePath = await exportSessionToMarkdown(detail)
      await loadFileTree({ skipRemoteSync: true })
      await setLeftSidebarTab('files')
      setActiveFilePath(filePath)
    } catch (error) {
      console.error('Failed to export memory session:', error)
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExporting(false)
    }
  }, [detail, loadFileTree, setActiveFilePath, setLeftSidebarTab])

  const handleGenerateSummaryNote = useCallback(async () => {
    const targetKeys = (selectedSessionKeys.length > 0 ? selectedSessionKeys : [selectedSessionKey]).filter(Boolean)
    if (!targetKeys.length) {
      return
    }

    setGeneratingSummary(true)

    try {
      const targetDetails = await Promise.all(
        targetKeys.map(async (sessionKey) => {
          if (detail && detail.sessionKey === sessionKey) {
            return detail
          }
          return getLlmMemorySessionDetail({
            platform,
            sessionKey,
            paths: appliedPaths,
          })
        }),
      )
      const validDetails = targetDetails.filter(Boolean)
      if (!validDetails.length) {
        throw new Error('未加载到可总结的会话详情。')
      }

      const aiConfig = await getAISettings('primaryModel')
      const validated = await validateAIService(aiConfig?.baseURL)
      if (!validated) return

      const openai = await createOpenAIClient(aiConfig)
      const prompt =
        validDetails.length === 1
          ? buildSessionSummaryPrompt(validDetails[0])
          : buildCombinedSessionSummaryPrompt(validDetails)
      const completion = await openai.chat.completions.create({
        model: aiConfig?.model || '',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: validDetails.length === 1 ? 1800 : 2800,
      })

      const summary = completion.choices[0]?.message?.content?.trim()
      if (!summary) {
        throw new Error('模型未返回可用总结。')
      }

      const filePath =
        validDetails.length === 1
          ? await createSummaryNoteFile(validDetails[0], summary)
          : await createCombinedSummaryNoteFile(validDetails, summary)
      await loadFileTree({ skipRemoteSync: true })
      await setLeftSidebarTab('files')
      setActiveFilePath(filePath)
    } catch (error) {
      console.error('Failed to generate summary note:', error)
      toast({
        title: '生成总结失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setGeneratingSummary(false)
    }
  }, [appliedPaths, detail, loadFileTree, platform, selectedSessionKey, selectedSessionKeys, setActiveFilePath, setLeftSidebarTab])

  const allFilteredSelected =
    filteredSessions.length > 0 && filteredSessions.every((session) => selectedSessionSet.has(session.sessionKey))
  const allSelectedInSelectionMode = selectionMode && allFilteredSelected
  const summaryButtonLabel =
    selectedSessionKeys.length > 1 ? `总结已选 ${selectedSessionKeys.length} 条` : 'AI总结为笔记'
  const visibleDetailMessages = useMemo(() => {
    if (!detail) return []
    return detail.messages.filter((message) => message.role !== 'tool')
  }, [detail])
  const filteredDetailMessages = useMemo(() => {
    if (!detail) return []
    const roleFiltered =
      messageRoleFilter === 'all'
        ? visibleDetailMessages
        : visibleDetailMessages.filter((message) => message.role === messageRoleFilter)

    return roleFiltered
      .map((message, index) => ({
        index,
        message,
        time: parseTimestampMillis(message.timestamp || 0),
      }))
      .sort((a, b) => {
        if (a.time === b.time) {
          return a.index - b.index
        }
        return sortOrder === 'newest' ? b.time - a.time : a.time - b.time
      })
      .map((item) => item.message)
  }, [detail, messageRoleFilter, sortOrder, visibleDetailMessages])

  const messageSearchResults = useMemo(() => {
    if (!messageSearchQuery.trim()) return []
    const q = messageSearchQuery.toLowerCase()
    return filteredDetailMessages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => (msg.content || '').toLowerCase().includes(q))
  }, [messageSearchQuery, filteredDetailMessages])

  const messageSearchCount = messageSearchResults.length

  const navigateMessageSearch = useCallback((direction: 'up' | 'down') => {
    if (messageSearchCount === 0) return
    setMessageSearchIndex((prev) => {
      if (direction === 'down') return (prev + 1) % messageSearchCount
      return (prev - 1 + messageSearchCount) % messageSearchCount
    })
  }, [messageSearchCount])

  useEffect(() => {
    if (messageSearchQuery && messageSearchCount > 0) {
      setMessageSearchIndex(0)
    }
  }, [messageSearchQuery, messageSearchCount])

  useEffect(() => {
    if (!messageSearchQuery || messageSearchCount === 0) return
    const match = messageSearchResults[messageSearchIndex]
    if (!match) return
    const el = document.querySelector(`[data-message-id="${match.msg.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [messageSearchIndex, messageSearchQuery, messageSearchCount, messageSearchResults])

  const hasDateRangeFilter = Boolean(dateFrom && dateTo)
  const hasSessionFilterSummary = hasDateRangeFilter || favoritesOnly || hasProjectFilter || Boolean(query.trim())
  const projectFilterLabel = hasProjectFilter
    ? selectedProjectKeys.length === 1
      ? projectOptions.find((project) => project.key === selectedProjectKeys[0])?.label || '1 个项目'
      : `${selectedProjectKeys.length} 个项目`
    : '全部项目'
  const hasDraftDateRange = Boolean(draftDateFrom && draftDateTo)
  const hasDateDraftChanges = draftDateFrom !== dateFrom || draftDateTo !== dateTo
  const applyDateRangeFilter = useCallback(() => {
    if (!draftDateFrom || !draftDateTo) {
      return
    }
    const normalizedFrom = draftDateFrom <= draftDateTo ? draftDateFrom : draftDateTo
    const normalizedTo = draftDateFrom <= draftDateTo ? draftDateTo : draftDateFrom
    setDateFrom(normalizedFrom)
    setDateTo(normalizedTo)
    setDateFilterOpen(false)
  }, [draftDateFrom, draftDateTo])
  const clearDateRangeFilter = useCallback(() => {
    setDraftDateFrom('')
    setDraftDateTo('')
    setDateFrom('')
    setDateTo('')
    setDateFilterOpen(false)
  }, [])

  // 筛选标签（filter chips）清除回调
  const clearQueryFilter = useCallback(() => {
    setQueryInput('')
    setQuery('')
  }, [])

  const clearFavoritesFilter = useCallback(() => {
    setFavoritesOnly(false)
  }, [])

  const clearProjectFilter = useCallback((projectKey: string) => {
    setSelectedProjectKeys((prev) => prev.filter((k) => k !== projectKey))
  }, [])

  const clearAllFilters = useCallback(() => {
    setQueryInput('')
    setQuery('')
    setDateFrom('')
    setDateTo('')
    setDraftDateFrom('')
    setDraftDateTo('')
    setFavoritesOnly(false)
    setSelectedProjectKeys([])
  }, [])

  const activeFilterCount = [
    Boolean(query.trim()),
    hasDateRangeFilter,
    favoritesOnly,
    hasProjectFilter,
  ].filter(Boolean).length

  const messageRoleStats = useMemo(() => {
    if (!detail) {
      return { all: 0, user: 0, assistant: 0, thinking: 0 }
    }
    return {
      all: visibleDetailMessages.length,
      user: visibleDetailMessages.filter((message) => message.role === 'user').length,
      assistant: visibleDetailMessages.filter((message) => message.role === 'assistant').length,
      thinking: visibleDetailMessages.filter((message) => message.role === 'thinking').length,
    }
  }, [detail, visibleDetailMessages])

  const sessionTokenStats = useMemo(() => {
    if (!detail?.messages) return { total: 0, user: 0, assistant: 0 }
    let user = 0
    let assistant = 0
    for (const msg of detail.messages) {
      const tokens = estimateTokens(msg.content || '')
      if (msg.role === 'user') user += tokens
      else if (msg.role === 'assistant') assistant += tokens
    }
    return { total: user + assistant, user, assistant }
  }, [detail])

  const bottomToolButtonClass = 'size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground'
  const topToolButtonClass = 'h-9 w-9 shrink-0 rounded-md border-0 bg-transparent shadow-none hover:bg-muted/40'
  const supportsLingmoMemories = platform === 'lingmo'
  const headerDescription = viewMode === 'ai-memories'
    ? '管理偏好与长期记忆，供 AI 在后续对话中自动引用。'
    : '查看 LingMo 内部 AI 会话、摘要与引用记录。'
  const sessionListTitle = supportsLingmoMemories ? '会话列表' : `${platformDisplayName(platform)} 会话`

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {supportsLingmoMemories ? (
        <div className="border-b px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Brain className="size-5 text-primary" />
                <h2 className="text-base font-semibold">记忆管理</h2>
                {viewMode === 'ai-memories' ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">LingMo</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{headerDescription}</p>
            </div>

            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'sessions' | 'ai-memories')}>
              <TabsList className="h-8 shrink-0 rounded-md border bg-background p-0.5 shadow-sm">
                <TabsTrigger value="sessions" className="h-7 gap-1.5 rounded px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <History className="size-3.5" />
                  <span>会话记录</span>
                </TabsTrigger>
                <TabsTrigger value="ai-memories" className="h-7 gap-1.5 rounded px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Brain className="size-3.5" />
                  <span>长期记忆</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      ) : null}
      {viewMode === 'ai-memories' ? (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-auto p-4">
          <MemoryList />
        </div>
      ) : (
        <>
          <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1 overflow-hidden">
            <ResizablePanel
              id="memory-session-list"
              order={1}
              defaultSize={35}
              minSize={20}
              maxSize={45}
              className="min-w-0"
            >
            <div className="flex h-full min-h-0 flex-col border-r">
              <div className="border-b px-4 py-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="text-sm font-semibold">{sessionListTitle}</h2>
                    <Badge
                      variant="outline"
                      className="h-5 min-w-[1.8rem] justify-center rounded-full border-primary/15 bg-primary/8 px-2 text-xs font-semibold tabular-nums text-primary shadow-sm"
                      title="会话总数"
                    >
                      {total}
                    </Badge>
                  </div>
                  {hasSessionFilterSummary ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 text-muted-foreground">
                        <span>筛选后</span>
                        <span className="font-semibold text-foreground/90">{filteredSessions.length}</span>
                      </span>
                      {hasProjectFilter ? (
                        <span className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 text-muted-foreground">
                          <FolderOpen className="size-3.5 shrink-0" />
                          <span className="truncate">{projectFilterLabel}</span>
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                          selectionMode && selectedSessionKeys.length > 0
                            ? 'border-primary/40 bg-primary/8 text-foreground'
                            : 'border-border/60 bg-muted/25 text-muted-foreground'
                        }`}
                      >
                        <span>已勾选</span>
                        <span className="font-semibold text-foreground/90">{selectionMode ? selectedSessionKeys.length : 0}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="border-b px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className={topToolButtonClass}
                title="刷新会话列表"
                onClick={() => setRefreshToken((value) => value + 1)}
                disabled={loadingSessions || loadingDetail || loadingEditLogs}
              >
                <RefreshCw className={`size-4 ${loadingSessions || loadingDetail || loadingEditLogs ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`${topToolButtonClass} ${favoritesOnly ? 'text-foreground' : ''}`}
                title={favoritesOnly ? '仅看收藏（开启）' : '仅看收藏（关闭）'}
                onClick={() => setFavoritesOnly((prev) => !prev)}
              >
                <Star className={`size-4 ${favoritesOnly ? 'fill-current' : ''}`} />
              </Button>
              <Popover
                open={dateFilterOpen}
                onOpenChange={(open) => {
                  setDateFilterOpen(open)
                  if (open) {
                    setDraftDateFrom(dateFrom)
                    setDraftDateTo(dateTo)
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`${topToolButtonClass} ${hasDateRangeFilter ? 'text-foreground' : 'text-muted-foreground'}`}
                    title={hasDateRangeFilter ? `日期范围：${dateFrom} - ${dateTo}` : '设置日期范围筛选'}
                  >
                    <CalendarClock className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <div className="p-2 space-y-2">
                    <div className="grid grid-cols-3 gap-1">
                      {(() => {
                        const today = new Date()
                        const f = (d: Date) => format(d, 'yyyy-MM-dd')
                        const presets: { label: string; from: string; to: string }[] = [
                          { label: '今天', from: f(today), to: f(today) },
                          { label: '近 7 天', from: f(subDays(today, 6)), to: f(today) },
                          { label: '近 30 天', from: f(subDays(today, 29)), to: f(today) },
                        ]
                        return presets.map((p) => {
                          const active = dateFrom === p.from && dateTo === p.to
                          return (
                            <button
                              key={p.label}
                              type="button"
                              className={`rounded px-1.5 py-1 text-[11px] transition-colors ${
                                active
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                              }`}
                              onClick={() => {
                                setDateFrom(p.from)
                                setDateTo(p.to)
                                setDraftDateFrom(p.from)
                                setDraftDateTo(p.to)
                                setDateFilterOpen(false)
                              }}
                            >
                              {p.label}
                            </button>
                          )
                        })
                      })()}
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground shrink-0">从</span>
                        <Input
                          type="date"
                          value={draftDateFrom}
                          onChange={(e) => setDraftDateFrom(e.target.value)}
                          className="h-6 text-[11px] px-1"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground shrink-0">到</span>
                        <Input
                          type="date"
                          value={draftDateTo}
                          onChange={(e) => setDraftDateTo(e.target.value)}
                          className="h-6 text-[11px] px-1"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t">
                      {hasDateRangeFilter ? (
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={clearDateRangeFilter}
                        >
                          清除
                        </button>
                      ) : <div />}
                      <button
                        type="button"
                        className="rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        disabled={!hasDraftDateRange || !hasDateDraftChanges}
                        onClick={applyDateRangeFilter}
                      >
                        应用
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon"
                className={topToolButtonClass}
                title={selectionMode ? '退出多选模式' : '进入多选模式'}
                onClick={() => {
                  if (selectionMode) {
                    exitSelectionMode()
                    return
                  }
                  setSelectionMode(true)
                }}
                disabled={!filteredSessions.length && !selectionMode}
              >
                <CheckSquare className={`size-4 ${selectionMode ? 'text-foreground' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={topToolButtonClass}
                title="应用路径配置"
                onClick={() => void handleSavePaths()}
                disabled={!hasPendingPathChanges}
              >
                <Save className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`${topToolButtonClass} text-foreground`}
                title={summaryButtonLabel}
                onClick={() => void handleGenerateSummaryNote()}
                disabled={generatingSummary || (!selectedSessionKey && selectedSessionKeys.length === 0)}
              >
                {generatingSummary ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="border-b px-3 py-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="搜索会话..."
                className="h-7 w-full pl-7 pr-7 text-xs"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setQueryInput('')
                    setQuery('')
                  }
                }}
              />
              {queryInput ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => { setQueryInput(''); setQuery(''); searchInputRef.current?.focus() }}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
          {selectionMode ? (
            <div className="border-b bg-muted/25 px-2 py-1.5">
              <div className="flex items-center gap-3 text-xs">
                <span className="font-semibold text-foreground">已选 {selectedSessionKeys.length}</span>
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={toggleSelectAllFiltered}
                >
                  {allSelectedInSelectionMode ? '取消全选' : '全选'}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={invertSelectFiltered}
                >
                  反选
                </button>
                <button
                  type="button"
                  className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
                  onClick={exitSelectionMode}
                  title="退出多选模式"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={!selectedSessionKeys.length}
                  onClick={() => handleBatchFavorite(true)}
                >
                  <Star className="mr-1 size-3.5" />
                  批量收藏
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={!selectedSessionKeys.length}
                  onClick={() => handleBatchFavorite(false)}
                >
                  取消收藏
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={!selectedSessionKeys.length || Boolean(deletingSessionKey)}
                  onClick={() => void handleBatchDeleteSessions()}
                >
                  {deletingSessionKey === BATCH_DELETE_SESSION_KEY ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 size-3.5" />
                  )}
                  批量删除
                </Button>
              </div>
            </div>
          ) : null}
          {hasSessionFilterSummary ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-1.5">
              {query.trim() ? (
                <Badge variant="outline" className="gap-1 rounded-full pr-1 text-xs">
                  <Search className="size-3" />
                  {query.length > 16 ? query.slice(0, 16) + '...' : query}
                  <button type="button" onClick={clearQueryFilter} className="inline-flex items-center justify-center rounded-full p-px hover:bg-muted/60">
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null}
              {hasDateRangeFilter ? (
                <Badge variant="outline" className="gap-1 rounded-full pr-1 text-xs">
                  <CalendarClock className="size-3" />
                  {dateFrom} ~ {dateTo}
                  <button type="button" onClick={clearDateRangeFilter} className="inline-flex items-center justify-center rounded-full p-px hover:bg-muted/60">
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null}
              {favoritesOnly ? (
                <Badge variant="outline" className="gap-1 rounded-full pr-1 text-xs">
                  <Star className="size-3" />
                  仅收藏
                  <button type="button" onClick={clearFavoritesFilter} className="inline-flex items-center justify-center rounded-full p-px hover:bg-muted/60">
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null}
              {selectedProjectKeys.map((projectKey) => {
                const option = projectOptions.find((p) => p.key === projectKey)
                return (
                  <Badge key={projectKey} variant="outline" className="gap-1 rounded-full pr-1 text-xs">
                    <FolderOpen className="size-3" />
                    {option?.label || projectKey}
                    <button type="button" onClick={() => clearProjectFilter(projectKey)} className="inline-flex items-center justify-center rounded-full p-px hover:bg-muted/60">
                      <X className="size-3" />
                    </button>
                  </Badge>
                )
              })}
              {activeFilterCount >= 2 ? (
                <button type="button" onClick={clearAllFilters} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                  清除全部
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0">
            {loadingSessions ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                正在加载会话...
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Search className="size-8 mb-2 opacity-40" />
                <p className="text-sm">未找到会话</p>
                <p className="text-xs mt-1 opacity-60">尝试调整筛选条件</p>
              </div>
            ) : (
              filteredSessions.map((session) => {
                const active = session.sessionKey === selectedSessionKey
                const checked = selectedSessionSet.has(session.sessionKey)
                const sessionDisplayTitle = buildSessionDisplayTitle(session)
                return (
                  <ContextMenu key={session.sessionKey}>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => {
                          if (selectionMode) {
                            toggleSessionSelected(session.sessionKey)
                            return
                          }
                          setSelectedSessionKey(session.sessionKey)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            if (selectionMode) {
                              toggleSessionSelected(session.sessionKey)
                              return
                            }
                            setSelectedSessionKey(session.sessionKey)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`group mb-2 w-full rounded-lg border text-left transition-all ${
                          listDensity === 'compact' ? 'p-2.5' : 'p-3'
                        } ${
                          active ? 'border-l-[3px] border-l-primary bg-primary/[0.03]' : 'hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className={listDensity === 'compact' ? 'line-clamp-2 text-xs font-semibold' : 'line-clamp-2 text-sm font-semibold'}>
                            {sessionDisplayTitle}
                          </div>
                          <div className="flex items-center gap-1">
                            {selectionMode ? (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSessionSelected(session.sessionKey)}
                                onClick={(event) => event.stopPropagation()}
                                className="size-3.5 cursor-pointer"
                                title="选择会话"
                              />
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleSessionFavorite(session)
                              }}
                              className={`rounded p-1 transition-all ${
                                session._favorite
                                  ? 'text-primary'
                                  : 'opacity-0 text-muted-foreground/40 hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100'
                              }`}
                              title={session._favorite ? '取消收藏' : '收藏会话'}
                            >
                              <Star className={`size-3.5 ${session._favorite ? 'fill-current' : ''}`} />
                            </button>
                          </div>
                        </div>
                        <div className={listDensity === 'compact' ? 'mt-1 flex items-center gap-1 text-xs text-muted-foreground' : 'mt-2 flex items-center gap-1 text-xs text-muted-foreground'}>
                          <CalendarClock className="size-3.5 shrink-0" />
                          <span>{formatTimestamp(session.updatedAt)}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {session.preview || '（无预览）'}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/60">
                          <FolderOpen className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{session.cwd || 'cwd: N/A'}</span>
                          {session.preview && (
                            <span className="flex shrink-0 items-center gap-1.5 ml-auto pl-2">
                              <span className="flex items-center gap-0.5">
                                <Zap className="size-2.5" />
                                {estimateTokens(session.preview) >= 1000 ? `${(estimateTokens(session.preview) / 1000).toFixed(1)}k` : estimateTokens(session.preview)}
                              </span>
                              <span className="flex items-center gap-0.5">
                                <MessageSquare className="size-2.5" />
                                {session.preview.length}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-36 p-1">
                      <ContextMenuItem
                        className="gap-2 py-1.5"
                        disabled={!session.cwd?.trim()}
                        onSelect={() => void handleOpenSessionProjectFolder(session)}
                      >
                        <FolderOpen className="size-3.5 text-muted-foreground" />
                        <span>打开项目</span>
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="gap-2 py-1.5"
                        disabled={!session.cwd?.trim()}
                        onSelect={() => void handleCopySessionCwd(session)}
                      >
                        <FolderOpen className="size-3.5 text-muted-foreground" />
                        <span>复制路径</span>
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem className="gap-2 py-1.5" onSelect={() => void handleCopySessionCommand(session, 'resume')}>
                        <Copy className="size-3.5 text-muted-foreground" />
                        <span>复制 resume</span>
                      </ContextMenuItem>
                      <ContextMenuItem className="gap-2 py-1.5" onSelect={() => void handleCopySessionCommand(session, 'fork')}>
                        <Copy className="size-3.5 text-muted-foreground" />
                        <span>复制 fork</span>
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="gap-2 py-1.5 text-destructive focus:text-destructive"
                        disabled={Boolean(deletingSessionKey)}
                        onSelect={() => void handleDeleteSession(session)}
                      >
                        <Trash2 className="size-3.5" />
                        <span>删除会话</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })
            )}
          </div>
        </div>
        </ResizablePanel>
        <ResizableHandle className="bg-border/80" />
        <ResizablePanel
          id="memory-session-detail"
          order={2}
          defaultSize={65}
          minSize={40}
          className="min-w-0"
        >
        <div className="min-h-0 min-w-0 h-full flex-1 overflow-hidden">
          {loadingDetail ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在加载会话详情...
            </div>
          ) : !detail ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <Brain className="size-10 mb-3 opacity-30" />
              <p className="text-sm">请选择左侧会话后查看与编辑记忆</p>
              <p className="text-xs mt-1 opacity-60">或使用搜索框查找特定会话</p>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="border-b px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold">
                        {activeSession
                          ? buildSessionDisplayTitle(activeSession)
                          : detail.title && detail.title !== detail.sessionId
                            ? detail.title
                            : '未命名会话'}
                      </div>
                      {activeSession ? (
                        <button
                          type="button"
                          onClick={() => toggleSessionFavorite(activeSession)}
                          className={`rounded p-1 transition-colors ${
                            activeSession._favorite ? 'text-primary' : 'text-muted-foreground/40 hover:text-foreground'
                          }`}
                          title={activeSession._favorite ? '取消收藏' : '收藏会话'}
                        >
                          <Star className={`size-3.5 ${activeSession._favorite ? 'fill-current' : ''}`} />
                        </button>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{detail.cwd || 'cwd: N/A'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    value={aliasInput}
                    onChange={(event) => setAliasInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleSaveAlias()
                      }
                    }}
                    className="h-8 min-w-[220px] flex-1"
                    placeholder="设置会话别名"
                  />
                  <Button size="icon" variant="outline" title="保存会话别名" onClick={handleSaveAlias}>
                    <Save className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    title="AI 生成候选短标题"
                    onClick={() => void handleGenerateAlias()}
                    disabled={generatingAlias}
                  >
                    {generatingAlias ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
                <Button
                  size="sm"
                  variant={messageRoleFilter === 'all' ? 'default' : 'outline'}
                  className="h-7 gap-1 text-xs"
                  onClick={() => setMessageRoleFilter('all')}
                >
                  全部
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{messageRoleStats.all}</Badge>
                </Button>
                <Button
                  size="sm"
                  variant={messageRoleFilter === 'user' ? 'default' : 'outline'}
                  className="h-7 gap-1 text-xs"
                  onClick={() => setMessageRoleFilter('user')}
                >
                  <User className="size-3.5" />
                  用户
                  {messageRoleFilter === 'user' ? (
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{messageRoleStats.user}</Badge>
                  ) : null}
                </Button>
                <Button
                  size="sm"
                  variant={messageRoleFilter === 'assistant' ? 'default' : 'outline'}
                  className="h-7 gap-1 text-xs"
                  onClick={() => setMessageRoleFilter('assistant')}
                >
                  <Bot className="size-3.5" />
                  AI
                  {messageRoleFilter === 'assistant' ? (
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{messageRoleStats.assistant}</Badge>
                  ) : null}
                </Button>
                <Button
                  size="sm"
                  variant={messageRoleFilter === 'thinking' ? 'default' : 'outline'}
                  className="h-7 gap-1 text-xs"
                  onClick={() => setMessageRoleFilter('thinking')}
                >
                  <Lightbulb className="size-3.5" />
                  思考
                  {messageRoleFilter === 'thinking' ? (
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{messageRoleStats.thinking}</Badge>
                  ) : null}
                </Button>
              </div>

              <div className="border-b px-4 py-2">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="relative w-full max-w-md">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={messageSearchInputRef}
                      value={messageSearchQuery}
                      onChange={(e) => setMessageSearchQuery(e.target.value)}
                      placeholder="搜索消息内容..."
                      className="h-7 w-full pl-7 pr-2 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); navigateMessageSearch(e.shiftKey ? 'up' : 'down') }
                        if (e.key === 'Escape') { setMessageSearchQuery('') }
                      }}
                    />
                  </div>
                  {messageSearchQuery && (
                    <>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {messageSearchCount > 0 ? messageSearchIndex + 1 + '/' + messageSearchCount : '0/0'}
                      </span>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => navigateMessageSearch('up')} disabled={messageSearchCount === 0}>
                        <ChevronUp className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => navigateMessageSearch('down')} disabled={messageSearchCount === 0}>
                        <ChevronDown className="size-3" />
                      </Button>
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setMessageSearchQuery('')}
                      >
                        <X className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {filteredDetailMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">当前会话未解析到可编辑消息</div>
                ) : (
                  <div className="space-y-3">
                    {filteredDetailMessages.map((message) => {
                      const isEditing = editingId === message.editTarget || editingId === message.id
                      const messageTime = formatMessageTimestamp(message.timestamp)
                      const isSearchMatch = messageSearchQuery && messageSearchResults.some(r => r.msg.id === message.id)
                      const isCurrentMatch = messageSearchQuery && messageSearchResults[messageSearchIndex]?.msg.id === message.id
                      return (
                        <div
                          key={message.id}
                          data-message-id={message.id}
                          className={`group rounded-lg border p-3 transition-all ${roleCardClass(message.role)} ${isCurrentMatch ? 'ring-1 ring-primary/50' : isSearchMatch ? 'bg-primary/[0.04]' : ''}`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant="outline" className={roleBadgeClass(message.role)}>{roleLabel(message.role)}</Badge>
                              {messageTime ? (
                                <span className="truncate text-xs text-muted-foreground">{messageTime}</span>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            {message.editable && message.editTarget ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  aria-label="编辑消息"
                                  onClick={() => startEdit(message.editTarget || message.id, message.content)}
                                  disabled={deletingMessageId === message.id}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-destructive hover:text-destructive"
                                  aria-label="删除消息"
                                  onClick={() => void handleDeleteMessage(message)}
                                  disabled={deletingMessageId === message.id}
                                >
                                  {deletingMessageId === message.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="size-3.5" />
                                  )}
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </div>

                          {isEditing ? (
                            <div className="space-y-2">
                              <Textarea
                                value={editingContent}
                                onChange={(event) => setEditingContent(event.target.value)}
                                className="min-h-28 font-mono text-xs"
                              />
                              <div className="flex items-center gap-2">
                                <Button size="sm" onClick={() => void saveEdit()} disabled={savingMessage}>
                                  {savingMessage ? (
                                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                                  ) : (
                                    <Save className="mr-1 size-3.5" />
                                  )}
                                  保存
                                </Button>
                                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={savingMessage}>
                                  取消
                                </Button>
                              </div>
                            </div>
                          ) : (() => {
                            const lineCount = message.content ? message.content.split("\n").length : 0
                            const isLong = lineCount > 6
                            const shouldExpand = expandedMessages.has(message.id) || (isSearchMatch && messageSearchQuery)
                            const displayText = messageSearchQuery && message.content
                              ? highlightTextReact(message.content, messageSearchQuery)
                              : (message.content || '(empty)')
                            return (
                            <div className="relative">
                              <pre className={`whitespace-pre-wrap break-words text-sm leading-6 ${
                                shouldExpand || !isLong ? '' : 'line-clamp-6'
                              }`}>{displayText}</pre>
                              {isLong && !shouldExpand && (
                                <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center pt-8 bg-gradient-to-t from-background via-background/80 to-transparent">
                                  <button
                                    type="button"
                                    className="text-xs text-primary hover:underline"
                                    onClick={() => setExpandedMessages((prev) => new Set(prev).add(message.id))}
                                  >
                                    展开全部 ({lineCount} 行)
                                  </button>
                                </div>
                              )}
                              {shouldExpand && isLong && !messageSearchQuery && (
                                <button
                                  type="button"
                                  className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => setExpandedMessages((prev) => {
                                    const next = new Set(prev)
                                    next.delete(message.id)
                                    return next
                                  })}
                                >
                                  收起
                                </button>
                              )}
                            </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <div className="flex h-6 shrink-0 items-center border-t border-border bg-background px-2 text-xs text-muted-foreground">
        <div className="flex h-full min-w-0 items-center gap-0.5">
          <div className="w-[124px] shrink-0">
            <Select value={platform} onValueChange={handlePlatformChange}>
              <SelectTrigger className="h-5 rounded-sm border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="平台" />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="lingmo" className="text-xs">LingMo</SelectItem>
                <SelectItem value="claude" className="text-xs">Claude Code</SelectItem>
                <SelectItem value="codex" className="text-xs">Codex CLI</SelectItem>
                <SelectItem value="opencode" className="text-xs">OpenCode</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mx-1 h-3 w-px bg-border" />

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`${bottomToolButtonClass} ${hasProjectFilter ? 'bg-accent text-foreground' : ''}`}
                title={`项目筛选：${projectFilterLabel}`}
                disabled={projectOptions.length === 0}
              >
                <FolderOpen className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-[280px] p-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <div className="text-xs font-medium">按项目筛选</div>
                  <Badge variant={hasProjectFilter ? 'default' : 'secondary'} className="h-5 px-1.5 text-xs">
                    {projectFilterLabel}
                  </Badge>
                </div>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                    !hasProjectFilter ? 'bg-muted text-foreground' : ''
                  }`}
                  onClick={selectAllProjects}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={!hasProjectFilter}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">全部项目</span>
                  <span className="text-xs text-muted-foreground">{projectOptions.length}</span>
                </button>
                <div className="max-h-[260px] overflow-y-auto pr-1">
                  {projectOptions.map((project) => {
                    const checked = selectedProjectSet.has(project.key)
                    return (
                      <button
                        key={project.key}
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                          checked ? 'bg-muted text-foreground' : ''
                        }`}
                        onClick={() => toggleProjectFilter(project.key)}
                        title={project.cwd}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          className="size-3.5 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate">{project.label}</span>
                        <span className="text-xs text-muted-foreground">{project.count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Popover open={showPathSettings} onOpenChange={setShowPathSettings}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`${bottomToolButtonClass} ${showPathSettings ? 'bg-accent text-foreground' : ''}`}
                title="高级路径设置"
              >
                {showPathSettings ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" side="top" sideOffset={6} className="w-[360px] max-w-[calc(100vw-16px)] p-2">
              <div className="flex items-center gap-2">
                <div className="text-xs font-medium text-foreground">高级路径设置</div>
                {hasAppliedPathConfig ? <Badge variant="outline">已自定义</Badge> : <Badge variant="secondary">默认路径</Badge>}
              </div>
              <div className="mt-1.5">
                {platform === 'claude' ? (
                  <PathInputWithPicker
                    value={paths.claudeHome || ''}
                    onChange={(value) => setPaths((prev) => ({ ...prev, claudeHome: value }))}
                    onPick={() => void handlePickPath('claudeHome', { title: '选择 Claude home 文件夹' })}
                    placeholder="Claude home 路径（可选）"
                  />
                ) : null}
                {platform === 'codex' ? (
                  <div className="grid grid-cols-1 gap-1.5">
                    <PathInputWithPicker
                      value={paths.codexHome || ''}
                      onChange={(value) => setPaths((prev) => ({ ...prev, codexHome: value }))}
                      onPick={() => void handlePickPath('codexHome', { title: '选择 Codex home 文件夹' })}
                      placeholder="Codex home 路径（可选）"
                    />
                    <PathInputWithPicker
                      value={paths.codexProjectRoot || ''}
                      onChange={(value) => setPaths((prev) => ({ ...prev, codexProjectRoot: value }))}
                      onPick={() => void handlePickPath('codexProjectRoot', { title: '选择 Codex 项目根文件夹' })}
                      placeholder="Codex 项目根过滤（可选）"
                    />
                  </div>
                ) : null}
                {platform === 'opencode' ? (
                  <PathInputWithPicker
                    value={paths.opencodeDbPath || ''}
                    onChange={(value) => setPaths((prev) => ({ ...prev, opencodeDbPath: value }))}
                    onPick={() =>
                      void handlePickPath('opencodeDbPath', {
                        title: '选择 OpenCode 数据库文件',
                        directory: false,
                      })
                    }
                    placeholder="OpenCode DB 路径（可选）"
                    pickLabel="选择文件"
                  />
                ) : null}
                {platform === 'lingmo' ? (
                  <PathInputWithPicker
                    value={paths.lingmoHome || ''}
                    onChange={(value) => setPaths((prev) => ({ ...prev, lingmoHome: value }))}
                    onPick={() =>
                      void handlePickPath('lingmoHome', {
                        title: '选择 LingMo 数据文件夹',
                      })
                    }
                    placeholder="LingMo 数据路径（可选，默认使用当前应用数据目录）"
                  />
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className={bottomToolButtonClass}
            title="导出会话为 Markdown"
            onClick={() => void handleExportSession()}
            disabled={!selectedSessionKey || exporting}
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={bottomToolButtonClass}
            title="编辑历史 / 回滚"
            onClick={() => setHistoryOpen(true)}
            disabled={!selectedSessionKey}
          >
            <History className="size-3.5" />
          </Button>
          {detail && (
            <>
              <div className="mx-1 h-3 w-px bg-border" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={bottomToolButtonClass}
                    title="活跃度热力图"
                  >
                    <Activity className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="center" side="top" sideOffset={6} className="w-auto p-4">
                  <div className="text-xs font-medium text-foreground/80 mb-3 text-center">近 12 周活跃度</div>
                  <MiniActivityHeatmap sessions={filteredSessions} />
                </PopoverContent>
              </Popover>
              <span className="flex items-center gap-0.5 tabular-nums text-muted-foreground" title="会话 Token 估算">
                <Zap className="size-3" />
                {sessionTokenStats.total >= 1000 ? `${(sessionTokenStats.total / 1000).toFixed(1)}k` : sessionTokenStats.total}
              </span>
              <span className="flex items-center gap-0.5 tabular-nums text-muted-foreground" title={`用户 ${sessionTokenStats.user} / 助手 ${sessionTokenStats.assistant}`}>
                <MessageSquare className="size-3" />
                {messageRoleStats.all}
              </span>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`${bottomToolButtonClass} ml-auto`}
            title={sortOrder === 'newest' ? '最新' : '最早'}
            onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
            disabled={!detail || visibleDetailMessages.length < 2}
          >
            {sortOrder === 'newest' ? <ArrowDownNarrowWide className="size-3.5" /> : <ArrowUpNarrowWide className="size-3.5" />}
          </Button>
        </div>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-[680px] max-w-full p-0 sm:max-w-[680px]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <SheetHeader className="border-b px-5 py-4">
              <SheetTitle className="text-base">编辑历史 / 回滚</SheetTitle>
              <SheetDescription>
                仅显示当前平台与当前会话的编辑记录。点击“回滚到此版本”会把目标消息恢复到旧内容，并新增一条回滚日志。
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loadingEditLogs ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在加载编辑历史...
                </div>
              ) : editLogs.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  暂无编辑历史。你编辑消息后会在这里显示记录。
                </div>
              ) : (
                <div className="space-y-3">
                  {editLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">#{log.id}</Badge>
                          <span>{formatTimestamp(log.createdAt)}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRestoreLog(log)}
                          disabled={restoringLogId === log.id}
                        >
                          {restoringLogId === log.id ? (
                            <Loader2 className="mr-1 size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-1 size-3.5" />
                          )}
                          回滚到此版本
                        </Button>
                      </div>
                      <div className="mb-2 rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                        编辑目标：{log.editTarget}
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="rounded border border-rose-200/60 bg-rose-50/40 p-2">
                          <div className="mb-1 text-xs font-medium text-rose-700">变更前</div>
                          <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-rose-900/90">{truncateText(log.oldContent, 320) || '(empty)'}</pre>
                        </div>
                        <div className="rounded border border-emerald-200/60 bg-emerald-50/40 p-2">
                          <div className="mb-1 text-xs font-medium text-emerald-700">变更后</div>
                          <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-emerald-900/90">{truncateText(log.newContent, 320) || '(empty)'}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
        </>
      )}
    </div>
  )
}
