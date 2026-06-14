import type { AiHotspotItem } from './types'

type DigestItem = Pick<
  AiHotspotItem,
  'title' | 'url' | 'sourceName' | 'publishedAt' | 'tags' | 'score' | 'signalSummary' | 'signalEssence'
>

export function buildHotspotDigestMarkdown(params: {
  date: string
  title: string
  items: DigestItem[]
}) {
  const grouped = groupItemsByPrimaryTag(params.items)

  return [
    `# ${params.title} ${params.date}`,
    '',
    '> AI 信号雷达快照：用于快速复盘、筛选与后续笔记沉淀。',
    '',
    '## 精选速览',
    '',
    ...params.items.slice(0, 5).map(formatDigestItem),
    '',
    ...Object.entries(grouped).flatMap(([tag, items]) => [
      `## ${tag}`,
      '',
      ...items.map(formatDigestItem),
      '',
    ]),
    '## 来源',
    '',
    ...params.items.map(formatDigestItem),
    '',
  ].join('\n')
}

function groupItemsByPrimaryTag(items: DigestItem[]): Record<string, DigestItem[]> {
  const grouped: Record<string, DigestItem[]> = {}

  for (const item of items) {
    const tag = item.tags[0]
    if (!tag) continue
    grouped[tag] ??= []
    grouped[tag].push(item)
  }

  return grouped
}

function formatDigestItem(item: DigestItem): string {
  const details = [
    `来源：${item.sourceName}`,
    `热度：${item.score}`,
    item.signalSummary ? `墨摘：${item.signalSummary}` : '',
    item.signalEssence ? `精华：${item.signalEssence}` : '',
  ].filter(Boolean)

  return `- [${item.title}](${item.url})\n  ${details.join('\n  ')}`
}
