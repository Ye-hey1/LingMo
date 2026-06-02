import {
  Activity,
  Brain,
  Cloud,
  Database,
  FileText,
  FolderTree,
  Github,
  History,
  Home,
  Inbox,
  MessageCircle,
  Rocket,
  Search,
  Settings,
  Video,
  WalletCards,
  Wrench,
} from 'lucide-react'
import type { ComponentType } from 'react'

export type DocNavItem = {
  title: string
  href: string
  description: string
  icon: ComponentType<{ className?: string }>
}

export type DocNavGroup = {
  title: string
  items: DocNavItem[]
}

export const docNavGroups: DocNavGroup[] = [
  {
    title: '开始',
    items: [
      {
        title: '首页',
        href: '/',
        description: 'LingMo 是什么、适合谁、核心工作流和阅读路径。',
        icon: Home,
      },
      {
        title: '快速开始',
        href: '/quick-start',
        description: '完成工作区、第一篇笔记、AI 模型和常用配置。',
        icon: Rocket,
      },
    ],
  },
  {
    title: '核心功能',
    items: [
      {
        title: '记录',
        href: '/capture',
        description: '收集文本、链接、截图、录音、文件和待办，并整理成笔记。',
        icon: Inbox,
      },
      {
        title: '写作',
        href: '/writing',
        description: '管理 Markdown 工作区、编辑正文、处理 PDF、图表和导出。',
        icon: FolderTree,
      },
      {
        title: 'AI',
        href: '/ai',
        description: 'Chat 对话、Agent 执行和 Deep Research 深度研究。',
        icon: MessageCircle,
      },
      {
        title: '知识库',
        href: '/knowledge',
        description: 'RAG 检索、向量索引、BM25、Rerank 和知识图谱。',
        icon: Search,
      },
    ],
  },
  {
    title: '资料处理',
    items: [
      {
        title: '链接',
        href: '/smart-links',
        description: '整理普通网页、GitHub 仓库、公众号文章和网页资料。',
        icon: Github,
      },
      {
        title: '视频语音',
        href: '/video-audio',
        description: '提取 B站、YouTube 字幕，下载音频并调用 STT 转写。',
        icon: Video,
      },
      {
        title: '学习',
        href: '/learning',
        description: '用费曼追问、苏格拉底式提问和主动解释检查理解。',
        icon: Brain,
      },
      {
        title: '闪卡',
        href: '/flashcards',
        description: '创建牌组，从笔记生成卡片，按到期、薄弱和掌握度复习。',
        icon: WalletCards,
      },
    ],
  },
  {
    title: '管理',
    items: [
      {
        title: '活跃度',
        href: '/activity',
        description: '查看记录、写作、聊天、AI、记忆和同步活动，并生成复盘。',
        icon: Activity,
      },
      {
        title: '记忆',
        href: '/memory',
        description: '管理 LingMo、Claude Code、Codex CLI 和 OpenCode 的 AI 会话记忆。',
        icon: Database,
      },
      {
        title: '设置',
        href: '/settings',
        description: '配置模型、记录、编辑器、模板、MCP、Skills 和搜索服务。',
        icon: Settings,
      },
      {
        title: '同步',
        href: '/sync',
        description: '通过 GitHub、Gitee、GitLab、S3、WebDAV 和本地备份保护资料。',
        icon: Cloud,
      },
    ],
  },
]

export const docNavItems: DocNavItem[] = docNavGroups.flatMap(group => group.items)

