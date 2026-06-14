/**
 * 输出工坊模板系统
 * 参考 html-anything 的 SKILL.md 模板架构，为 LingMo 笔记场景优化
 */

import { listInstalledTemplates } from './market'
import type { ExportBlueprint } from './smart-card-export'
import { WECHAT_STYLES } from './wechat-styles'
import { MOKA_OUTPUT_TEMPLATES } from './moka/templates'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputMode =
  | 'social'       // 社交传播
  | 'moka'         // Moka 卡片模式
  | 'wechat'       // 公众号排版
  | 'infographic'  // 可视化展示
  | 'deck'         // 演示汇报
  | 'article'      // 专业阅读
  | 'creative'     // AI 自由创意

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

1. **CJK 优先字体栈** — 中文使用 Noto Sans/Serif SC、思源黑体/宋体或系统中文字体，拉丁文使用系统 sans 或少量高质量字体
2. **清晰排版层级** — 标题、正文、说明、标签使用固定 rem 阶梯；正文不低于 1rem，长段落行高 1.55-1.75，标题使用 text-wrap: balance
3. **有节奏的布局** — 使用 4px/8px 基线间距，相关元素收紧，区块之间留出更大间距；Grid 负责二维结构，Flex 负责行内排列
4. **克制容器与安全区** — 卡片圆角优先 8/12/16px，避免 24px 以上的大圆角；移动端、长词、表格和代码块不得横向溢出
5. **状态型动效** — 动画只用于悬停、展开、切换、加载和内容关系提示；150-250ms 为主，使用 ease-out quart/quint/expo，必须提供 prefers-reduced-motion 降级
6. **颜色对比度 ≥ 4.5** — 正文、说明、占位文本都必须清晰可读；不要使用渐变文字或低对比灰字
7. **使用用户真实数据** — 不得使用 Lorem ipsum 或占位文本
8. **自包含单文件** — 所有 CSS 内联，无外部依赖；除必要字体 CDN 外不加载外部资源
`

const WECHAT_DESIGN_CONSTRAINTS = `
## 公众号排版约束

1. **保持 Markdown 结构** — 不重新编造内容，不强行拆卡片，优先保留用户原有标题、段落、表格、列表、引用和代码块
2. **微信编辑器友好** — 输出以内联样式为主，避免依赖外部脚本、复杂动画或平台不稳定 CSS
3. **正文阅读优先** — 字号、行高、段落间距以手机阅读为准，避免网页化装饰遮蔽正文
4. **图文复制优先** — 生成后推荐使用“导出 / 图文”复制到公众号后台
`

const WECHAT_OUTPUT_TEMPLATES: OutputTemplate[] = WECHAT_STYLES.map((style) => ({
  id: style.id,
  name: style.name,
  nameEn: style.nameEn,
  mode: 'wechat',
  scenario: 'sharing',
  description: style.description,
  icon: '🟩',
  designConstraints: WECHAT_DESIGN_CONSTRAINTS,
  outputHint: '生成可直接复制到微信公众号编辑器的内联样式图文 HTML',
  bestFor: style.bestFor,
  recommended: style.recommended,
  features: ['公众号', 'Markdown', '图文复制'],
  outputTargets: ['图文'],
  previewTone: 'wechat-article',
  sizePresets: ['auto'],
}))

const CREATIVE_SERIES_BASE_PROMPT = `
## 创意设计集成规范

能力来源：本模板提炼自本地创意设计工作流与 workflow、design-context、design-styles、content-guidelines、slide-decks、tweaks-system、animations、video-export、verification、critique-guide 等规范。输出工坊直接生成浏览器可预览的 HTML 源产物；PPTX、MP4、GIF、BGM 等脚本链路属于本地创意导出能力，必须在 HTML 注释中写清可执行导出配方，不能在页面可见区域假装已经导出。

