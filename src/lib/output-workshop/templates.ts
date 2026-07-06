/**
 * 智能排版模板系统
 * 参考 html-anything 的 SKILL.md 模板架构，为 LingMo 笔记场景优化
 */

import { listInstalledTemplates } from './market'
import type { DesignProfileId } from './design-profiles'
import type { ExportBlueprint } from './smart-card-export'
import { WECHAT_STYLES, type WechatStyleId, loadCustomWechatThemes } from './wechat-styles'
export { isLocalWechatOutputTemplate } from './template-routing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputMode =
  | 'social'       // 社交传播
  | 'wechat'       // 一键排版
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
  /**
   * 显式声明的生成管线，供 template-routing 直接判定，避免依赖 mode/features/previewTone
   * 等隐式字符串规则。未标注时 routing 回退到既有启发式规则（兼容旧模板）。
   * - "wechat": 本地一键排版（buildWechatArticle）
   * - "local-style": AI 结构解析 + 本地样式模板（buildStyle）
   * - "creative": AI 自由直绘
   */
  pipeline?: "wechat" | "local-style" | "creative"
  description: string
  icon: string
  /** 设计约束提示 */
  designConstraints: string
  /** 输出格式提示 */
  outputHint: string
  /** 推荐用途 */
  bestFor: string
  /** 模板能力标签：用于智能排版模板库展示，兼容 open-design 的 artifact metadata 思路 */
  features?: string[]
  /** 支持/推荐的输出目标 */
  outputTargets?: string[]
  /** 预览视觉调性 */
  previewTone?: string
  /** 模板库预览主题：色彩/字体/母题/标语，驱动 buildSocialSeriesTemplatePreview */
  previewTheme?: TemplatePreviewTheme
  /** 推荐的设计 profile，用于创意直绘提示词补充 */
  designProfileId?: DesignProfileId
  /** 推荐生成工作流，用于动态模板或 open-design 清单提示 */
  pipelineHint?: string[]
  /** 模板追加质量规则 */
  qualityRules?: string[]
  /** 推荐尺寸预设 */
  sizePresets?: string[]
  /** 是否推荐 */
  recommended?: boolean
  /** AI直绘时的自定义约束提示词 */
  skillPrompt?: string
  /** 智能卡片导出蓝图 */
  exportBlueprint?: ExportBlueprint
}