export const moduleOverviewItems = [
  {
    title: '记录',
    href: '/capture',
    description: '把还没有结构的信息先放进收集箱，再按标签、类型和 AI 整理流程沉淀成笔记。',
    icon: Inbox,
  },
  {
    title: '写作',
    href: '/writing',
    description: '围绕本地 Markdown 工作区管理文件、编辑正文、处理 PDF、图表和导出结果。',
    icon: FolderTree,
  },
  {
    title: 'AI',
    href: '/ai',
    description: '根据任务深度选择 Chat、Agent 或 Deep Research，分别处理问答、执行和研究。',
    icon: MessageCircle,
  },
  {
    title: '知识库',
    href: '/knowledge',
    description: '为笔记建立索引，让 AI 能引用你的本地资料，而不是只给通用回答。',
    icon: Search,
  },
  {
    title: '链接',
    href: '/smart-links',
    description: '识别普通网页、GitHub 仓库、微信公众号文章，并自动生成结构化记录。',
    icon: Github,
  },
  {
    title: '视频语音',
    href: '/video-audio',
    description: '优先读取公开字幕，没有字幕时下载音频并调用 STT 转写。',
    icon: Video,
  },
  {
    title: '学习',
    href: '/learning',
    description: '用费曼学习法和苏格拉底式追问检查理解漏洞，让你先解释，再被追问。',
    icon: Brain,
  },
  {
    title: '闪卡',
    href: '/flashcards',
    description: '把笔记、课程和视频内容生成问答卡、填空题、选择题和简答题，按薄弱程度复习。',
    icon: WalletCards,
  },
  {
    title: '活跃度',
    href: '/activity',
    description: '把记录、写作、对话、AI、记忆和同步汇总成时间线、热力图和复盘材料。',
    icon: Activity,
  },
  {
    title: '记忆',
    href: '/memory',
    description: '集中查看、搜索、编辑、导出和沉淀不同 AI 工具的会话上下文。',
    icon: Database,
  },
  {
    title: '同步',
    href: '/sync',
    description: '把工作区文件、记录和部分配置备份到远程服务或本地压缩包。',
    icon: Cloud,
  },
]

export const configurationItems = [
  {
    title: '模型配置',
    href: '/settings',
    description: '配置聊天、Embedding、Rerank、STT、TTS 和多模态模型。',
    icon: MessageCircle,
  },
  {
    title: '记录与模板',
    href: '/settings',
    description: '配置记录工具栏、记录描述模型和整理模板。',
    icon: FileText,
  },
  {
    title: 'MCP 与 Skills',
    href: '/settings',
    description: '接入外部工具服务器和可复用 AI 能力包。',
    icon: Wrench,
  },
  {
    title: '同步备份',
    href: '/sync',
    description: '配置远程仓库、对象存储、WebDAV 和本地备份。',
    icon: Cloud,
  },
  {
    title: '活跃度与记忆',
    href: '/activity',
    description: '配置复盘目标，查看活动数据，并把高价值对话沉淀为笔记。',
    icon: History,
  },
]