### 核心理念
- HTML 是工具，不是媒介。根据输入材料选择专家身份：视觉编辑、幻灯片设计师、信息图设计师、交互原型师或 motion designer。
- 不要像普通网页模板。做幻灯片时像 PPT，做信息图时像出版物，做原型时像可点击产品界面，做动画时像一段有时间轴的叙事 demo。
- 从已有上下文出发。输入材料里如果出现品牌、产品、界面、色值、设计系统、截图描述或参考风格，优先提取这些上下文作为视觉系统；如果没有上下文，明确在 HTML 注释中写出 assumptions 与选择的 aesthetic direction。
- 先建立设计系统，再写页面：颜色、字体、间距、圆角、组件词汇、动效节奏都必须自洽。

### 工作流
1. 内部先做 Junior Designer brief，不在可见页面显示：目标受众、内容类型、关键信息、假设、风险、选用的视觉方向。
2. 依据内容选择一种交付形态：
   - 演示/汇报/课程：生成单文件 HTML deck，16:9 舞台，支持键盘翻页，正文最小 24px，每页一个记忆点。
   - 信息图/数据/流程：生成印刷级信息图，使用精确网格、注释、图例、时间轴或流程图，不伪造数据。
   - 产品/功能/体验描述：生成高保真交互原型，包含真实状态切换、可点击路径和 44px 以上触控目标。
   - 观点/故事/复盘：生成编辑部专题或叙事页面，避免 hero + 三卡片套路。
   - 动画/演示机制：生成轻量 stage + scene 结构，用 CSS/少量 JS 时间轴表达信息关系，不做装饰性乱动。
3. 如果内容适合变体探索，加入一个轻量 Tweaks 面板，用 localStorage 保存 2-3 个参数：主题、密度、字号、布局或动效强度。Tweaks 必须小而可用，不遮挡主要内容。

### 设计哲学选择
从内容中选择一种主导哲学，不要混搭成噪音：
- Pentagram / Müller-Brockmann：网格、字体、黑白加单一强调色，适合品牌、汇报、结构化观点。
- Information Architects：内容优先、阅读效率、少装饰，适合长文、文档、知识库。
- Fathom / Stamen：科学叙事、数据地图、注释系统，适合研究、数据、时间线。
- Takram：技术与人文的精密平衡，适合 AI、产品、系统设计。
- Kenya Hara：东方极简、留白、材料感，适合哲学、文化、沉思型内容。
- Field.io / Active Theory：生成艺术、运动诗学，只在内容本身与算法、流动、系统、未来感有关时使用。
- Experimental Jetset：概念极简、字体即图形，适合宣言、封面、强观点。

### 反 AI slop 规则
- 禁止默认紫蓝粉大渐变、hero + 3-column features、重复同款 card grid、emoji 装饰、假数据 metric cards、编造 quote。
- 禁止普通圆角卡片加左侧粗色条作为主要设计语言。
- 禁止用廉价 SVG 手画人物、设备或场景。需要素材但没有素材时，用诚实的 placeholder 或纯排版解决。
- 卡片只在信息确实需要分组时使用；信息结构能用网格、索引、时间轴、目录、标注系统表达时优先不用卡片。
- 每个视觉元素必须服务内容。删掉不会损失信息的装饰就不要生成。

