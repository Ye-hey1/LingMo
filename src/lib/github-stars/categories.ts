import type { GithubStarRepository } from '@/types/github-stars'

export interface GithubStarCategory {
  id: string
  name: string
  keywords: string[]
  icon?: string | null
  custom?: boolean
}

export const GITHUB_STAR_UNCATEGORIZED = '未分类'

export const GITHUB_STAR_DEFAULT_CATEGORIES: GithubStarCategory[] = [
  {
    id: 'web',
    name: 'Web应用',
    keywords: ['web应用', 'web', 'website', 'frontend', 'react', 'vue', 'angular', 'nextjs', 'svelte'],
  },
  {
    id: 'mobile',
    name: '移动应用',
    keywords: ['移动应用', 'mobile', 'android', 'ios', 'flutter', 'react-native', 'swift', 'kotlin'],
  },
  {
    id: 'desktop',
    name: '桌面应用',
    keywords: ['桌面应用', 'desktop', 'electron', 'tauri', 'gui', 'qt', 'gtk'],
  },
  {
    id: 'database',
    name: '数据库',
    keywords: ['数据库', 'database', 'sql', 'nosql', 'mongodb', 'mysql', 'postgresql', 'sqlite', 'redis'],
  },
  {
    id: 'ai',
    name: 'AI/机器学习',
    keywords: ['ai工具', 'ai', 'llm', 'gpt', 'claude', 'agent', 'ml', 'machine learning', 'deep learning', 'neural', 'prompt'],
  },
  {
    id: 'devtools',
    name: '开发工具',
    keywords: ['开发工具', 'tool', 'cli', 'build', 'deploy', 'debug', 'test', 'automation', 'sdk', 'framework'],
  },
  {
    id: 'security',
    name: '安全工具',
    keywords: ['安全工具', 'security', 'encryption', 'auth', 'vulnerability', 'oauth', 'password'],
  },
  {
    id: 'game',
    name: '游戏',
    keywords: ['游戏', 'game', 'gaming', 'unity', 'unreal', 'godot'],
  },
  {
    id: 'design',
    name: '设计工具',
    keywords: ['设计工具', 'design', 'ui', 'ux', 'graphics', 'image', 'figma'],
  },
  {
    id: 'productivity',
    name: '效率工具',
    keywords: ['效率工具', 'productivity', 'note', 'todo', 'calendar', 'task', 'download', 'manager'],
  },
  {
    id: 'education',
    name: '教育学习',
    keywords: ['教育学习', 'education', 'learning', 'tutorial', 'course', 'learn'],
  },
  {
    id: 'analytics',
    name: '数据分析',
    keywords: ['数据分析', 'analytics', 'data', 'visualization', 'chart', 'dashboard'],
  },
]

function includesEitherSide(value: string, keyword: string) {
  const normalizedValue = value.toLowerCase()
  const normalizedKeyword = keyword.toLowerCase()
  return normalizedValue.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedValue)
}

function categoryMatchesAiTags(repo: GithubStarRepository, category: GithubStarCategory) {
  return repo.aiTags.some(tag => category.keywords.some(keyword => includesEitherSide(tag, keyword)))
}

function categoryMatchesRepositoryText(repo: GithubStarRepository, category: GithubStarCategory) {
  const repoText = [
    repo.name,
    repo.fullName,
    repo.description || '',
    repo.language || '',
    repo.aiSummary || '',
    repo.ownerLogin,
    ...repo.topics,
    ...repo.customTags,
  ].join(' ').toLowerCase()

  return category.keywords.some(keyword => repoText.includes(keyword.toLowerCase()))
}

export function resolveGithubStarCategory(
  repo: GithubStarRepository,
  categories: GithubStarCategory[] = GITHUB_STAR_DEFAULT_CATEGORIES,
) {
  if (repo.customCategory?.trim()) {
    return repo.customCategory.trim()
  }

  const aiCategory = categories.find(category => categoryMatchesAiTags(repo, category))
  if (aiCategory) return aiCategory.name

  const defaultCategory = categories.find(category => categoryMatchesRepositoryText(repo, category))
  return defaultCategory?.name || GITHUB_STAR_UNCATEGORIZED
}

export function matchesGithubStarCategory(
  repo: GithubStarRepository,
  categoryName: string,
  categories: GithubStarCategory[] = GITHUB_STAR_DEFAULT_CATEGORIES,
) {
  if (categoryName === 'all') return true
  return resolveGithubStarCategory(repo, categories) === categoryName
}
