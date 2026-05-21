import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Mark } from '@/db/marks'
import { markToMarkdown } from '@/lib/mark-to-markdown'
import { sanitizeFileName } from '@/lib/sync/filename-utils'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  buildGitHubProjectsCollectionMarkdown,
  buildGitHubProjectsComparisonMarkdown,
  isGitHubProjectMark,
} from '@/lib/github-project'

const MARK_TYPE_LABELS: Record<Mark['type'], string> = {
  scan: '截图',
  text: '文本',
  image: '图片',
  link: '链接',
  file: '文件',
  recording: '录音',
  todo: '待办',
}

function compactText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

export function getRecordTitle(mark: Mark) {
  const rawTitle = compactText(mark.desc) || compactText(mark.content) || compactText(mark.url) || MARK_TYPE_LABELS[mark.type]
  return rawTitle.slice(0, 48).trim() || '记录素材'
}

function buildRecordSection(mark: Mark, index?: number) {
  const title = getRecordTitle(mark)
  const content = markToMarkdown(mark).trim()
  const heading = index === undefined ? `## ${title}` : `## ${index + 1}. ${title}`
  const meta = [
    `- 类型：${MARK_TYPE_LABELS[mark.type]}`,
    `- 时间：${formatDateTime(mark.createdAt)}`,
    `- 记录 ID：${mark.id}`,
  ]

  return [
    heading,
    '',
    ...meta,
    '',
    content || '> 这条记录暂时没有可写入正文的内容。',
  ].join('\n')
}

export function buildRecordsMarkdown(marks: Mark[], options?: { tagName?: string }) {
  const sortedMarks = [...marks].sort((a, b) => a.createdAt - b.createdAt)
  if (sortedMarks.length > 0 && sortedMarks.every(isGitHubProjectMark)) {
    return buildGitHubProjectsCollectionMarkdown(sortedMarks, options)
  }

  const isSingle = sortedMarks.length === 1
  const title = isSingle ? getRecordTitle(sortedMarks[0]) : `记录整理 ${formatDateTime(Date.now())}`
  const tagLine = options?.tagName ? `- 来源标签：${options.tagName}` : null

  return [
    `# ${title}`,
    '',
    '> 从记录中转箱转化而来，可继续整理、补充双链或归档为正式笔记。',
    '',
    '- 来源：记录中转箱',
    `- 转化时间：${formatDateTime(Date.now())}`,
    `- 记录数量：${sortedMarks.length}`,
    ...(tagLine ? [tagLine] : []),
    '',
    ...sortedMarks.flatMap((mark, index) => [
      buildRecordSection(mark, isSingle ? undefined : index),
      '',
      '---',
      '',
    ]).slice(0, -2),
    '',
  ].join('\n')
}

export function buildRecordsAppendMarkdown(marks: Mark[], options?: { tagName?: string }) {
  const sortedMarks = [...marks].sort((a, b) => a.createdAt - b.createdAt)
  const tagText = options?.tagName ? ` · ${options.tagName}` : ''

  return [
    `## 来自记录中转箱${tagText}`,
    '',
    `> 追加时间：${formatDateTime(Date.now())} · ${sortedMarks.length} 条记录`,
    '',
    ...sortedMarks.flatMap((mark, index) => [
      buildRecordSection(mark, sortedMarks.length === 1 ? undefined : index),
      '',
    ]),
  ].join('\n').trim()
}

async function fileExists(relativePath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  return workspace.isCustom
    ? exists(options.path)
    : exists(options.path, { baseDir: options.baseDir })
}

async function writeWorkspaceText(relativePath: string, content: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  if (workspace.isCustom) {
    await writeTextFile(options.path, content)
    return
  }
  await writeTextFile(options.path, content, { baseDir: options.baseDir })
}

async function readWorkspaceText(relativePath: string) {
  const workspace = await getWorkspacePath()
  const options = await getFilePathOptions(relativePath)
  return workspace.isCustom
    ? readTextFile(options.path)
    : readTextFile(options.path, { baseDir: options.baseDir })
}

export async function createNoteFromRecords(marks: Mark[], options?: { tagName?: string }) {
  if (marks.length === 0) {
    throw new Error('没有可转化的记录')
  }

  const firstMark = marks[0]
  const title = marks.length === 1 ? getRecordTitle(firstMark) : `记录整理-${formatDateForFile(Date.now())}`
  const baseName = sanitizeFileName(title).slice(0, 56) || '记录素材'
  let filePath = `${baseName}.md`
  let counter = 1

  while (await fileExists(filePath)) {
    filePath = `${baseName}(${counter}).md`
    counter += 1
  }

  const content = buildRecordsMarkdown(marks, options)
  await writeWorkspaceText(filePath, content)

  return { filePath, content }
}

export async function createGitHubProjectsComparisonNote(marks: Mark[], options?: { tagName?: string }) {
  const githubMarks = marks.filter(isGitHubProjectMark)
  if (githubMarks.length < 2) {
    throw new Error('至少选择 2 个 GitHub 开源项目才能生成技术对比')
  }

  const title = `开源项目技术选型对比-${formatDateForFile(Date.now())}`
  const baseName = sanitizeFileName(title).slice(0, 56) || '开源项目技术选型对比'
  let filePath = `${baseName}.md`
  let counter = 1

  while (await fileExists(filePath)) {
    filePath = `${baseName}(${counter}).md`
    counter += 1
  }

  const content = buildGitHubProjectsComparisonMarkdown(githubMarks, options)
  await writeWorkspaceText(filePath, content)

  return { filePath, content }
}

export async function appendRecordsToNote(filePath: string, marks: Mark[], options?: { currentContent?: string; tagName?: string }) {
  if (!/\.md$/i.test(filePath)) {
    throw new Error('只能追加到 Markdown 笔记')
  }
  if (marks.length === 0) {
    throw new Error('没有可追加的记录')
  }

  const existingContent = options?.currentContent ?? await readWorkspaceText(filePath)
  const appendContent = buildRecordsAppendMarkdown(marks, { tagName: options?.tagName })
  const nextContent = existingContent.trim()
    ? `${existingContent.trimEnd()}\n\n${appendContent}\n`
    : `${appendContent}\n`

  await writeWorkspaceText(filePath, nextContent)
  return nextContent
}
