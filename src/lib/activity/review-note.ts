import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'

import { readWorkspaceTextFile } from '@/lib/file-binary'
import { sanitizeFileName } from '@/lib/sync/filename-utils'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

const REVIEW_FOLDER = 'activity-reviews'

function normalizeFileName(value: string) {
  return sanitizeFileName(value).replace(/\.md$/i, '').slice(0, 72) || 'activity-review'
}

function formatTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function trimMarkdown(content: string) {
  return content.trim().replace(/\n{3,}/g, '\n\n')
}

async function ensureWorkspaceFolder(relativeFolderPath: string) {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(relativeFolderPath)
  const folderExists = workspace.isCustom
    ? await exists(pathOptions.path)
    : await exists(pathOptions.path, { baseDir: pathOptions.baseDir })

  if (folderExists) return

  if (workspace.isCustom) {
    await mkdir(pathOptions.path, { recursive: true })
    return
  }

  await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
}

async function workspaceFileExists(relativePath: string) {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(relativePath)
  return workspace.isCustom
    ? exists(pathOptions.path)
    : exists(pathOptions.path, { baseDir: pathOptions.baseDir })
}

async function writeWorkspaceText(relativePath: string, content: string) {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(relativePath)

  if (workspace.isCustom) {
    await writeTextFile(pathOptions.path, content)
    return
  }

  await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
}

export function isAppendableActivityNote(filePath?: string | null) {
  return Boolean(filePath && /\.(md|markdown|txt)$/i.test(filePath))
}

export function wrapReviewAsWeeklyReport(title: string, content: string, rangeLabel?: string) {
  return [
    `# 周报 - ${title}`,
    '',
    `- 周期：${rangeLabel || title}`,
    `- 生成时间：${formatTimestamp()}`,
    '',
    '## 本周摘要',
    '- ',
    '',
    '## 关键成果',
    '- ',
    '',
    '## 风险与问题',
    '- ',
    '',
    '## 下周计划',
    '- [ ] ',
    '',
    '## AI 回顾原文',
    '',
    trimMarkdown(content),
    '',
  ].join('\n')
}

export function wrapReviewAsRetrospective(title: string, content: string, rangeLabel?: string) {
  return [
    `# 复盘 - ${title}`,
    '',
    `- 范围：${rangeLabel || title}`,
    `- 生成时间：${formatTimestamp()}`,
    '',
    '## 结果回顾',
    '- ',
    '',
    '## 做得好的地方',
    '- ',
    '',
    '## 问题与风险',
    '- ',
    '',
    '## 下一步行动',
    '- [ ] ',
    '',
    '## AI 回顾原文',
    '',
    trimMarkdown(content),
    '',
  ].join('\n')
}

function buildAppendSection(title: string, content: string, rangeLabel?: string) {
  return [
    `## ${title}`,
    '',
    `> 追加时间：${formatTimestamp()}${rangeLabel ? ` · ${rangeLabel}` : ''}`,
    '',
    trimMarkdown(content),
    '',
  ].join('\n')
}

export async function createActivityReviewNote(title: string, content: string) {
  await ensureWorkspaceFolder(REVIEW_FOLDER)

  const baseName = normalizeFileName(title)
  let filePath = `${REVIEW_FOLDER}/${baseName}.md`
  let suffix = 1

  while (await workspaceFileExists(filePath)) {
    filePath = `${REVIEW_FOLDER}/${baseName}-${suffix}.md`
    suffix += 1
  }

  await writeWorkspaceText(filePath, trimMarkdown(content) + '\n')
  return filePath
}

export async function appendActivityReviewToNote(
  filePath: string,
  content: string,
  options?: {
    currentContent?: string
    title?: string
    rangeLabel?: string
  },
) {
  if (!isAppendableActivityNote(filePath)) {
    throw new Error('只能追加到 Markdown 或文本笔记')
  }

  const existingContent = options?.currentContent ?? await readWorkspaceTextFile(filePath)
  const nextSection = buildAppendSection(options?.title || '活动回顾', content, options?.rangeLabel)
  const nextContent = existingContent.trim()
    ? `${existingContent.trimEnd()}\n\n${nextSection}`
    : `${nextSection}\n`

  await writeWorkspaceText(filePath, nextContent)
  return nextContent
}
