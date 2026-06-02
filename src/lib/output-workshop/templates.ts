/**
 * 输出工坊模板系统
 * 参考 html-anything 的 SKILL.md 模板架构，为 LingMo 笔记场景优化
 */

import { listInstalledTemplates } from './market'
import type { ExportBlueprint } from './smart-card-export'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputMode =
  | 'social'       // 社交传播
  | 'infographic'  // 可视化展示
  | 'deck'         // 演示汇报
  | 'article'      // 专业阅读
  | 'creative'     // AI 自由设计

export type OutputScenario =
  | 'note'         // 笔记整理
  | 'research'     // 研究报告
  | 'presentation' // 演示汇报
  | 'sharing'      // 分享传播
  | 'learning'     // 学习总结

export interface OutputTemplate {
  id: string
  name: string
  nameEn: string
  mode: OutputMode
  scenario: OutputScenario
  description: string
  icon: string
  /** 设计约束提示 */
  designConstraints: string
  /** 输出格式提示 */
  outputHint: string
  /** 推荐用途 */
  bestFor: string
  /** 模板能力标签：用于输出工坊模板库展示，兼容 open-design 的 artifact metadata 思路 */
  features?: string[]
  /** 支持/推荐的输出目标 */
  outputTargets?: string[]
  /** 预览视觉调性 */
  previewTone?: string
  /** 推荐尺寸预设 */
  sizePresets?: string[]
  /** 是否推荐 */
  recommended?: boolean
  /** AI直绘时的自定义约束提示词 */
  skillPrompt?: string
  /** 智能卡片导出蓝图 */
  exportBlueprint?: ExportBlueprint
}

// ---------------------------------------------------------------------------
// 设计约束
// ---------------------------------------------------------------------------

const SHARED_DESIGN_CONSTRAINTS = `
## 设计约束（必须遵守）

1. **CJK 优先字体栈** — 中文使用 Noto Sans/Serif SC 或思源黑体/宋体，拉丁文使用 Inter/Manrope
2. **8px 基线网格** — 所有间距、行高、字体大小必须是 8 的倍数
3. **圆角柔和阴影** — 使用圆角（8px/12px/16px）和柔和阴影，避免纯黑纯白
4. **颜色对比度 ≥ 4.5** — 确保文字可读性
5. **使用用户真实数据** — 不得使用 Lorem ipsum 或占位文本
6. **自包含单文件** — 所有 CSS 内联，无外部依赖
7. **移动端适配** — 使用响应式设计，确保在手机上可读
`

// ---------------------------------------------------------------------------
// 模板列表
// ---------------------------------------------------------------------------

