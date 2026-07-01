import type { TemplateOverrides } from '../../components/output-workshop/types'
import { buildTemplateOverridePrompt } from '../../components/output-workshop/workshop-controls'
import { CREATIVE_DESIGN_PROMPT } from '../../components/output-workshop/utils-prompts'
import { renderDesignProfilePromptBlock } from './design-profiles'
import type { OutputTemplate } from './templates'

export const CREATIVE_PROMPT_SOURCE_LIMIT = 8_000
export const CREATIVE_DIRECT_MAX_TOKENS = 7_000

export const CREATIVE_SKILL_DIRECT_PROMPT = `你是 LingMo 智能排版的资深前端设计师。请根据当前创意模板规范和输入材料生成完整自包含 HTML。

核心要求：
- 只输出完整 HTML，不输出解释文本或 Markdown 包裹。
- 优先保留输入材料中的真实结构、标题、术语和事实，不编造数据。
- 页面必须可直接在 iframe 中预览，移动端和桌面端都不能横向溢出。
- 必须包含清晰高对比文字、CJK 字体栈、8px 间距节奏、prefers-reduced-motion 降级。
- 如果是原型、Deck、信息图或变体模板，要优先完成对应交付形态，不要做成普通网页。`

export interface BuildCreativePromptOptions {
  template: OutputTemplate
  title: string
  sourceContent: string
  sourceLabel?: string
  customInstructions?: string
  templateOverrides: TemplateOverrides
}

