import type { AiHotspotItem, AiHotspotSourceStatus } from '@/lib/ai-hotspots'

export function formatHotspotTime(value: string | null) {
  if (!value) return '时间未知'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '时间未知'

  const diffMs = Date.now() - time
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`

  return new Date(time).toLocaleDateString()
}

export function getHotspotHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function getPrimaryHotspotTag(item: AiHotspotItem) {
  return item.tags[0] || 'AI'
}

export function buildSourceOptions(items: AiHotspotItem[], sources: AiHotspotSourceStatus[]) {
  const options = new Map<string, string>()

  for (const source of sources) {
    options.set(source.sourceId, source.sourceName)
  }
  for (const item of items) {
    if (!options.has(item.sourceId)) {
      options.set(item.sourceId, item.sourceName)
    }
  }

  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function getSourceHealthText(sources: AiHotspotSourceStatus[]) {
  if (sources.length === 0) return '暂无来源状态'
  const ok = sources.filter(source => source.ok).length
  return `${ok}/${sources.length} 来源可用`
}
