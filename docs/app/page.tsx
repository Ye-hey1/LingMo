import Link from 'next/link'
import { ArrowRight, Bot, CheckCircle2, MessageCircle, Telescope } from 'lucide-react'
import { DocsShell } from '@/components/docs-shell'
import { configurationItems, homeSections, moduleOverviewItems } from '@/lib/docs'
import { DualLang, T } from '@/components/translation'
import { HeroBannerIllustration } from '@/components/illustrations'

// 模块中英双语对照字典
const moduleTrans: Record<string, { enTitle: string; enDesc: string }> = {
  '记录': { 
    enTitle: 'Capture', 
    enDesc: 'Put unstructured information into inbox, then organize into notes with tags and AI workflows.' 
  },
  '写作': { 
    enTitle: 'Writing', 
    enDesc: 'Manage Markdown workspaces, edit body content, handle PDFs, charts, and export results.' 
  },
  'AI': { 
    enTitle: 'AI', 
    enDesc: 'Choose Chat, Agent, or Deep Research mode to tackle Q&A, automation, and research tasks.' 
  },
  '知识库': { 
    enTitle: 'Knowledge', 
    enDesc: 'Index local notes, enabling AI to reference your proprietary data rather than general facts.' 
  },
  '链接': { 
    enTitle: 'Smart Links', 
    enDesc: 'Parse standard web pages, GitHub repos, and WeChat articles to create structured notes.' 
  },
  '视频语音': { 
    enTitle: 'Video & Audio', 
    enDesc: 'Read open-source subtitles, or download audio and trigger STT for transcription.' 
  },
  '学习': { 
    enTitle: 'Learning', 
    enDesc: 'Diagnose comprehension gaps with Feynman technique and active Socratic questioning.' 
  },
  '闪卡': { 
    enTitle: 'Flashcards', 
    enDesc: 'Generate flashcards, Q&As, and quizzes from notes, then review based on memory retention.' 
  },
  '活跃度': { 
    enTitle: 'Activity', 
    enDesc: 'Synthesize capture, writing, AI chat, memories, and sync records into visual review dashboards.' 
  },
  '记忆': { 
    enTitle: 'Memory', 
    enDesc: 'Consolidate, search, edit, export, and accumulate context logs across diverse AI tools.' 
  },
  '同步': { 
    enTitle: 'Sync', 
    enDesc: 'Backup workspace files, tags, and settings to remote services or compressed archives.' 
  },
}

