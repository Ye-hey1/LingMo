'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Brain, Files, Github, Highlighter, ImagePlus, LayoutTemplate, Network, Newspaper, Settings, Star, WalletCards, Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useFavoritesStore from '@/stores/favorites'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useSidebarStore } from '@/stores/sidebar'
import useUpdateStore from '@/stores/update'
import { AiHotspotsModal } from '@/components/ai-hotspots-modal'
import { CreativeCanvasModal } from '@/components/creative-canvas-modal'
import { OutputWorkshopModal } from '@/components/output-workshop-modal'
import emitter from '@/lib/emitter'

import { FileActions } from './file/file-actions'
import { FLASHCARD_TAB_PATH } from './flashcard/flashcard-constants'
import { GITHUB_STARS_TAB_PATH } from './github-stars/github-stars-constants'
import { KNOWLEDGE_GRAPH_TAB_PATH } from './knowledge/knowledge-graph-constants'
import { MarkActions } from './mark/mark-actions'
import { MEMORY_TAB_PATH } from './memory/memory-constants'
import { AGENT_CENTER_TAB_PATH } from './agent/agent-constants'

// 动态导入：侧边栏各面板按需加载，减少首屏 bundle 大小
const FileSidebar = dynamic(() => import('./file/index').then(m => ({ default: m.FileSidebar })), { ssr: false })
const NoteSidebar = dynamic(() => import('./mark/index').then(m => ({ default: m.NoteSidebar })), { ssr: false })
const FavoritesSection = dynamic(() => import('./file/favorites-section').then(m => ({ default: m.FavoritesSection })), { ssr: false })

const SIDEBAR_TABS = [
  { title: 'files', icon: Files },
  { title: 'notes', icon: Highlighter },
] as const

