'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, Github, Languages, Moon, PanelLeft, Search, Sun, X } from 'lucide-react'
import { docNavGroups } from '@/lib/docs'
import { LingMoLogo } from '@/components/lingmo-logo'
import { useLang, type Lang } from '@/components/translation'

const navTranslation: Record<string, { zh: string; en: string }> = {
  // 组标题
  '开始': { zh: '开始', en: 'Getting Started' },
  '核心功能': { zh: '核心功能', en: 'Core Features' },
  '资料处理': { zh: '资料处理', en: 'Data Processing' },
  '管理': { zh: '管理', en: 'Management' },

  // 项标题与描述
  '首页': { zh: '首页', en: 'Home' },
  'LingMo 是什么、适合谁、核心工作流和阅读路径。': { 
    zh: 'LingMo 是什么、适合谁、核心工作流和阅读路径。', 
    en: 'What is LingMo, target audience, core workflow, and reading path.' 
  },
  '快速开始': { zh: '快速开始', en: 'Quick Start' },
  '完成工作区、第一篇笔记、AI 模型和常用配置。': { 
    zh: '完成工作区、第一篇笔记、AI 模型和常用配置。', 
    en: 'Setup workspace, create your first note, configure AI models & settings.' 
  },
  '记录': { zh: '记录', en: 'Capture' },
  '收集文本、链接、截图、录音、文件和待办，并整理成笔记。': { 
    zh: '收集文本、链接、截图、录音、文件和待办，并整理成笔记。', 
    en: 'Collect text, links, screenshots, audio, files, and tasks into notes.' 
  },
  '写作': { zh: '写作', en: 'Writing' },
  '管理 Markdown 工作区、编辑正文、处理 PDF、图表 and 导出。': { 
    zh: '管理 Markdown 工作区、编辑正文、处理 PDF、图表和导出。', 
    en: 'Manage Markdown workspace, edit content, handle PDFs, charts, & export.' 
  },
  'AI': { zh: 'AI', en: 'AI' },
  'Chat 对话、Agent 执行和 Deep Research 深度研究。': { 
    zh: 'Chat 对话、Agent 执行和 Deep Research 深度研究。', 
    en: 'Chat conversation, Agent execution, and Deep Research.' 
  },
  '知识库': { zh: '知识库', en: 'Knowledge' },
  'RAG 检索、向量索引、BM25、Rerank and 知识图谱。': { 
    zh: 'RAG 检索、向量索引、BM25、Rerank 和知识图谱。', 
    en: 'RAG retrieval, vector indexing, BM25, Rerank, and knowledge graph.' 
  },
  '链接': { zh: '链接', en: 'Smart Links' },
  '整理普通网页、GitHub 仓库、公众号文章和网页资料。': { 
    zh: '整理普通网页、GitHub 仓库、公众号文章和网页资料。', 
    en: 'Organize standard web pages, GitHub repos, articles, and web resources.' 
  },
  '视频语音': { zh: '视频语音', en: 'Video & Audio' },
  '提取 B站、YouTube 字幕，下载音频并调用 STT 转写。': { 
    zh: '提取 B站、YouTube 字幕，下载音频并调用 STT 转写。', 
    en: 'Extract subtitles from Bilibili/YouTube, download audio, STT transcription.' 
  },
  '学习': { zh: '学习', en: 'Learning' },
  '用费曼追问、苏格拉底式提问和主动解释检查理解。': { 
    zh: '用费曼追问、苏格拉底式提问和主动解释检查理解。', 
    en: 'Use Feynman technique, Socratic questioning, and active explanation.' 
  },
  '闪卡': { zh: '闪卡', en: 'Flashcards' },
  '创建牌组，从笔记生成卡片，按到期、薄弱 and 掌握度复习。': { 
    zh: '创建牌组，从笔记生成卡片，按到期、薄弱和掌握度复习。', 
    en: 'Create decks, generate cards from notes, review by status and mastery.' 
  },
  '活跃度': { zh: '活跃度', en: 'Activity' },
  '查看记录、写作、聊天、AI、记忆 and 同步活动，并生成复盘。': { 
    zh: '查看记录、写作、聊天、AI、记忆和同步活动，并生成复盘。', 
    en: 'Track capture, writing, chat, AI, memory, and sync activities for review.' 
  },
  '记忆': { zh: '记忆', en: 'Memory' },
  '管理 LingMo、Claude Code、Codex CLI and OpenCode 的 AI 会话记忆。': { 
    zh: '管理 LingMo、Claude Code、Codex CLI 和 OpenCode 的 AI 会话记忆。', 
    en: 'Manage AI session memories for LingMo, Claude Code, Codex, and OpenCode.' 
  },
  '设置': { zh: '设置', en: 'Settings' },
  '配置模型、记录、编辑器、模板、MCP、Skills and 搜索服务。': { 
    zh: '配置模型、记录、编辑器、模板、MCP、Skills 和搜索服务。', 
    en: 'Configure models, capture, editor, templates, MCP, Skills, and search.' 
  },
  '同步': { zh: '同步', en: 'Sync' },
  '通过 GitHub、Gitee、GitLab、S3、WebDAV and 本地备份保护资料。': { 
    zh: '通过 GitHub、Gitee、GitLab、S3、WebDAV 和本地备份保护资料。', 
    en: 'Protect data with GitHub, Gitee, GitLab, S3, WebDAV, and local backup.' 
  },
}

