import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import type { AiHotspotItem } from './types'

const NOTE_FOLDER = 'AI热点'

function getItemDate(item: AiHotspotItem) {
  const value = item.publishedAt || item.firstSeenAt || item.lastSeenAt
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10)
  }
  return date.toISOString().slice(0, 10)
}

function toSafeSegment(value: string, fallback: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return sanitized || fallback
}

async function pathExists(relativePath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  if (workspace.isCustom) {
    return exists(options.path)
  }
  return exists(options.path, { baseDir: options.baseDir })
}

async function ensureWorkspaceFolder(relativeFolderPath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativeFolderPath)
  if (workspace.isCustom) {
    if (!(await exists(options.path))) {
      await mkdir(options.path, { recursive: true })
    }
    return
  }
  if (!(await exists(options.path, { baseDir: options.baseDir }))) {
    await mkdir(options.path, { baseDir: options.baseDir, recursive: true })
  }
}

async function writeWorkspaceNote(relativePath: string, content: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  if (workspace.isCustom) {
    await writeTextFile(options.path, content)
    return
  }
  await writeTextFile(options.path, content, { baseDir: options.baseDir })
}

async function createUniqueNotePath(baseName: string) {
  let filePath = `${NOTE_FOLDER}/${baseName}.md`
  let index = 2
  while (await pathExists(filePath)) {
    filePath = `${NOTE_FOLDER}/${baseName}-${index}.md`
    index += 1
  }
  return filePath
}

export function buildHotspotItemNoteMarkdown(item: AiHotspotItem) {
  const lines = [
    `# ${item.title}`,
    '',
    `- 来源：${item.sourceName}${item.feedName ? ` / ${item.feedName}` : ''}`,
    `- 发布时间：${item.publishedAt || '未知'}`,
    `- 原文链接：${item.url}`,
    `- 标签：${item.tags.length > 0 ? item.tags.join('、') : '未分类'}`,
    `- 热度：${item.score}`,
    '',
    '## 摘要',
    '',
    item.summary || '待补充。',
    '',
    '## 观察',
    '',
    '- ',
  ]

  if (item.titleOriginal && item.titleOriginal !== item.title) {
    lines.splice(2, 0, `> 原标题：${item.titleOriginal}`, '')
  }

  return lines.join('\n')
}

export async function writeHotspotItemNote(item: AiHotspotItem) {
  await ensureWorkspaceFolder(NOTE_FOLDER)
  const date = getItemDate(item)
  const titlePart = toSafeSegment(item.title, 'ai-hotspot')
  const filePath = await createUniqueNotePath(`${date}-${titlePart}`)
  await writeWorkspaceNote(filePath, buildHotspotItemNoteMarkdown(item))
  return filePath
}

export async function writeHotspotDigestNote(markdown: string, params: {
  title: string
  date?: string
}) {
  await ensureWorkspaceFolder(NOTE_FOLDER)
  const date = params.date || new Date().toISOString().slice(0, 10)
  const titlePart = toSafeSegment(params.title, 'AI热点摘要')
  const filePath = await createUniqueNotePath(`${date}-${titlePart}`)
  await writeWorkspaceNote(filePath, markdown)
  return filePath
}