function SidebarRailButton({
  active,
  disabled,
  icon,
  label,
  className,
  onClick,
  tooltipSide = 'right',
}: {
  active?: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  className?: string
  onClick?: () => void
  tooltipSide?: 'left' | 'right'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'size-8 rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground',
            active && 'bg-background text-foreground shadow-sm ring-1 ring-border/70',
            className,
          )}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function LeftSidebarRail() {
  const { leftSidebarTab, leftSidebarVisible, centerPanelVisible, setLeftSidebarTab, toggleLeftSidebar, toggleCenterPanel } = useSidebarStore()
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const setActiveFilePath = useArticleStore((state) => state.setActiveFilePath)
  const { hasUpdate } = useUpdateStore()
  const isSettingsOpen = useSettingsDialogStore((state) => state.isOpen)
  const closeSettingsDialog = useSettingsDialogStore((state) => state.close)
  const openSettingsDialog = useSettingsDialogStore((state) => state.open)
  const t = useTranslations()
  const tCommon = useTranslations('common')
  const [outputWorkshopOpen, setOutputWorkshopOpen] = useState(false)
  const [aiHotspotsOpen, setAiHotspotsOpen] = useState(false)
  const [creativeCanvasOpen, setCreativeCanvasOpen] = useState(false)
  const [creativeCanvasRequestId, setCreativeCanvasRequestId] = useState(0)
  const [creativeCanvasInitialPrompt, setCreativeCanvasInitialPrompt] = useState<string | null>(null)
  const [creativeCanvasInitialSourcePath, setCreativeCanvasInitialSourcePath] = useState<string | null>(null)
  const [workshopInitialPath, setWorkshopInitialPath] = useState<string | null>(null)
  const [workshopInitialContent, setWorkshopInitialContent] = useState<string | null>(null)

  useEffect(() => {
    const handleOpenWorkshop = (event: any) => {
      setWorkshopInitialPath(event.filePath || null)
      setWorkshopInitialContent(event.fileContent)
      setOutputWorkshopOpen(true)
    }

    const handleOpenCreativeCanvas = (event?: { prompt?: string; sourcePath?: string }) => {
      setCreativeCanvasInitialPrompt(event?.prompt || null)
      setCreativeCanvasInitialSourcePath(event?.sourcePath || null)
      setCreativeCanvasRequestId(current => current + 1)
      setCreativeCanvasOpen(true)
    }

    emitter.on('open-output-workshop', handleOpenWorkshop)
    emitter.on('open-creative-canvas', handleOpenCreativeCanvas)
    return () => {
      emitter.off('open-output-workshop', handleOpenWorkshop)
      emitter.off('open-creative-canvas', handleOpenCreativeCanvas)
    }
  }, [])

  const canLoadActiveFile = Boolean(
    activeFilePath &&
    !activeFilePath.startsWith('lingmo://') &&
    (activeFilePath.split('/').pop() || '').includes('.')
  )
  const linkedFileContent = workshopInitialContent ?? (
    outputWorkshopOpen && canLoadActiveFile
      ? useArticleStore.getState().currentArticle
      : null
  )

  const openFavorites = async () => {
    if (!leftSidebarVisible) {
      await toggleLeftSidebar()
    }
    await setLeftSidebarTab('favorites')
  }

  const openKnowledgeGraph = async () => {
    // 先确保中心面板可见
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
    // 然后设置文件路径，这样可以确保Tab创建逻辑正常执行
    await setActiveFilePath(KNOWLEDGE_GRAPH_TAB_PATH)
  }

  const openFlashcards = async () => {
    // 先确保中心面板可见
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
    // 然后设置文件路径
    await setActiveFilePath(FLASHCARD_TAB_PATH)
  }

  const openMemoryManager = async () => {
    // 先确保中心面板可见
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
    // 然后设置文件路径
    await setActiveFilePath(MEMORY_TAB_PATH)
  }

  const openGithubStars = async () => {
    // 先确保中心面板可见
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
    // 然后设置文件路径
    await setActiveFilePath(GITHUB_STARS_TAB_PATH)
  }

  const openAgentCenter = async () => {
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
    await setActiveFilePath(AGENT_CENTER_TAB_PATH)
  }

  const openCreativeCanvas = async () => {
    setCreativeCanvasInitialPrompt(null)
    setCreativeCanvasInitialSourcePath(null)
    setCreativeCanvasRequestId(current => current + 1)
    setCreativeCanvasOpen(true)
  }

  return (
    <TooltipProvider>
      <aside className="left-sidebar-rail">
        <div className="left-sidebar-rail-actions">
          <SidebarRailButton
            active={leftSidebarVisible && leftSidebarTab === 'favorites'}
            icon={<Star className="size-4" />}
            label={t('navigation.favorites')}
            onClick={() => {
              void openFavorites()
            }}
          />
          <SidebarRailButton
            active={activeFilePath === KNOWLEDGE_GRAPH_TAB_PATH}
            icon={<Network className="size-4" />}
            label="知识图谱"
            onClick={() => {
              void openKnowledgeGraph()
            }}
          />
          <SidebarRailButton
            active={activeFilePath === FLASHCARD_TAB_PATH}
            icon={<WalletCards className="size-4" />}
            label="闪卡"
            onClick={() => {
              void openFlashcards()
            }}
          />
          <SidebarRailButton
            active={activeFilePath === MEMORY_TAB_PATH}
            icon={<Brain className="size-4" />}
            label="记忆管理"
            onClick={() => {
              void openMemoryManager()
            }}
          />
          <SidebarRailButton
            active={activeFilePath === GITHUB_STARS_TAB_PATH}
            icon={<Github className="size-4" />}
            label="GitHub 管理"
            onClick={() => {
              void openGithubStars()
            }}
          />
          <SidebarRailButton
            active={activeFilePath === AGENT_CENTER_TAB_PATH}
            icon={<Workflow className="size-4" />}
            label="Agent 调度"
            onClick={() => {
              void openAgentCenter()
            }}
          />
          <SidebarRailButton
            active={creativeCanvasOpen}
            icon={<ImagePlus className="size-4" />}
            label={t('creativeCanvas.title')}
            onClick={() => {
              void openCreativeCanvas()
            }}
          />
          <SidebarRailButton
            active={aiHotspotsOpen}
            icon={<Newspaper className="size-4" />}
            label="AI 热点"
            onClick={() => {
              setAiHotspotsOpen(true)
            }}
          />
          <SidebarRailButton
            active={outputWorkshopOpen}
            icon={<LayoutTemplate className="size-4" />}
            label="智能排版"
            onClick={() => {
              setOutputWorkshopOpen(true)
            }}
          />
        </div>
        <div className="mt-auto flex flex-col items-center gap-2 pb-1">
          <SidebarRailButton
            active={isSettingsOpen}
            icon={(
              <span className="relative">
                <Settings className="size-4" />
                {hasUpdate && !isSettingsOpen ? (
                  <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500" />
                ) : null}
              </span>
            )}
            label={tCommon('settings')}
            className="relative"
            onClick={() => {
              if (isSettingsOpen) {
                closeSettingsDialog()
              } else {
                openSettingsDialog()
              }
            }}
          />
        </div>
      </aside>

      {/* 智能排版弹窗 */}
      <OutputWorkshopModal
        open={outputWorkshopOpen}
        onClose={() => {
          setOutputWorkshopOpen(false)
          setWorkshopInitialPath(null)
          setWorkshopInitialContent(null)
        }}
        linkedFilePath={workshopInitialPath ?? (canLoadActiveFile ? activeFilePath : null)}
        linkedFileContent={linkedFileContent}
      />
      <AiHotspotsModal
        open={aiHotspotsOpen}
        onClose={() => setAiHotspotsOpen(false)}
      />
      <CreativeCanvasModal
        open={creativeCanvasOpen}
        onClose={() => setCreativeCanvasOpen(false)}
        initialPrompt={creativeCanvasInitialPrompt}
        initialSourcePath={creativeCanvasInitialSourcePath}
        requestId={creativeCanvasRequestId}
      />
    </TooltipProvider>
  )
}

