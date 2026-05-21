import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { createOpenAIClient, getAISettings, handleAIError, prepareMessages } from '@/lib/ai/utils'
import type { Mark } from '@/db/marks'

export const GITHUB_PROJECT_TAG_NAME = '开源项目'
const GITHUB_API_BASE = 'https://api.github.com'
const README_LIMIT = 20000

export class GitHubProjectError extends Error {
  status?: number

  constructor(message: string, options?: { status?: number }) {
    super(message)
    this.name = 'GitHubProjectError'
    this.status = options?.status
  }
}

export interface GitHubRepoRef {
  owner: string
  repo: string
  url: string
}

interface GitHubRepoApiResponse {
  full_name?: string
  html_url?: string
  description?: string | null
  stargazers_count?: number
  forks_count?: number
  language?: string | null
  topics?: string[]
  license?: { spdx_id?: string | null; name?: string | null } | null
  homepage?: string | null
  pushed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  default_branch?: string
}

interface GitHubReadmeApiResponse {
  content?: string
  encoding?: string
}

export interface GitHubProjectInfo {
  source: 'github'
  collectedAt: number
  owner: string
  repo: string
  fullName: string
  url: string
  description: string
  stars: number
  forks: number
  language: string | null
  topics: string[]
  license: string | null
  homepage: string | null
  pushedAt: string | null
  readme: string
}

export interface GitHubProjectSummary {
  projectIntro: string
  techStack: string[]
  techArchitecture: string[]
  coreFeatures: string[]
  useCases: string[]
  installation: string[]
  projectStructure: string[]
  quickStart: string[]
  documentationOutline: string[]
  applicationNotes: string[]
}

export interface GitHubProjectRecordPayload extends GitHubProjectInfo {
  summary: GitHubProjectSummary
  displayName?: string
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function normalizeGitHubUrl(value?: string) {
  const ref = value ? parseGitHubRepoUrl(value) : null
  return ref?.url.toLowerCase() || cleanText(value).replace(/\/+$/, '').toLowerCase()
}

function decodeBase64Content(value?: string) {
  if (!value) return ''
  const compact = value.replace(/\s+/g, '')
  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(compact)))
    }
  } catch {
    // fall back below
  }

  try {
    const binary = atob(compact)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const content = text.trim()
  if (!content) return null

  try {
    return JSON.parse(content)
  } catch {
    // ignore
  }

  const match = content.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback
  return value
    .map(item => cleanText(String(item)))
    .filter(Boolean)
    .slice(0, 8)
}

function normalizeAliasStringArray(parsed: Record<string, unknown> | null, keys: string[], fallback: string[] = []) {
  for (const key of keys) {
    const value = parsed?.[key]
    if (Array.isArray(value)) {
      return normalizeStringArray(value, fallback)
    }
  }

  return fallback
}

function extractReadmeSection(readme: string, headings: string[]) {
  const lines = readme.split(/\r?\n/)
  const wanted = headings.map(item => item.toLowerCase())

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (!match) continue

    const level = match[1].length
    const title = cleanText(match[2]).toLowerCase()
    if (!wanted.some(item => title.includes(item))) continue

    const section: string[] = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextHeading = lines[next].match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
      if (nextHeading && nextHeading[1].length <= level) {
        break
      }
      section.push(lines[next])
    }

    return section.join('\n').trim().slice(0, 4000)
  }

  return ''
}

function extractReadmeHeadings(readme: string) {
  return readme
    .split(/\r?\n/)
    .map(line => line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/)?.[2])
    .filter((item): item is string => Boolean(item))
    .map(item => cleanText(item.replace(/\[[^\]]+\]\([^)]+\)/g, '')))
    .filter(Boolean)
    .slice(0, 10)
}

function sectionToList(value: string, fallback: string[]) {
  if (!value) return fallback

  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^```/.test(line))
    .map(line => line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 8)

  return lines.length > 0 ? lines : fallback
}

function compactReadmeExcerpt(value: string, maxLength = 2600) {
  const text = value.trim()
  if (!text) return ''
  if (text.length <= maxLength) return text

  const next = text.slice(0, maxLength)
  const safeEnd = next.lastIndexOf('\n')
  const clipped = (safeEnd > 800 ? next.slice(0, safeEnd) : next).trimEnd()
  const fenceCount = (clipped.match(/```/g) || []).length

  return `${clipped}${fenceCount % 2 === 1 ? '\n```' : ''}\n\n...`
}

