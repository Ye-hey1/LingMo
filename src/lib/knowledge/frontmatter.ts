/**
 * frontmatter - Markdown 笔记 frontmatter 权威解析/序列化/合并器
 *
 * 项目级 Schema（字段全部可选，但建议必填 title）：
 *   ---
 *   title: 标题
 *   tags: [tag1, tag2]
 *   aliases: [别名1, 别名2]
 *   status: inbox | active | archived | deleted
 *   source: https://...
 *   created: 2026-01-01T00:00:00.000Z
 *   updated: 2026-01-02T00:00:00.000Z
 *   review_after: 2026-01-10
 *   related: [path/to/note1.md, path/to/note2.md]
 *   source_run_id: agent_run_xxx
 *   ---
 *
 * 不依赖外部 YAML 库：手写最小子集解析器，足以覆盖上述字段。
 * 兼容 yaml 行内数组 [a, b] 与块数组 - a\n- b。
 */

export type NoteStatus = 'inbox' | 'active' | 'archived' | 'deleted'

export interface NoteFrontmatter {
  title?: string
  tags?: string[]
  aliases?: string[]
  status?: NoteStatus
  source?: string
  created?: string
  updated?: string
  review_after?: string
  related?: string[]
  source_run_id?: string
  /** 透传其他字段（不丢失未知数据） */
  extras?: Record<string, string | string[] | undefined>
}

const FRONTMATTER_RE = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/

export interface ParsedNote {
  frontmatter: NoteFrontmatter
  body: string
  hasFrontmatter: boolean
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    // 行内 [a, b]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
    // 逗号分隔
    return trimmed.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  }
  return undefined
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // 去引号
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function coerceStatus(value: unknown): NoteStatus | undefined {
  const s = coerceString(value)?.toLowerCase()
  if (s === 'inbox' || s === 'active' || s === 'archived' || s === 'deleted') return s
  return undefined
}

/**
 * 解析 frontmatter 文本块为结构化对象。
 * 仅提取 schema 中已知字段；未知字段透传到 extras。
 */