export interface TemplatePreviewTheme {
  /** 卡片背景色 */
  bg: string
  /** 主文字色 */
  ink: string
  /** 副文字色 */
  muted: string
  /** 强调色 */
  accent: string
  /** 次强调色（可选，用于数据/图表） */
  altAccent?: string
  /** 标题字体 CSS font-family 值 */
  fontTitle: string
  /** 正文字体 CSS font-family 值 */
  fontBody: string
  /** 等宽字体（可选） */
  fontMono?: string
  /** 母题：控制预览卡装饰元素 */
  motif:
    | 'editorial'        // 双栏衬线 + 发丝线 + 刊号
    | 'terminal-dark'    // 纯黑 + 荧光绿 + ASCII 边框
    | 'consulting'       // 海军蓝 + 金 + 矩阵图
    | 'review-score'     // 巨型评分 + 红绿结论
    | 'terminal-warm'    // 暖纸 + 打字机 + $ 提示符
    | 'storyboard'       // 石色 + 罗马数字 + 分镜格
    | 'dot-matrix'       // 点阵网格 + 信号波形
    | 'sketch-note'      // 纸张网格 + 手写批注
    | 'playful-geometric'// Memphis 几何贴纸
    | 'neo-brutal'       // 粗黑边框 + 硬阴影
    | 'botanical'        // 叶脉线条 + 温和绿
    | 'retro-print'      // 旧纸栏头 + 复古印刷
    | 'clean-native'     // 原生简约卡片
  /** 一句话视觉定位（显示在预览卡顶部） */
  tagline: string
  /** 角标编号，如 "ISSUE 042" / "SIG_01" / "VOL.I" */
  cornerLabel?: string
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
## 一键排版约束

1. **保持 Markdown 结构** — 不重新编造内容，不强行拆卡片，优先保留用户原有标题、段落、表格、列表、引用和代码块
2. **微信编辑器友好** — 输出以内联样式为主，避免依赖外部脚本、复杂动画或平台不稳定 CSS
3. **正文阅读优先** — 字号、行高、段落间距以手机阅读为准，避免网页化装饰遮蔽正文
4. **图文复制优先** — 生成后推荐使用“导出 / 图文”复制到公众号后台
`

const WECHAT_TEMPLATE_ICONS: Record<WechatStyleId, string> = {
  "wechat-default": "文",
  "latepost-depth": "晚",
  "wechat-anthropic": "C",
  "wechat-tech": "码",
  "wechat-elegant": "雅",
  "wechat-deepread": "读",
  "wechat-ft": "FT",
  "wechat-nyt": "NY",
  "wechat-jonyive": "J",
  "wechat-medium": "M",
  "wechat-apple": "⌘",
  "guardian": "G",
  "nikkei": "日",
  "warm-docs": "暖",
  "lemonde": "L",
}

const WECHAT_TEMPLATE_FEATURES: Record<WechatStyleId, string[]> = {
  "wechat-default": ["通用图文", "一键排版", "图文复制"],
  "latepost-depth": ["晚点深度", "一键排版", "商业观察"],
  "wechat-anthropic": ["温暖文档", "一键排版", "AI 产品"],
  "wechat-tech": ["技术代码", "一键排版", "代码友好"],
  "wechat-elegant": ["优雅长文", "一键排版", "人文随笔"],
  "wechat-deepread": ["深度阅读", "一键排版", "低干扰"],
  "wechat-ft": ["财经评论", "一键排版", "商业分析"],
  "wechat-nyt": ["新闻叙事", "一键排版", "专题报道"],
  "wechat-jonyive": ["极简留白", "一键排版", "设计叙事"],
  "wechat-medium": ["博客阅读", "一键排版", "观点文章"],
  "wechat-apple": ["Apple 简洁", "一键排版", "产品发布"],
  guardian: ["卫报评论", "一键排版", "公共议题"],
  nikkei: ["日经商业", "一键排版", "产业观察"],
  "warm-docs": ["暖色文档", "一键排版", "知识整理"],
  lemonde: ["法式社论", "一键排版", "国际观察"],
}

const WECHAT_OUTPUT_TEMPLATES: OutputTemplate[] = WECHAT_STYLES.map((style) => ({
  id: style.id,
  name: style.name,
  nameEn: style.nameEn,
  mode: 'wechat',
  scenario: 'sharing',
  description: style.description,
  icon: WECHAT_TEMPLATE_ICONS[style.id],
  designConstraints: WECHAT_DESIGN_CONSTRAINTS,
  outputHint: '生成可直接复制到微信公众号编辑器的内联样式图文 HTML',
  bestFor: style.bestFor,
  recommended: style.recommended,
  features: WECHAT_TEMPLATE_FEATURES[style.id],
  outputTargets: ['图文'],
  previewTone: 'wechat-article',
  sizePresets: ['auto'],
}))

const REDBOOK_CARD_SELECTORS = ['.cover-container', '.card-container', '[data-redbook-card]', '[data-export-card]']

const AUTO_REDBOOK_BASE_PROMPT = `
## Auto-Redbook 社交组图规范

能力来源：参考 comeonzhj/Auto-Redbook-Skills 的 8 套主题皮肤、4 种分页模式和统一卡片结构，并迁移为 LingMo 智能排版的社交传播模板。只生成可导出的 HTML 卡片，不生成账号登录、Cookie、托管运营或自动发布能力。

### 统一卡片结构
- 默认输出 1080×1440 的 3:4 小红书/社交传播组图，一组包含封面 + 多张正文卡。
- 每张卡必须使用可被智能卡片导出识别的结构：\`.cover-container\` 或 \`.card-container\`，并补充 \`data-redbook-card\`。
- 推荐结构：
  \`<section class="card-container" data-redbook-card="1"><div class="card-inner"><div class="card-content"><div class="card-content-scale">...</div></div></div></section>\`
- 封面可用 \`.cover-container\`，正文卡用 \`.card-container\`；所有卡片保持同一宽高比例、安全边距和主题语言。
- \`.card-content\` 是固定视窗内容区，\`.card-content-scale\` 是自动适配层，便于导出时使用 auto-fit 整体缩放。

### 分页与内容策略
- 内容短且需要严格控制页数：可在 HTML 中保留 \`<hr data-card-break>\` 或独立 \`---\` 分隔，适配 separator。
- 内容长短不稳定：按标题、段落和列表语义拆为多张卡，适配 auto-split。
- 单张卡内容接近溢出时，优先压缩层级、删冗余装饰、拆下一页；不要把正文缩到不可读。
- 每张卡只承载一个清晰观点：标题、解释、证据/步骤/清单、页码四层即可。
- 需要标签时用真实主题词，不要批量生成平台运营话术。

### 输出形态禁令
- 不要生成普通长网页、桌面报告、全屏 dashboard 或单个 .container 平铺页面。
- 不要只生成一个 hero 后面接四个信息块；必须是多张独立 3:4 画板。
- 不要把所有章节放在一个 card 内；长内容必须拆为多个 .card-container。
- 不要把卡片尺寸写成 max-width: 440px 的手机网页容器；导出源画板必须是 1080px × 1440px。
`

const AUTO_REDBOOK_EXPORT_BLUEPRINT: ExportBlueprint = {
  cardSelectors: REDBOOK_CARD_SELECTORS,
  defaultRatio: '3:4',
  cardGap: 24,
  pagingMode: 'auto-fit',
  autoSplitMaxChars: 760,
  dynamicMaxHeight: 2160,
}

const AUTO_REDBOOK_THEMES: Array<{
  id: string
  name: string
  nameEn: string
  description: string
  icon: string
  bestFor: string
  themeName: string
  themePrompt: string
  recommended?: boolean
  previewTheme: TemplatePreviewTheme
  pagingMode?: ExportBlueprint['pagingMode']
  autoSplitMaxChars?: number
}> = [
  {
    id: 'social-redbook-sketch',
    name: '手绘笔记组图',
    nameEn: 'Redbook Sketch',
    description: '纸张网格、铅笔线条、红蓝标记笔和便签感批注，适合把知识点整理成亲手画过的社交卡片。',
    icon: '笔',
    bestFor: '学习笔记、方法清单、课程总结、轻松教程',
    themeName: 'sketch',
    recommended: true,
    themePrompt: `
### 主题皮肤：Sketch 手绘素描
- 背景使用米白纸张 #fffef9，可叠加浅灰网格线，形成手账/草稿纸质感。
- 主文字为炭笔黑 #333，强调用红色标记笔 #e74c3c、蓝色圆珠笔 #3498db、黄色荧光笔 #f1c40f。
- 标题可用波浪下划线、虚线分隔、手写批注式标签，但字体仍需清晰可读。
- 引用块像便签纸，可有轻微旋转；正文保持整齐，不要把手绘感做成凌乱感。
`,
    previewTheme: {
      bg: '#fffef9',
      ink: '#333333',
      muted: '#777777',
      accent: '#e74c3c',
      altAccent: '#3498db',
      fontTitle: '"Comic Sans MS", "LXGW WenKai", "PingFang SC", sans-serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"Courier New", monospace',
      motif: 'sketch-note',
      tagline: '纸张网格与手写批注',
      cornerLabel: 'SKETCH 01',
    },
  },
  {
    id: 'social-redbook-playful',
    name: '几何贴纸组图',
    nameEn: 'Playful Geometric',
    description: 'Memphis 几何、奶油底、紫粉黄绿高饱和贴纸块，适合更活泼的教程、清单和趋势解读。',
    icon: '几',
    bestFor: '轻教程、清单内容、趋势观察、生活方式分享',
    themeName: 'playful-geometric',
    themePrompt: `
### 主题皮肤：Playful Geometric 活泼几何
- 背景使用温暖奶油白 #fffdf5，可加入点阵或几何小元素。
- 主色 #8b5cf6，辅助 #f472b6、#fbbf24、#34d399；用于标签、标题块、重点贴纸。
- 标题可用粗边框、硬阴影、非对称圆角和贴纸效果，但页面网格必须稳定。
- 适合短句、清单、步骤；避免整页堆满装饰导致导出时文字拥挤。
`,
    previewTheme: {
      bg: '#fffdf5',
      ink: '#1e293b',
      muted: '#64748b',
      accent: '#8b5cf6',
      altAccent: '#f472b6',
      fontTitle: '"Inter", "PingFang SC", sans-serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"SFMono", "Menlo", monospace',
      motif: 'playful-geometric',
      tagline: 'Memphis 贴纸节奏',
      cornerLabel: 'POP 02',
    },
  },
  {
    id: 'social-redbook-brutal',
    name: '粗野醒目组图',
    nameEn: 'Neo Brutalism',
    description: '厚黑边框、硬阴影、荧光黄/红/青色块，适合强观点、避坑指南和结论先行内容。',
    icon: '粗',
    bestFor: '强观点、避坑指南、产品吐槽、结论型传播',
    themeName: 'neo-brutalism',
    themePrompt: `
### 主题皮肤：Neo-Brutalism 新粗野主义
- 奶油白底 #fffdf5，粗黑边框、硬阴影和高饱和色块构成视觉冲击。
- 强调色可选 #ff4757、#feca57、#00d2d3、#a29bfe，但每张卡控制在 2-3 个主色。
- 标题重字重、直角块面、黑色描边；数据/警示/结论可做成醒目标签。
- 不用柔和渐变、玻璃拟态或大圆角；画面要直接、响亮、可截图传播。
`,
    previewTheme: {
      bg: '#fffdf5',
      ink: '#000000',
      muted: '#3a3a3a',
      accent: '#ff4757',
      altAccent: '#feca57',
      fontTitle: '"Arial Black", "PingFang SC", sans-serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"SFMono", "Menlo", monospace',
      motif: 'neo-brutal',
      tagline: 'RAW · LOUD · DIRECT',
      cornerLabel: 'LOUD 03',
    },
  },
  {
    id: 'social-redbook-botanical',
    name: '植物园组图',
    nameEn: 'Botanical',
    description: '淡绿白底、森林绿、木质棕与舒缓行距，适合知识整理、疗愈内容和自然生活方式。',
    icon: '叶',
    bestFor: '自然生活、疗愈笔记、阅读摘记、温和知识分享',
    themeName: 'botanical',
    themePrompt: `
### 主题皮肤：Botanical 植物园
- 背景使用淡绿白 #f9faf6，文字为深绿灰 #2d3b36。
- 主色森林绿 #4a7c59，辅助淡绿 #8fbc8f、木质棕 #8b7355、暖米白 #e8e4dc。
- 标题用细线、叶脉感分隔、温和留白；正文行高更舒展，适合慢阅读。
- 可使用极简叶形/枝条线条作为分区提示，但不要大量插画化。
`,
    previewTheme: {
      bg: '#f9faf6',
      ink: '#2d3b36',
      muted: '#6f8177',
      accent: '#4a7c59',
      altAccent: '#8b7355',
      fontTitle: '"Noto Serif SC", "Songti SC", serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"SFMono", "Menlo", monospace',
      motif: 'botanical',
      tagline: '自然柔和的知识温度',
      cornerLabel: 'BOTANY 04',
    },
  },
  {
    id: 'social-redbook-professional',
    name: '专业简报组图',
    nameEn: 'Professional',
    description: '白底、专业蓝、三线表和报告式层级，适合商业分析、产品总结、研究摘要的社交化输出。',
    icon: '报',
    bestFor: '商业分析、研究摘要、产品复盘、专业干货',
    themeName: 'professional',
    themePrompt: `
### 主题皮肤：Professional 专业商务
- 纯白底 #ffffff，主文字 #1a202c，强调蓝 #2563eb，浅蓝底 #dbeafe。
- 使用简洁页眉、章节编号、关键结论框、三线表或小型数据图，不做花哨装饰。
- 标题底部可用蓝色细线；脚注、来源、页码必须清晰。
- 适合高信任内容：不要编造数据来源，没有数据时用结构图或要点矩阵。
`,
    previewTheme: {
      bg: '#ffffff',
      ink: '#1a202c',
      muted: '#64748b',
      accent: '#2563eb',
      altAccent: '#93c5fd',
      fontTitle: '"Inter", "PingFang SC", sans-serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"SFMono", "Menlo", monospace',
      motif: 'consulting',
      tagline: '专业简报的社交化表达',
      cornerLabel: 'BRIEF 05',
    },
  },
  {
    id: 'social-redbook-retro',
    name: '复古印刷组图',
    nameEn: 'Retro',
    description: '米黄纸、棕褐文字、复古橙与双线标题，适合怀旧故事、品牌旧事和读书札记。',
    icon: '旧',
    bestFor: '怀旧叙事、品牌故事、读书札记、文化随笔',
    themeName: 'retro',
    themePrompt: `
### 主题皮肤：Retro 复古怀旧
- 背景使用复古米黄 #fdf6e3，文字为棕褐 #5c4033。
- 强调色 #d35400，辅助 #f39c12、#8b4513、#f5deb3；可用双线、虚线、邮戳式标签。
- 标题适合双线下划、旧报纸栏头、复古编号；正文有温暖纸感。
- 保持怀旧而不脏乱，避免咖啡色糊成一片，重点色只用于标题和标签。
`,
    previewTheme: {
      bg: '#fdf6e3',
      ink: '#5c4033',
      muted: '#8b7355',
      accent: '#d35400',
      altAccent: '#f39c12',
      fontTitle: '"Georgia", "Songti SC", serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"Courier New", monospace',
      motif: 'retro-print',
      tagline: '温暖旧纸与复古栏头',
      cornerLabel: 'RETRO 06',
    },
  },
  {
    id: 'social-redbook-terminal',
    name: '黑屏终端组图',
    nameEn: 'Terminal',
    description: '深黑终端、等宽字、绿色命令提示符和代码块，适合技术教程、工具测评和开发者工作流。',
    icon: '⌘',
    bestFor: '技术教程、开源项目、命令行工作流、AI 工具测评',
    themeName: 'terminal',
    recommended: true,
    themePrompt: `
### 主题皮肤：Terminal 黑屏终端
- 背景 #0d1117，主文字 #c9d1d9，终端绿 #39d353，链接蓝 #58a6ff，高亮紫 #a371f7。
- 使用等宽字体、命令行提示符、状态栏、代码片段、日志输出和 ASCII 分隔线。
- 标题可以带 \`#\` / \`##\` 前缀，清单可像命令输出；每张卡保留清楚的技术步骤。
- 不使用暖纸终端风，也不使用彩虹霓虹；保持冷静、清晰、可复制教程感。
`,
    previewTheme: {
      bg: '#0d1117',
      ink: '#c9d1d9',
      muted: '#8b949e',
      accent: '#39d353',
      altAccent: '#58a6ff',
      fontTitle: '"JetBrains Mono", "SFMono", monospace',
      fontBody: '"JetBrains Mono", "SFMono", monospace',
      fontMono: '"JetBrains Mono", "SFMono", monospace',
      motif: 'terminal-dark',
      tagline: '命令行里的技术卡片',
      cornerLabel: '$ xhs --render',
    },
  },
  {
    id: 'social-redbook-clean',
    name: '简约原生组图',
    nameEn: 'Clean Native',
    description: '白底、靛蓝紫、圆角引用和干净层级，保留小红书原生友好的现代简约阅读感。',
    icon: '简',
    bestFor: '通用分享、知识摘要、观点提炼、轻量长文转卡片',
    themeName: 'default',
    themePrompt: `
### 主题皮肤：Default 简约原生
- 白底 #ffffff，文字 #475569 / #1e293b，强调靛蓝紫 #6366f1 和紫罗兰 #8b5cf6。
- 标题、引用、代码和标签保持现代圆角，但圆角克制，投影轻微。
- 适合多数内容的通用社交组图：清楚、干净、有一点平台友好气质。
- 避免全屏大渐变和廉价装饰，优先保证信息层级和导出稳定。
`,
    previewTheme: {
      bg: '#ffffff',
      ink: '#1e293b',
      muted: '#64748b',
      accent: '#6366f1',
      altAccent: '#8b5cf6',
      fontTitle: '"Inter", "PingFang SC", sans-serif',
      fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
      fontMono: '"SFMono", "Menlo", monospace',
      motif: 'clean-native',
      tagline: '干净稳定的社交组图',
      cornerLabel: 'CARD 08',
    },
    pagingMode: 'auto-split',
    autoSplitMaxChars: 700,
  },
]

const AUTO_REDBOOK_SOCIAL_TEMPLATES: OutputTemplate[] = AUTO_REDBOOK_THEMES.map((theme) => ({
  id: theme.id,
  name: theme.name,
  nameEn: theme.nameEn,
  mode: 'social',
  scenario: 'sharing',
  description: theme.description,
  icon: theme.icon,
  designConstraints: SHARED_DESIGN_CONSTRAINTS + AUTO_REDBOOK_BASE_PROMPT + theme.themePrompt,
  skillPrompt: AUTO_REDBOOK_BASE_PROMPT + theme.themePrompt,
  outputHint: `生成 ${theme.themeName} 主题的 3:4 社交传播组图 HTML，使用 Auto-Redbook 统一卡片结构并支持智能卡片导出`,
  bestFor: theme.bestFor,
  recommended: theme.recommended,
  features: ['小红书组图', '3:4', theme.pagingMode === 'auto-split' ? '自动拆分' : '自动适配'],
  outputTargets: ['PNG 组图', 'ZIP'],
  previewTone: `auto-redbook-${theme.themeName}`,
  previewTheme: theme.previewTheme,
  sizePresets: ['3:4', '1:1'],
  exportBlueprint: {
    ...AUTO_REDBOOK_EXPORT_BLUEPRINT,
    pagingMode: theme.pagingMode ?? AUTO_REDBOOK_EXPORT_BLUEPRINT.pagingMode,
    autoSplitMaxChars: theme.autoSplitMaxChars ?? AUTO_REDBOOK_EXPORT_BLUEPRINT.autoSplitMaxChars,
  },
}))

const CREATIVE_SERIES_BASE_PROMPT = `
## 创意设计集成规范

能力来源：本模板提炼自本地创意设计工作流与 workflow、design-context、design-styles、content-guidelines、slide-decks、tweaks-system、animations、video-export、verification、critique-guide 等规范。智能排版直接生成浏览器可预览的 HTML 源产物；PPTX、MP4、GIF、BGM 等脚本链路属于本地创意导出能力，必须在 HTML 注释中写清可执行导出配方，不能在页面可见区域假装已经导出。

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
- 在 HTML 顶部注释写清：当前智能排版可直接预览 HTML，并可走现有 PPTX/PDF 导出；真文本框可编辑 PPTX 需本地 scripts/export_deck_pptx.mjs 链路。
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
- 在 HTML 顶部注释写清：当前智能排版可直接预览 HTML，并可走现有 PPTX/PDF 导出；真文本框可编辑 PPTX 需本地 scripts/export_deck_pptx.mjs 链路。
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
- 在 HTML 注释中附导出配方：25fps MP4、60fps 插帧、palette 优化 GIF、BGM/SFX cue list。当前智能排版生成 HTML 源，视频/BGM 需本地 video-export 脚本链路。
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
- 在 HTML 注释中附导出配方：25fps MP4、60fps 插帧、palette 优化 GIF、BGM/SFX cue list。当前智能排版生成 HTML 源，视频/BGM 需本地 video-export 脚本链路。
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
- 页面必须能整页导出，也要声明关键图表选择器，便于智能排版卡片导出。
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
- 页面必须能整页导出，也要声明关键图表选择器，便于智能排版卡片导出。
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
  ...CREATIVE_SERIES_TEMPLATES,

  // === 一、社交传播类 ===
  ...AUTO_REDBOOK_SOCIAL_TEMPLATES,
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

  {
    id: 'social-editorial',
    name: '杂志风',
    nameEn: 'Editorial',
    mode: 'social',
    scenario: 'sharing',
    description: '纸刊仪式感：大号衬线刊头、首字下沉、双栏排版、栏目标签与刊号，像《单读》《T Magazine》的小红书封面',
    icon: '📰',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：纸刊的仪式感
这不是"加个衬线字体"的卡片，而是真正复刻一本设计杂志的版面节奏。读者第一眼应该觉得"这是一本可以翻的刊物"，而不是"一张社交卡片"。

## 自主规划要求（不要套固定结构）
由你根据内容自主决定每张卡的页面任务（封面/目录/正文对页/引文页/数据栏/结尾），但必须遵守下面的视觉契约。

## 色彩令牌
- 纸白底 #faf8f3，主墨 #111，副墨 #555，浅墨 #8d8a84
- 发丝分隔线 #e4e0d7，强调用单一朱红 #c0392b（仅用于栏目标或重点词下划线，不大面积铺色）
- 禁止渐变、禁止鲜彩、禁止深色块背景

## 字体系统
- 中文标题：宋体衬线大字（Songti SC / Noto Serif SC / STSong），可使用 60-90px 的刊头级字号
- 中文正文：PingFang SC / Noto Sans SC
- 数字/刊号/页码：等宽字（SFMono / Menlo），如 "ISSUE 042 · 2026"
- 英文刊名：Cormorant / EB Garamond 衬线斜体

## 构图语言
- 双栏或三栏排版，栏间用 1px 发丝线分隔
- 首字下沉（drop cap）：正文首字放大 3-4 倍衬线字
- 栏目标签：左上角 "COLUMN / 栏目名"，右上角页码 "P.04"
- 引文用大号衬线斜体独立成块，前后留白
- 刊头：大字号衬线 + 一条粗水平线 + 一条细水平线（双线刊头）

## 页面节奏建议
- 封面：超大刊头 + 一句副标 + 期号
- 内页：双栏正文 + 栏目标 + 引文块
- 数据页：杂志式数据卡，数字用 Georgia 衬线大字

## 避免项（防止风格趋同）
- 不要用圆角卡片堆叠（那是小红书默认风）
- 不要用 emoji 作装饰
- 不要用渐变背景或毛玻璃
- 不要把标题居中堆叠——杂志是网格的，不是居中的
- 标题不使用无衬线
`,
    skillPrompt: `

## 视觉灵魂：纸刊的仪式感
这不是"加个衬线字体"的卡片，而是真正复刻一本设计杂志的版面节奏。读者第一眼应该觉得"这是一本可以翻的刊物"，而不是"一张社交卡片"。

## 自主规划要求（不要套固定结构）
由你根据内容自主决定每张卡的页面任务（封面/目录/正文对页/引文页/数据栏/结尾），但必须遵守下面的视觉契约。

## 色彩令牌
- 纸白底 #faf8f3，主墨 #111，副墨 #555，浅墨 #8d8a84
- 发丝分隔线 #e4e0d7，强调用单一朱红 #c0392b（仅用于栏目标或重点词下划线，不大面积铺色）
- 禁止渐变、禁止鲜彩、禁止深色块背景

## 字体系统
- 中文标题：宋体衬线大字（Songti SC / Noto Serif SC / STSong），可使用 60-90px 的刊头级字号
- 中文正文：PingFang SC / Noto Sans SC
- 数字/刊号/页码：等宽字（SFMono / Menlo），如 "ISSUE 042 · 2026"
- 英文刊名：Cormorant / EB Garamond 衬线斜体

## 构图语言
- 双栏或三栏排版，栏间用 1px 发丝线分隔
- 首字下沉（drop cap）：正文首字放大 3-4 倍衬线字
- 栏目标签：左上角 "COLUMN / 栏目名"，右上角页码 "P.04"
- 引文用大号衬线斜体独立成块，前后留白
- 刊头：大字号衬线 + 一条粗水平线 + 一条细水平线（双线刊头）

## 页面节奏建议
- 封面：超大刊头 + 一句副标 + 期号
- 内页：双栏正文 + 栏目标 + 引文块
- 数据页：杂志式数据卡，数字用 Georgia 衬线大字

## 避免项（防止风格趋同）
- 不要用圆角卡片堆叠（那是小红书默认风）
- 不要用 emoji 作装饰
- 不要用渐变背景或毛玻璃
- 不要把标题居中堆叠——杂志是网格的，不是居中的
- 标题不使用无衬线
`,
    previewTheme: {
    bg: '#faf8f3',
    ink: '#111111',
    muted: '#8d8a84',
    accent: '#c0392b',
    fontTitle: '"Songti SC", "Noto Serif SC", "STSong", serif',
    fontBody: '"PingFang SC", "Noto Sans SC", sans-serif',
    fontMono: '"SFMono", "Menlo", monospace',
    motif: 'editorial',
    tagline: '纸刊的仪式感',
    cornerLabel: 'ISSUE 042 · 2026',
  },
    outputHint: '生成纸刊仪式感、双栏衬线主导的小红书杂志封面卡组',
    bestFor: '观点文章封面、深度内容封面、品牌随笔、文化类小红书封面',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.editorial-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-geek-report',
    name: '极客风格',
    nameEn: 'Geek Report',
    mode: 'social',
    scenario: 'sharing',
    description: '终端屏幕的冷峻：纯黑底 + 荧光绿/青等宽字 + ASCII 边框 + 命令行交互，hacker 美学的小红书技术封面',
    icon: '🛠️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：终端屏幕的冷峻
读者第一眼应该觉得"这是从某个终端 / IDE / 监控面板里截出来的画面"，而不是"一张加了等宽字体的卡片"。整个画面要像 CRT 屏幕或现代代码编辑器：高对比、信息密集、有命令行交互痕迹。

## 自主规划要求
由你根据内容自主决定页面任务（终端启动屏/命令输出页/代码解析页/对比矩阵页/状态面板/结束页），但必须维持终端式视觉契约。

## 色彩令牌
- 纯黑或近黑底 #0a0a0a / #000
- 主文字：荧光绿 #00ff9c 或薄荷青 #7fffd4（择一为主，不混用）
- 副文字：雾灰 #8ba5ba、暗银 #a8b3bd
- 警示：琥珀 #f4be64（warning）、朱红 #ff5555（error）、电光蓝 #5fb3f7（info）
- 行号/注释：暗灰 #4a5560
- 禁止彩虹色、禁止暖色调、禁止纸感底色

## 字体系统
- 全局等宽：JetBrains Mono / SF Mono / Consolas / Menlo
- CJK：等宽中文（Hiragino Sans GB / Sarasa Mono），若无则 PingFang SC 但保持等宽气质
- 标题用大号等宽 + 全大写英文 + 编号，如 "01_BUILD_LOG"

## 构图语言
- ASCII 边框：+- Raiders of the Lost Ark 式边框 ─┐ └┘
- 命令行提示符：$ / > / # 作为段落引导
- 代码块：语法高亮（关键字/字符串/注释不同色），行号
- 状态行：底部 status bar 显示分支、时间、CPU 等 mock 数据
- 标签：[TAG] / {KEY} / <ARG> 方括号语法

## 页面节奏建议
- 封面：终端启动画面 + 大号 ASCII 标题
- 内容页：命令输出 + 注解
- 对比页：左右双终端对比
- 数据页：监控面板式 KPI 网格

## 避免项
- 不要用纸感暖底（那是另一个风格）
- 不要用衬线字体
- 不要用圆角卡片——终端是直角的
- 不要堆 emoji
- 不要让画面"温柔"——极客风是冷的、硬的、高对比的
`,
    skillPrompt: `

## 视觉灵魂：终端屏幕的冷峻
读者第一眼应该觉得"这是从某个终端 / IDE / 监控面板里截出来的画面"，而不是"一张加了等宽字体的卡片"。整个画面要像 CRT 屏幕或现代代码编辑器：高对比、信息密集、有命令行交互痕迹。

## 自主规划要求
由你根据内容自主决定页面任务（终端启动屏/命令输出页/代码解析页/对比矩阵页/状态面板/结束页），但必须维持终端式视觉契约。

## 色彩令牌
- 纯黑或近黑底 #0a0a0a / #000
- 主文字：荧光绿 #00ff9c 或薄荷青 #7fffd4（择一为主，不混用）
- 副文字：雾灰 #8ba5ba、暗银 #a8b3bd
- 警示：琥珀 #f4be64（warning）、朱红 #ff5555（error）、电光蓝 #5fb3f7（info）
- 行号/注释：暗灰 #4a5560
- 禁止彩虹色、禁止暖色调、禁止纸感底色

## 字体系统
- 全局等宽：JetBrains Mono / SF Mono / Consolas / Menlo
- CJK：等宽中文（Hiragino Sans GB / Sarasa Mono），若无则 PingFang SC 但保持等宽气质
- 标题用大号等宽 + 全大写英文 + 编号，如 "01_BUILD_LOG"

## 构图语言
- ASCII 边框：+- Raiders of the Lost Ark 式边框 ─┐ └┘
- 命令行提示符：$ / > / # 作为段落引导
- 代码块：语法高亮（关键字/字符串/注释不同色），行号
- 状态行：底部 status bar 显示分支、时间、CPU 等 mock 数据
- 标签：[TAG] / {KEY} / <ARG> 方括号语法

## 页面节奏建议
- 封面：终端启动画面 + 大号 ASCII 标题
- 内容页：命令输出 + 注解
- 对比页：左右双终端对比
- 数据页：监控面板式 KPI 网格

## 避免项
- 不要用纸感暖底（那是另一个风格）
- 不要用衬线字体
- 不要用圆角卡片——终端是直角的
- 不要堆 emoji
- 不要让画面"温柔"——极客风是冷的、硬的、高对比的
`,
    previewTheme: {
    bg: '#0a0a0a',
    ink: '#e5e5e5',
    muted: '#7a7a7a',
    accent: '#00ff9c',
    altAccent: '#4a9eff',
    fontTitle: '"JetBrains Mono", "SFMono", monospace',
    fontBody: '"JetBrains Mono", "SFMono", monospace',
    fontMono: '"JetBrains Mono", "SFMono", monospace',
    motif: 'terminal-dark',
    tagline: '终端屏幕的冷峻',
    cornerLabel: '~/xhs $',
  },
    outputHint: '生成纯黑底、荧光绿、终端交互感的极客技术封面卡组',
    bestFor: '开发者工具实测、AI 工具技术封面、开源项目分享、命令行工作流',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.geek-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-consulting-report',
    name: '咨询报告',
    nameEn: 'Consulting Report',
    mode: 'social',
    scenario: 'sharing',
    description: '咨询机构的权威感：海军蓝 + 金线 + Georgia 衬线数字 + 战略框架图 + 来源标注，麦肯锡式的小红书行业研究封面',
    icon: '📑',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：咨询机构的权威感
读者第一眼应该觉得"这是从一份麦肯锡 / BCG / 贝恩的报告里撕下来的页面"，而不是"一张蓝色背景的卡片"。要传递出严谨、可信、有数据支撑的专业感。

## 自主规划要求
由你根据内容自主决定页面任务（执行摘要/市场规模/竞争格局/战略框架/财务模型/结论建议），但必须维持咨询报告的视觉契约。

## 色彩令牌
- 深海军蓝主底 #1b2a4a / #151f35（仅用于封面/章节页）
- 内容页用米白底 #faf8f3 + 海军蓝字
- 强调色：青蓝 #00a9f4 / #4fc3f7（用于数据高亮）
- 金属金 #c9a96e（用于细分隔线、章节编号）
- 数据红绿：#c0392b / #27ae60（仅用于增减箭头）
- 禁止鲜彩、禁止渐变、禁止荧光色

## 字体系统
- 标题：Noto Serif SC / Source Han Serif（衬线传递权威）
- 正文：PingFang SC / Noto Sans SC
- 数字：Georgia / Times New Roman 衬线数字（KPI 必须用衬线数字，不用等宽）
- 来源/脚注：等宽小字，如 "Source: 工信部 2026Q1"

## 构图语言
- 顶部页眉：左 LOGO 占位 + 中章节名 + 右页码 "01 / 08"
- 战略框架：2x2 矩阵、3 层金字塔、SWOT 四象限、价值链横向流程
- 数据图：柱状/折线/瀑布图，数据标签清晰
- 表格：三线表（顶线/表头线/底线），无竖线
- 来源标注：每张图下脚注来源

## 页面节奏建议
- 封面：深蓝底 + 白色衬线大标题 + 报告编号
- 执行摘要：米白底 + 3 条 Key Insight
- 数据页：图表 + 解读 + 来源
- 框架页：战略矩阵 + 象限标注

## 避免项
- 不要用荧光色或亮蓝（那是科技风不是咨询风）
- 不要用等宽字作正文
- 不要无来源地堆数字
- 不要圆角卡片——咨询报告是方正的、严肃的
- 不要 emoji
`,
    skillPrompt: `

## 视觉灵魂：咨询机构的权威感
读者第一眼应该觉得"这是从一份麦肯锡 / BCG / 贝恩的报告里撕下来的页面"，而不是"一张蓝色背景的卡片"。要传递出严谨、可信、有数据支撑的专业感。

## 自主规划要求
由你根据内容自主决定页面任务（执行摘要/市场规模/竞争格局/战略框架/财务模型/结论建议），但必须维持咨询报告的视觉契约。

## 色彩令牌
- 深海军蓝主底 #1b2a4a / #151f35（仅用于封面/章节页）
- 内容页用米白底 #faf8f3 + 海军蓝字
- 强调色：青蓝 #00a9f4 / #4fc3f7（用于数据高亮）
- 金属金 #c9a96e（用于细分隔线、章节编号）
- 数据红绿：#c0392b / #27ae60（仅用于增减箭头）
- 禁止鲜彩、禁止渐变、禁止荧光色

## 字体系统
- 标题：Noto Serif SC / Source Han Serif（衬线传递权威）
- 正文：PingFang SC / Noto Sans SC
- 数字：Georgia / Times New Roman 衬线数字（KPI 必须用衬线数字，不用等宽）
- 来源/脚注：等宽小字，如 "Source: 工信部 2026Q1"

## 构图语言
- 顶部页眉：左 LOGO 占位 + 中章节名 + 右页码 "01 / 08"
- 战略框架：2x2 矩阵、3 层金字塔、SWOT 四象限、价值链横向流程
- 数据图：柱状/折线/瀑布图，数据标签清晰
- 表格：三线表（顶线/表头线/底线），无竖线
- 来源标注：每张图下脚注来源

## 页面节奏建议
- 封面：深蓝底 + 白色衬线大标题 + 报告编号
- 执行摘要：米白底 + 3 条 Key Insight
- 数据页：图表 + 解读 + 来源
- 框架页：战略矩阵 + 象限标注

## 避免项
- 不要用荧光色或亮蓝（那是科技风不是咨询风）
- 不要用等宽字作正文
- 不要无来源地堆数字
- 不要圆角卡片——咨询报告是方正的、严肃的
- 不要 emoji
`,
    previewTheme: {
    bg: '#1b2a4a',
    ink: '#f5f1e8',
    muted: '#a8b3c7',
    accent: '#c9a96e',
    fontTitle: '"Georgia", "Songti SC", serif',
    fontBody: '"PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif',
    fontMono: '"Georgia", serif',
    motif: 'consulting',
    tagline: '咨询机构的权威感',
    cornerLabel: 'EXHIBIT 03',
  },
    outputHint: '生成海军蓝、衬线数字、战略框架驱动的咨询报告封面卡组',
    bestFor: '行业研究封面、执行摘要封面、咨询报告、高信任商业内容',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.consulting-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-clean-review',
    name: '简约测评',
    nameEn: 'Clean Review',
    mode: 'social',
    scenario: 'sharing',
    description: '结论先行的决断力：奶油底 + 超大评分数字 + 红绿 verdict + 对比矩阵，Wirecutter 式的极简测评封面',
    icon: '⚖️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：结论先行的决断力
读者第一眼就要看到"推荐 / 不推荐 / 8.5 分"这样的明确结论。这不是温柔的内容卡片，而是一份冷静、克制、敢下判断的测评报告。视觉上要让结论数字和 verdict 标签成为绝对主角。

## 自主规划要求
由你根据内容自主决定页面任务（总评/分项评分/优缺点/对比矩阵/场景推荐/购买建议），但必须维持"结论先行"的视觉契约。

## 色彩令牌
- 奶油主底 #f2f0ec / #f8f6f1
- 主墨 #1a1a18 / #111110
- 副灰 #77766e
- 推荐绿 #2d8659 / #27ae60（仅用于推荐 verdict）
- 警示红 #c0392b / #e8382a（仅用于不推荐/缺点）
- 中性琥珀 #d4a017（用于"看情况"）
- 禁止渐变、禁止多彩、禁止装饰性插图

## 字体系统
- 评分数字：超大无衬线（120-180px），PingFang SC / Inter / SF Pro，字重 Black 或 Bold
- 标题：PingFang SC / Noto Sans SC，大号无衬线
- 正文：同上，但字号克制
- 标签：全大写无衬线 + 字距，如 "RECOMMENDED" / "BEST FOR"

## 构图语言
- Verdict 卡片：顶部超大评分数字 + 下方红绿标签条
- 优缺点：左右双栏 ✓ 绿色 / ✗ 红色（仅此处用 emoji 替代符号也可）
- 对比矩阵：表格形式，行=产品，列=维度，单元格用 ● ○ ✕ 评分
- 维度条：水平进度条 + 分数标签

## 页面节奏建议
- 封面：超大评分 + 产品名 + 一句结论
- 分项页：雷达图或维度条
- 对比页：矩阵表
- 场景页："适合谁 / 不适合谁"

## 避免项
- 不要温柔——测评要有判断力
- 不要用衬线字体（那是杂志风）
- 不要用深色背景（测评要冷静明亮）
- 不要把优缺点藏起来——它们是主角
- 评分数字必须够大，不能小里小气
`,
    skillPrompt: `

## 视觉灵魂：结论先行的决断力
读者第一眼就要看到"推荐 / 不推荐 / 8.5 分"这样的明确结论。这不是温柔的内容卡片，而是一份冷静、克制、敢下判断的测评报告。视觉上要让结论数字和 verdict 标签成为绝对主角。

## 自主规划要求
由你根据内容自主决定页面任务（总评/分项评分/优缺点/对比矩阵/场景推荐/购买建议），但必须维持"结论先行"的视觉契约。

## 色彩令牌
- 奶油主底 #f2f0ec / #f8f6f1
- 主墨 #1a1a18 / #111110
- 副灰 #77766e
- 推荐绿 #2d8659 / #27ae60（仅用于推荐 verdict）
- 警示红 #c0392b / #e8382a（仅用于不推荐/缺点）
- 中性琥珀 #d4a017（用于"看情况"）
- 禁止渐变、禁止多彩、禁止装饰性插图

## 字体系统
- 评分数字：超大无衬线（120-180px），PingFang SC / Inter / SF Pro，字重 Black 或 Bold
- 标题：PingFang SC / Noto Sans SC，大号无衬线
- 正文：同上，但字号克制
- 标签：全大写无衬线 + 字距，如 "RECOMMENDED" / "BEST FOR"

## 构图语言
- Verdict 卡片：顶部超大评分数字 + 下方红绿标签条
- 优缺点：左右双栏 ✓ 绿色 / ✗ 红色（仅此处用 emoji 替代符号也可）
- 对比矩阵：表格形式，行=产品，列=维度，单元格用 ● ○ ✕ 评分
- 维度条：水平进度条 + 分数标签

## 页面节奏建议
- 封面：超大评分 + 产品名 + 一句结论
- 分项页：雷达图或维度条
- 对比页：矩阵表
- 场景页："适合谁 / 不适合谁"

## 避免项
- 不要温柔——测评要有判断力
- 不要用衬线字体（那是杂志风）
- 不要用深色背景（测评要冷静明亮）
- 不要把优缺点藏起来——它们是主角
- 评分数字必须够大，不能小里小气
`,
    previewTheme: {
    bg: '#f2f0ec',
    ink: '#0e0e0e',
    muted: '#8a8780',
    accent: '#c0392b',
    altAccent: '#2e7d32',
    fontTitle: '"Helvetica Neue", "Inter", "PingFang SC", sans-serif',
    fontBody: '"PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif',
    fontMono: '"SFMono", "Menlo", monospace',
    motif: 'review-score',
    tagline: '结论先行的决断力',
    cornerLabel: 'VERDICT',
  },
    outputHint: '生成奶油底、超大评分、结论先行的极简测评封面卡组',
    bestFor: '产品测评封面、AI 工具实测、对比横评、好物清单',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.review-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-terminal',
    name: '终端风',
    nameEn: 'Terminal',
    mode: 'social',
    scenario: 'sharing',
    description: '老式终端打印纸的暖意：暖灰纸底 + 深褐等宽字 + 打字机排版 + 命令行流程 + stdout 输出块',
    icon: '🖥️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：老式终端打印纸的暖意
区别于"极客风格"的冷峻黑底荧光绿，这是 70-80 年代行式打印机 / 老式终端的暖纸质感——像热敏纸、像电传打字机输出。读者第一眼应该觉得"这是一卷刚从终端打印机里出来的纸"，带温度、带历史感、带工程师的手作气质。

## 自主规划要求
由你根据内容自主决定页面任务（登录会话/命令序列/输出日志/任务清单/错误处理/退出总结），但必须维持"打印纸"的视觉契约。

## 色彩令牌
- 暖纸底 #e8e6e2 / #f3f2ef（带轻微颗粒/扫描线纹理）
- 主字：深褐 #2f2f2f / #3a342c（不是纯黑，是墨水渗进纸的褐）
- 副字：柔褐 rgba(47,47,47,0.58)
- 强调：暗朱 #a04030 / 老式绿 #5a7a4a
- 禁止荧光色、禁止纯黑底、禁止冷色调

## 字体系统
- 全局等宽：SFMono / Consolas / Courier New / Menlo（必须等宽，传递打字机感）
- CJK：PingFang SC 但保持紧凑节奏
- 标题可用 Arial Black 大号作"标题印刷感"，但主体仍是等宽
- 所有文字带极轻微的 letter-spacing 模拟字距

## 构图语言
- 顶部 banner：模拟终端标题栏 "SESSION 2026-04-23 · TASK: xxx"
- 命令提示符：$ / > / # 引导每一段
- stdout 块：用边框框起来的输出区，等宽字
- 任务清单：[ ] 未完成 / [x] 已完成（box-drawing 字符）
- 进度条：ASCII 风格 [####------] 40%
- 分隔线：===== 或 ----- 字符

## 页面节奏建议
- 封面：终端登录画面 + 任务标题
- 内容页：命令 + 输出 + 注解
- 清单页：任务列表 box
- 结束页：logout + summary

## 避免项
- 不要和"极客风格"混淆——这个是暖纸，那个是黑屏
- 不要用衬线字体
- 不要用鲜彩
- 不要现代化过度——保留一点 80 年代的笨拙感
- 不要圆角卡片——纸是直角的
`,
    skillPrompt: `

## 视觉灵魂：老式终端打印纸的暖意
区别于"极客风格"的冷峻黑底荧光绿，这是 70-80 年代行式打印机 / 老式终端的暖纸质感——像热敏纸、像电传打字机输出。读者第一眼应该觉得"这是一卷刚从终端打印机里出来的纸"，带温度、带历史感、带工程师的手作气质。

## 自主规划要求
由你根据内容自主决定页面任务（登录会话/命令序列/输出日志/任务清单/错误处理/退出总结），但必须维持"打印纸"的视觉契约。

## 色彩令牌
- 暖纸底 #e8e6e2 / #f3f2ef（带轻微颗粒/扫描线纹理）
- 主字：深褐 #2f2f2f / #3a342c（不是纯黑，是墨水渗进纸的褐）
- 副字：柔褐 rgba(47,47,47,0.58)
- 强调：暗朱 #a04030 / 老式绿 #5a7a4a
- 禁止荧光色、禁止纯黑底、禁止冷色调

## 字体系统
- 全局等宽：SFMono / Consolas / Courier New / Menlo（必须等宽，传递打字机感）
- CJK：PingFang SC 但保持紧凑节奏
- 标题可用 Arial Black 大号作"标题印刷感"，但主体仍是等宽
- 所有文字带极轻微的 letter-spacing 模拟字距

## 构图语言
- 顶部 banner：模拟终端标题栏 "SESSION 2026-04-23 · TASK: xxx"
- 命令提示符：$ / > / # 引导每一段
- stdout 块：用边框框起来的输出区，等宽字
- 任务清单：[ ] 未完成 / [x] 已完成（box-drawing 字符）
- 进度条：ASCII 风格 [####------] 40%
- 分隔线：===== 或 ----- 字符

## 页面节奏建议
- 封面：终端登录画面 + 任务标题
- 内容页：命令 + 输出 + 注解
- 清单页：任务列表 box
- 结束页：logout + summary

## 避免项
- 不要和"极客风格"混淆——这个是暖纸，那个是黑屏
- 不要用衬线字体
- 不要用鲜彩
- 不要现代化过度——保留一点 80 年代的笨拙感
- 不要圆角卡片——纸是直角的
`,
    previewTheme: {
    bg: '#e8e6e2',
    ink: '#2f2f2f',
    muted: '#6e6a64',
    accent: '#8b4513',
    fontTitle: '"Courier New", "Source Code Pro", monospace',
    fontBody: '"Courier New", "Source Code Pro", monospace',
    fontMono: '"Courier New", "Source Code Pro", monospace',
    motif: 'terminal-warm',
    tagline: '老式终端打印纸的暖意',
    cornerLabel: 'TTY 01 · LOG',
  },
    outputHint: '生成暖纸底、深褐等宽、老式终端打印纸感的封面卡组',
    bestFor: '终端风封面、命令行工作流、任务执行测评、复古极客内容',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.terminal-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-story-field',
    name: '故事集',
    nameEn: 'Story Field',
    mode: 'social',
    scenario: 'sharing',
    description: '胶片档案的安静奢华：石色底 + 暖驼沙 + 衬线斜体引文 + 分镜格 + 罗马数字章节 + 颗粒噪点',
    icon: '🗺️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：胶片档案的安静奢华
读者第一眼应该觉得"这是一份从某个影像工作室 / 田野调查档案柜里抽出来的资料"，带电影感、带叙事性、带克制的奢华。不要热闹，不要鲜艳，要像《National Geographic》或 Wes Anderson 电影的安静时刻。

## 自主规划要求
由你根据内容自主决定页面任务（封面/场景设定/人物或产品登场/过程展开/转折/收束/档案附录），但必须维持"影像档案"的视觉契约。

## 色彩令牌
- 浅米石底 #f4efe6 / #ede6d8（带轻微胶片颗粒）
- 主字：深石 #2c2824 / #1f1c18
- 副字：柔石 rgba(44,40,36,0.62)
- 强调：暖沙驼 #a89474 / #b89968（用于章节编号、引文、细线）
- 深色块可选：石黑 #1a1714（仅用于章节扉页）
- 禁止鲜彩、禁止荧光、禁止渐变

## 字体系统
- 标题：Songti SC / Noto Serif CJK SC / Cormorant Garamond 衬线大字
- 正文：PingFang SC / Noto Sans CJK SC
- 引文：衬线斜体（Cormorant / EB Garamond Italic）
- 章节编号：罗马数字 Ⅰ Ⅱ Ⅲ 用衬线大字

## 构图语言
- 分镜格：把页面分割成 2-4 个不等大的格子，像电影分镜（一大一小、上下错落）
- 章节扉页：纯石色底 + 居中罗马数字 + 一句章节标题
- 引文块：大号衬线斜体 + 上下留白 + 细沙驼线
- 图位：留出大量图位（即使无图也保留 frame，标注 "FRAME 01"）
- 颗粒：整页轻微胶片噪点（opacity 极低）

## 页面节奏建议
- 封面：石色底 + 衬线大标题 + 副标 + 期号
- 场景页：宽幅图位 + 一段场景描写
- 转折页：引文独立成页
- 附录页：档案式列表 + 来源

## 避免项
- 不要热闹——这是安静叙事
- 不要无衬线字体作标题
- 不要鲜彩或荧光
- 不要居中堆叠——故事集是分镜的、错落的
- 不要现代感过强——保留一点档案柜的旧意
`,
    skillPrompt: `

## 视觉灵魂：胶片档案的安静奢华
读者第一眼应该觉得"这是一份从某个影像工作室 / 田野调查档案柜里抽出来的资料"，带电影感、带叙事性、带克制的奢华。不要热闹，不要鲜艳，要像《National Geographic》或 Wes Anderson 电影的安静时刻。

## 自主规划要求
由你根据内容自主决定页面任务（封面/场景设定/人物或产品登场/过程展开/转折/收束/档案附录），但必须维持"影像档案"的视觉契约。

## 色彩令牌
- 浅米石底 #f4efe6 / #ede6d8（带轻微胶片颗粒）
- 主字：深石 #2c2824 / #1f1c18
- 副字：柔石 rgba(44,40,36,0.62)
- 强调：暖沙驼 #a89474 / #b89968（用于章节编号、引文、细线）
- 深色块可选：石黑 #1a1714（仅用于章节扉页）
- 禁止鲜彩、禁止荧光、禁止渐变

## 字体系统
- 标题：Songti SC / Noto Serif CJK SC / Cormorant Garamond 衬线大字
- 正文：PingFang SC / Noto Sans CJK SC
- 引文：衬线斜体（Cormorant / EB Garamond Italic）
- 章节编号：罗马数字 Ⅰ Ⅱ Ⅲ 用衬线大字

## 构图语言
- 分镜格：把页面分割成 2-4 个不等大的格子，像电影分镜（一大一小、上下错落）
- 章节扉页：纯石色底 + 居中罗马数字 + 一句章节标题
- 引文块：大号衬线斜体 + 上下留白 + 细沙驼线
- 图位：留出大量图位（即使无图也保留 frame，标注 "FRAME 01"）
- 颗粒：整页轻微胶片噪点（opacity 极低）

## 页面节奏建议
- 封面：石色底 + 衬线大标题 + 副标 + 期号
- 场景页：宽幅图位 + 一段场景描写
- 转折页：引文独立成页
- 附录页：档案式列表 + 来源

## 避免项
- 不要热闹——这是安静叙事
- 不要无衬线字体作标题
- 不要鲜彩或荧光
- 不要居中堆叠——故事集是分镜的、错落的
- 不要现代感过强——保留一点档案柜的旧意
`,
    previewTheme: {
    bg: '#f4efe6',
    ink: '#3a3530',
    muted: '#a89474',
    accent: '#a89474',
    fontTitle: '"Cormorant", "Songti SC", serif',
    fontBody: '"PingFang SC", "Noto Sans SC", "Cormorant", serif',
    fontMono: '"Cormorant", "EB Garamond", serif',
    motif: 'storyboard',
    tagline: '胶片档案的安静奢华',
    cornerLabel: 'VOL. I',
  },
    outputHint: '生成石色底、暖驼沙、分镜叙事的胶片档案封面卡组',
    bestFor: '故事化案例封面、项目复盘、田野调查、安静品牌叙事',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.story-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
  },
  {
    id: 'social-dot-matrix',
    name: '点阵编辑风',
    nameEn: 'Dot Matrix',
    mode: 'social',
    scenario: 'sharing',
    description: '信号场的编辑感：浅纸底 + 点阵网格 + 信号波形 + 刻度尺 + 宋体大标题 + 数据节点标注',
    icon: '📡',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
## 视觉灵魂：信号场的编辑感
读者第一眼应该觉得"这是一个技术编辑 / 数据记者的工作面板"，背景是点阵网格（像工程图纸或示波器屏幕），上面飘着信号波形、刻度尺、数据节点。既有编辑的严谨，又有数据的活力，但不喧闹。

## 自主规划要求
由你根据内容自主决定页面任务（信号总览/节点解析/波形对比/趋势曲线/异常标记/结论收束），但必须维持"点阵场域"的视觉契约。

## 色彩令牌
- 浅纸底 #deded9 / #e8e7e1（必须叠加点阵网格 pattern）
- 主字：墨 #24221f
- 副字：quiet 灰 rgba(36,34,31,0.62)
- 网格线：极淡 rgba(36,34,31,0.055)（点阵或方阵）
- 发丝线：rgba(36,34,31,0.16)
- 强调：暗琥珀 #b8864a / 信号青 #4a7a8c（用于数据高亮和波形）
- 禁止鲜彩、禁止渐变、禁止深色背景

## 字体系统
- 标题：Songti SC / Noto Serif CJK SC 衬线大字（编辑感的灵魂）
- 正文：PingFang SC / Noto Sans CJK SC
- 数据/标签/坐标：等宽（SFMono / Consolas），如 "SIG_01 · 0.84"

## 构图语言
- 全屏点阵网格背景（CSS background-image: radial-gradient 圆点矩阵，或 SVG pattern）
- 信号波形：SVG path 绘制的折线/曲线，配坐标轴
- 数据节点：圆点 + 引线标注 + 等宽标签
- 刻度尺：顶部或左侧的工程刻度
- 卡片：无边框，靠点阵背景分区，用细发丝线划界

## 页面节奏建议
- 封面：点阵底 + 衬线大标题 + 一条主信号波形
- 节点页：单个数据点放大解析
- 对比页：双波形叠加
- 结论页：信号收敛/发散示意

## 避免项
- 不要无衬线标题（衬线是这个风格的编辑灵魂）
- 不要纯白底——必须有点阵网格
- 不要鲜彩——这是技术编辑，不是科技 demo
- 不要圆角卡片堆叠
- 波形/数据不能是装饰，必须与内容关联
`,
    skillPrompt: `

## 视觉灵魂：信号场的编辑感
读者第一眼应该觉得"这是一个技术编辑 / 数据记者的工作面板"，背景是点阵网格（像工程图纸或示波器屏幕），上面飘着信号波形、刻度尺、数据节点。既有编辑的严谨，又有数据的活力，但不喧闹。

## 自主规划要求
由你根据内容自主决定页面任务（信号总览/节点解析/波形对比/趋势曲线/异常标记/结论收束），但必须维持"点阵场域"的视觉契约。

## 色彩令牌
- 浅纸底 #deded9 / #e8e7e1（必须叠加点阵网格 pattern）
- 主字：墨 #24221f
- 副字：quiet 灰 rgba(36,34,31,0.62)
- 网格线：极淡 rgba(36,34,31,0.055)（点阵或方阵）
- 发丝线：rgba(36,34,31,0.16)
- 强调：暗琥珀 #b8864a / 信号青 #4a7a8c（用于数据高亮和波形）
- 禁止鲜彩、禁止渐变、禁止深色背景

## 字体系统
- 标题：Songti SC / Noto Serif CJK SC 衬线大字（编辑感的灵魂）
- 正文：PingFang SC / Noto Sans CJK SC
- 数据/标签/坐标：等宽（SFMono / Consolas），如 "SIG_01 · 0.84"

## 构图语言
- 全屏点阵网格背景（CSS background-image: radial-gradient 圆点矩阵，或 SVG pattern）
- 信号波形：SVG path 绘制的折线/曲线，配坐标轴
- 数据节点：圆点 + 引线标注 + 等宽标签
- 刻度尺：顶部或左侧的工程刻度
- 卡片：无边框，靠点阵背景分区，用细发丝线划界

## 页面节奏建议
- 封面：点阵底 + 衬线大标题 + 一条主信号波形
- 节点页：单个数据点放大解析
- 对比页：双波形叠加
- 结论页：信号收敛/发散示意

## 避免项
- 不要无衬线标题（衬线是这个风格的编辑灵魂）
- 不要纯白底——必须有点阵网格
- 不要鲜彩——这是技术编辑，不是科技 demo
- 不要圆角卡片堆叠
- 波形/数据不能是装饰，必须与内容关联
`,
    previewTheme: {
    bg: '#deded9',
    ink: '#24221f',
    muted: 'rgba(36,34,31,0.62)',
    accent: '#b8864a',
    altAccent: '#4a7a8c',
    fontTitle: '"Songti SC", "Noto Serif CJK SC", serif',
    fontBody: '"PingFang SC", "Noto Sans CJK SC", sans-serif',
    fontMono: '"SFMono", "Consolas", monospace',
    motif: 'dot-matrix',
    tagline: '信号场的编辑感',
    cornerLabel: 'SIG_01 · 0.84',
  },
    outputHint: '生成点阵网格、信号波形、技术编辑感的封面卡组',
    bestFor: 'AI 系统观察、模型发布解读、技术编辑封面、数据叙事',
    sizePresets: ['3:4', '1:1'],
    exportBlueprint: { cardSelectors: ['.xhs-card', '.dot-card', '[class*="card"]'], defaultRatio: '3:4', cardGap: 24 },
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