export function LeftSidebar() {
  const { leftSidebarTab, leftSidebarVisible, setLeftSidebarTab } = useSidebarStore()
  const { initFavorites } = useFavoritesStore()
  const previousPrimaryTabRef = useRef<'files' | 'notes'>('files')
  const t = useTranslations()
  const isFavoritesTab = leftSidebarTab === 'favorites'

  useEffect(() => {
    void initFavorites()
  }, [initFavorites])

  useEffect(() => {
    if (leftSidebarTab === 'files' || leftSidebarTab === 'notes') {
      previousPrimaryTabRef.current = leftSidebarTab
    }
  }, [leftSidebarTab])

  useEffect(() => {
    if (leftSidebarTab === 'creativeCanvas') {
      void setLeftSidebarTab(previousPrimaryTabRef.current)
    }
  }, [leftSidebarTab, setLeftSidebarTab])

  const exitFavorites = () => {
    void setLeftSidebarTab(previousPrimaryTabRef.current)
  }

  return (
    <TooltipProvider>
      <div className={cn('left-sidebar-shell h-full w-full overflow-hidden', !leftSidebarVisible && 'is-collapsed')}>
        <Tabs
          value={leftSidebarTab}
          onValueChange={(value) => {
            void setLeftSidebarTab(value as (typeof SIDEBAR_TABS)[number]['title'])
          }}
          className="flex h-full w-full flex-col"
        >
          <div className="left-sidebar-toolbar flex h-10 shrink-0 items-center border-b bg-muted/20 px-2">
            {isFavoritesTab ? (
              <div className="left-sidebar-toolbar-content flex min-w-0 flex-1 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                  <Star className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t('navigation.favorites')}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={t('common.back')}
                      onClick={exitFavorites}
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t('common.back')}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <div className="left-sidebar-toolbar-content flex min-w-0 flex-1 items-center justify-between gap-2">
                <TabsList className="h-8 rounded-md bg-background p-0.5">
                  {SIDEBAR_TABS.map((tab) => {
                    const Icon = tab.icon
                    return (
                      <TabsTrigger key={tab.title} value={tab.title} className="h-7 gap-1.5 rounded px-2 text-xs">
                        <Icon className="size-3.5" />
                        {t(`navigation.${tab.title === 'notes' ? 'record' : tab.title}`)}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
                <div className="shrink-0">
                  {leftSidebarTab === 'files' ? <FileActions compact showImport={false} /> : null}
                  {leftSidebarTab === 'notes' ? <MarkActions /> : null}
                </div>
              </div>
            )}
          </div>
          <div className="left-sidebar-panel-body min-h-0 flex-1 overflow-hidden">
            <TabsContent value="files" className="m-0 h-full overflow-hidden">
              <FileSidebar />
            </TabsContent>
            <TabsContent value="notes" className="m-0 h-full overflow-hidden">
              <NoteSidebar />
            </TabsContent>
            <TabsContent value="favorites" className="m-0 h-full overflow-hidden">
              <FavoritesSection showEmpty standalone />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </TooltipProvider>
  )
}
