'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { rename, readTextFile, readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { getCurrentWebview } from "@tauri-apps/api/webview"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { computedParentPath } from "@/lib/path"
import useArticleStore, { DirTree } from "@/stores/article"

import { FileItem } from "./file-item"
import { FolderItem } from "./folder-item"
import { writeDroppedFileToFolder, writeDroppedFileToRoot } from "./root-drop"

function isInternalFileDragActive() {
  if (typeof window === "undefined") {
    return false
  }

  return Boolean((window as unknown as { __lingMoDraggingFilePath?: string }).__lingMoDraggingFilePath)
}

function Tree({
  item,
  focusSidebar,
  forceExpanded = false,
}: {
  item: DirTree
  focusSidebar: () => void
  forceExpanded?: boolean
}) {
  const { collapsibleList, loadCollapsibleFiles, setCollapsibleList } = useArticleStore()
  const path = computedParentPath(item)

  function handleCollapse(isOpen: boolean) {
    setCollapsibleList(path, isOpen)
    if (isOpen) {
      loadCollapsibleFiles(path)
    }
  }

  if (item.isFile) {
    return <FileItem item={item} focusSidebar={focusSidebar} />
  }

  return (
    <li>
      <Collapsible
        onOpenChange={handleCollapse}
        className="group/collapsible [&[data-state=open]>button>.file-manange-item>svg:first-child]:rotate-90"
        open={forceExpanded || collapsibleList.includes(path)}
      >
        <FolderItem item={item} focusSidebar={focusSidebar} forceExpanded={forceExpanded} />
        <CollapsibleContent className="file-manager-nested">
          <ul>
            {item.children?.map((subItem) => (
              <Tree
                key={`${computedParentPath(subItem)}-${subItem.isLocale}`}
                item={subItem}
                focusSidebar={focusSidebar}
                forceExpanded={forceExpanded}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export function FileManager({
  focusSidebar,
  tree,
  forceExpanded = false,
}: {
  focusSidebar: () => void
  tree?: DirTree[]
  forceExpanded?: boolean
}) {
  const [isDragging, setIsDragging] = useState(false)
  const { fileTree, loadFileTree } = useArticleStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const dropTargetFolderRef = useRef<string>("")

  useEffect(() => {
    if (fileTree.length === 0) {
      loadFileTree()
    }
  }, [fileTree.length, loadFileTree])

  // 支持的文本文件扩展名（与编辑器保持一致）
  const TEXT_EXTENSIONS = /\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|html|htm|drawio)$/i
  // 支持的二进制文件扩展名
  const BINARY_EXTENSIONS = /\.(jpg|jpeg|png|gif|bmp|webp|svg|pdf)$/i

  const resolveDropTargetFolder = useCallback((position?: { x: number; y: number }) => {
    const el = containerRef.current
    if (!el || !position) {
      return ""
    }

    const target = document.elementFromPoint(position.x, position.y)
    if (!target || !el.contains(target)) {
      return ""
    }

    const folderEl = (target as HTMLElement).closest<HTMLElement>("[data-file-manager-folder-path]")
    if (!folderEl || !el.contains(folderEl)) {
      return ""
    }

    return folderEl.dataset.fileManagerFolderPath || ""
  }, [])

  // 处理外部文件拖入（通过 Tauri 的 onDragDropEvent）
  const handleExternalDrop = useCallback(async (paths: string[], targetFolder = "") => {
    const { getFilePathOptions } = await import("@/lib/workspace")
    const store = useArticleStore.getState()
    const importedPaths: string[] = []

    for (const filePath of paths) {
      const fileName = filePath.split(/[/\\]/).pop() || filePath

      if (TEXT_EXTENSIONS.test(fileName)) {
        // 文本类文件：md, txt, html, js, ts, json, yaml, drawio 等
        const content = await readTextFile(filePath)
        const relativePath = targetFolder
          ? await writeDroppedFileToFolder(
            { fileName, getFilePathOptions, writeTextFile },
            { kind: "text", content },
            targetFolder,
          )
          : await writeDroppedFileToRoot(
          { fileName, getFilePathOptions, writeTextFile },
          { kind: "text", content },
        )
        store.upsertLocalEntry(relativePath, false)
        importedPaths.push(relativePath)
      } else if (BINARY_EXTENSIONS.test(fileName)) {
        // 二进制文件：图片、PDF 等
        const content = await readFile(filePath)
        const relativePath = targetFolder
          ? await writeDroppedFileToFolder(
            { fileName, getFilePathOptions, writeFile },
            { kind: "binary", content },
            targetFolder,
          )
          : await writeDroppedFileToRoot(
          { fileName, getFilePathOptions, writeFile },
          { kind: "binary", content },
        )
        store.upsertLocalEntry(relativePath, false)
        importedPaths.push(relativePath)
      }
    }

    if (targetFolder) {
      await store.ensurePathExpanded(targetFolder)
    }

    const lastImportedPath = importedPaths[importedPaths.length - 1]
    if (lastImportedPath) {
      store.setActiveFilePath(lastImportedPath)
    }
  }, [])

  // 使用 Tauri 的 onDragDropEvent 监听外部文件拖放
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let isOverContainer = false

    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload

      if (type === 'enter' || type === 'over') {
        if (isInternalFileDragActive()) {
          setIsDragging(false)
          isOverContainer = false
          dropTargetFolderRef.current = ""
          return
        }

        // 检查鼠标是否在文件树容器内
        const { x, y } = event.payload.position
        const rect = el.getBoundingClientRect()
        isOverContainer = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        dropTargetFolderRef.current = isOverContainer ? resolveDropTargetFolder(event.payload.position) : ""
        setIsDragging(isOverContainer)
        return
      }

      if (type === 'leave') {
        setIsDragging(false)
        isOverContainer = false
        dropTargetFolderRef.current = ""
        return
      }

      if (type === 'drop') {
        setIsDragging(false)
        isOverContainer = false
        if (isInternalFileDragActive()) {
          dropTargetFolderRef.current = ""
          return
        }

        const { paths } = event.payload
        if (paths && paths.length > 0) {
          const targetFolder = resolveDropTargetFolder(event.payload.position) || dropTargetFolderRef.current
          void handleExternalDrop(paths, targetFolder)
        }
        dropTargetFolderRef.current = ""
      }
    })

    return () => {
      void unlisten.then(fn => fn())
    }
  }, [handleExternalDrop, resolveDropTargetFolder])

  // 内部文件拖拽（文件树内移动到根目录）仍使用 DOM 事件
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleNativeDrop(event: DragEvent) {
      const dt = event.dataTransfer
      if (!dt) return

      // 只处理内部拖拽（外部文件由 Tauri 事件处理）
      const renamePath = dt.getData("application/x-lingmo-file") || dt.getData("text")
      if (!renamePath) return

      event.preventDefault()
      event.stopPropagation()

      void (async () => {
        let actualPath = renamePath
        try {
          const parsed = JSON.parse(renamePath)
          if (parsed?.path) actualPath = parsed.path
        } catch {
          // actualPath 就是纯文本路径
        }

        const filename = actualPath.slice(actualPath.lastIndexOf("/") + 1)
        const { getFilePathOptions, getWorkspacePath } = await import("@/lib/workspace")
        const { generateCopyFilename } = await import("@/lib/default-filename")
        const workspace = await getWorkspacePath()
        const targetName = await generateCopyFilename("", filename)

        const oldPathOptions = await getFilePathOptions(actualPath)
        const newPathOptions = await getFilePathOptions(targetName)
        if (workspace.isCustom) {
          await rename(oldPathOptions.path, newPathOptions.path)
        } else {
          await rename(oldPathOptions.path, newPathOptions.path, {
            newPathBaseDir: newPathOptions.baseDir,
            oldPathBaseDir: oldPathOptions.baseDir,
          })
        }

        const { activeFilePath, loadFileTree, moveLocalEntry, setActiveFilePath, syncOpenTabsForPathChange } = useArticleStore.getState()
        const movedInTree = moveLocalEntry(actualPath, targetName)
        if (!movedInTree) {
          await loadFileTree({ skipRemoteSync: true })
        }
        await syncOpenTabsForPathChange(actualPath, targetName)

        if (actualPath === activeFilePath) {
          setActiveFilePath(targetName)
        }
      })()
    }

    el.addEventListener('drop', handleNativeDrop)
    return () => el.removeEventListener('drop', handleNativeDrop)
  }, [])

  const visibleTree = useMemo(() => tree ?? fileTree, [fileTree, tree])

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto">
      {/* 拖拽提示遮罩层 */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none bg-primary/5 border-2 border-dashed border-primary rounded-lg shadow-lg backdrop-blur-[1px] transition-all duration-200">
          <div className="flex flex-col items-center gap-2 p-6 bg-background/90 rounded-xl shadow-xl border border-primary/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary animate-bounce"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <p className="text-sm font-medium text-foreground">
              松开即可导入文件
            </p>
            <p className="text-xs text-muted-foreground">
              支持 txt、html、md、图片、PDF 等格式
            </p>
          </div>
        </div>
      )}
      <div className="file-manager-list flex-1">
        <div className="flex-1">
          <ul className="h-full">
            {visibleTree.map((item) => (
              <Tree
                key={`${computedParentPath(item)}-${item.isLocale}`}
                item={item}
                focusSidebar={focusSidebar}
                forceExpanded={forceExpanded}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