  {
    id: 'deck-rain-notes',
    name: '雨天手记',
    nameEn: 'Rain Notes',
    mode: 'deck',
    scenario: 'presentation',
    description: '参考 lieflat-html-deck/rain-notes：米白纸感底、墨色衬线、雨蓝薄雾点缀，极简安静的 AI 评测/产品札记演示',
    icon: '🌧️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 16:9 横向 slide，参考 lieflat "rain-notes" 风格：米白羊皮纸底（#ddd3ba / rgba(248,243,230,.84)），墨色正文（#2a2a28、副墨 #5a5854、灰墨 #8a8782），雨蓝点缀（rgba(82,118,142,0.52)）
- 标题用宋体/Cormorant 衬线（Songti SC、Noto Serif SC），正文用 Noto Sans SC，章节序号用等宽字
- 大量留白与极细分割线（rgba(60,58,54,0.15)），不使用粗边框、不用渐变、不用阴影
- 装饰：可选的细雨斜线/雾化叠加（低透明度），呈现"雨日窗边安静写作"的氛围
- 单页单观点，标题大字号轻字重，正文分 statement / body / evidence 三层
- 动效极克制：仅入场淡入与细分隔线生长，必须提供 prefers-reduced-motion 降级
`,
    outputHint: '生成宁静、纸感、衬线主导的横向演示 HTML，适合 AI 模型评测、产品札记、安静叙事',
    bestFor: 'AI 模型评测笔记、产品反思、安静型产品故事、雨日工坊式分享',
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.slide', '.rain-slide', '[class*="slide"]'], defaultRatio: '16:9', cardGap: 0 },
  },
  {
    id: 'deck-story-field',
    name: '故事集',
    nameEn: 'Story Field',
    mode: 'deck',
    scenario: 'presentation',
    description: '参考 lieflat-html-deck/story-field：影像感深暗底、暖驼沙色、Cormorant 衬线大字，田野报告式的安静奢华叙事',
    icon: '🎞️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 16:9 横向 slide，参考 lieflat "story-field" 风格：深暗石底（#201d1a），暖驼沙色（rgba(168,148,116,.82)），白色透层卡片（rgba(255,255,255,.9)）
- 标题字体用 Cormorant Garamond / EB Garamond / Songti SC 衬线大字，正文用 PingFang SC
- 影像叙事感：大量图位（如有）、archive 档案式排印、横向分镜、可选颗粒噪点
- 装饰：极细金线、引文用衬线斜体、章节编号采用罗马数字或田野手记体
- 颜色克制：石色为主，沙驼为 accent，避免鲜彩与渐变
- 动效：cubic-bezier(.76,0,.24,1) 缓动，分镜渐显与图片轻盈浮入
`,
    outputHint: '生成影像感、田野报告式、安静奢华的横向演示 HTML',
    bestFor: '影像主导的故事型 deck、项目复盘、田野调查、品牌叙事',
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.slide', '.story-slide', '[class*="slide"]'], defaultRatio: '16:9', cardGap: 0 },
  },
  {
    id: 'deck-geek-report',
    name: '极客报告',
    nameEn: 'Geek Report',
    mode: 'deck',
    scenario: 'presentation',
    description: '参考 lieflat-html-deck/geek-report：纸感暗底 + 终端正文字 + 酸性绿/蓝/橄榄点缀，单色技术型开发者报告',
    icon: '🧰',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 16:9 横向 slide，参考 lieflat "geek-report" 风格：暗框底（#252525 frame），正文纸张色变量 paper，墨色字 #292929
- accent 色板：酸性绿 #c9f044 (acid)、雾蓝 #8ba5ba (blue)、橄榄绿 #7d9c77 (green)、警示朱 #eb4e3d
- 字体：中英等宽（SFMono / Consolas / Menlo）作章节编号与代码，CJK 用 Noto Sans SC；标题可用大号无衬线 + 编号
- 装饰：终端式分隔条、纸感细线（rgba(41,41,41,.18)）、章节用 "01 / 04" 编号、引文用 > 引用块
- 内容密度高：每页可承载 KPI、代码块、对比表、流程图，但不堆砌
- 动效中等：入场缓动 cubic-bezier(0.19,1,0.22,1)，行/列错位浮入，禁用弹跳
`,
    outputHint: '生成极客、终端纸感、单色技术的横向演示 HTML',
    bestFor: '开发者技术分析、AI 系统解读、开源项目汇报、极客评测',
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.slide', '.geek-slide', '[class*="slide"]'], defaultRatio: '16:9', cardGap: 0 },
  },
  {
    id: 'deck-pixel-report',
    name: '黑底闪光',
    nameEn: 'Pixel Report',
    mode: 'deck',
    scenario: 'presentation',
    description: '参考 lieflat-html-deck/pixel-report：纯黑底 + 像素 HUD + 酸性绿/琥珀高对比，复古游戏式结构化分析演示',
    icon: '👾',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 16:9 横向 slide，参考 lieflat "pixel-report" 风格：纯黑底 #000，前景文字偏白（#f6f7f3）
- accent 色板：酸性绿黄 #c7f75a (acid)、琥珀 #f4be64 (amber)、青蓝渐变 (teal)
- 视觉语言：像素 UI、复古游戏 HUD、扫描线、像素分块边角（step-corner）、单色像素图标
- 字体：等宽像素风（Consolas / SF Mono / 像素字体回退），标题可使用大号无衬线 + 像素描边
- 装饰：HUD 风格的数据标签、进度条、像素箭头、状态指示灯（在线/离线/分析中）
- 信息分块清晰：每页用网格分区，像游戏面板一样组织 KPI/对比/流程
- 动效：扫描线滑过、像素块入场（translate + opacity），中等节奏
`,
    outputHint: '生成像素 HUD、黑底闪光、复古游戏风的横向演示 HTML',
    bestFor: '技术分步解析、产品升级解读、AI 工具实测、结构化对比分析',
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.slide', '.pixel-slide', '[class*="slide"]'], defaultRatio: '16:9', cardGap: 0 },
  },
  {
    id: 'deck-dot-matrix',
    name: '点阵编辑风',
    nameEn: 'Dot Matrix',
    mode: 'deck',
    scenario: 'presentation',
    description: '参考 lieflat-html-deck/dot-matrix-dark：点阵画布背景 + 琥珀控件 + signal 数据叙事，深色技术型分析演示',
    icon: '🛰️',
    designConstraints: SHARED_DESIGN_CONSTRAINTS + `
- 16:9 横向 slide，参考 lieflat "dot-matrix-dark" 风格：深暗底 #080706，琥珀色字 #f0dfbf，控件半透 rgba(246,244,239,.74)
- 画布背景使用点阵网格（dot-matrix pattern），营造"信号场域 / data field"质感
- accent 色板：琥珀 #f0dfbf、沙色、青灰 #3e4744 / 亮青 #e2cda5、control 半透层
- 字体：PingFang SC 正文 + SF Mono 等宽数据，标题可用大号衬线/无衬线
- 装饰：信号点、波形线、数据轨迹、低透明度网格刻度，控件用半透磨砂层
- 信息以"信号 / 节点 / 字段"的方式组织，适合 KPI、benchmark、模型能力地图
- 动效较高：信号扫描、点阵依次点亮、字段浮入，需提供 prefers-reduced-motion 降级
`,
    outputHint: '生成点阵画布、信号场域、深色技术风的横向演示 HTML',
    bestFor: 'AI 系统解读、模型 benchmark、技术信号叙事、数据场域分析',
    sizePresets: ['16:9'],
    exportBlueprint: { cardSelectors: ['.slide', '.dot-slide', '[class*="slide"]'], defaultRatio: '16:9', cardGap: 0 },
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
  { id: 'wechat', name: '一键排版', icon: '🪄', description: '内联样式、图文复制、微信编辑器友好' },
  { id: 'creative', name: 'AI 自由创意', icon: '🎨', description: '根据创意模板或自由提示直绘网页' },
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
    // 合并用户自定义的微信主题（从 localStorage 同步读取，转成 OutputTemplate 形态）
    const customWechat = loadCustomWechatThemes().map((theme) => ({
      id: theme.id,
      name: theme.name,
      nameEn: theme.name,
      mode: 'wechat' as OutputMode,
      scenario: 'sharing' as OutputScenario,
      description: '自定义微信主题',
      icon: '✨',
      designConstraints: WECHAT_DESIGN_CONSTRAINTS,
      outputHint: '自定义样式的微信图文排版',
      bestFor: '自定义主题',
      outputTargets: ['图文'],
      previewTone: 'wechat-article',
      sizePresets: ['auto'],
    }))
    return [...OUTPUT_TEMPLATES, ...installed, ...customWechat]
  } catch (e) {
    console.error("加载动态/本地自定义模板失败，降级使用静态模板列表:", e)
    return OUTPUT_TEMPLATES
  }
}
