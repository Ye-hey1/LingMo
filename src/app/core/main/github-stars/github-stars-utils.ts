export function formatCount(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(value)
}

export function formatDate(value: string | number | null | undefined) {
  if (!value) return '未同步'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatRelativeTime(value: string | number | null | undefined) {
  if (!value) return '未同步'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '未同步'

  const diffMs = Date.now() - time
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`

  return formatDate(value)
}

export function parseTagInput(value: string) {
  return value
    .split(/[,，\n]/)
    .map(item => item.trim())
    .filter((item, index, array) => item && array.indexOf(item) === index)
}

const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Java: '#b07219',
  Go: '#00add8',
  Rust: '#dea584',
  Vue: '#41b883',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  Shell: '#89e051',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Scala: '#c22d40',
  Dart: '#00B4AB',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  Lua: '#000080',
  Perl: '#0298c3',
  R: '#198CE7',
  Julia: '#a270ba',
  Zig: '#ec915c',
  ObjectiveC: '#438eff',
  MATLAB: '#e16737',
}

export function getLanguageColor(language: string | null) {
  return language ? LANGUAGE_COLORS[language] || '#6b7280' : '#9ca3af'
}