// 常用入口表格中英双语对照字典
const tableItems = [
  {
    zhTask: '保存文本、链接、截图、录音、文件、待办',
    enTask: 'Save text, links, screenshots, audio, files, and tasks',
    zhGo: '左侧记录页签或底部快捷记录按钮',
    enGo: 'Left Capture tab or bottom quick record button',
    zhDoc: '记录',
    enDoc: 'Capture',
    href: '/capture',
  },
  {
    zhTask: '整理 GitHub 项目、公众号文章、网页资料',
    enTask: 'Organize GitHub repos, official accounts, and web resources',
    zhGo: '记录 → 链接',
    enGo: 'Capture → Links',
    zhDoc: '链接',
    enDoc: 'Links',
    href: '/smart-links',
  },
  {
    zhTask: '把 B站 / YouTube 视频转成文字',
    enTask: 'Transcribe Bilibili / YouTube videos to text',
    zhGo: '记录 → 链接，粘贴视频 URL',
    enGo: 'Capture → Links, paste video URL',
    zhDoc: '视频语音',
    enDoc: 'Video & Audio',
    href: '/video-audio',
  },
  {
    zhTask: '写 Markdown、导出 PDF、管理文件',
    enTask: 'Write Markdown, export PDF, and manage files',
    zhGo: '左侧文件页签和中间编辑器',
    enGo: 'Left File tree and central editor workspace',
    zhDoc: '写作',
    enDoc: 'Writing',
    href: '/writing',
  },
  {
    zhTask: '让 AI 基于本地资料回答',
    enTask: 'Get AI answers backed by local documents',
    zhGo: '设置 → 知识库，聊天区打开 RAG',
    enGo: 'Settings → Knowledge Base, enable RAG in Chat',
    zhDoc: '知识库',
    enDoc: 'Knowledge Base',
    href: '/knowledge',
  },
  {
    zhTask: '用 Chat、Agent、Deep Research',
    enTask: 'Utilize Chat, Agent, and Deep Research modes',
    zhGo: '右侧聊天区模式切换',
    enGo: 'Right sidebar mode switch control',
    zhDoc: 'AI',
    enDoc: 'AI & Agent',
    href: '/ai',
  },
  {
    zhTask: '生成闪卡、复习薄弱卡片',
    enTask: 'Generate flashcards and review weak areas',
    zhGo: '左侧竖栏 → 闪卡',
    enGo: 'Left vertical toolbar → Flashcards',
    zhDoc: '闪卡',
    enDoc: 'Flashcards',
    href: '/flashcards',
  },
  {
    zhTask: '用费曼学习法检查理解',
    enTask: 'Verify understanding with Feynman technique',
    zhGo: '编辑器 /费曼追问',
    enGo: 'Editor command `/Feynman`',
    zhDoc: '学习',
    enDoc: 'Learning',
    href: '/learning',
  },
  {
    zhTask: '查看今日、本周、月度复盘',
    enTask: 'View daily, weekly, and monthly reviews',
    zhGo: '标题栏 → 活跃度中心',
    enGo: 'Top header → Activity Center',
    zhDoc: '活跃度',
    enDoc: 'Activity',
    href: '/activity',
  },
  {
    zhTask: '管理 AI 会话记忆',
    enTask: 'Manage context memory for AI interactions',
    zhGo: '左侧竖栏 → 记忆',
    enGo: 'Left vertical toolbar → Memory',
    zhDoc: '记忆',
    enDoc: 'Memory',
    href: '/memory',
  },
  {
    zhTask: '备份和多设备同步',
    enTask: 'Backup data and sync across multiple devices',
    zhGo: '设置 → 同步，活跃度中心 → 同步',
    enGo: 'Settings → Sync or Activity → Sync',
    zhDoc: '同步',
    enDoc: 'Sync',
    href: '/sync',
  },
]

// 常用配置中英对照
const configTrans: Record<string, { enTitle: string; enDesc: string }> = {
  '模型配置': {
    enTitle: 'Model Settings',
    enDesc: 'Configure chat, embedding, rerank, STT, TTS, and multimodal models.',
  },
  '记录与模板': {
    enTitle: 'Capture & Templates',
    enDesc: 'Customize capture toolbar, descriptive models, and processing templates.',
  },
  'MCP 与 Skills': {
    enTitle: 'MCP & Skills',
    enDesc: 'Integrate external model context servers and reusable agent skill packages.',
  },
  '同步备份': {
    enTitle: 'Sync & Backup',
    enDesc: 'Configure remote Git repositories, S3 object storage, WebDAV, or local backups.',
  },
  '活跃度与记忆': {
    enTitle: 'Activity & Memory',
    enDesc: 'Set custom review goals, audit usage logs, and persist high-value chats.',
  },
}