function cleanupLegacyGitHubProjectContent(content: string) {
  return content
    .replace(/^## README 结构$/gm, '## 文档结构')
    .replace(/^### README 片段\s*\n/gm, '')
}

function fallbackSummary(info: GitHubProjectInfo): GitHubProjectSummary {
  const language = info.language ? [info.language] : []
  const topicItems = info.topics.slice(0, 5)
  const installSection = extractReadmeSection(info.readme, ['install', 'installation', 'setup', 'getting started', 'quick start', '快速开始', '安装'])
  const structureSection = extractReadmeSection(info.readme, ['project structure', 'directory structure', 'architecture', '架构', '目录结构', '项目结构'])
  const techSection = extractReadmeSection(info.readme, ['tech stack', 'technology', 'built with', 'dependencies', '技术栈', '依赖'])
  const readmeHeadings = extractReadmeHeadings(info.readme)

  return {
    projectIntro: info.description || `${info.fullName} 是一个 GitHub 开源项目。`,
    techStack: sectionToList(techSection, [...language, ...topicItems].length > 0 ? [...language, ...topicItems] : ['README 中未明确说明技术栈。']),
    techArchitecture: [...language, ...topicItems].length > 0 ? [...language, ...topicItems] : ['README 中未明确说明技术架构。'],
    coreFeatures: info.description ? [info.description] : ['README 中未明确说明核心功能。'],
    useCases: ['适合作为开源项目调研、工具选型或二次开发参考。'],
    installation: sectionToList(installSection, ['README 中未明确说明安装方式。']),
    projectStructure: sectionToList(structureSection, ['README 中未明确说明项目架构或目录结构。']),
    quickStart: ['查看仓库 README 获取安装与运行方式。'],
    documentationOutline: readmeHeadings.length > 0 ? readmeHeadings : ['README 未提取到清晰的章节结构。'],
    applicationNotes: ['可结合当前业务场景评估是否适合集成、学习或改造。'],
  }
}

function getLineText(value?: string | null, index = 0) {
  const line = (value || '')
    .split(/\r?\n/)
    .map(item => cleanText(item))
    .filter(Boolean)[index] || ''
  return line
}

function normalizeSummary(info: GitHubProjectInfo, parsed: Record<string, unknown> | null): GitHubProjectSummary {
  const fallback = fallbackSummary(info)
  return {
    projectIntro: cleanText(parsed?.projectIntro as string) || fallback.projectIntro,
    techStack: normalizeStringArray(parsed?.techStack, fallback.techStack),
    techArchitecture: normalizeStringArray(parsed?.techArchitecture, fallback.techArchitecture),
    coreFeatures: normalizeStringArray(parsed?.coreFeatures, fallback.coreFeatures),
    useCases: normalizeStringArray(parsed?.useCases, fallback.useCases),
    installation: normalizeStringArray(parsed?.installation, fallback.installation),
    projectStructure: normalizeStringArray(parsed?.projectStructure, fallback.projectStructure),
    quickStart: normalizeStringArray(parsed?.quickStart, fallback.quickStart),
    documentationOutline: normalizeAliasStringArray(parsed, ['documentationOutline', 'readmeHighlights'], fallback.documentationOutline),
    applicationNotes: normalizeStringArray(parsed?.applicationNotes, fallback.applicationNotes),
  }
}

export function parseGitHubRepoUrl(input: string): GitHubRepoRef | null {
  try {
    const url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
      return null
    }

    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repo) {
      return null
    }

    return {
      owner,
      repo: repo.replace(/\.git$/i, ''),
      url: `https://github.com/${owner}/${repo.replace(/\.git$/i, '')}`,
    }
  } catch {
    return null
  }
}

export async function getGitHubProjectApiToken() {
  const store = await Store.load('store.json')
  return cleanText(await store.get<string>('githubProjectApiToken'))
}

