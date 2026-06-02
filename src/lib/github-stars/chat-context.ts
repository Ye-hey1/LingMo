import { fetchRepositoryDocumentOutline, fetchRepositoryReadme, type GithubRepositoryDocumentPath } from '@/lib/github-stars/api'
import type { GithubStarRepository } from '@/types/github-stars'

const README_CONTEXT_LIMIT = 12000
const DOCUMENT_GROUP_LABELS: Record<GithubRepositoryDocumentPath['kind'], string> = {
  readme: '入口文档',
  docs: '文档目录',
  config: '项目配置',
  example: '示例资料',
  source: '核心源码线索',
  other: '其他资料',
}

function truncateText(value: string, limit: number) {
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit).trim()}\n\n[README 已截断，剩余 ${trimmed.length - limit} 个字符未附加。]`
}

function formatList(items: string[]) {
  return items.length > 0 ? items.join(', ') : '无'
}

function formatDocumentOutline(paths: GithubRepositoryDocumentPath[]) {
  if (paths.length === 0) {
    return '未读取到 README 之外的文档结构。'
  }

  const groups = new Map<GithubRepositoryDocumentPath['kind'], GithubRepositoryDocumentPath[]>()
  paths.forEach((item) => {
    const group = groups.get(item.kind) || []
    group.push(item)
    groups.set(item.kind, group)
  })

  return Array.from(groups.entries())
    .map(([kind, items]) => {
      const lines = items.slice(0, 30).map(item => `- ${item.path}${item.size ? ` (${item.size} bytes)` : ''}`)
      const omitted = items.length > 30 ? `\n- ... 还有 ${items.length - 30} 个文件` : ''
      return `### ${DOCUMENT_GROUP_LABELS[kind]}\n${lines.join('\n')}${omitted}`
    })
    .join('\n\n')
}

function getEffectiveDescription(repository: GithubStarRepository) {
  return repository.customDescription || repository.aiSummary || repository.description || '暂无描述'
}

export async function createGithubStarChatContext(repository: GithubStarRepository) {
  const [readmeResult, outlineResult] = await Promise.allSettled([
    fetchRepositoryReadme(repository.fullName),
    fetchRepositoryDocumentOutline(repository.fullName),
  ])
  const readme = readmeResult.status === 'fulfilled' ? readmeResult.value : ''
  const outline = outlineResult.status === 'fulfilled'
    ? outlineResult.value
    : { defaultBranch: null, truncated: false, paths: [] }

  const lines = [
    `# GitHub 仓库学习上下文：${repository.fullName}`,
    '',
    '## 基本信息',
    `- 仓库：${repository.fullName}`,
    `- 链接：${repository.htmlUrl}`,
    `- 作者：${repository.ownerLogin}`,
    `- 语言：${repository.language || '未知'}`,
    `- Star：${repository.stargazersCount}`,
    `- Fork：${repository.forksCount}`,
    `- 最近更新：${repository.pushedAt || repository.updatedAt || '未知'}`,
    `- 描述：${getEffectiveDescription(repository)}`,
    `- Topics：${formatList(repository.topics)}`,
    `- AI 标签：${formatList(repository.aiTags)}`,
    `- 自定义标签：${formatList(repository.customTags)}`,
    '',
    '## 文档结构',
    `- 默认分支：${outline.defaultBranch || '未知'}`,
    `- GitHub 返回截断：${outline.truncated ? '是' : '否'}`,
    '',
    formatDocumentOutline(outline.paths),
    '',
    '## README 摘要材料',
    readme
      ? truncateText(readme, README_CONTEXT_LIMIT)
      : 'README 暂未读取到，可能是仓库未提供 README、网络超时或权限不足。',
    '',
    '## 使用说明',
    '请基于以上仓库资料回答后续问题。若问题超出 README 和文档结构范围，请先说明当前上下文不足，再给出可继续阅读的文件路径或 GitHub 页面。回答时优先帮助用户理解项目用途、目录结构、上手路径、核心模块和学习路线。',
  ]
  const fullContent = lines.join('\n')

  return {
    prompt: `梳理 ${repository.fullName} 这个项目的用途和文档结构。基于提供的 README 摘要、基本信息等，总结它的核心用途、支持的功能，并列出文档结构中的关键文件及其说明。只使用引用中的信息，不要进行外部搜索。`,
    quoteData: {
      quote: `${repository.fullName} 项目资料、README 和文档结构`,
      fullContent,
      fileName: `${repository.fullName} 项目资料`,
      startLine: 1,
      endLine: fullContent.split('\n').length,
      from: 0,
      to: fullContent.length,
      articlePath: repository.htmlUrl,
    },
    documentCount: outline.paths.length,
    hasReadme: Boolean(readme.trim()),
  }
}