// 模块详解中英对照
const homeSectionsTrans: Record<string, { enTitle: string; enSummary: string; enEntry: string; enWorkflow: string[]; enDetails: string[] }> = {
  '先收集，再整理': {
    enTitle: 'Capture First, Organize Later',
    enSummary: 'The capture module takes all ephemeral info. Inspirations, links, screenshots, audio, files, and tasks sit in inbox first, to be categorized or merged later.',
    enEntry: 'Left Capture tab, Link popup, Screenshot/Audio inputs, and bottom record button.',
    enWorkflow: ['Quick capture', 'Tag categorization', 'AI structuring', 'Note consolidation'],
    enDetails: [
      'Inbox holds temporary entries, ideal for thoughts without immediate classification.',
      'Links, screenshots, audio, and files flow through automated parsing structures.',
      'Select multiple records to merge into notes, append to existing documents, or outline.'
    ]
  },
  '用 Markdown 写作和管理资料': {
    enTitle: 'Markdown Writing & Workspace Management',
    enSummary: 'The writing workspace centers around local directory management. Create Markdown notes, view assets, process PDFs, render charts, and execute exports.',
    enEntry: 'Workspace file tree, Editor tabs, File context menus, and Export options.',
    enWorkflow: ['Workspace selection', 'Directory layout', 'Note editing', 'Export & delivery'],
    enDetails: [
      'File tree supports creating, renaming, dragging, pinning, copying, moving, and deleting.',
      'Editor fully supports tables, code blocks, MathJax formulas, bi-directional links, outline trees.',
      'Export Markdown directly to beautifully formatted PDFs, or extract highlights from PDFs.'
    ]
  },
  '按任务选择 AI 模式': {
    enTitle: 'Task-specific AI Execution Modes',
    enSummary: 'Unleash different intelligence capabilities via Chat, Agent, and Deep Research. Selecting the right mode is more effective than writing exhaustive prompts.',
    enEntry: 'Right-side chat area switches, editor slash commands, and AI/MCP settings.',
    enWorkflow: ['Mode selection', 'Context supply', 'Task execution', 'Output review'],
    enDetails: [
      'Chat mode handles rapid Q&As, explanations, summaries, translations, and inline revisions.',
      'Agent mode reads workspace files, parses logs, drives tools, creates notes, and drafts flashcards.',
      'Deep Research issues clarification questions, queries online sources, validates evidence, and generates reports.'
    ]
  },
  '让知识库回答你的资料': {
    enTitle: 'RAG Knowledge base Q&A',
    enSummary: 'Build proprietary semantic indexes on top of local files. AI retrieves matching chunks first before formulating grounded answers.',
    enEntry: 'Settings → Knowledge Base, indexing menus, and chat retrieval toggle.',
    enWorkflow: ['Model setup', 'Indexing workspace', 'Retrieval context', 'Connection audit'],
    enDetails: [
      'Embedding vectors enable semantic search, while BM25 and fuzzy matching guarantee keyword safety.',
      'Rerank models prioritize retrieval candidate fragments, securing ultimate synthesis quality.',
      'Knowledge graphs help uncover bi-directional connections, thematic clusters, and isolated notes.'
    ]
  },
  '把外部资料变成本地内容': {
    enTitle: 'Automated Web Content Extraction',
    enSummary: 'Turn generic web pages, GitHub repositories, WeChat articles, and audio/video files into digestible, structured offline notes.',
    enEntry: 'Capture tab → Links section, transcription pipelines, and record attachments.',
    enWorkflow: ['Paste link', 'Background extraction', 'Review structured notes', 'Generate permanent card'],
    enDetails: [
      'GitHub links automatically extract technical architectures, project summaries, features, and getting-started recipes.',
      'WeChat article parsers parse cleanly, filtering layout noise into structured Markdown.',
      'Video parsers download open subtitles, falling back to local audio extraction and STT transcription.'
    ]
  },
  '用主动回忆巩固理解': {
    enTitle: 'Active Recall & Comprehension Diagnostics',
    enSummary: 'Move from passive reading to active comprehension. Flashcards target long-term memory retention, while Socratic dialogue targets understanding depth.',
    enEntry: 'Left Flashcard menu, Editor selections to cards, `/Feynman` command, `/flashcard` command.',
    enWorkflow: ['Material import', 'AI card generation', 'Retention-based review', 'Feynman testing'],
    enDetails: [
      'Flashcards support multiple card types: Q&As, fill-in-the-blanks, choices, and summaries.',
      'Drop multiple Markdown/TXT files to batch draft dozens of cards instantly.',
      'Feynman dialogue challenges you to explain concepts in simple terms; AI questions core mechanics, assumptions, and edge cases.'
    ]
  },
  '查看活跃度和沉淀记忆': {
    enTitle: 'Activity Metrics & Conversation Archive',
    enSummary: 'Track metrics across capturing, writing, AI chats, and synchronizations. Memory vault provides centralized control over local AI context logs.',
    enEntry: 'Top status bar indicators, Left Memory vault tab, and slash summary commands.',
    enWorkflow: ['Audit heatmap', 'Timeline filtering', 'Generate review summaries', 'Archive insights'],
    enDetails: [
      'Activity hub features daily heatmaps, metric targets, timelines, and synchronization diagnostics.',
      'Configure targets for capturing, writing, and effective chat messages, generating daily/weekly reviews.',
      'Memory manager organizes context history from LingMo, Claude Code, Codex, and OpenCode.'
    ]
  },
  '同步备份和配置扩展': {
    enTitle: 'Synchronization, Backups & Model Extension',
    enSummary: 'Ensure long-term durability and extensibility: customize models, capture behaviors, editor plugins, MCP servers, Web Search, and S3/Git sync nodes.',
    enEntry: 'Main settings button, Settings → Sync, toolbar synchronization hooks.',
    enWorkflow: ['Model validation', 'Secure sync setups', 'Plugin integrations', 'System integrity check'],
    enDetails: [
      'Synchronizers capture incremental workspace logs, tags, chat contexts, and settings.',
      'Set custom model endpoints for Chat, Embedding, Rerank, STT, TTS, OCR, and Web Search.',
      'MCP integrates external workspace tools; Skills packages standard multi-step agent behaviors.'
    ]
  },
}