### 输出约束
- 输出完整自包含 HTML，只返回代码。
- 在 HTML 顶部加入注释：assumptions、chosen philosophy、artifact type、content structure、known limitations。
- 必须包含 prefers-reduced-motion 降级。
- 移动端与桌面端都不能横向溢出，长标题、表格、代码块必须有安全处理。
- 生成的内容必须来自用户材料，允许压缩、分组、重排，不允许编造不存在的数据、客户、引用或事实。
`

const CREATIVE_SERIES_TEMPLATES: OutputTemplate[] = [
  {
    id: 'creative-huashu-design',
    name: '智能创意路由',
    nameEn: 'Creative Output Router',
    mode: 'creative',
    scenario: 'presentation',
    description: '根据材料自动判断要做原型、Deck、动画、变体、信息图、方向顾问或专家评审',
    icon: '✦',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 综合路由任务
- 先判断输入材料最适合哪一种创意交付形态，并在 HTML 顶部注释写出 routing decision。
- 如果用户没有明确要求形态，优先输出 3 个方向的轻量预览面板，让用户选择后再深入。
- 可见页面不能只是模板菜单，必须给出可用的第一版视觉产物。
`,
    outputHint: '自动路由到最合适的创意交付形态，生成第一版可预览 HTML',
    bestFor: '需求还不完全确定、需要 AI 判断设计产物类型、想先看方向',
    recommended: true,
    features: ['智能路由', 'Brief', '方向预览'],
    outputTargets: ['HTML', 'PNG/PDF', '下游脚本'],
    previewTone: 'creative-router',
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 综合路由任务
- 先判断输入材料最适合哪一种创意交付形态，并在 HTML 顶部注释写出 routing decision。
- 如果用户没有明确要求形态，优先输出 3 个方向的轻量预览面板，让用户选择后再深入。
- 可见页面不能只是模板菜单，必须给出可用的第一版视觉产物。
`,
  },
  {
    id: 'huashu-prototype',
    name: '真机交互原型',
    nameEn: 'Device Prototype',
    mode: 'creative',
    scenario: 'presentation',
    description: 'App/Web 高保真交互原型：单文件 HTML、真 iPhone bezel、可点击状态流、Playwright 检查清单',
    icon: '▣',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 交互原型任务
- 输出单文件 HTML 高保真 App/Web 原型。App 场景默认使用 iPhone 15 Pro bezel：Dynamic Island、状态栏、Home Indicator、内容安全区都要准确，不要随手画一个手机框。
- 页面必须有真实可点击状态：至少 3 个 screen/state、一个主流程、tab 或关键按钮切换，触控目标不小于 44px。
- 为关键元素添加 data-testid，并在 HTML 注释中列出 Playwright 最小验证：进入详情、关键按钮、tab/状态切换、pageerror=0。
- 使用用户材料中的真实功能和内容；没有真实图片时用诚实 placeholder，不用廉价手绘 SVG 充当产品图。
`,
    outputHint: '生成可点击 App/Web 原型 HTML，并附 Playwright 验证清单',
    bestFor: '移动应用 mockup、Web 产品流程、功能演示、设计 review',
    recommended: true,
    features: ['Prototype', 'iPhone bezel', 'Clickable'],
    outputTargets: ['HTML', 'PNG', 'Playwright清单'],
    sizePresets: ['mobile', '16:9'],
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 交互原型任务
- 输出单文件 HTML 高保真 App/Web 原型。App 场景默认使用 iPhone 15 Pro bezel：Dynamic Island、状态栏、Home Indicator、内容安全区都要准确，不要随手画一个手机框。
- 页面必须有真实可点击状态：至少 3 个 screen/state、一个主流程、tab 或关键按钮切换，触控目标不小于 44px。
- 为关键元素添加 data-testid，并在 HTML 注释中列出 Playwright 最小验证：进入详情、关键按钮、tab/状态切换、pageerror=0。
- 使用用户材料中的真实功能和内容；没有真实图片时用诚实 placeholder，不用廉价手绘 SVG 充当产品图。
`,
  },
  {
    id: 'huashu-deck',
    name: '浏览器演讲 Deck',
    nameEn: 'Centered HTML Deck',
    mode: 'creative',
    scenario: 'presentation',
    description: 'HTML deck 浏览器演讲源文件，16:9 居中逐页播放；可按 editable PPTX 约束组织 DOM',
    icon: '▤',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 演讲幻灯片任务
- 输出单文件 HTML deck，16:9 舞台居中显示，键盘左右键翻页，页码、speaker notes、print/PDF 友好。
- 每页一个记忆点，正文最小 24px，演讲者 10 米外可读；deck 不要像网页长滚动。
- 如果输入或用户指令提到 PPTX/可编辑，HTML 必须从第一行按 html2pptx 友好约束写：body 固定 16:9，文字放 h/p，文字元素自身不加 background/border/shadow，不使用 web component、复杂 SVG、CSS gradient。
- 在 HTML 顶部注释写清：当前输出工坊可直接预览 HTML，并可走现有 PPTX/PDF 导出；真文本框可编辑 PPTX 需本地 scripts/export_deck_pptx.mjs 链路。
`,
    outputHint: '生成浏览器可演讲 HTML deck，并保留 PPTX/PDF 下游导出提示',
    bestFor: '演讲、课程、项目汇报、发布会 deck、可导 PPTX/PDF 的源文件',
    recommended: true,
    features: ['Deck', 'Speaker notes', 'PPTX-ready'],
    outputTargets: ['HTML deck', 'PDF', 'PPTX'],
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.creative-slide', '.slide', '[data-slide]'], defaultRatio: '16:9', cardGap: 0 },
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 演讲幻灯片任务
- 输出单文件 HTML deck，16:9 舞台居中显示，键盘左右键翻页，页码、speaker notes、print/PDF 友好。
- 每页一个记忆点，正文最小 24px，演讲者 10 米外可读；deck 不要像网页长滚动。
- 如果输入或用户指令提到 PPTX/可编辑，HTML 必须从第一行按 html2pptx 友好约束写：body 固定 16:9，文字放 h/p，文字元素自身不加 background/border/shadow，不使用 web component、复杂 SVG、CSS gradient。
- 在 HTML 顶部注释写清：当前输出工坊可直接预览 HTML，并可走现有 PPTX/PDF 导出；真文本框可编辑 PPTX 需本地 scripts/export_deck_pptx.mjs 链路。
`,
  },
  {
    id: 'huashu-timeline-animation',
    name: '时间轴动画直绘',
    nameEn: 'Timeline Animation',
    mode: 'creative',
    scenario: 'sharing',
    description: 'Stage + Sprite 时间片段模型，生成可播放/暂停/拖动的时间轴动画 HTML，并附 MP4/GIF/BGM 导出配方',
    icon: '▶',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 时间轴动画任务
- 输出单文件 HTML animation stage，包含 play/pause、scrubber、当前时间、总时长，并用 JS timeline 数据驱动场景。
- 用 Stage/Sprite 思维组织：scene、sprite、start/end、interpolate、easing。不要做成几张 PPT 淡入淡出。
- 默认画布 1920x1080，可自适应 letterbox。运动必须有节奏，重点信息逐步揭示，支持 prefers-reduced-motion。
- 在 HTML 注释中附导出配方：25fps MP4、60fps 插帧、palette 优化 GIF、BGM/SFX cue list。当前输出工坊生成 HTML 源，视频/BGM 需本地 video-export 脚本链路。
`,
    outputHint: '生成时间轴动画 HTML 源，并附 MP4/GIF/BGM 下游导出说明',
    bestFor: '概念解释、发布动画、机制演示、社媒视频素材前置设计',
    features: ['Timeline', 'MP4/GIF recipe', 'BGM cues'],
    outputTargets: ['HTML动画', 'MP4脚本', 'GIF脚本', 'BGM配方'],
    sizePresets: ['16:9'],
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 时间轴动画任务
- 输出单文件 HTML animation stage，包含 play/pause、scrubber、当前时间、总时长，并用 JS timeline 数据驱动场景。
- 用 Stage/Sprite 思维组织：scene、sprite、start/end、interpolate、easing。不要做成几张 PPT 淡入淡出。
- 默认画布 1920x1080，可自适应 letterbox。运动必须有节奏，重点信息逐步揭示，支持 prefers-reduced-motion。
- 在 HTML 注释中附导出配方：25fps MP4、60fps 插帧、palette 优化 GIF、BGM/SFX cue list。当前输出工坊生成 HTML 源，视频/BGM 需本地 video-export 脚本链路。
`,
  },
  {
    id: 'huashu-variants',
    name: '多方向设计变体',
    nameEn: 'Variants + Tweaks',
    mode: 'creative',
    scenario: 'presentation',
    description: '3+ 并排方案对比，内置 Tweaks 实时调参，用 localStorage 保存主题、密度、布局等变量',
    icon: '◫',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 设计变体任务
- 输出至少 3 个并排 variation，必须跨维度探索：视觉方向、布局、密度、交互或色彩，不要只换配色。
- 页面包含可折叠 Tweaks 面板，至少 3 个参数：theme、density、layout 或 motion intensity，并用 localStorage 持久化。
- 每个 variation 都要有短 label 与 tradeoff，不给用户制造盲选。
- 适合交互差异时，Tweaks 切换必须真的改变 DOM/状态，不只是文字说明。
`,
    outputHint: '生成 3+ 设计方向并排对比，并提供 Tweaks 实时调参',
    bestFor: '视觉探索、方案比稿、布局/密度/交互方向选择',
    recommended: true,
    features: ['3+ variants', 'Tweaks', 'localStorage'],
    outputTargets: ['HTML', 'PNG/PDF'],
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 设计变体任务
- 输出至少 3 个并排 variation，必须跨维度探索：视觉方向、布局、密度、交互或色彩，不要只换配色。
- 页面包含可折叠 Tweaks 面板，至少 3 个参数：theme、density、layout 或 motion intensity，并用 localStorage 持久化。
- 每个 variation 都要有短 label 与 tradeoff，不给用户制造盲选。
- 适合交互差异时，Tweaks 切换必须真的改变 DOM/状态，不只是文字说明。
`,
  },
  {
    id: 'huashu-infographic',
    name: '印刷级信息图',
    nameEn: 'Print-grade Infographic',
    mode: 'creative',
    scenario: 'research',
    description: '印刷级信息图/可视化，精确网格、图例、注释、数据来源，可导 PDF/PNG/SVG 友好',
    icon: '◈',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 信息图/可视化任务
- 输出印刷级信息图 HTML：明确画布、安全区、标题层级、图例、注释、来源、脚注。
- 若材料包含数据，优先用真实数据做图；不能伪造数字。无数据时做结构图、流程图或概念地图。
- SVG 只用于真实图表/连线/图例，不用于廉价装饰；可导 PDF/PNG/SVG 时要保持高对比、矢量友好。
- 页面必须能整页导出，也要声明关键图表选择器，便于输出工坊智能卡片导出。
`,
    outputHint: '生成印刷级信息图 HTML，可走 PDF/PNG/智能卡片导出',
    bestFor: '研究报告、数据故事、流程图、知识地图、品牌图解',
    features: ['Infographic', 'Print grid', 'Data viz'],
    outputTargets: ['HTML', 'PDF', 'PNG', 'SVG友好'],
    exportBlueprint: { cardSelectors: ['.creative-infographic', '.infographic-panel', '[data-export-card]'], defaultRatio: 'auto', cardGap: 16 },
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 信息图/可视化任务
- 输出印刷级信息图 HTML：明确画布、安全区、标题层级、图例、注释、来源、脚注。
- 若材料包含数据，优先用真实数据做图；不能伪造数字。无数据时做结构图、流程图或概念地图。
- SVG 只用于真实图表/连线/图例，不用于廉价装饰；可导 PDF/PNG/SVG 时要保持高对比、矢量友好。
- 页面必须能整页导出，也要声明关键图表选择器，便于输出工坊智能卡片导出。
`,
  },
  {
    id: 'huashu-direction-advisor',
    name: '设计方向顾问',
    nameEn: 'Direction Advisor',
    mode: 'creative',
    scenario: 'presentation',
    description: '5 流派 × 20 种设计哲学，推荐 3 个差异化方向，并行生成 Demo 供选择',
    icon: '◇',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 设计方向顾问任务
- 当需求模糊、没有设计上下文或用户只说“做得好看”时，输出方向顾问页面，而不是直接押一个风格。
- 必须覆盖 5 个设计流派与 20 种哲学的选择空间，并最终推荐 3 个差异化方向。
- 每个推荐方向必须包含：哲学来源、适用理由、视觉语法、风险、适合/不适合场景，以及一个小型 HTML demo 面板。
- 3 个方向要拉开距离：保守可信、表达性强、实验前沿，不要三份都长得像。
`,
    outputHint: '生成 3 个可比较的设计方向和 demo 面板，帮助先定风格',
    bestFor: '需求模糊、风格未定、需要先选方向或说服团队',
    recommended: true,
    features: ['5x20 philosophy', '3 demos', 'Advisor'],
    outputTargets: ['HTML顾问板', 'PNG/PDF'],
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 设计方向顾问任务
- 当需求模糊、没有设计上下文或用户只说“做得好看”时，输出方向顾问页面，而不是直接押一个风格。
- 必须覆盖 5 个设计流派与 20 种哲学的选择空间，并最终推荐 3 个差异化方向。
- 每个推荐方向必须包含：哲学来源、适用理由、视觉语法、风险、适合/不适合场景，以及一个小型 HTML demo 面板。
- 3 个方向要拉开距离：保守可信、表达性强、实验前沿，不要三份都长得像。
`,
  },
  {
    id: 'huashu-expert-review',
    name: '5维专家评审',
    nameEn: '5D Expert Review',
    mode: 'creative',
    scenario: 'research',
    description: '按哲学一致性、视觉层级、细节执行、功能性、创新性打分，输出雷达图与 Keep/Fix/Quick Wins',
    icon: '◎',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + CREATIVE_SERIES_BASE_PROMPT + `