export function compactCreativeSkillPrompt(skillPrompt: string): string {
  const trimmed = skillPrompt.trim()
  const templateTaskMatch = trimmed.match(/\n### [^\n]*(?:任务|顾问|评审)[\s\S]*$/)
  const templateTask = templateTaskMatch?.[0]?.trim()
  if (templateTask) return templateTask
  return trimmed.length > 2400 ? trimmed.slice(-2400).trim() : trimmed
}

function isAutoRedbookTemplate(template: OutputTemplate): boolean {
  return template.id.startsWith('social-redbook-')
}

function renderTemplateMetadataBlock(template: OutputTemplate): string {
  return `## 当前模板
- ID：${template.id}
- 名称：${template.name}
- 模式：${template.mode}
- 场景：${template.scenario}
- 最佳用途：${template.bestFor}
- 输出目标：${template.outputTargets?.join('、') || template.outputHint}
- 尺寸建议：${template.sizePresets?.join('、') || 'auto'}
${template.pipelineHint?.length ? `- 推荐工作流：${template.pipelineHint.join(' -> ')}` : ''}`
}

function renderAutoRedbookContract(template: OutputTemplate): string {
  if (!isAutoRedbookTemplate(template)) return ''

  return `## Auto-Redbook 卡片生成硬性合同（必须遵守）
这不是普通网页长页，也不是瀑布流。你必须生成一组可逐张导出的社交媒体卡片。

### 必须输出的 DOM 形态
- body 内必须有一个 \`.redbook-deck\`，其中包含 1 张封面卡 + 3 到 8 张正文卡。
- 封面卡必须使用：
  \`<section class="cover-container" data-redbook-card="cover">...</section>\`
- 正文卡必须使用：
  \`<section class="card-container" data-redbook-card="1">...</section>\`
- 每张卡内部必须使用：
  \`<div class="card-inner"><div class="card-content"><div class="card-content-scale">真实内容</div></div></div>\`
- \`.cover-container\` 和 \`.card-container\` 必须是固定 1080px × 1440px，不能用 auto 高度，不能变成长网页 section。

### 必须包含的基础 CSS 骨架
\`\`\`css
body { margin: 0; background: #e5e7eb; display: grid; place-items: center; padding: 32px; }
.redbook-deck { display: grid; gap: 24px; justify-items: center; }
.cover-container, .card-container {
  width: 1080px;
  height: 1440px;
  position: relative;
  overflow: hidden;
  background: #f3f4f6;
  padding: 54px;
}
.card-inner, .cover-inner {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}
.card-content {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}
.card-content-scale {
  position: relative;
  transform-origin: top left;
}
\`\`\`

### 内容组织
- 第一张封面卡：大标题、核心副标题、来源/主题标签、页码或系列编号。
- 后续每张正文卡：只讲一个章节或一个关键观点，包含标题、短解释、清单/步骤/证据。
- 内容较多时拆更多卡，不要把所有内容平铺在一张超长网页里。
- 每张卡底部显示页码，如 \`01 / 06\`，便于导出组图后排序。

### 禁止项
- 禁止只输出一个 \`.container\`、\`.page\`、\`main\` 长页面。
- 禁止把内容做成桌面报告、仪表盘、瀑布流或普通文章。
- 禁止所有 section 横向/纵向平铺成单个网页版式。
- 禁止把主题风格只做成背景色；必须把 ${template.name} 的主题语言落实到标题、标签、分隔、引用、页码和重点模块。`
}

function renderQualityRulesBlock(template: OutputTemplate): string {
  const rules = template.qualityRules ?? []
  const baseRules = [
    '输出完整自包含 HTML，并从第一屏开始就是可用产物，不要输出菜单、计划或说明页。',
    '用用户材料中的真实内容完成页面；允许压缩、分组、重排，不允许编造数据、引用、客户或事实。',
    '保证移动端和桌面端不横向溢出；长标题、表格、代码块、固定比例画板都要有安全处理。',
    '必须包含 @media (prefers-reduced-motion: reduce) 降级；动效只表达状态或内容关系。',
    isAutoRedbookTemplate(template)
      ? '本模板必须生成独立固定比例卡片组；避免默认紫蓝粉渐变、低对比灰字和无意义大阴影，但不要把卡片组图改成普通长网页。'
      : '避免渐变文字、默认紫蓝粉渐变、同款卡片网格、低对比灰字、无意义大阴影和 24px 以上大圆角卡片。',
    ...rules,
  ]
  const lines = baseRules.filter(Boolean)
  return `## 生成质量规则
${lines.map((rule) => `- ${rule}`).join('\n')}`
}

export function buildCreativeDirectPrompt(options: BuildCreativePromptOptions): string {
  const {
    template,
    title,
    sourceContent,
    sourceLabel,
    customInstructions,
    templateOverrides,
  } = options

  const normalizedSourceContent = typeof sourceContent === 'string' ? sourceContent.trim() : ''
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  const normalizedSourceLabel = typeof sourceLabel === 'string' ? sourceLabel.trim() : ''
  const normalizedCustomInstructions = typeof customInstructions === 'string' ? customInstructions.trim() : ''

  const hasSkillPrompt = Boolean(template.skillPrompt)
  const basePrompt = hasSkillPrompt ? CREATIVE_SKILL_DIRECT_PROMPT : CREATIVE_DESIGN_PROMPT
  const skillBlock = hasSkillPrompt
    ? `## 当前选用的创意模板规范：${template.name}
${compactCreativeSkillPrompt(template.skillPrompt ?? '')}`
    : ''
  const autoRedbookContract = renderAutoRedbookContract(template)

  return [
    basePrompt,
    renderTemplateMetadataBlock(template),
    renderDesignProfilePromptBlock(template.designProfileId),
    skillBlock,
    autoRedbookContract,
    renderQualityRulesBlock(template),
    `## 界面参数偏好
下面的参数只约束尺寸、字体、主题色、安全区和导出偏好。请优先依据输入材料决定视觉母题、信息结构和布局骨架，不要因为这些参数生成固定套路。
${buildTemplateOverridePrompt(templateOverrides)}`,
    normalizedCustomInstructions ? `## 用户额外设计要求\n${normalizedCustomInstructions}` : '',
    `## 输入材料
来源：${normalizedSourceLabel || '手动输入材料'}
主标题：${normalizedTitle || template.name || 'AI 创意设计成果'}

---
${normalizedSourceContent.slice(0, CREATIVE_PROMPT_SOURCE_LIMIT)}
---`,
  ].filter(Boolean).join('\n\n')
}
