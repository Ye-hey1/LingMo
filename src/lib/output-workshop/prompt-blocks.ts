import type { TemplateOverrides } from './shared/types'
import { buildTemplateOverridePrompt } from './shared/template-overrides'
import { renderDesignProfilePromptBlock } from './design-profiles'
import type { OutputTemplate } from './templates'

export const CREATIVE_PROMPT_SOURCE_LIMIT = 8_000
export const CREATIVE_DIRECT_MAX_TOKENS = 7_000

/**
 * AI 自由创意（无 skillPrompt）模式下的设计总纲 prompt。
 * 原定义在 components/utils-prompts.ts，因其仅被本文件消费，移入 lib 层以消除反向依赖。
 */
export const CREATIVE_DESIGN_PROMPT = `你是一个内容驱动的资深视觉编辑、信息架构师和前端网页交互设计师。
你的任务不是套用固定网页模板，而是先阅读材料，再为这份材料定制一个独特的自包含 HTML 视觉成品。

**内容驱动创意策略（必须先在内部完成，不要输出分析文字）**:
1. 判断材料的真实类型：研究报告、产品复盘、教程、人物故事、会议纪要、数据解读、观点宣言、清单、时间线、案例拆解等。
2. 判断目标读者与阅读场景：快速扫读、深度阅读、社媒传播、课堂讲解、汇报展示、个人知识库复习等。
3. 从材料中提取一个视觉隐喻或结构母题：流程、地图、档案、剧本、仪表盘、标本册、展览墙、航线、棋盘、时间轴、实验记录、目录索引等。母题必须来自输入内容，不要凭空装饰。
4. 依据内容结构选择版式，而不是默认 hero + card grid。可以采用但不限于：编辑部专题、田野笔记、交互目录、分镜叙事、横向时间轴、双栏论文批注、地图式导览、卡片组图、PPT 单页、数据看板、问答卡、流程仪表、案例卷宗。
5. 为这次输入生成专属的信息层级：哪些内容做标题、哪些做主视觉、哪些做证据、哪些做脚注、哪些做导航。不要把所有章节渲染成相同卡片。
6. 如果输入包含数字、时间、对比、步骤或实体关系，必须把这些结构转成相应的视觉组织方式；如果没有数据，不要伪造指标。

**反模板要求（非常重要）**:
- 严禁每次都生成同一种大标题 hero、三四张圆角卡片、统一渐变背景的固定套路。
- 严禁只替换文字但保持相同布局骨架；布局、节奏、导航和重点呈现方式必须随内容变化。
- 不要为了“高端感”堆砌装饰。视觉选择必须能解释材料，而不是覆盖材料。
- 可以做强视觉，但必须让用户看得出这是为当前内容特别设计的页面。

**视觉与排版核心规范（必须严格遵守）**:
1. **对比度第一原则 (Strict Contrast)**:
   - 文字颜色与背景色必须具有超高对比度，确保文字清晰可读，绝不模糊！
   - 如果使用深色背景（例如 OLED 纯黑 #050505 或深 Slate 蓝 #0F172A），文字必须使用纯白 (#FFFFFF) 或亮灰 (#F1F5F9)；段落文字也必须在 #CBD5E1 以上。
   - 如果使用浅色背景（如 Warm Cream #FDFBF7 或银白 #F8FAFC），文字必须使用炭黑 (#0F172A) 或深 Slate 灰 (#1E293B)。
2. **产品级排版 (Premium Typography)**:
   - 在 head 标签中，必须静态引入 Google Fonts 顶级字体：
     <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
   - 主 headings 优先使用 'Playfair Display' (Serif) 或 'Plus Jakarta Sans' (Sans)。
   - 中文部分必须显式定义 CJK 中日韩字体栈：'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif。
   - 正文不小于 1rem；长文行高 1.55-1.75；标题使用 text-wrap: balance，段落使用 text-wrap: pretty。
 3. **精确布局与容器节制**:
    - 使用 4px/8px 基线间距，相关元素紧密分组，不同区块用更大留白区分。
    - Grid 负责二维结构，Flex 负责横向/纵向一维排列；固定比例卡片必须有安全区，表格、代码块和长标题不得横向溢出。
    - 卡片圆角优先 8px/12px/16px；不要使用 24px 以上大圆角、普通卡片套卡片、渐变文字或装饰性玻璃拟态。
4. **精细的时间轴/列表对齐**:
   - 列表、步骤、时间轴的图标或圆点必须与右侧标题首行文字进行数学上的居中/对齐，严禁粗糙错位。
   - 连接线使用极细的 1px 线段（如 border-l border-muted 或者是渐变背景），保持极高精度。
5. **单文件自包含与体积控制**:
   - 可以引入 <script src="https://cdn.tailwindcss.com"></script> 以获得强大的 Tailwind CSS 渲染能力。
   - 所有图标请直接使用文字、精美 Emoji 或极简 CSS 绘制，**严禁生成庞大冗长的 SVG 代码**（以防触发 6000 字符的体积限制导致截断）。
6. **状态型动效 (Purposeful Motion)**:
   - 动效只用于 hover、press、展开折叠、加载、切换和内容关系提示；常规状态变化 150-250ms，布局变化不超过 350ms。
   - 使用 ease-out quart/quint/expo 曲线，避免 bounce/elastic；必须写入 @media (prefers-reduced-motion: reduce) 降级。

**输出要求**:
- 只输出完整的 HTML 页面代码
- HTML 中必须包含一个简短的内联注释 \`<!-- creative-brief: ... -->\`，用一句话记录本次页面采用的内容母题与版式策略，便于调试；不要在页面可见区域显示这句说明。
- 不要使用任何 Markdown 代码块包裹，也不要有任何前置或后置的文本说明（如果系统强制需要代码块，可以使用 \`\`\`html ... \`\`\` 包裹）`

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
  // designConstraints 是模板的视觉规范（配色/字体/装饰/动效），对无 skillPrompt 的模板
  // （如 deck-rain-notes 等 5 个 deck 模板）尤其关键——它是 AI 直绘时唯一的风格约束来源。
  const constraintsBlock = template.designConstraints?.trim()
    ? `\n- 视觉规范（必须严格遵守）：${template.designConstraints.trim()}`
    : ''
  return `## 当前模板
- ID：${template.id}
- 名称：${template.name}
- 模式：${template.mode}
- 场景：${template.scenario}
- 最佳用途：${template.bestFor}
- 输出目标：${template.outputTargets?.join('、') || template.outputHint}
- 尺寸建议：${template.sizePresets?.join('、') || 'auto'}
${template.pipelineHint?.length ? `- 推荐工作流：${template.pipelineHint.join(' -> ')}` : ''}${constraintsBlock}`
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