function normalizePath(path: string) {
  if (path !== '/' && path.endsWith('/')) {
    return path.slice(0, -1)
  }
  return path
}

export function DocsShell({
  children,
  currentPath,
}: {
  children: React.ReactNode
  currentPath: string
}) {
  const normalizedCurrentPath = normalizePath(currentPath)
  const [collapsed, setCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [translationOpen, setTranslationOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  
  // 引入全局双语状态
  const { lang, setLang } = useLang()

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('lingmo-docs-theme')
    const savedCollapsed = window.localStorage.getItem('lingmo-docs-sidebar-collapsed')

    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme)
    }
    if (savedCollapsed === 'true') {
      setCollapsed(true)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('lingmo-docs-theme', theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('lingmo-docs-sidebar-collapsed', String(collapsed))
  }, [collapsed])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCollapsed(false)
        window.setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('')
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const getCurrentUrl = () => {
    if (typeof window === 'undefined') return 'https://lingmonote.cc.cd'
    return window.location.href
  }

  const openTranslatedPage = () => {
    const url = new URL('https://translate.google.com/translate')
    url.searchParams.set('sl', 'zh-CN')
    url.searchParams.set('tl', 'en')
    url.searchParams.set('u', getCurrentUrl())
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
    setTranslationOpen(false)
  }

  const copyCurrentLink = async () => {
    await navigator.clipboard.writeText(getCurrentUrl())
    setLinkCopied(true)
    window.setTimeout(() => setLinkCopied(false), 1400)
  }

  // 国际化标签文本
  const labels = {
    search: lang === 'zh' ? '搜索文档' : lang === 'en' ? 'Search docs' : '搜索 / Search',
    noResults: lang === 'zh' ? '没有匹配的页面' : lang === 'en' ? 'No matching pages' : '没有匹配 / No matches',
    quickStart: lang === 'zh' ? '快速开始' : lang === 'en' ? 'Quick Start' : '快速开始 / Quick Start',
    home: lang === 'zh' ? '欢迎使用 LingMo' : lang === 'en' ? 'Welcome to LingMo' : '欢迎使用 / Welcome to LingMo',
    collapse: collapsed
      ? (lang === 'en' ? 'Expand sidebar' : '展开侧边栏')
      : (lang === 'en' ? 'Collapse sidebar' : '折叠侧边栏'),
    language: lang === 'zh' ? '语言' : lang === 'en' ? 'Language' : '语言 / Language',
    theme: theme === 'light'
      ? (lang === 'en' ? 'Switch to dark' : '切换为深色模式')
      : (lang === 'en' ? 'Switch to light' : '切换为浅色模式'),
  }

  // 支持中英文联合双向搜索
  const visibleNavGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return docNavGroups

    return docNavGroups
      .map(group => {
        const transGroup = navTranslation[group.title] || { zh: group.title, en: group.title }
        return {
          ...group,
          items: group.items.filter(item => {
            const transTitle = navTranslation[item.title] || { zh: item.title, en: item.title }
            const transDesc = navTranslation[item.description] || { zh: item.description, en: item.description }
            const haystack = `${item.title} ${transTitle.zh} ${transTitle.en} ${item.description} ${transDesc.zh} ${transDesc.en} ${group.title} ${transGroup.zh} ${transGroup.en}`.toLowerCase()
            return haystack.includes(query)
          }),
        }
      })
      .filter(group => group.items.length > 0)
  }, [searchQuery])

  const currentTitle = docNavGroups
    .flatMap(group => group.items)
    .find(item => normalizePath(item.href) === normalizedCurrentPath)?.title

  const shellClassName = collapsed ? 'docs-app-shell docs-app-shell-collapsed' : 'docs-app-shell'

  return (
    <div className={shellClassName}>
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header">
          <Link href="/" className="docs-brand" aria-label="LingMo 使用文档首页">
            <LingMoLogo className="docs-brand-logo" />
            <span className="docs-brand-copy">
              <span className="docs-brand-title">LingMo</span>
            </span>
          </Link>
          <button
            type="button"
            className="docs-icon-button"
            aria-label={labels.collapse}
            aria-pressed={collapsed}
            title={labels.collapse}
            onClick={() => setCollapsed(value => !value)}
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        </div>

        <div className="docs-search" role="search">
          <Search className="h-5 w-5" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            className="docs-search-input"
            placeholder={labels.search}
            aria-label={labels.search}
          />
          {searchQuery ? (
            <button
              type="button"
              className="docs-search-clear"
              aria-label="清除搜索"
              onClick={() => {
                setSearchQuery('')
                searchInputRef.current?.focus()
              }}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <span className="docs-search-kbd">Ctrl</span>
          <span className="docs-search-kbd">K</span>
        </div>

        <nav className="docs-nav" aria-label="文档导航">
          {visibleNavGroups.length === 0 ? (
            <p className="docs-nav-empty">{labels.noResults}</p>
          ) : visibleNavGroups.map(group => {
            const transGroup = navTranslation[group.title] || { zh: group.title, en: group.title }
            return (
              <section key={group.title} className="docs-nav-group">
                <h2>
                  {lang === 'en' 
                    ? transGroup.en 
                    : lang === 'bilingual' 
                      ? `${transGroup.zh} / ${transGroup.en}` 
                      : transGroup.zh}
                </h2>
                <div className="docs-nav-list">
                  {group.items.map(item => {
                    const Icon = item.icon
                    const active = normalizePath(item.href) === normalizedCurrentPath
                    const transTitle = navTranslation[item.title] || { zh: item.title, en: item.title }
                    const transDesc = navTranslation[item.description] || { zh: item.description, en: item.description }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={active ? 'docs-nav-item docs-nav-item-active' : 'docs-nav-item'}
                        title={lang === 'en' ? transDesc.en : lang === 'bilingual' ? `${transDesc.zh} / ${transDesc.en}` : transDesc.zh}
                      >
                        <Icon className="docs-nav-icon" />
                        <span className="docs-nav-copy">
                          {lang === 'zh' && <span className="docs-nav-title">{transTitle.zh}</span>}
                          {lang === 'en' && <span className="docs-nav-title">{transTitle.en}</span>}
                          {lang === 'bilingual' && (
                            <span className="flex flex-col items-start leading-[1.3] py-0.5">
                              <span className="docs-nav-title text-[13px] font-semibold tracking-wide">{transTitle.zh}</span>
                              <span className="text-[10px] opacity-60 font-sans tracking-wide font-normal mt-[2px]">{transTitle.en}</span>
                            </span>
                          )}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </nav>

        <div className="docs-sidebar-footer flex items-center justify-between gap-1 w-full px-2 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sidebar)]">
          {/* 三态滑动胶囊滑块或循环微按钮 */}
          {!collapsed ? (
            <div className="flex items-center bg-[var(--color-bg-inset)] rounded-lg p-[3px] border border-[var(--color-border-subtle)] w-full max-w-[155px] relative overflow-hidden select-none text-[11px] font-medium text-[var(--color-text-muted)] h-8">
              {/* 滑动胶囊背景 */}
              <div 
                className="absolute top-[3px] bottom-[3px] rounded-md bg-[var(--color-bg-card)] shadow-xs transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] border border-[var(--color-border-subtle)]"
                style={{
                  left: lang === 'zh' ? '3px' : lang === 'en' ? 'calc(33.33% + 1px)' : 'calc(66.66% - 1px)',
                  width: 'calc(33.33% - 4px)',
                }}
              />
              <button 
                type="button"
                onClick={() => setLang('zh')}
                className={`flex-1 text-center py-1 z-10 transition-colors duration-200 relative text-[11px] ${lang === 'zh' ? 'text-[var(--color-text)] font-semibold' : 'hover:text-[var(--color-text)]'}`}
              >
                中
              </button>
              <button 
                type="button"
                onClick={() => setLang('en')}
                className={`flex-1 text-center py-1 z-10 transition-colors duration-200 relative text-[11px] ${lang === 'en' ? 'text-[var(--color-text)] font-semibold' : 'hover:text-[var(--color-text)]'}`}
              >
                EN
              </button>
              <button 
                type="button"
                onClick={() => setLang('bilingual')}
                className={`flex-1 text-center py-1 z-10 transition-colors duration-200 relative text-[11px] ${lang === 'bilingual' ? 'text-[var(--color-text)] font-semibold' : 'hover:text-[var(--color-text)]'}`}
              >
                双
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="docs-footer-button flex flex-col items-center justify-center relative p-1.5 hover:bg-[var(--color-bg-inset)] rounded-lg transition-colors border border-[var(--color-border-subtle)] w-8 h-8"
              aria-label={labels.language}
              title={`${labels.language}: ${lang === 'zh' ? '中文' : lang === 'en' ? 'English' : '双语对照'}`}
              onClick={() => {
                const nextLang: Lang = lang === 'zh' ? 'en' : lang === 'en' ? 'bilingual' : 'zh'
                setLang(nextLang)
              }}
            >
              <Languages className="h-4 w-4" />
              <span className="text-[9px] font-bold mt-[1px] opacity-90 select-none">
                {lang === 'zh' ? '中' : lang === 'en' ? 'EN' : '双'}
              </span>
            </button>
          )}

          <div className="flex items-center gap-1.5">
            <a className="docs-footer-button w-8 h-8 flex items-center justify-center hover:bg-[var(--color-bg-inset)] rounded-lg border border-transparent hover:border-[var(--color-border-subtle)]" href="https://github.com/Ye-hey1/LingMo" target="_blank" rel="noreferrer" aria-label="打开 GitHub">
              <Github className="h-4 w-4" />
            </a>
            <button
              type="button"
              className="docs-theme-toggle w-8 h-8 flex items-center justify-center hover:bg-[var(--color-bg-inset)] rounded-lg border border-transparent hover:border-[var(--color-border-subtle)] relative"
              aria-label={labels.theme}
              title={labels.theme}
              onClick={() => setTheme(value => (value === 'light' ? 'dark' : 'light'))}
            >
              <Sun className={theme === 'light' ? 'h-4 w-4 docs-theme-icon-active' : 'h-4 w-4 absolute opacity-0 transition-opacity'} />
              <Moon className={theme === 'dark' ? 'h-4 w-4 docs-theme-icon-active' : 'h-4 w-4 absolute opacity-0 transition-opacity'} />
            </button>
          </div>
        </div>
      </aside>

      <div className="docs-main-area">
        <header className="docs-topbar">
          <div className="docs-topbar-breadcrumb">
            <span className="docs-breadcrumb-dot" />
            <span>
              {normalizedCurrentPath === '/' 
                ? labels.home 
                : (lang === 'en' 
                    ? (navTranslation[currentTitle || '']?.en || currentTitle) 
                    : lang === 'bilingual' 
                      ? `${currentTitle} / ${(navTranslation[currentTitle || '']?.en || currentTitle)}` 
                      : currentTitle)}
            </span>
          </div>
          <nav className="docs-topbar-links" aria-label="快捷链接">
            <Link href="/quick-start">{labels.quickStart}</Link>
            <a href="https://github.com/Ye-hey1/LingMo" target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight className="h-4 w-4" />
            </a>
          </nav>
        </header>

        <main className="docs-content-scroll">
          <article className="docs-prose">{children}</article>
        </main>
      </div>
    </div>
  )
}
