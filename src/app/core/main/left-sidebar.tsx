'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Brain, Files, Highlighter, Network, Settings, Star, WalletCards } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useFavoritesStore from '@/stores/favorites'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useSidebarStore } from '@/stores/sidebar'
import useUpdateStore from '@/stores/update'

import { FavoritesSection } from './file/favorites-section'
import { FileActions } from './file/file-actions'
import { FileSidebar } from './file/index'
import { FLASHCARD_TAB_PATH } from './flashcard/flashcard-constants'
import { KNOWLEDGE_GRAPH_TAB_PATH } from './knowledge/knowledge-graph-constants'
import { MarkActions } from './mark/mark-actions'
import { NoteSidebar } from './mark/index'
import { MEMORY_TAB_PATH } from './memory/memory-constants'

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
  const { activeFilePath, setActiveFilePath } = useArticleStore()
  const { hasUpdate } = useUpdateStore()
  const isSettingsOpen = useSettingsDialogStore((state) => state.isOpen)
  const closeSettingsDialog = useSettingsDialogStore((state) => state.close)
  const openSettingsDialog = useSettingsDialogStore((state) => state.open)
  const t = useTranslations()
  const tCommon = useTranslations('common')

  const openFavorites = async () => {
    if (!leftSidebarVisible) {
      await toggleLeftSidebar()
    }
    await setLeftSidebarTab('favorites')
  }

  const openKnowledgeGraph = async () => {
    setActiveFilePath(KNOWLEDGE_GRAPH_TAB_PATH)
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
  }

  const openFlashcards = async () => {
    setActiveFilePath(FLASHCARD_TAB_PATH)
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
  }

  const openMemoryManager = async () => {
    setActiveFilePath(MEMORY_TAB_PATH)
    if (!centerPanelVisible) {
      await toggleCenterPanel()
    }
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
            label="记忆"
            onClick={() => {
              void openMemoryManager()
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
