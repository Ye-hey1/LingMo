import { exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { sanitizeFileName, sanitizeFilePath } from '@/lib/sync/filename-utils'

const DEFAULT_RESEARCH_REPORT_TITLE = '研究报告'
const MAX_RESEARCH_REPORT_TITLE_LENGTH = 70
export const RESEARCH_SESSION_DIR = '.sessions'

export type ResearchReportFileTarget = {
  title: string
  dateStamp: string
  baseName: string
  fileName: string
  sessionFileName: string
  relativeFilePath: string
  relativeSessionFilePath: string
}

export function formatResearchReportDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
}

function firstMeaningfulLine(value: string) {
  return value
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('<!--'))
}

function extractReportHeading(report: string) {
  const lines = report.split('\n').slice(0, 40)
  const h1 = lines
    .map(line => line.match(/^#\s+(.+?)\s*$/)?.[1]?.trim())
    .find(Boolean)
  if (h1) return h1

  return lines
    .map(line => line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim())
    .find(title => title && !/^(参考来源|来源|附录|研究质量)/.test(title))
}

export function normalizeResearchReportTitle(query: string, report = '') {
  const rawTitle = extractReportHeading(report)
    || firstMeaningfulLine(query)
    || DEFAULT_RESEARCH_REPORT_TITLE

  const withoutControlWords = rawTitle
    .replace(/直接开始研究|直接研究|开始研究|跳过|不用问|no questions/gi, '')
    .replace(/\.(md|markdown|research\.json)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const sanitized = sanitizeFileName(withoutControlWords || DEFAULT_RESEARCH_REPORT_TITLE)
    .replace(/\.(md|markdown|research\.json)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RESEARCH_REPORT_TITLE_LENGTH)
    .replace(/^[_\s.-]+|[_\s.-]+$/g, '')

  return sanitized || DEFAULT_RESEARCH_REPORT_TITLE
}

export function buildResearchReportBaseName(query: string, report: string, date: Date) {
  const title = normalizeResearchReportTitle(query, report)
  const dateStamp = formatResearchReportDate(date)
  return {
    title,
    dateStamp,
    baseName: `${title}-${dateStamp}`,
  }
}

async function workspaceRelativePathExists(relativePath: string) {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(relativePath)

  try {
    if (workspace.isCustom) {
      return await exists(pathOptions.path)
    }
    return await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
  } catch {
    return false
  }
}

export async function buildUniqueResearchReportTarget(params: {
  query: string
  report: string
  date: Date
  researchDir?: string
}): Promise<ResearchReportFileTarget> {
  const researchDir = params.researchDir || 'research'
  const { title, dateStamp, baseName } = buildResearchReportBaseName(params.query, params.report, params.date)

  for (let index = 0; index < 100; index++) {
    const candidateBaseName = sanitizeFileName(index === 0 ? baseName : `${baseName}-${index + 1}`)
    const fileName = `${candidateBaseName}.md`
    const sessionFileName = `${candidateBaseName}.research.json`
    const relativeFilePath = sanitizeFilePath(`${researchDir}/${fileName}`)
    const relativeSessionFilePath = sanitizeFilePath(`${researchDir}/${RESEARCH_SESSION_DIR}/${sessionFileName}`)

    const [reportExists, sessionExists] = await Promise.all([
      workspaceRelativePathExists(relativeFilePath),
      workspaceRelativePathExists(relativeSessionFilePath),
    ])

    if (!reportExists && !sessionExists) {
      return {
        title,
        dateStamp,
        baseName: candidateBaseName,
        fileName,
        sessionFileName,
        relativeFilePath,
        relativeSessionFilePath,
      }
    }
  }

  const fallbackBaseName = sanitizeFileName(`${baseName}-${Date.now()}`)
  return {
    title,
    dateStamp,
    baseName: fallbackBaseName,
    fileName: `${fallbackBaseName}.md`,
    sessionFileName: `${fallbackBaseName}.research.json`,
    relativeFilePath: sanitizeFilePath(`${researchDir}/${fallbackBaseName}.md`),
    relativeSessionFilePath: sanitizeFilePath(`${researchDir}/${RESEARCH_SESSION_DIR}/${fallbackBaseName}.research.json`),
  }
}