### 5 维度专家评审任务
- 输出的是设计评审 artifact，不是重新设计页面。评审对象来自用户提供的 HTML、截图描述、设计稿说明或生成结果。
- 5 个维度各 0-10 分：哲学一致性、视觉层级、细节执行、功能性、创新性。必须给出总分、雷达图、证据句。
- 输出 Keep / Fix / Quick Wins 三栏。Fix 要按严重程度排序，Quick Wins 必须是 5-15 分钟内可执行的小修复。
- 评审设计不评设计师，语气具体、可操作、不空泛夸奖。
`,
    outputHint: '生成专家评审页，包含雷达图、分数、Keep/Fix/Quick Wins 和修复清单',
    bestFor: '审稿、视觉验收、改版前诊断、设计质量复盘',
    features: ['5D review', 'Radar', 'Fix list'],
    outputTargets: ['HTML评审', 'PDF'],
    skillPrompt: CREATIVE_SERIES_BASE_PROMPT + `
### 5 维度专家评审任务
- 输出的是设计评审 artifact，不是重新设计页面。评审对象来自用户提供的 HTML、截图描述、设计稿说明或生成结果。
- 5 个维度各 0-10 分：哲学一致性、视觉层级、细节执行、功能性、创新性。必须给出总分、雷达图、证据句。
- 输出 Keep / Fix / Quick Wins 三栏。Fix 要按严重程度排序，Quick Wins 必须是 5-15 分钟内可执行的小修复。
- 评审设计不评设计师，语气具体、可操作、不空泛夸奖。
`,
  },
]

// ---------------------------------------------------------------------------
// 模板列表
// ---------------------------------------------------------------------------

export const OUTPUT_TEMPLATES: OutputTemplate[] = [
  ...WECHAT_OUTPUT_TEMPLATES,
  ...MOKA_OUTPUT_TEMPLATES,
  ...CREATIVE_SERIES_TEMPLATES,

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

export const INTERNAL_OUTPUT_TEMPLATES: OutputTemplate[] = [
  ...OUTPUT_TEMPLATES,
]

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function getOutputTemplate(id: string): OutputTemplate {
  return INTERNAL_OUTPUT_TEMPLATES.find(t => t.id === id) || OUTPUT_TEMPLATES[0]
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
  return typeof value === 'string' && INTERNAL_OUTPUT_TEMPLATES.some(t => t.id === value)
}

// ---------------------------------------------------------------------------
// Mode metadata
// ---------------------------------------------------------------------------

export const OUTPUT_MODES: Array<{ id: OutputMode; name: string; icon: string; description: string }> = [
  { id: 'creative', name: 'AI 自由创意', icon: '🎨', description: '根据创意模板或自由提示直绘网页' },
  { id: 'moka', name: 'Moka 卡片', icon: '✨', description: 'AI 卡片设计、参考图、分页导出' },
  { id: 'wechat', name: '公众号排版', icon: '🟩', description: '内联样式、图文复制、微信编辑器友好' },
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
