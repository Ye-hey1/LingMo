import type { AiHotspotItem } from './types'

type DigestItem = Pick<AiHotspotItem, 'title' | 'url' | 'sourceName' | 'publishedAt' | 'tags'>

export function buildHotspotDigestMarkdown(params: {
  date: string
  title: string
  items: DigestItem[]
}) {
  const grouped = groupItemsByPrimaryTag(params.items)

  return [
    `# ${params.title} ${params.date}`,
    '',
    '## 速览',
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
  return `- [${item.title}](${item.url}) - ${item.sourceName}`
}
