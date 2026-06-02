import type { ArtifactTemplate, ArtifactTemplateId } from './types'

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  {
    id: 'article-report',
    name: '视觉报告',
    scenario: 'note',
    description: '适合将笔记、研究材料、复盘内容转成可阅读的单页 HTML 报告。',
    aspectHint: 'single-page editorial report',
    outputHint: '生成分区清晰、适合长文阅读的自包含 HTML 页面。',
  },
  {
    id: 'data-report',
    name: '数据报告',
    scenario: 'data',
    description: '适合 CSV、JSON、表格摘要和指标解读。',
    aspectHint: 'dashboard-style data report',
    outputHint: '突出关键指标、表格摘要、数据洞察和异常点。',
  },
  {
    id: 'deck-brief',
    name: '演示简报',
    scenario: 'deck',
    description: '适合把材料转成横向分屏的演示页或汇报提纲。',
    aspectHint: 'presentation deck brief',
    outputHint: '按 slide 分块组织，每页只承载一个核心观点。',
  },
  {
    id: 'poster-card',
    name: '海报卡片',
    scenario: 'poster',
    description: '适合把结论、活动、产品说明转成视觉冲击更强的分享图。',
    aspectHint: 'poster card',
    outputHint: '使用更强标题、少量要点和明确行动信息。',
  },
]

export function getArtifactTemplate(templateId: unknown): ArtifactTemplate {
  if (typeof templateId === 'string') {
    const template = ARTIFACT_TEMPLATES.find((item) => item.id === templateId)
    if (template) return template
  }

  return ARTIFACT_TEMPLATES[0]
}

export function isArtifactTemplateId(value: unknown): value is ArtifactTemplateId {
  return typeof value === 'string' && ARTIFACT_TEMPLATES.some((item) => item.id === value)
}

