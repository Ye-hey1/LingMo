import type { AiHotspotItem } from './types'

function formatList(items: string[]) {
  return items.length > 0 ? items.join('、') : '无'
}

export function createAiHotspotChatContext(item: AiHotspotItem, mode: 'discuss' | 'deep-dive' = 'discuss') {
  const fullContent = [
    `# AI 热点上下文：${item.title}`,
    '',
    '## 基本信息',
    `- 标题：${item.title}`,
    item.titleOriginal && item.titleOriginal !== item.title ? `- 原标题：${item.titleOriginal}` : '',
    `- 来源：${item.sourceName}`,
    `- Feed：${item.feedName}`,
    `- 链接：${item.url}`,
    `- 发布时间：${item.publishedAt || '未知'}`,
    `- 标签：${formatList(item.tags)}`,
    `- 热度：${item.score}`,
    '',
    '## 摘要',
    item.summary || '暂无摘要。',
  ].filter(Boolean).join('\n')

  const prompt = mode === 'deep-dive'
    ? `请基于引用中的 AI 热点信息，设计一个后续深挖方案：判断它可能涉及的技术方向、需要核验的关键事实、可追踪的官方来源，以及对我当前知识库值得沉淀的观察点。不要编造引用外事实。`
    : `请基于引用中的 AI 热点信息，帮我判断这条动态为什么值得关注、可能影响哪些方向，并给出适合沉淀到笔记里的要点。不要编造引用外事实。`

  return {
    prompt,
    quoteData: {
      quote: `${item.title} - ${item.sourceName}`,
      fullContent,
      fileName: `${item.title} AI 热点资料`,
      startLine: 1,
      endLine: fullContent.split('\n').length,
      from: 0,
      to: fullContent.length,
      articlePath: item.url,
    },
  }
}