export async function setGitHubProjectApiToken(token: string) {
  const store = await Store.load('store.json')
  await store.set('githubProjectApiToken', token)
  await store.save()
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await tauriFetch(`${GITHUB_API_BASE}${path}`, {
    method: 'GET',
    connectTimeout: 15000,
    headers,
  })

  if (!response.ok) {
    throw new GitHubProjectError(`GitHub API 请求失败（${response.status}）`, {
      status: response.status,
    })
  }

  return await response.json() as T
}

export function getGitHubProjectErrorMessage(error: unknown) {
  if (error instanceof GitHubProjectError) {
    if (error.status === 401) {
      return 'GitHub Token 无效或已过期，请在设置中重新配置。'
    }
    if (error.status === 403) {
      return 'GitHub API 访问受限，可能是 Token 权限不足、频率限制或组织权限限制。'
    }
    if (error.status === 404) {
      return '未找到该 GitHub 仓库，可能是链接错误、仓库已删除，或私有仓库没有访问权限。'
    }
    return `GitHub API 请求失败（${error.status ?? 'unknown'}），请稍后重试。`
  }

  if (error instanceof Error) {
    return error.message || 'GitHub 项目识别失败。'
  }

  return 'GitHub 项目识别失败。'
}

export async function fetchGitHubProjectInfo(ref: GitHubRepoRef, token: string): Promise<GitHubProjectInfo> {
  const repo = await githubJson<GitHubRepoApiResponse>(`/repos/${ref.owner}/${ref.repo}`, token)
  let readme = ''

  try {
    const readmePayload = await githubJson<GitHubReadmeApiResponse>(`/repos/${ref.owner}/${ref.repo}/readme`, token)
    if (readmePayload.encoding === 'base64') {
      readme = decodeBase64Content(readmePayload.content).slice(0, README_LIMIT)
    }
  } catch {
    readme = ''
  }

  return {
    source: 'github',
    collectedAt: Date.now(),
    owner: ref.owner,
    repo: ref.repo,
    fullName: repo.full_name || `${ref.owner}/${ref.repo}`,
    url: repo.html_url || ref.url,
    description: cleanText(repo.description),
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || 0),
    language: repo.language || null,
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 12) : [],
    license: repo.license?.spdx_id || repo.license?.name || null,
    homepage: cleanText(repo.homepage) || null,
    pushedAt: repo.pushed_at || null,
    readme,
  }
}

export async function summarizeGitHubProject(info: GitHubProjectInfo): Promise<GitHubProjectSummary> {
  try {
    const aiConfig = await getAISettings('markDescModel')
    if (!aiConfig?.model) {
      return fallbackSummary(info)
    }

    const prompt = [
      '你是开源项目研究助理。请根据 GitHub 仓库元数据和 README，整理成精简、专业、可直接用于中文文档、推文和知识库笔记的项目说明。',
      '输出语言必须以简体中文为主。如果 README 或项目简介是英文，请将项目简介、功能、场景、应用价值等关键信息翻译并改写为自然中文。',
      '命令、包名、路径、配置键、API 名称、代码片段、技术名词、License、链接保持原文，不要强行翻译。',
      '优先保留 README 中已有的信息结构，尤其是安装方式、快速开始、项目架构、目录结构、语言、技术栈、命令和关键表格信息，但不要直接大段摘抄原文。',
      '写法要像一份项目说明文档，不要使用“README 片段”“原文片段”“摘要片段”等加工痕迹说法。',
      '必须返回严格 JSON，不要输出 Markdown 或额外解释。',
      'JSON 格式：',
      '{"projectIntro":"","techStack":[""],"techArchitecture":[""],"coreFeatures":[""],"useCases":[""],"installation":[""],"projectStructure":[""],"quickStart":[""],"documentationOutline":[""],"applicationNotes":[""]}',
      '要求：',
      '1. projectIntro 用 1 句自然中文说明项目解决什么问题；',
      '2. techStack 输出 2-8 条中文说明，保留 Rust、Docker、CLI、TUI 等技术名词原文；',
      '3. techArchitecture 输出 2-6 条，说明模块划分、运行方式、数据流或客户端/服务端结构；',
      '4. coreFeatures 输出 3-6 条中文功能说明；',
      '5. useCases 输出 2-5 条中文使用场景；',
      '6. installation 输出 README 中明确出现的安装/启动步骤或命令，命令保持原样，可在同一条前半句用中文解释；',
      '7. projectStructure 输出 README 中明确出现的目录结构、模块结构或架构说明，路径和目录名保持原样；',
      '8. quickStart 输出 2-5 条，如果 README 不明确就保守说明查看 README；',
      '9. documentationOutline 输出 README 原有主要章节标题或最值得保留的文档结构点，英文标题可翻译成中文，必要时括号保留原名；',
      '10. applicationNotes 输出 2-4 条中文说明，对产品、工作流、学习或二次开发有什么借鉴价值；',
      '11. 不要编造 README 和元数据没有支撑的具体命令，不确定时写“README 中未明确说明”。',
      '',
      `项目：${info.fullName}`,
      `链接：${info.url}`,
      `简介：${info.description}`,
      `语言：${info.language || ''}`,
      `Topics：${info.topics.join(', ')}`,
      `Stars：${info.stars}`,
      `Forks：${info.forks}`,
      `License：${info.license || ''}`,
      `Homepage：${info.homepage || ''}`,
      `README：${truncate(info.readme, README_LIMIT)}`,
    ].join('\n')

    const { messages } = await prepareMessages(prompt)
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages,
      temperature: 0.2,
      top_p: aiConfig.topP || 1,
    })

    const parsed = extractJsonObject(completion.choices[0]?.message?.content || '')
    return normalizeSummary(info, parsed)
  } catch (error) {
    handleAIError(error, false)
    return fallbackSummary(info)
  }
}

