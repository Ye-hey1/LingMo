"use client"

import * as React from "react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { join } from "@tauri-apps/api/path"
import { copyFile, exists, mkdir, readDir } from "@tauri-apps/plugin-fs"
import { debounce } from "lodash-es"
import {
  ChevronDown,
  DraftingCompass,
  FilePlus,
  FolderInput,
  FolderPlus,
  LoaderCircle,
  Plus,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import emitter from "@/lib/emitter"
import { createDiagramFile } from "@/lib/create-diagram-file"
import type { DiagramKind } from "@/lib/diagram"
import { getWorkspacePath } from "@/lib/workspace"
import useArticleStore from "@/stores/article"

import { DIAGRAM_TYPE_OPTIONS } from "./diagram-type-menu"

interface FileActionsProps {
  compact?: boolean
  dense?: boolean
  showArticle?: boolean
  showDiagram?: boolean
  showFolder?: boolean
  showImport?: boolean
}

export function FileActions({
  compact = false,
  dense = false,
  showArticle = true,
  showDiagram = true,
  showFolder = true,
  showImport = true,
}: FileActionsProps) {
  const {
    activeFilePath,
    loadFileTree,
    newFolder,
  } = useArticleStore()
  const t = useTranslations("article.file.toolbar")
  const [isImporting, setIsImporting] = React.useState(false)
  const compactButtonClassName = dense
    ? "size-5 rounded-sm text-muted-foreground hover:text-foreground"
    : "size-7 rounded-md text-muted-foreground hover:text-foreground"
  const compactIconClassName = dense ? "size-3" : "h-4 w-4"

  const debounceNewFolder = debounce(newFolder, 200)

  function handleNewArticle() {
    emitter.emit('template-select-dialog:open')
  }

  async function handleNewDiagram(kind: DiagramKind) {
    const parentPath = activeFilePath?.includes("/") ? activeFilePath.split("/").slice(0, -1).join("/") : ""

    try {
      await createDiagramFile(parentPath, kind)
    } catch (error) {
      toast({
        description: String(error),
        variant: "destructive",
      })
    }
  }

  async function copyMarkdownFilesRecursively(sourceDir: string, targetDir: string, relativePath = ""): Promise<number> {
    let copiedCount = 0

    try {
      const entries = await readDir(sourceDir)

      for (const entry of entries) {
        if (entry.name.startsWith(".")) {
          continue
        }

        const sourcePath = await join(sourceDir, entry.name)
        const newRelativePath = relativePath ? await join(relativePath, entry.name) : entry.name
        const targetPath = await join(targetDir, newRelativePath)

        if (entry.isDirectory) {
          copiedCount += await copyMarkdownFilesRecursively(sourcePath, targetDir, newRelativePath)
        } else if (entry.isFile) {
          const isMd = entry.name.endsWith(".md")
          const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(entry.name)
          const isPdf = /\.pdf$/i.test(entry.name)

          if (isMd || isImage || isPdf) {
            const targetDirPath = relativePath ? await join(targetDir, relativePath) : targetDir
            if (!(await exists(targetDirPath))) {
              await mkdir(targetDirPath, { recursive: true })
            }

            await copyFile(sourcePath, targetPath)
            copiedCount += 1
          }
        }
      }
    } catch (error) {
      console.error("Error copying files:", error)
      throw error
    }

    return copiedCount
  }

  async function handleImportMarkdown() {
    try {
      setIsImporting(true)

      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: t("importMarkdown"),
      })

      if (!selectedPath) {
        setIsImporting(false)
        return
      }

      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom
        ? workspace.path
        : await join(await import("@tauri-apps/api/path").then((module) => module.appDataDir()), "article")

      const copiedCount = await copyMarkdownFilesRecursively(selectedPath as string, targetDir)

      await loadFileTree()

      toast({
        title: t("importSuccess"),
        description: t("importSuccessDesc", { count: copiedCount }),
      })
    } catch (error) {
      console.error("Import markdown error:", error)
      toast({
        title: t("importError"),
        description: String(error),
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-0.5">
        {showArticle ? (
          <TooltipButton
            icon={<FilePlus className={compactIconClassName} />}
            tooltipText={t("newArticle")}
            onClick={handleNewArticle}
            side="bottom"
            buttonClassName={compactButtonClassName}
          />
        ) : null}
        {showDiagram ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("newDiagram")}
                title={t("newDiagram")}
                className={compactButtonClassName}
              >
                <DraftingCompass className={compactIconClassName} />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[196px] p-1">
            {DIAGRAM_TYPE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.kind} className="gap-2 rounded-md px-2 py-2" onSelect={() => handleNewDiagram(option.kind)}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                  {option.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{option.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{option.description}</span>
                </span>
                <span className="ml-2 text-[10px] text-muted-foreground">{option.meta}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {showFolder ? (
          <TooltipButton
            icon={<FolderPlus className={compactIconClassName} />}
            tooltipText={t("newFolder")}
            onClick={debounceNewFolder}
            side="bottom"
            buttonClassName={compactButtonClassName}
          />
        ) : null}
        {showImport ? (
          <TooltipButton
            icon={isImporting ? <LoaderCircle className={cn(compactIconClassName, "animate-spin")} /> : <FolderInput className={compactIconClassName} />}
            tooltipText={isImporting ? t("importing") : t("importMarkdown")}
            onClick={handleImportMarkdown}
            disabled={isImporting}
            side="top"
            buttonClassName={compactButtonClassName}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={compact ? "outline" : "ghost"}
            size={compact ? "icon" : "sm"}
            aria-label={t("createMenu")}
            title={t("createMenu")}
            className={cn(
              compact ? "size-7 rounded-md border-border/70 bg-background shadow-sm" : "h-8 rounded-md px-2.5 text-xs hover:bg-accent",
            )}
          >
            <Plus className="h-4 w-4" />
            {!compact ? <span className="font-medium">{t("createMenu")}</span> : null}
            {!compact ? <ChevronDown className="h-3.5 w-3.5 opacity-60" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={handleNewArticle}>
            <FilePlus className="h-4 w-4" />
            {t("newArticle")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={debounceNewFolder}>
            <FolderPlus className="h-4 w-4" />
            {t("newFolder")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DraftingCompass className="h-4 w-4" />
              {t("newDiagram")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[196px] p-1">
              {DIAGRAM_TYPE_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.kind} className="gap-2 rounded-md px-2 py-2" onSelect={() => handleNewDiagram(option.kind)}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                    {option.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{option.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{option.description}</span>
                  </span>
                  <span className="ml-2 text-[10px] text-muted-foreground">{option.meta}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleImportMarkdown} disabled={isImporting}>
            {isImporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
            {isImporting ? t("importing") : t("importMarkdown")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
