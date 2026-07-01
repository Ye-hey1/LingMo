/**
 * Lightweight design profile library for LingMo intelligent layout.
 * Inspired by Open Design's direction blocks, but scoped to prompt guidance.
 */

export type DesignProfileId =
  | 'wechat-readable'
  | 'editorial-reading'
  | 'modern-minimal'
  | 'social-impact'
  | 'swiss-deck'
  | 'data-utility'
  | 'tech-utility'
  | 'experimental-brutalist'

export interface DesignProfile {
  id: DesignProfileId
  label: string
  bestFor: string
  palette: {
    background: string
    surface: string
    text: string
    muted: string
    accent: string
  }
  typography: string[]
  posture: string[]
  avoid: string[]
}

export const DESIGN_PROFILES: DesignProfile[] = [
  {
    id: 'wechat-readable',
    label: '一键排版阅读',
    bestFor: '微信图文、公众号长文、手机端复制发布',
    palette: {
      background: '#ffffff',
      surface: '#f7f7f5',
      text: '#1f2933',
      muted: '#5f6875',
      accent: '#2f7d5b',
    },
    typography: [
      '正文 15-17px，行高 1.75-1.95，段落间距稳定',
      '标题层级清楚但不过度网页化，优先保留 Markdown 标题结构',
      '代码、表格、引用块要可复制，不依赖复杂脚本或动画',
    ],
    posture: [
      '以内联样式和微信编辑器兼容 CSS 为主',
      '内容宽度紧凑，适合手机阅读和后台粘贴',
      '强调色少量用于标题、引用、重点句，不铺满整屏',
    ],
    avoid: [
      '网页 hero、复杂交互和浮动导航',
      '大面积渐变、发光、玻璃拟态',
      '把长文强行拆成同质卡片',
    ],
  },
  {
    id: 'editorial-reading',
    label: '编辑部阅读',
    bestFor: '长文、研究笔记、读书笔记、复盘总结',
    palette: {
      background: '#f8f8f6',
      surface: '#ffffff',
      text: '#202124',
      muted: '#62676f',
      accent: '#9d2f2f',
    },
    typography: [
      '标题可用衬线或宋体气质，正文使用清晰无衬线或系统中文字体',
      '正文行长控制在 65-75ch，长段落行高 1.65-1.85',
      '引用、脚注、目录使用小一级字号，不抢正文',
    ],
    posture: [
      '用留白、分栏、引文和目录建立阅读节奏',
      '优先保留原文结构和章节关系',
      '适度使用细线、页眉、编号和旁注，少用卡片',
    ],
    avoid: [
      '每个章节都做同款圆角卡片',
      '低对比灰字和过窄行距',
      '与内容无关的杂志装饰',
    ],
  },
  {
    id: 'modern-minimal',
    label: '现代极简产品',
    bestFor: '产品说明、工作报告、知识库、清爽网页化输出',
    palette: {
      background: '#f8fafc',
      surface: '#ffffff',
      text: '#111827',
      muted: '#5b6472',
      accent: '#2563eb',
    },
    typography: [
      '使用系统无衬线字体，固定 rem 阶梯，不用夸张流体字号',
      '标题、标签、按钮和说明保持产品 UI 的紧凑比例',
      '数字使用 tabular-nums，表格和状态信息清晰对齐',
    ],
    posture: [
      '边框、留白、轻量状态色构成层级',
      '组件语言稳定：按钮、标签、卡片、表格样式统一',
      '动效只表达 hover、切换、加载或展开状态',
    ],
    avoid: [
      '装饰性阴影和过度圆角',
      '营销落地页式大 hero',
      '没有信息功能的渐变背景',
    ],
  },
  {
    id: 'social-impact',
    label: '社交传播冲击',
    bestFor: '小红书、朋友圈、知识卡、观点组图',
    palette: {
      background: '#fbfbfd',
      surface: '#ffffff',
      text: '#141821',
      muted: '#667085',
      accent: '#e5484d',
    },
    typography: [
      '封面标题可以更大，但必须防止移动端溢出',
      '每张卡只承载一个主观点，证据和脚注分层处理',
      '中文标点、数字和短标签需要对齐，避免乱跳',
    ],
    posture: [
      '优先 3:4 或 1:1 安全画板，保留导出安全区',
      '用封面、目录、详情卡建立组图叙事',
      '色彩用于信息锚点，而不是每个块都涂满',
    ],
    avoid: [
      'emoji 堆砌和廉价贴纸感',
      '所有卡片只换颜色不换结构',
      '把不存在的数据做成大数字卖点',
    ],
  },
  {
    id: 'swiss-deck',
    label: '瑞士网格演示',
    bestFor: 'PPT、演讲、课程、方案汇报',
    palette: {
      background: '#f5f5f2',
      surface: '#ffffff',
      text: '#111111',
      muted: '#5f5f5f',
      accent: '#d83b2d',
    },
    typography: [
      '16:9 slide 中正文最小 24px，远距离可读',
      '单页单观点，标题、statement、evidence 清楚分层',
      '页码、模板编号、speaker notes 使用轻量小字号',
    ],
    posture: [
      '用 12/16 列网格和细线对齐，不依赖圆角卡片',
      '每页固定安全区，横向翻页时不要网页长滚动',
      '色彩保持黑白灰加一个强调色',
    ],
    avoid: [
      '像网页一样纵向堆 section',
      '重阴影、渐变字和复杂背景图',
      '同一页塞入过多段落',
    ],
  },
  {
    id: 'data-utility',
    label: '数据工具叙事',
    bestFor: '数据看板、信息图、时间线、流程图、研究摘要',
    palette: {
      background: '#f7f9fb',
      surface: '#ffffff',
      text: '#162033',
      muted: '#5a6575',
      accent: '#0f766e',
    },
    typography: [
      '图例、坐标、指标和注释使用清晰小字号，不低于 12px',
      '数字使用等宽或 tabular-nums，单位和来源必须标注',
      '说明文本短句化，图表旁注比长段落更优先',
    ],
    posture: [
      '先组织信息关系：时间、层级、对比、因果或分组',
      '没有原始数据时用定性结构，不伪造指标',
      '图表、表格、时间线和注释系统保持同一网格',
    ],
    avoid: [
      '假 KPI、假增长率和无来源百分比',
      '过多颜色导致图例不可读',
      '只用装饰卡片代替真正的信息结构',
    ],
  },
  {
    id: 'tech-utility',
    label: '技术工具界面',
    bestFor: '技术分享、代码说明、API 文档、工程复盘',
    palette: {
      background: '#0b1020',
      surface: '#111827',
      text: '#f8fafc',
      muted: '#cbd5e1',
      accent: '#22c55e',
    },
    typography: [
      '代码使用等宽字体，正文仍保持足够字号和行高',
      '命令、路径、状态码、日志片段必须可复制可阅读',
      '表格、代码块、终端块要有横向溢出保护',
    ],
    posture: [
      '高信息密度，但保持清晰分组和状态色',
      '用标签、分隔线、目录和代码高亮构成层级',
      '深色主题下正文对比度必须足够高',
    ],
    avoid: [
      '霓虹发光泛滥',
      '纯黑背景上低对比蓝紫文字',
      '把教程做成花哨海报',
    ],
  },
  {
    id: 'experimental-brutalist',
    label: '实验硬边排版',
    bestFor: '宣言、强观点、艺术项目、非标创意页',
    palette: {
      background: '#fbfbf8',
      surface: '#ffffff',
      text: '#101010',
      muted: '#444444',
      accent: '#ff3b30',
    },
    typography: [
      '大标题可以强烈，但移动端必须有安全字号上限',
      '可使用单色、强边框、非对称栏宽和显性网格',
      '正文依然要读得清楚，不用怪异字距制造困难',
    ],
    posture: [
      '少圆角、少阴影、少渐变，靠结构和字体完成风格',
      '允许强烈对比，但要服务材料的观点',
      '用索引、编号、断裂网格或海报式层级表达态度',
    ],
    avoid: [
      '为了酷而牺牲可读性',
      '廉价手绘 SVG 和随机涂鸦',
      '所有元素都在抢注意力',
    ],
  },
]

export const DEFAULT_DESIGN_PROFILE_ID: DesignProfileId = 'modern-minimal'

export function getDesignProfile(id?: string): DesignProfile {
  return DESIGN_PROFILES.find((profile) => profile.id === id) ?? DESIGN_PROFILES.find((profile) => profile.id === DEFAULT_DESIGN_PROFILE_ID)!
}

export function renderDesignProfilePromptBlock(profileId?: string): string {
  const profile = getDesignProfile(profileId)
  return `## 设计 Profile：${profile.label}

适用场景：${profile.bestFor}

### 视觉令牌
- 背景：${profile.palette.background}
- 表面：${profile.palette.surface}
- 正文：${profile.palette.text}
- 弱化文本：${profile.palette.muted}
- 强调色：${profile.palette.accent}

### 字体与排版
${profile.typography.map((item) => `- ${item}`).join('\n')}

### 布局姿态
${profile.posture.map((item) => `- ${item}`).join('\n')}

### 避免
${profile.avoid.map((item) => `- ${item}`).join('\n')}`
}