function formatList(items: string[]) {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '- 暂无明确说明'
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildGitHubProjectRecord(payload: GitHubProjectRecordPayload) {
  const { summary } = payload
  const displayName = cleanText(payload.displayName) || payload.repo || payload.fullName
  const desc = `${displayName}\n${summary.projectIntro}`
  const content = [
    `<!-- lingmo:github-project ${JSON.stringify({
      fullName: payload.fullName,
      displayName,
      url: payload.url,
      collectedAt: payload.collectedAt,
    })} -->`,
    `# ${displayName}`,
    '',
    '## 项目简介',
    summary.projectIntro,
    '',
    '## 文档结构',
    formatList(summary.documentationOutline),
    '',
    '## 技术栈',
    formatList(summary.techStack),
    '',
    '## 技术架构',
    formatList(summary.techArchitecture),
    '',
    '## 核心功能',
    formatList(summary.coreFeatures),
    '',
    '## 使用场景',
    formatList(summary.useCases),
    '',
    '## 安装与运行',
    formatList(summary.installation),
    '',
    '## 快速上手',
    formatList(summary.quickStart),
    '',
    '## 项目架构',
    formatList(summary.projectStructure),
    '',
    '## 应用价值',
    formatList(summary.applicationNotes),
  ].filter(Boolean).join('\n')

  return { desc, content }
}

export function isGitHubProjectMark(mark: Mark) {
  return mark.type === 'link' && /<!--\s*lingmo:github-project\b/.test(mark.content || '')
}

export function getGitHubProjectMarkUrl(mark: Mark) {
  const content = mark.content || ''
  const marker = content.match(/<!--\s*lingmo:github-project\s+({[\s\S]*?})\s*-->/)
  if (marker?.[1]) {
    try {
      const meta = JSON.parse(marker[1]) as { url?: string }
      return normalizeGitHubUrl(meta.url)
    } catch {
      // fall through to mark url
    }
  }

  return normalizeGitHubUrl(mark.url)
}

export function getGitHubProjectDisplayName(mark: Mark) {
  const content = mark.content || ''
  const marker = content.match(/<!--\s*lingmo:github-project\s+({[\s\S]*?})\s*-->/)
  if (marker?.[1]) {
    try {
      const meta = JSON.parse(marker[1]) as { displayName?: string; fullName?: string }
      const fromMeta = cleanText(meta.displayName)
      if (fromMeta) {
        return fromMeta
      }
      const fullName = cleanText(meta.fullName)
      if (fullName) {
        return fullName.split('/').filter(Boolean).pop() || fullName
      }
    } catch {
      // fall through
    }
  }

  const descTitle = getLineText(mark.desc, 0)
  if (descTitle) {
    return descTitle.includes('/') ? descTitle.split('/').filter(Boolean).pop() || descTitle : descTitle
  }

  const contentTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
  if (contentTitle) {
    return contentTitle.includes('/') ? contentTitle.split('/').filter(Boolean).pop() || contentTitle : contentTitle
  }

  const fallbackUrl = normalizeGitHubUrl(mark.url)
  return fallbackUrl.split('/').filter(Boolean).pop() || fallbackUrl
}

export function getGitHubProjectIntro(mark: Mark) {
  const content = mark.content || ''
  const sectionIntro = extractSection(content, '项目简介')
  if (sectionIntro) {
    return sectionIntro
  }

  const descLines = (mark.desc || '')
    .split(/\r?\n/)
    .map(line => cleanText(line))
    .filter(Boolean)
  return descLines.slice(1).join(' ').trim() || cleanText(mark.desc)
}

export function getGitHubProjectMeta(mark: Mark) {
  const content = mark.content || ''
  const marker = content.match(/<!--\s*lingmo:github-project\s+({[\s\S]*?})\s*-->/)
  let markerMeta: { fullName?: string; displayName?: string; url?: string; collectedAt?: number } = {}

  if (marker?.[1]) {
    try {
      markerMeta = JSON.parse(marker[1])
    } catch {
      markerMeta = {}
    }
  }

  return {
    fullName: cleanText(markerMeta.fullName),
    displayName: getGitHubProjectDisplayName(mark),
    url: cleanText(markerMeta.url) || mark.url,
    collectedAt: Number(markerMeta.collectedAt || mark.createdAt || 0),
    collectedAtText: extractLine(content, '收集时间') || (mark.createdAt ? formatDateTime(mark.createdAt) : ''),
    language: extractLine(content, '语言') || '未标注',
    stars: extractLine(content, 'Stars') || '',
    forks: extractLine(content, 'Forks') || '',
    license: extractLine(content, 'License') || '未标注',
    topics: extractLine(content, 'Topics'),
    homepage: extractLine(content, 'Homepage'),
    intro: getGitHubProjectIntro(mark),
  }
}

export function getGitHubProjectDetailContent(mark: Mark) {
  let content = mark.content || ''
  content = content.replace(/<!--\s*lingmo:github-project\s+{[\s\S]*?}\s*-->\s*/g, '')
  content = content.replace(/^#\s+.+\n+/, '')
  content = content.replace(
    /^(?:链接|收集时间|语言|Stars|Forks|License|Topics|Homepage)：.*(?:\r?\n|$)+/gm,
    '',
  )
  content = content.replace(
    /## 项目概览\s*\n\| 项目 \| 信息 \|\s*\n\|---\|---\|\s*\n(?:\|.*\|\s*\n?)+/m,
    '',
  )
  content = cleanupLegacyGitHubProjectContent(content)

  return content.trim()
}

export function updateGitHubProjectMarkTitle(mark: Mark, displayName: string) {
  const nextDisplayName = cleanText(displayName)
  if (!nextDisplayName) {
    throw new Error('项目名称不能为空')
  }

  const descLines = (mark.desc || '').split(/\r?\n/)
  const nextDescLines = descLines.length > 0
    ? [nextDisplayName, ...descLines.slice(1)]
    : [nextDisplayName]

  const marker = mark.content?.match(/<!--\s*lingmo:github-project\s+({[\s\S]*?})\s*-->/)
  let nextContent = mark.content || ''
  if (marker?.[1]) {
    try {
      const meta = JSON.parse(marker[1]) as Record<string, unknown>
      meta.displayName = nextDisplayName
      nextContent = nextContent.replace(marker[0], `<!-- lingmo:github-project ${JSON.stringify(meta)} -->`)
    } catch {
      // ignore parse errors and keep original content
    }
  }

  if (nextContent) {
    nextContent = nextContent.replace(/^#\s+.+$/m, `# ${nextDisplayName}`)
  }

  return {
    desc: nextDescLines.join('\n'),
    content: nextContent,
  }
}

function extractSection(content: string, heading: string) {
  const pattern = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`)
  return content.match(pattern)?.[1]?.trim() || ''
}

function extractLine(content: string, label: string) {
  return content.match(new RegExp(`^${label}：(.+)$`, 'm'))?.[1]?.trim() || ''
}

export function buildGitHubProjectsCollectionMarkdown(marks: Mark[], options?: { tagName?: string }) {
  const projectMarks = marks.filter(isGitHubProjectMark).sort((a, b) => a.createdAt - b.createdAt)
  if (projectMarks.length === 0) {
    return ''
  }

  const title = `开源项目收藏整理 ${formatDateTime(Date.now())}`
  const sections = projectMarks.map((mark, index) => {
    const content = mark.content || ''
    const name = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || mark.desc?.split('\n')[0]?.trim() || mark.url
    const collectedAt = extractLine(content, '收集时间') || formatDateTime(mark.createdAt)
    const intro = extractSection(content, '项目简介') || mark.desc || ''
    const useCases = extractSection(content, '使用场景')
    const application = extractSection(content, '应用价值')
    const tech = extractSection(content, '技术架构')

    return [
      `## ${index + 1}. ${name}`,
      '',
      `- 收集时间：${collectedAt}`,
      `- 项目名称：${name}`,
      `- 链接：${mark.url}`,
      '',
      '### 简介',
      intro || '暂无简介。',
      '',
      '### 技术与功能',
      tech || '暂无明确技术架构说明。',
      '',
      '### 应用场景',
      useCases || '暂无明确使用场景说明。',
      '',
      '### 应用价值',
      application || '可继续结合个人工作流评估。',
    ].join('\n')
  })

  return [
    `# ${title}`,
    '',
    '- 来源：GitHub 开源项目收藏',
    `- 来源标签：${options?.tagName || GITHUB_PROJECT_TAG_NAME}`,
    `- 整理时间：${formatDateTime(Date.now())}`,
    `- 项目数量：${projectMarks.length}`,
    '',
    '## 项目清单',
    ...projectMarks.map(mark => {
      const content = mark.content || ''
      const name = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || mark.desc?.split('\n')[0]?.trim() || mark.url
      const intro = extractSection(content, '项目简介') || mark.desc?.split('\n').slice(1).join(' ').trim() || ''
      return `- [${name}](${mark.url})：${intro}`
    }),
    '',
    '---',
    '',
    ...sections.flatMap(section => [section, '', '---', '']).slice(0, -2),
    '',
  ].join('\n')
}