export const homeSections = [
  {
    number: '01',
    title: '先收集，再整理',
    href: '/capture',
    summary: '记录模块负责承接所有临时信息。灵感、链接、截图、录音、文件和待办都可以先进入收集箱，后续再归类、处理或合并成笔记。',
    entry: '左侧记录页、链接弹窗、截图/录音入口、底部快捷记录按钮。',
    details: [
      '中转站用于临时收集，适合还没想好分类的内容。',
      '链接、截图、录音和文件会按类型进入不同解析流程。',
      '多选记录后可以合并成笔记、追加到当前笔记或生成大纲。',
    ],
    workflow: ['快速记录', '按标签归类', 'AI 整理', '沉淀成文'],
  },
  {
    number: '02',
    title: '用 Markdown 写作和管理资料',
    href: '/writing',
    summary: '写作模块围绕本地工作区展开。你可以管理 Markdown、图片、PDF、图表和导出文件，把记录区沉淀出的材料整理成长期内容。',
    entry: '文件树、编辑器标签页、文件右键菜单、导出菜单。',
    details: [
      '文件树支持新建、重命名、拖拽、收藏、复制、移动和删除。',
      '编辑器支持表格、代码块、数学公式、内部链接、大纲和搜索替换。',
      'Markdown 可以导出为 PDF，PDF 批注也可以整理为 Markdown。',
    ],
    workflow: ['选择工作区', '组织目录', '编辑笔记', '导出交付'],
  },
  {
    number: '03',
    title: '按任务选择 AI 模式',
    href: '/ai',
    summary: 'AI 模块分为 Chat、Agent 和 Deep Research。Chat 负责快速问答，Agent 负责本地工具执行，Deep Research 负责联网调研和报告生成。',
    entry: '右侧聊天输入框模式切换、编辑器 / 命令、设置中的 AI / MCP / Skills。',
    details: [
      'Chat 适合解释、改写、总结和轻量问答。',
      'Agent 可以读取文件、整理记录、调用工具、创建笔记和生成闪卡。',
      'Deep Research 会澄清问题、检索来源、分析证据并生成报告。',
    ],
    workflow: ['选择模式', '提供上下文', '执行任务', '检查结果'],
  },
  {
    number: '04',
    title: '让知识库回答你的资料',
    href: '/knowledge',
    summary: '知识库模块把本地笔记转换成可检索资料。AI 回答前可以先检索相关片段，再基于你的内容生成回答。',
    entry: '设置 → 知识库、文件夹索引菜单、聊天区 RAG 开关。',
    details: [
      'Embedding 用于语义检索，BM25 和模糊搜索补充关键词召回。',
      'Rerank 用于重新排序候选片段，提高引用质量。',
      '知识图谱帮助发现双向链接、相关主题和孤立笔记。',
    ],
    workflow: ['配置模型', '建立索引', '检索引用', '复盘连接'],
  },
  {
    number: '05',
    title: '把外部资料变成本地内容',
    href: '/smart-links',
    summary: '链接、视频和语音模块负责把网页、开源项目、公众号文章、B站和 YouTube 内容转成可阅读、可整理、可检索的记录。',
    entry: '记录 → 链接记录、视频转写记录、录音记录。',
    details: [
      'GitHub 仓库会整理项目简介、技术栈、核心功能和快速上手。',
      '微信公众号文章会尽量提取正文并转换为 Markdown。',
      '视频会优先读取字幕，没有字幕时使用 yt-dlp、ffmpeg 和 STT 兜底。',
    ],
    workflow: ['粘贴链接', '后台解析', '查看结果', '生成笔记'],
  },
  {
    number: '06',
    title: '用主动回忆巩固理解',
    href: '/flashcards',
    summary: '学习和闪卡模块负责把知识从“看过”变成“能解释”。闪卡处理记忆巩固，费曼追问处理理解诊断。',
    entry: '左侧闪卡入口、编辑器选区生成闪卡、/生成闪卡、/费曼追问。',
    details: [
      '闪卡支持牌组、到期复习、薄弱卡片、选择题、填空题、简答题和问答卡。',
      '可以拖入多篇 Markdown 或 TXT，让 AI 一次生成多张卡片草稿。',
      '费曼追问要求你先解释，AI 再追问机制、例子、边界和反例。',
    ],
    workflow: ['导入材料', '生成卡片', '到期复习', '费曼追问'],
  },
  {
    number: '07',
    title: '查看活跃度和沉淀记忆',
    href: '/activity',
    summary: '活跃度中心把记录、写作、聊天、AI、记忆和同步汇总在一起。记忆管理则集中保存不同 AI 工具的会话，方便搜索、编辑、导出和复盘。',
    entry: '标题栏活跃度按钮、左侧记忆入口、/今日回顾、/本周回顾、/知识盘点。',
    details: [
      '活跃度中心包含总览、时间线、AI、记忆和同步页签。',
      '可以设置每日记录、写作、有效对话目标，并生成今日、本周、月度复盘。',
      '记忆管理支持 LingMo、Claude Code、Codex CLI、OpenCode 会话检索和导出。',
    ],
    workflow: ['查看热力图', '筛选时间线', '生成复盘', '沉淀记忆'],
  },
  {
    number: '08',
    title: '同步备份和配置扩展',
    href: '/settings',
    summary: '设置和同步模块负责长期维护：模型、知识库、记录工具栏、模板、MCP、Skills、图床、Web 搜索、音频和多端备份都在这里配置。',
    entry: '设置入口、设置 → 同步、活跃度中心 → 同步、编辑器底部同步按钮。',
    details: [
      '同步支持当前文件、全量工作区文件、记录标签、聊天和部分设置。',
      '设置中可以管理 Chat、Embedding、Rerank、STT、TTS、图片识别和默认模型。',
      'MCP 提供外部工具，Skills 提供可复用专业工作流。',
    ],
    workflow: ['配置模型', '开启同步', '接入扩展', '定期体检'],
  },
]

export function getDocByHref(href: string) {
  return docNavItems.find(item => item.href === href)
}
