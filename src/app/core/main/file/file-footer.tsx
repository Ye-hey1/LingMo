'use client'

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  ArrowDownAZ,
  Calendar,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Cloud,
  FolderOpen,
  FolderPlus,
  FolderSync,
  SlidersHorizontal,
  SortAsc,
  SortDesc,
} from "lucide-react"
import { useMemo } from "react"
import { useTranslations } from 'next-intl'

import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { getWorkspaceDisplayName } from "@/lib/workspace-name"
import { useSkillsStore } from "@/stores/skills"
import useArticleStore from "@/stores/article"
import useSettingStore from "@/stores/setting"
import { FileActions } from "./file-actions"
import { FileToolbar } from "./file-toolbar"

export function FileFooter() {
  const { workspacePath, workspaceHistory, setWorkspacePath } = useSettingStore()
  const { refreshSkills } = useSkillsStore()
  const {
    collapsibleList,
    clearCollapsibleList,
    loadFileTree,
    setActiveFilePath,
    setCurrentArticle,
    setShowCloudFiles,
    setSortDirection,
    setSortType,
    showCloudFiles,
    sortDirection,
    sortType,
    toggleAllFolders,
  } = useArticleStore()
  const tFile = useTranslations('settings.file')
  const tToolbar = useTranslations('article.file.toolbar')

  const currentWorkspaceName = useMemo(() => {
    return getWorkspaceDisplayName(workspacePath, tFile('workspace.defaultPath'))
  }, [workspacePath, tFile])

  async function handleSelectWorkspace() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: tFile('workspace.select'),
      })

      if (selected) {
        await switchWorkspace(selected as string)
      }
    } catch (error) {
      console.error('Select workspace failed:', error)
    }
  }

  async function switchWorkspace(path: string) {
    if (path === workspacePath) return

    try {
      await setWorkspacePath(path)
      await clearCollapsibleList()
      setActiveFilePath('')
      setCurrentArticle('')
      await loadFileTree()
      await refreshSkills()
    } catch (error) {
      console.error('Switch workspace failed:', error)
    }
  }

  async function handleResetWorkspace() {
    try {
      await setWorkspacePath('')
      await clearCollapsibleList()
      setActiveFilePath('')
      setCurrentArticle('')
      await loadFileTree()
      await refreshSkills()
    } catch (error) {
      console.error('Reset workspace failed:', error)
    }
  }

  return (
    <div className="flex h-6 items-center gap-1 overflow-hidden border-t border-border bg-background px-2 text-xs text-muted-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-5 min-w-0 flex-1 justify-between border-0 bg-transparent px-1 text-xs text-muted-foreground hover:bg-accent focus:ring-0"
          >
            <span className="truncate text-xs">{currentWorkspaceName}</span>
            <ChevronDown className="ml-1 size-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{tFile('workspace.actions')}</DropdownMenuLabel>
          <DropdownMenuItem onClick={handleSelectWorkspace}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {tFile('workspace.select')}
          </DropdownMenuItem>
          {workspacePath ? (
            <DropdownMenuItem onClick={handleResetWorkspace}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {tFile('workspace.defaultPath')}
            </DropdownMenuItem>
          ) : null}

          {workspaceHistory.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{tFile('workspace.history')}</DropdownMenuLabel>
              {workspaceHistory.map((path, index) => (
                <DropdownMenuItem key={index} onClick={() => switchWorkspace(path)}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  <span className="truncate" title={path}>
                    {getWorkspaceDisplayName(path, tFile('workspace.defaultPath'))}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}

          {!workspacePath && workspaceHistory.length === 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <FolderOpen className="mr-2 h-4 w-4" />
                {tFile('workspace.defaultPath')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <FileActions compact dense showArticle={false} showDiagram={false} showFolder={false} />
        <TooltipButton
          icon={<FolderSync className="size-3" />}
          tooltipText={tToolbar("refresh")}
          onClick={() => loadFileTree()}
          side="top"
          buttonClassName="size-5 rounded-sm text-muted-foreground hover:text-foreground"
        />
        <TooltipButton
          icon={<Cloud className={cn("size-3", showCloudFiles ? "text-foreground" : "opacity-55")} />}
          tooltipText={showCloudFiles ? tToolbar("hideCloudFiles") : tToolbar("showCloudFiles")}
          onClick={() => setShowCloudFiles(!showCloudFiles)}
          side="top"
          buttonClassName="size-5 rounded-sm text-muted-foreground hover:text-foreground"
        />
        <TooltipButton
          icon={collapsibleList.length > 0 ? <ChevronsDownUp className="size-3" /> : <ChevronsUpDown className="size-3" />}
          tooltipText={collapsibleList.length > 0 ? tToolbar("collapseAll") : tToolbar("expandAll")}
          onClick={toggleAllFolders}
          side="top"
          buttonClassName="size-5 rounded-sm text-muted-foreground hover:text-foreground"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={tToolbar("sortByName")}
            >
              <SlidersHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{tToolbar("sortByName")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setSortType("name")} className={sortType === "name" ? "bg-accent" : ""}>
              <ArrowDownAZ className="mr-2 h-4 w-4" />
              {tToolbar("sortByName")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortType("created")} className={sortType === "created" ? "bg-accent" : ""}>
              <Calendar className="mr-2 h-4 w-4" />
              {tToolbar("sortByCreated")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortType("modified")} className={sortType === "modified" ? "bg-accent" : ""}>
              <Calendar className="mr-2 h-4 w-4" />
              {tToolbar("sortByModified")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}>
              {sortDirection === "asc" ? <SortDesc className="mr-2 h-4 w-4" /> : <SortAsc className="mr-2 h-4 w-4" />}
              {sortDirection === "asc" ? tToolbar("sortDesc") : tToolbar("sortAsc")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <FileToolbar compact dense tooltipSide="top" />
      </div>
    </div>
  )
}