function compactSectionForTable(content: string, heading: string, fallback = '') {
  const section = extractSection(content, heading)
  const value = section
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('<br>')
  return value || fallback
}

function escapeTableCell(value: string) {
  return cleanText(value)
    .replace(/\|/g, '\\|')
    .replace(/<br>\s*/g, '<br>')
}

export function buildGitHubProjectsComparisonMarkdown(marks: Mark[], options?: { tagName?: string }) {
  const projectMarks = marks.filter(isGitHubProjectMark).sort((a, b) => a.createdAt - b.createdAt)
  if (projectMarks.length === 0) {
    return ''
  }

  const rows = projectMarks.map((mark) => {
    const content = mark.content || ''
    const name = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || mark.desc?.split('\n')[0]?.trim() || mark.url
    const intro = compactSectionForTable(content, '项目简介', mark.desc || '')
    const tech = compactSectionForTable(content, '技术架构', '待补充')
    const features = compactSectionForTable(content, '核心功能', '待补充')
    const useCases = compactSectionForTable(content, '使用场景', '待补充')
    const application = compactSectionForTable(content, '应用价值', '待结合业务评估')

    return `| [${escapeTableCell(name)}](${mark.url}) | ${escapeTableCell(tech)} | ${escapeTableCell(intro)} | ${escapeTableCell(features)} | ${escapeTableCell(useCases)} | ${escapeTableCell(application)} |`
  })

  return [
    `# 开源项目技术选型对比 ${formatDateTime(Date.now())}`,
    '',
    '- 来源：GitHub 开源项目收藏',
    `- 来源标签：${options?.tagName || GITHUB_PROJECT_TAG_NAME}`,
    `- 整理时间：${formatDateTime(Date.now())}`,
    `- 项目数量：${projectMarks.length}`,
    '',
    '| 项目 | 技术栈 | 解决问题 | 核心能力 | 适用场景 | 可借鉴点 |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '## 选型备注',
    '',
    '- 优先补充：维护活跃度、License 约束、集成成本、与当前技术栈的兼容性。',
    '- 建议下一步：为候选项目补一轮本地试用记录，再决定是否进入正式方案。',
    '',
  ].join('\n')
}