export const OUTPUT_TEMPLATES: OutputTemplate[] = [
  // === 一、社交传播类 ===
  {
    id: 'social-xiaohongshu',
    name: '粉彩磨砂卡片',
    nameEn: 'Xiaohongshu Style',
    mode: 'social',
    scenario: 'sharing',
    description: 'ins风、圆角磨砂、马卡龙配色、标签化、移动端优先的沉浸式卡片，轻松解决MD文字密集问题',
    icon: '📱',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 柔和粉彩色调
- 圆角卡片，移动端优先排版
- emoji 点缀
- 竖版 3:4
`,
    outputHint: '生成视觉精美、极具吸睛力的小红书卡片',
    bestFor: '小红书、Instagram、社交媒体分享',
    recommended: true,
    exportBlueprint: { cardSelectors: ['.xhs-card', '.card', '[class*="xhs"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-waterfall',
    name: '瀑布流卡片',
    nameEn: 'Waterfall Cards',
    mode: 'social',
    scenario: 'sharing',
    description: '极简留白、自适应卡片瀑布流。把长篇大论的大段MD内容智能拆分为模块化独立卡片，阅读无压力',
    icon: '📇',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 极简留白卡片
- 卡片瀑布流布局
- 每一个Section渲染为独立精美卡片
`,
    outputHint: '生成多卡片排列的瀑布流自适应页面',
    bestFor: '多知识点拆分、文章合集、碎片化学习笔记',
    exportBlueprint: { cardSelectors: ['.card', '.waterfall-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 20 },
  },
  {
    id: 'social-card',
    name: '瑞士网格社媒卡',
    nameEn: 'Guizang M01 Social Series',
    mode: 'social',
    scenario: 'sharing',
    description: '参考 guizang-social-card-skill 的 M01/S03/S07 配方：3:4 锁定画板、12 列网格、封面加详情卡的社媒组图',
    icon: '🐦',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 固定 3:4 社媒画板，输出封面 M01 + 多张 S 系列详情卡
- 使用 12 列/16 行栅格、模板编号、页码、安全 footer，不做圆角卡片堆叠
- 标题遵循“大字号、轻字重、强留白”，每卡只承载一个清晰观点
- 色彩限制为米白纸底、墨黑正文、单一朱红锚点，避免渐变与重阴影
`,
    outputHint: '生成可逐张导出的归藏社媒组图 HTML，默认 1080×1440 视觉比例',
    bestFor: '小红书封面、朋友圈长图、知识观点卡、产品洞察卡',
    recommended: true,
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.gz-social-card', '.cover-card', '.detail-card'], defaultRatio: '3:4', cardGap: 28 },
  },

  // === 二、可视化展示类 ===
  {
    id: 'learning-mindmap',
    name: '思维导图',
    nameEn: 'Mindmap Style',
    mode: 'infographic',
    scenario: 'learning',
    description: '纯 CSS 与 SVG 实现的无限层级自适应金字塔左右树状脑图，层级清晰，交互流畅，支持缩放与拖拽',
    icon: '🧠',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 中心主题 + 分支
- 层级结构清晰
- 颜色区分不同分支
- 纯 CSS 与自适应贝塞尔连线绘制
`,
    outputHint: '生成思维导图风格的知识结构页面',
    bestFor: '知识梳理、概念整理、学习大纲',
    recommended: true,
  },
  {
    id: 'visual-bento',
    name: 'Bento网格画册',
    nameEn: 'Bento Grid Layout',
    mode: 'infographic',
    scenario: 'sharing',
    description: '日式便当盒网格模块化布局，一屏填满、图文混排，结构极度清晰，打造2026顶级前沿设计风格',
    icon: '🍱',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- Bento Grid 网格布局
- 模块化双层卡片
- 限制在一屏内展示，紧凑高颜值
`,
    outputHint: '生成一屏式日式便当盒网格模块化页面',
    bestFor: '作品集、产品介绍、多模块教程、多维图文笔记',
  },
  {
    id: 'poster-hero',
    name: '极光金句海报',
    nameEn: 'Poster Style',
    mode: 'infographic',
    scenario: 'sharing',
    description: '全屏海报、高端渐变背景、超大渐变字标题。程序自动过滤MD冗余文字，只保留最核心的观点，极其适合截图分享',
    icon: '🦸',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 全屏海报
- 大字标题与居中排版
- 动态背景，渐变遮罩与文字
`,
    outputHint: '生成高饱和度视觉冲击海报长图',
    bestFor: '核心总结、金句宣传、核心观点宣言、截图打卡',
  },
  {
    id: 'poster-magazine',
    name: '复古杂志海报',
    nameEn: 'Magazine Poster',
    mode: 'infographic',
    scenario: 'sharing',
    description: '新闻纸周日报风格的大字海报，充满复古印刷美感与黄金分割排版',
    icon: '🖼️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 超大衬线标题
- 双栏正文
- 点阵奶油色底
- 竖版 1080×1920
`,
    outputHint: '生成视觉冲击力强的单页纸版海报',
    bestFor: '深度内容分享、社交媒体美文、活动宣传',
  },
  {
    id: 'data-infographic',
    name: '垂直数据图',
    nameEn: 'Infographic',
    mode: 'infographic',
    scenario: 'research',
    description: '垂直滚动的高清时间轴与数据故事图，适合进行图文穿穿插科普',
    icon: '📈',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 垂直滚动
- 图文穿插
- 数据可视化
- 故事线结构
`,
    outputHint: '生成垂直滚动的高格调信息图',
    bestFor: '数据故事、科普笔记、研究报告长文',
  },

  // === 三、演示汇报类 ===
  {
    id: 'deck-minimal',
    name: '瑞士网格幻灯片',
    nameEn: 'Guizang S01 Deck',
    mode: 'deck',
    scenario: 'presentation',
    description: '参考 guizang-ppt-skill 的 S01/S02/S04/S09/S16/S22：16:9 锁定画布、16 列瑞士网格、封面/目录/内容/结尾完整结构',
    icon: '🎬',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 固定 16:9 slide 画布，按封面 S01、目录 S02、内容 S04/S09/S16、结尾 S22 生成
- 使用 16 列/9 行瑞士网格、模板编号、页码和细线对齐，不使用圆角容器
- 单页单观点，标题大字号轻字重，正文拆为 statement/body/evidence
- 全 deck 只保留一个朱红 accent，避免多色渐变和厚重投影
`,
    outputHint: '生成可横向翻页的归藏 PPT HTML，每页可作为独立 16:9 slide 导出',
    bestFor: '工作汇报、产品方案、课程演示、研究报告解读',
    recommended: true,
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.gz-deck-slide', '.slide-frame'], defaultRatio: '16:9', cardGap: 0 },
  },
  {
    id: 'deck-tech',
    name: '极客技术幻灯片',
    nameEn: 'Tech Sharing',
    mode: 'deck',
    scenario: 'presentation',
    description: '赛博朋克深色网格等宽编程主题，支持代码高亮与霓虹呼吸发光卡片',
    icon: '💻',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 深色背景
- 等宽代码字体与霓虹色彩
- 支持代码块特殊高亮
`,
    outputHint: '生成极客科技感十足的横向演示幻灯片',
    bestFor: '程序员技术汇报、开源项目分享、算法讲解',
    exportBlueprint: { cardSelectors: ['.slide', '.deck-slide'], defaultRatio: '16:9', cardGap: 0 },
  },
  {
    id: 'report-business',
    name: '商务双栏报告',
    nameEn: 'Business Report',
    mode: 'deck',
    scenario: 'presentation',
    description: '极简商务黑白灰底色、清晰树形层级。左侧固定目录锚点跳转，右侧高精度单双栏排版，专业正式',
    icon: '📂',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 极简商务黑白灰色调
- 左侧目录树快速锚点跳转
- MD表格/列表/代码完全格式化
`,
    outputHint: '生成高度严谨、专业工整的商务研究报告',
    bestFor: '工作总结、正式调研报告、学术笔记、公关文档',
  },

  // === 四、专业阅读类 ===
  {
    id: 'read-glass',
    name: '极光毛玻璃阅读',
    nameEn: 'Liquid Glass Reader',
    mode: 'article',
    scenario: 'note',
    description: '2026顶级设计！底部液态弥散流体气泡流动，覆盖高通透磨砂玻璃阅报器，内置字体缩放、护眼模式与侧栏导航',
    icon: '🧊',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 动态液态弥散背景
- 高透磨砂玻璃材质（backdrop-filter）
- 护眼模式切换与字体无级调节
`,
    outputHint: '生成具有未来通透感的可交互液态玻璃沉浸式读报页面',
    bestFor: '精品深度阅读、高质量技术长文、小说、唯美散文',
    recommended: true,
  },
  {
    id: 'read-accordion',
    name: '折叠大纲手册',
    nameEn: 'Accordion Manual',
    mode: 'article',
    scenario: 'learning',
    description: '手风琴折叠模块化收纳。自动将MD二级标题转化为纯CSS展开折叠板，默认折叠，极大提升极客阅读与大纲整理效率',
    icon: '🪗',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 纯 CSS details 手风琴结构
- 隐藏长篇文本，默认只显章节大纲
- 干净利落，阅读效率提升100%
`,
    outputHint: '生成具有高级手风琴收拢折叠功能的说明手册页面',
    bestFor: '内容冗长的MD笔记、API参数手册、问答教程FAQ、长说明书',
  },
  {
    id: 'read-dark-tech',
    name: '暗黑极客阅读',
    nameEn: 'Dark Tech Mode',
    mode: 'article',
    scenario: 'note',
    description: '程序员最爱！极致极客纯黑背景搭配护眼霓虹高亮。大代码块行号显示、行内代码强调及极致精简装饰',
    icon: '🌌',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 纯黑 #030303 护眼科技感底色
- 霓虹紫/天际蓝高亮强调
- 代码块行号渲染与精美框线
`,
    outputHint: '生成极致暗黑、代码高阶渲染的科技阅读文档',
    bestFor: '开发日记、源码解析、技术文档、环境部署指令',
  },
  {
    id: 'article-editorial',
    name: '周刊杂志排版',
    nameEn: 'Editorial Article',
    mode: 'article',
    scenario: 'note',
    description: '适合长文阅读的单页报告，类似杂志排版风格',
    icon: '📰',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 使用衬线字体作为标题，无衬线字体作为正文
- 段落间距 24px，行高 1.6-1.8
- 适当的引用块和分隔线
`,
    outputHint: '生成分区清晰、适合长文阅读的自包含 HTML 页面',
    bestFor: '笔记整理、研究报告、读书笔记、复盘总结',
  },
  {
    id: 'article-kami',
    name: '古典宣纸手卷',
    nameEn: 'Kami Parchment',
    mode: 'article',
    scenario: 'note',
    description: '温暖的羊皮纸底色 + 墨蓝强调色，类似 Kami 风格',
    icon: '📜',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 背景色 #f5f4ed（暖白）
- 强调色 #2c3e50（墨蓝）
- 单一衬线字体家族
`,
    outputHint: '生成温暖舒适的阅读页面，适合深度阅读',
    bestFor: '长文笔记、日记、反思、哲学思考',
  },
  {
    id: 'article-brutalist',
    name: '黑白硬边缘极简',
    nameEn: 'Brutalist Style',
    mode: 'article',
    scenario: 'note',
    description: '硬边、黑白、反网格的极简设计',
    icon: '⬛',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 黑白为主，强调色仅用于链接
- 无圆角，硬边框
`,
    outputHint: '生成大胆、直接的极简页面',
    bestFor: '技术文档、代码笔记、API 文档',
  },
  {
    id: 'data-dashboard',
    name: '数据仪表盘',
    nameEn: 'Data Dashboard',
    mode: 'article',
    scenario: 'research',
    description: '仪表盘风格的数据报告，突出关键指标',
    icon: '📊',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 顶部 KPI 卡片
- 表格摘要
- 使用表格和列表展示数据
`,
    outputHint: '生成突出关键指标的数据报告',
    bestFor: '数据分析、CSV/JSON 可视化、指标解读',
  },
  {
    id: 'learning-flashcard',
    name: '学习卡片',
    nameEn: 'Learning Cards',
    mode: 'article',
    scenario: 'learning',
    description: '知识点卡片式布局，正面展示核心问题，反面承载复杂Markdown大纲，适合高效复习记忆',
    icon: '📇',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 卡片网格布局
- 正面/背面翻转效果
- 适合打印与滚动记忆
`,
    outputHint: '生成知识点卡片，正面/背面完美翻转，适合复习和记忆',
    bestFor: '学习笔记、知识点整理、考试复习',
    exportBlueprint: { cardSelectors: ['.flashcard', '.learning-card', '.card'], defaultRatio: '3:4', cardGap: 16 },
  },
  {
    id: 'custom-ai-design',
    name: 'AI 自由创意设计',
    nameEn: 'Custom AI Design',
    mode: 'creative',
    scenario: 'note',
    description: '由 AI 自主构思网页排版，直接进行一站式网页创意设计',
    icon: '🎨',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 扮演天才前端设计师，直接输出完美、现代、精美的完整自包含 HTML 页面
- 可以根据内容定制任何非凡的布局
`,
    outputHint: '由 AI 自由发挥网页设计与排版',
    bestFor: '创意海报、个性网页、特殊演示、非标排版报告',
  },
]

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function getOutputTemplate(id: string): OutputTemplate {
  return OUTPUT_TEMPLATES.find(t => t.id === id) || OUTPUT_TEMPLATES[0]
}

export function getTemplatesByMode(mode: OutputMode): OutputTemplate[] {
  return OUTPUT_TEMPLATES.filter(t => t.mode === mode)
}

export function getTemplatesByScenario(scenario: OutputScenario): OutputTemplate[] {
  return OUTPUT_TEMPLATES.filter(t => t.scenario === scenario)
}

export function getRecommendedTemplates(): OutputTemplate[] {
  return OUTPUT_TEMPLATES.filter(t => t.recommended)
}

export function isOutputTemplateId(value: unknown): value is string {
  return typeof value === 'string' && OUTPUT_TEMPLATES.some(t => t.id === value)
}

// ---------------------------------------------------------------------------
// Mode metadata
// ---------------------------------------------------------------------------

export const OUTPUT_MODES: Array<{ id: OutputMode; name: string; icon: string; description: string }> = [
  { id: 'creative', name: 'AI 自由设计', icon: '🎨', description: '根据设计 Skill 或自由提示直绘网页' },
  { id: 'social', name: '社交传播', icon: '📢', description: '轻量化、易分享、高颜值' },
  { id: 'infographic', name: '可视化展示', icon: '📈', description: '图文并茂、视觉冲击' },
  { id: 'deck', name: '演示汇报', icon: '🎬', description: '正式、结构化、替代 PPT' },
  { id: 'article', name: '专业阅读', icon: '📖', description: '解决 MD 阅读难、内容冗余' },
]

export const OUTPUT_SCENARIOS: Array<{ id: OutputScenario; name: string; icon: string }> = [
  { id: 'note', name: '笔记整理', icon: '📝' },
  { id: 'research', name: '研究报告', icon: '🔬' },
  { id: 'presentation', name: '演示汇报', icon: '🎤' },
  { id: 'sharing', name: '分享传播', icon: '📢' },
  { id: 'learning', name: '学习总结', icon: '📚' },
]

export async function listAllTemplates(): Promise<OutputTemplate[]> {
  try {
    const installed = await listInstalledTemplates()
    return [...OUTPUT_TEMPLATES, ...installed]
  } catch (e) {
    console.error("加载动态/本地自定义模板失败，降级使用静态模板列表:", e)
    return OUTPUT_TEMPLATES
  }
}