export default function HomePage() {
  return (
    <DocsShell currentPath="/">
      {/* 头部 Banner，引入 3D 科技流光插画 */}
      <div className="w-full mb-8 relative rounded-2xl overflow-hidden bg-gradient-to-br from-[var(--color-bg-inset)] to-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="flex-1 min-w-[280px]">
          <DualLang
            zh={
              <header className="manual-intro !m-0 !p-0">
                <p className="manual-eyebrow">LingMo 使用手册</p>
                <h1 className="text-3xl font-extrabold tracking-tight">把碎片资料整理成可复用的知识</h1>
                <p className="manual-lead text-base mt-3 opacity-90 leading-relaxed">
                  LingMo 是一个本地优先的 AI 笔记工作台。它把记录、写作、知识库、AI 任务、链接解析、视频转写、学习复盘和同步备份放在同一套工作流里。
                </p>
              </header>
            }
            en={
              <header className="manual-intro !m-0 !p-0">
                <p className="manual-eyebrow">LingMo Manual</p>
                <h1 className="text-3xl font-extrabold tracking-tight">Transform Fragmented Info into Reusable Knowledge</h1>
                <p className="manual-lead text-base mt-3 opacity-90 leading-relaxed">
                  LingMo is a local-first AI notebook workstation. It unifies capturing, writing, RAG knowledge bases, AI models, automated link scraping, video transcriptions, learning review loops, and secure sync nodes into a single coherent system.
                </p>
              </header>
            }
          />
        </div>
        <div className="w-full md:w-[260px] lg:w-[320px] aspect-square flex items-center justify-center shrink-0">
          <HeroBannerIllustration />
        </div>
      </div>

      {/* 完整工作流 */}
      <section className="manual-section">
        <DualLang
          zh={
            <>
              <h2>LingMo 的完整工作流</h2>
              <p>
                使用 LingMo 时，不需要一开始就把资料整理得很完美。更推荐的方式是：先收集，再整理，再写作，然后用 AI、知识库、闪卡、活跃度和同步把资料变成长期可用的知识系统。
              </p>
            </>
          }
          en={
            <>
              <h2>Complete Workflow of LingMo</h2>
              <p>
                With LingMo, you don't need to organize everything perfectly at first. We highly recommend: capture first, then organize, then write, and finally leverage AI models, vector search, flashcards, active reviews, and multi-end synchronizations to cultivate an enduring knowledge system.
              </p>
            </>
          }
        />
        <div className="manual-process overflow-x-auto py-2">
          <DualLang
            zh={
              <div className="flex items-center gap-2 whitespace-nowrap">
                {['收集', '整理', '写作', '检索', '学习', '复盘', '同步'].map((step, index) => (
                  <span key={step} className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-text)] text-sm">{step}</span>
                    {index < 6 ? <ArrowRight className="h-3.5 w-3.5 opacity-40" /> : null}
                  </span>
                ))}
              </div>
            }
            en={
              <div className="flex items-center gap-2 whitespace-nowrap">
                {['Capture', 'Organize', 'Write', 'Retrieve', 'Learn', 'Review', 'Sync'].map((step, index) => (
                  <span key={step} className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-text)] text-sm">{step}</span>
                    {index < 6 ? <ArrowRight className="h-3.5 w-3.5 opacity-40" /> : null}
                  </span>
                ))}
              </div>
            }
          />
        </div>
      </section>

      {/* 功能地图 (Bento Grid) */}
      <section className="manual-section">
        <h2><T zh="功能地图" en="Feature Blueprint" /></h2>
        <DualLang
          zh={<p>LingMo 的功能不是分散工具，而是一条从资料输入到知识沉淀的链路。下面这些模块可以单独使用，也可以互相联动。</p>}
          en={<p>The features in LingMo are not isolated utilities; they form a seamless path from raw data input to consolidated wisdom. These modules can operate independently or hook together.</p>}
        />
        <div className="module-grid">
          {moduleOverviewItems.map(item => {
            const Icon = item.icon
            const trans = moduleTrans[item.title] || { enTitle: item.title, enDesc: item.description }
            return (
              <Link href={item.href} key={item.title} className="module-card">
                <Icon className="module-card-icon" />
                <span className="flex-1">
                  <DualLang
                    zh={
                      <>
                        <strong>{item.title}</strong>
                        <small>{item.description}</small>
                      </>
                    }
                    en={
                      <>
                        <strong>{trans.enTitle}</strong>
                        <small>{trans.enDesc}</small>
                      </>
                    }
                  />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* 常用入口对照 (表格) */}
      <section className="manual-section">
        <h2><T zh="常用入口对照" en="Quick Navigation Reference" /></h2>
        <DualLang
          zh={
            <table>
              <thead>
                <tr>
                  <th>你想做什么</th>
                  <th>去哪里</th>
                  <th>相关文档</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.zhTask}</td>
                    <td>{item.zhGo}</td>
                    <td><Link href={item.href}>{item.zhDoc}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          en={
            <table>
              <thead>
                <tr>
                  <th>What you want to do</th>
                  <th>Where to go</th>
                  <th>Related Doc</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.enTask}</td>
                    <td>{item.enGo}</td>
                    <td><Link href={item.href}>{item.enDoc}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </section>

      {/* AI 三种模式 */}
      <section className="manual-section">
        <h2><T zh="AI 的三种执行模式" en="Three AI Execution Modes" /></h2>
        <DualLang
          zh={<p>右侧聊天区的模式切换决定 AI 的工作方式。选对模式，会比写更长的提示词更重要。</p>}
          en={<p>Switching modes in the right sidebar alters how the AI functions. Selecting the appropriate model is far more impactful than drafting endless prompts.</p>}
        />
        <div className="ai-mode-overview">
          <DualLang
            zh={
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                <article className="border border-[var(--color-border-subtle)] p-4 rounded-xl bg-[var(--color-bg-card)]">
                  <MessageCircle className="h-5 w-5 text-amber-500 mb-2" />
                  <h3>Chat</h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">用于快速问答、解释、总结、翻译和局部改写。</p>
                </article>
                <article className="border border-[var(--color-border-subtle)] p-4 rounded-xl bg-[var(--color-bg-card)]">
                  <Bot className="h-5 w-5 text-amber-500 mb-2" />
                  <h3>Agent</h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">用于读取文件、整理记录、调用工具、创建笔记和执行本地任务。</p>
                </article>
                <article className="border border-[var(--color-border-subtle)] p-4 rounded-xl bg-[var(--color-bg-card)]">
                  <Telescope className="h-5 w-5 text-amber-500 mb-2" />
                  <h3>Deep Research</h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">用于联网检索、来源验证、证据分析和研究报告生成。</p>
                </article>
              </div>
            }
            en={
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                <article className="border border-[var(--color-border-subtle)] p-4 rounded-xl bg-[var(--color-bg-card)]">
                  <MessageCircle className="h-5 w-5 text-amber-500 mb-2" />
                  <h3>Chat</h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Ideal for rapid Q&As, code explanations, text summaries, translation, and localized copywriting.</p>
                </article>
                <article className="border border-[var(--color-border-subtle)] p-4 rounded-xl bg-[var(--color-bg-card)]">
                  <Bot className="h-5 w-5 text-amber-500 mb-2" />
                  <h3>Agent</h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Reads workspace assets, invokes shell tools, generates Markdown cards, and executes local system tasks.</p>
                </article>
                <article className="border border-[var(--color-border-subtle)] p-4 rounded-xl bg-[var(--color-bg-card)]">
                  <Telescope className="h-5 w-5 text-amber-500 mb-2" />
                  <h3>Deep Research</h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Executes online queries, clarifies facts, structures evidence logs, and synthesizes structured PDF reports.</p>
                </article>
              </div>
            }
          />
        </div>
        <Link href="/ai" className="manual-primary-link mt-4 inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <T zh="查看 AI 模式说明" en="View Detailed AI Guidelines" />
        </Link>
      </section>

      {/* 模块详解 */}
      <section className="manual-section">
        <h2><T zh="核心模块详解" en="Deep Dive into Core Modules" /></h2>
        <div className="module-explain-list">
          {homeSections.map(section => {
            const trans = homeSectionsTrans[section.title] || {
              enTitle: section.title,
              enSummary: section.summary,
              enEntry: section.entry,
              enWorkflow: section.workflow,
              enDetails: section.details,
            }
            return (
              <article key={section.number} className="module-explain-card">
                <div className="module-explain-index">{section.number}</div>
                <div className="module-explain-body">
                  <div className="module-explain-title-row">
                    <DualLang
                      zh={<h3>{section.title}</h3>}
                      en={<h3>{trans.enTitle}</h3>}
                    />
                    <Link href={section.href}>
                      <T zh="查看详情" en="View Details" /> <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <DualLang
                    zh={<p className="text-sm my-2 text-[var(--color-text-muted)] leading-relaxed">{section.summary}</p>}
                    en={<p className="text-sm my-2 text-[var(--color-text-muted)] leading-relaxed">{trans.enSummary}</p>}
                  />
                  <div className="module-meta">
                    <span><T zh="入口" en="Entry" /></span>
                    <strong><T zh={section.entry} en={trans.enEntry} /></strong>
                  </div>
                  
                  <DualLang
                    zh={
                      <ul className="my-3 space-y-1">
                        {section.details.map(detail => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    }
                    en={
                      <ul className="my-3 space-y-1">
                        {trans.enDetails.map(detail => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    }
                  />

                  <div className="module-flow" aria-label={`${section.title} 推荐流程`}>
                    <DualLang
                      zh={
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {section.workflow.map((step, index) => (
                            <span key={step} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                              <span>{step}</span>
                              {index < section.workflow.length - 1 ? <ArrowRight className="h-3 w-3 opacity-60" /> : null}
                            </span>
                          ))}
                        </div>
                      }
                      en={
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {trans.enWorkflow.map((step, index) => (
                            <span key={step} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                              <span>{step}</span>
                              {index < trans.enWorkflow.length - 1 ? <ArrowRight className="h-3 w-3 opacity-60" /> : null}
                            </span>
                          ))}
                        </div>
                      }
                    />
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* 常用配置 */}
      <section className="manual-section">
        <h2><T zh="全局高级配置" en="Global Advanced Configuration" /></h2>
        <div className="config-list">
          {configurationItems.map(item => {
            const Icon = item.icon
            const trans = configTrans[item.title] || { enTitle: item.title, enDesc: item.description }
            return (
              <Link href={item.href} key={item.title} className="config-item">
                <Icon className="h-5 w-5 text-amber-500 shrink-0" />
                <span>
                  <DualLang
                    zh={
                      <>
                        <strong>{item.title}</strong>
                        <small>{item.description}</small>
                      </>
                    }
                    en={
                      <>
                        <strong>{trans.enTitle}</strong>
                        <small>{trans.enDesc}</small>
                      </>
                    }
                  />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* 推荐阅读顺序 */}
      <section className="manual-section manual-note bg-gradient-to-r from-[var(--color-bg-inset)] to-[var(--color-bg-card)] border border-[var(--color-border-subtle)] p-6 rounded-2xl">
        <DualLang
          zh={
            <>
              <h2>推荐阅读顺序</h2>
              <p className="text-sm opacity-90 leading-relaxed mb-4">
                第一次使用建议按“快速开始 → 记录 → 写作 → AI → 知识库”的顺序阅读。如果你主要想整理网页、开源项目或视频内容，可以直接看“链接”和“视频语音”。
              </p>
            </>
          }
          en={
            <>
              <h2>Recommended Reading Path</h2>
              <p className="text-sm opacity-90 leading-relaxed mb-4">
                For beginners, we highly recommend following: "Quick Start → Capture → Writing → AI → Knowledge Base". If your main goal is to scrap web pages, GitHub repositories, or video podcasts, you can jump directly to "Links" and "Video & Audio".
              </p>
            </>
          }
        />
        <Link href="/quick-start" className="manual-primary-link inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <T zh="从快速开始进入" en="Start with Quick Start" />
        </Link>
      </section>
    </DocsShell>
  )
}