export function parseFrontmatterText(fmText: string): NoteFrontmatter {
  const fm: NoteFrontmatter = {}
  const extras: Record<string, string | string[] | undefined> = {}
  const knownKeys = new Set(['title', 'tags', 'aliases', 'status', 'source', 'url', 'created', 'updated', 'review_after', 'review-after', 'related', 'source_run_id', 'source-run-id'])
  let currentKey = ''
  let currentArray: string[] | null = null

  const flushArray = (key: string) => {
    if (currentArray && currentArray.length > 0) {
      const normalized = key.toLowerCase().replace(/-/g, '_')
      assignField(fm, normalized, currentArray)
    }
    currentArray = null
  }

  for (const rawLine of fmText.split(/\r?\n/)) {
    // 块数组项
    const listItemMatch = rawLine.match(/^\s+-\s+(.+)$/)
    if (listItemMatch && currentKey) {
      const value = coerceString(listItemMatch[1].replace(/^["']|["']$/g, ''))
      if (value !== undefined) {
        if (currentArray === null) currentArray = []
        currentArray.push(value)
      }
      continue
    }
    // 新 key
    const match = rawLine.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (match) {
      if (currentKey) flushArray(currentKey)
      const [, key, rawValue] = match
      currentKey = key
      if (rawValue.trim() === '') {
        // 可能是块数组开头，等下一行
        currentArray = null
        continue
      }
      const normalized = key.toLowerCase().replace(/-/g, '_')
      // 先暂存到 extras，下面 normalize 阶段再分发
      if (knownKeys.has(normalized)) {
        if (rawValue.trim().startsWith('[')) {
          // 行内数组
          const arr = coerceStringArray(rawValue)
          if (arr && arr.length > 0) assignField(fm, normalized, arr)
          currentArray = null
        } else {
          const v = coerceString(rawValue)
          if (v !== undefined) assignField(fm, normalized, v)
          currentArray = null
        }
      } else {
        const v = coerceString(rawValue)
        extras[key] = v
      }
      // 重置：让下一个 key 决定是否开新数组
      // currentKey 保留以支持后续块数组项
    }
  }
  if (currentKey) flushArray(currentKey)

  // url → source 别名
  if (!fm.source && extras.url) {
    fm.source = typeof extras.url === 'string' ? extras.url : extras.url[0]
    delete extras.url
  }
  if (Object.keys(extras).length > 0) {
    fm.extras = extras
  }
  return fm
}

function assignField(fm: NoteFrontmatter, normalizedKey: string, value: string | string[]) {
  switch (normalizedKey) {
    case 'title':
      if (typeof value === 'string') fm.title = value
      break
    case 'tags':
      fm.tags = Array.isArray(value) ? value : coerceStringArray(value)
      break
    case 'aliases':
      fm.aliases = Array.isArray(value) ? value : coerceStringArray(value)
      break
    case 'status':
      if (typeof value === 'string') fm.status = coerceStatus(value)
      break
    case 'source':
    case 'url':
      if (typeof value === 'string') fm.source = value
      break
    case 'created':
      if (typeof value === 'string') fm.created = value
      break
    case 'updated':
      if (typeof value === 'string') fm.updated = value
      break
    case 'review_after':
      if (typeof value === 'string') fm.review_after = value
      break
    case 'related':
      fm.related = Array.isArray(value) ? value : coerceStringArray(value)
      break
    case 'source_run_id':
      if (typeof value === 'string') fm.source_run_id = value
      break
    default:
      break
  }
}

/**
 * 解析整篇 Markdown 文本为 frontmatter + body。
 */
export function parseNote(content: string): ParsedNote {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    return { frontmatter: {}, body: content, hasFrontmatter: false }
  }
  const [, fmText, body] = match
  return {
    frontmatter: parseFrontmatterText(fmText),
    body: body || '',
    hasFrontmatter: true,
  }
}

/**
 * 序列化 frontmatter 为 YAML 文本块（不含 --- 边界）。
 * 字段顺序固定，便于 diff 友好。
 */
export function serializeFrontmatterText(fm: NoteFrontmatter): string {
  const lines: string[] = []
  const pushScalar = (key: string, value?: string) => {
    if (value === undefined || value === '') return
    lines.push(`${key}: ${value}`)
  }
  const pushArray = (key: string, arr?: string[]) => {
    if (!arr || arr.length === 0) return
    if (arr.length === 1) {
      lines.push(`${key}: [${arr[0]}]`)
    } else {
      lines.push(`${key}: [${arr.join(', ')}]`)
    }
  }

  pushScalar('title', fm.title)
  pushArray('tags', fm.tags)
  pushArray('aliases', fm.aliases)
  pushScalar('status', fm.status)
  pushScalar('source', fm.source)
  pushScalar('created', fm.created)
  pushScalar('updated', fm.updated)
  pushScalar('review_after', fm.review_after)
  pushArray('related', fm.related)
  pushScalar('source_run_id', fm.source_run_id)
  if (fm.extras) {
    for (const [k, v] of Object.entries(fm.extras)) {
      if (typeof v === 'string') pushScalar(k, v)
      else if (Array.isArray(v)) pushArray(k, v)
    }
  }
  return lines.join('\n')
}

/**
 * 序列化完整 Markdown：如果 frontmatter 非空，前置 --- 块。
 */
export function serializeNote(fm: NoteFrontmatter, body: string): string {
  const hasAnyField =
    fm.title || fm.tags?.length || fm.aliases?.length || fm.status || fm.source ||
    fm.created || fm.updated || fm.review_after || fm.related?.length || fm.source_run_id ||
    (fm.extras && Object.keys(fm.extras).length > 0)
  if (!hasAnyField) return body
  return `---\n${serializeFrontmatterText(fm)}\n---\n\n${body.replace(/^\s+/, '')}`
}

/**
 * 合并 frontmatter：patch 中的字段覆盖 base，但 undefined 字段保留 base。
 * 数组字段（tags/aliases/related）：patch 全量替换（不去重，调用方决定）。
 */
export function mergeFrontmatter(base: NoteFrontmatter, patch: NoteFrontmatter): NoteFrontmatter {
  const result: NoteFrontmatter = { ...base }
  if (patch.title !== undefined) result.title = patch.title
  if (patch.tags !== undefined) result.tags = patch.tags
  if (patch.aliases !== undefined) result.aliases = patch.aliases
  if (patch.status !== undefined) result.status = patch.status
  if (patch.source !== undefined) result.source = patch.source
  if (patch.created !== undefined) result.created = patch.created
  if (patch.updated !== undefined) result.updated = patch.updated
  if (patch.review_after !== undefined) result.review_after = patch.review_after
  if (patch.related !== undefined) result.related = patch.related
  if (patch.source_run_id !== undefined) result.source_run_id = patch.source_run_id
  if (patch.extras !== undefined) {
    result.extras = { ...(base.extras || {}), ...patch.extras }
  }
  return result
}

/**
 * 给已有 content 应用 frontmatter patch。
 * - 解析现有 frontmatter（如有）
 * - 用 patch 合并
 * - 自动设置 updated（除非 patch 显式提供）
 * - 重新序列化返回
 */
export function applyFrontmatterPatch(content: string, patch: NoteFrontmatter): string {
  const parsed = parseNote(content)
  const merged = mergeFrontmatter(parsed.frontmatter, patch)
  if (patch.updated === undefined) {
    merged.updated = new Date().toISOString()
  }
  return serializeNote(merged, parsed.body)
}

/**
 * 确保必填字段：title 回退链 frontmatter.title → 第一行 H1 → fallback
 * 自动设置 created（首次创建时）
 * 不修改已有 frontmatter 的其他字段。
 */
export function ensureRequiredFrontmatter(
  content: string,
  fallback: { title?: string; sourceRunId?: string; origin?: 'manual' | 'agent_generated' | 'capture' | 'synced' | 'imported' } = {},
): string {
  const parsed = parseNote(content)
  const patch: NoteFrontmatter = {}

  if (!parsed.frontmatter.title) {
    patch.title = inferTitleFromBody(parsed.body) || fallback.title || ''
  }
  if (!parsed.frontmatter.created) {
    patch.created = new Date().toISOString()
  }
  if (!parsed.frontmatter.updated) {
    patch.updated = new Date().toISOString()
  }
  if (!parsed.frontmatter.source_run_id && fallback.sourceRunId) {
    patch.source_run_id = fallback.sourceRunId
  }
  if (!parsed.frontmatter.status) {
    patch.status = fallback.origin === 'agent_generated' ? 'inbox' : 'active'
  }

  if (Object.keys(patch).length === 0) return content
  return applyFrontmatterPatch(content, patch)
}

function inferTitleFromBody(body: string): string {
  for (const line of body.split(/\r?\n/, 8)) {
    const trimmed = line.trim()
    if (/^#\s+/.test(trimmed)) {
      return trimmed.replace(/^#\s+/, '').trim()
    }
    if (trimmed && !/^#{1,6}\s/.test(trimmed)) {
      return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed
    }
  }
  return ''
}

/**
 * 文件名 → 默认标题（去掉扩展名）。
 */
export function fileNameToTitle(filePath: string): string {
  const baseName = filePath.split('/').pop() || filePath
  return baseName.replace(/\.(md|markdown)$/i, '').trim()
}
