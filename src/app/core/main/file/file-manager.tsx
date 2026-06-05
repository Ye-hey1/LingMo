'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { rename, readTextFile, readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { getCurrentWebview } from "@tauri-apps/api/webview"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { computedParentPath } from "@/lib/path"
import {
  getLingMoFilePointerDragDetail,
  LINGMO_FILE_POINTER_DRAG_EVENT,
} from "@/lib/file-pointer-drag"
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

function readInternalDragPath(value: string) {
  let actualPath = value
  try {
    const parsed = JSON.parse(value)
    if (parsed?.path) actualPath = parsed.path
  } catch {
    // Plain text paths are still supported for older native drag payloads.
  }
  return actualPath
}

function getFileParentPath(filePath: string) {
  return filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : ""
}

function collectVisibleFilePaths(items: DirTree[]) {
  const paths: string[] = []

  const visit = (nodes: DirTree[]) => {
    for (const node of nodes) {
      if (node.isFile) {
        paths.push(computedParentPath(node))
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }

  visit(items)
  return paths
}

function Tree({
  item,
  focusSidebar,
  forceExpanded = false,
  selectedFilePaths,
  onFileSelectionClick,
  onFileContextMenu,
  onClearFileSelection,
  activeDropTargetFolder,
}: {
  item: DirTree
  focusSidebar: () => void
  forceExpanded?: boolean
  selectedFilePaths: string[]
  onFileSelectionClick: (event: React.MouseEvent<HTMLElement>, path: string) => boolean
  onFileContextMenu: (path: string) => void
  onClearFileSelection: () => void
  activeDropTargetFolder: string
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
    return (
      <FileItem
        item={item}
        focusSidebar={focusSidebar}
        selectedFilePaths={selectedFilePaths}
        onFileSelectionClick={onFileSelectionClick}
        onFileContextMenu={onFileContextMenu}
        onClearFileSelection={onClearFileSelection}
      />
    )
  }

  return (
    <li>
      <Collapsible
        onOpenChange={handleCollapse}
        className="group/collapsible [&[data-state=open]>button>.file-manange-item>svg:first-child]:rotate-90"
        open={forceExpanded || collapsibleList.includes(path)}
      >
        <FolderItem
          item={item}
          focusSidebar={focusSidebar}
          forceExpanded={forceExpanded}
          isDropTarget={activeDropTargetFolder === path}
        />
        <CollapsibleContent className="file-manager-nested">
          <ul>
            {item.children?.map((subItem) => (
              <Tree
                key={`${computedParentPath(subItem)}-${subItem.isLocale}`}
                item={subItem}
                focusSidebar={focusSidebar}
                forceExpanded={forceExpanded}
                selectedFilePaths={selectedFilePaths}
                onFileSelectionClick={onFileSelectionClick}
                onFileContextMenu={onFileContextMenu}
                onClearFileSelection={onClearFileSelection}
                activeDropTargetFolder={activeDropTargetFolder}
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
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([])
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>("")
  const [activeDropTargetFolder, setActiveDropTargetFolder] = useState("")
  const { fileTree, loadFileTree } = useArticleStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const dropTargetFolderRef = useRef<string>("")
  const autoExpandTimerRef = useRef<number | null>(null)
  const autoExpandTargetRef = useRef("")

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

  const resolveInternalDropTarget = useCallback((position: { x: number; y: number }) => {
    const el = containerRef.current
    const target = document.elementFromPoint(position.x, position.y)
    if (!el || !target || !el.contains(target)) {
      return { inside: false, targetFolder: "", overTreeItem: false }
    }

    const targetElement = target as HTMLElement
    const folderEl = targetElement.closest<HTMLElement>("[data-file-manager-folder-path]")
    if (folderEl && el.contains(folderEl)) {
      return {
        inside: true,
        targetFolder: folderEl.dataset.fileManagerFolderPath || "",
        overTreeItem: true,
      }
    }

    const fileEl = targetElement.closest<HTMLElement>("[data-file-manager-file-path]")
    return {
      inside: true,
      targetFolder: "",
      overTreeItem: Boolean(fileEl && el.contains(fileEl)),
    }
  }, [])

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current !== null) {
      window.clearTimeout(autoExpandTimerRef.current)
      autoExpandTimerRef.current = null
    }
    autoExpandTargetRef.current = ""
  }, [])

  const scheduleFolderAutoExpand = useCallback((folderPath: string) => {
    if (!folderPath || forceExpanded) {
      clearAutoExpandTimer()
      return
    }

    if (autoExpandTargetRef.current === folderPath) {
      return
    }

    clearAutoExpandTimer()
    autoExpandTargetRef.current = folderPath
    autoExpandTimerRef.current = window.setTimeout(() => {
      autoExpandTimerRef.current = null
      autoExpandTargetRef.current = ""
      void (async () => {
        const store = useArticleStore.getState()
        if (!store.collapsibleList.includes(folderPath)) {
          await store.setCollapsibleList(folderPath, true)
        }
        await store.loadCollapsibleFiles(folderPath)
      })()
    }, 600)
  }, [clearAutoExpandTimer, forceExpanded])

  const updateActiveDropTargetFolder = useCallback((folderPath: string) => {
    dropTargetFolderRef.current = folderPath
    setActiveDropTargetFolder(prev => prev === folderPath ? prev : folderPath)
    scheduleFolderAutoExpand(folderPath)
  }, [scheduleFolderAutoExpand])

  const clearActiveDropTargetFolder = useCallback(() => {
    dropTargetFolderRef.current = ""
    setActiveDropTargetFolder("")
    clearAutoExpandTimer()
  }, [clearAutoExpandTimer])

  const moveInternalFile = useCallback(async (actualPath: string, targetFolder = "") => {
    const filename = actualPath.slice(actualPath.lastIndexOf("/") + 1)
    const sourceFolderPath = actualPath.includes("/") ? actualPath.split("/").slice(0, -1).join("/") : ""

    if (!filename || sourceFolderPath === targetFolder) {
      return
    }

    const { getFilePathOptions, getWorkspacePath } = await import("@/lib/workspace")
    const { generateCopyFilename } = await import("@/lib/default-filename")
    const workspace = await getWorkspacePath()
    const targetName = await generateCopyFilename(targetFolder, filename)
    const targetPath = targetFolder ? `${targetFolder}/${targetName}` : targetName

    if (actualPath === targetPath) {
      return
    }

    const oldPathOptions = await getFilePathOptions(actualPath)
    const newPathOptions = await getFilePathOptions(targetPath)

    if (workspace.isCustom) {
      await rename(oldPathOptions.path, newPathOptions.path)
    } else {
      await rename(oldPathOptions.path, newPathOptions.path, {
        newPathBaseDir: newPathOptions.baseDir,
        oldPathBaseDir: oldPathOptions.baseDir,
      })
    }

    const store = useArticleStore.getState()
    const movedInTree = store.moveLocalEntry(actualPath, targetPath)
    if (targetFolder) {
      await store.ensurePathExpanded(targetFolder)
    }
    if (!movedInTree) {
      await store.loadFileTree({ skipRemoteSync: true })
    }
    await store.syncOpenTabsForPathChange(actualPath, targetPath)

    if (actualPath === useArticleStore.getState().activeFilePath) {
      store.setActiveFilePath(targetPath)
    }
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
          clearActiveDropTargetFolder()
          return
        }

        // 检查鼠标是否在文件树容器内
        const { x, y } = event.payload.position
        const rect = el.getBoundingClientRect()
        isOverContainer = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        const targetFolder = isOverContainer ? resolveDropTargetFolder(event.payload.position) : ""
        updateActiveDropTargetFolder(targetFolder)
        setIsDragging(isOverContainer)
        return
      }

      if (type === 'leave') {
        setIsDragging(false)
        isOverContainer = false
        clearActiveDropTargetFolder()
        return
      }

      if (type === 'drop') {
        setIsDragging(false)
        isOverContainer = false
        if (isInternalFileDragActive()) {
          clearActiveDropTargetFolder()
          return
        }

        const { paths } = event.payload
        if (paths && paths.length > 0) {
          const targetFolder = resolveDropTargetFolder(event.payload.position) || dropTargetFolderRef.current
          void handleExternalDrop(paths, targetFolder)
        }
        clearActiveDropTargetFolder()
      }
    })

    return () => {
      void unlisten.then(fn => fn())
    }
  }, [clearActiveDropTargetFolder, handleExternalDrop, resolveDropTargetFolder, updateActiveDropTargetFolder])

  // 内部文件拖拽（文件树内移动到根目录）仍兼容旧的 DOM drag payload.
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
        await moveInternalFile(readInternalDragPath(renamePath), "")
      })()
    }

    el.addEventListener('drop', handleNativeDrop)
    return () => el.removeEventListener('drop', handleNativeDrop)
  }, [moveInternalFile])

  useEffect(() => {
    function handleFilePointerDrag(event: Event) {
      const detail = getLingMoFilePointerDragDetail(event)
      if (!detail?.path || detail.isDirectory) {
        return
      }

      if (detail.phase === "cancel") {
        clearActiveDropTargetFolder()
        return
      }

      const target = resolveInternalDropTarget({ x: detail.x, y: detail.y })
      const sourceFolderPath = getFileParentPath(detail.path)
      const targetFolder = target.inside && target.targetFolder && target.targetFolder !== sourceFolderPath
        ? target.targetFolder
        : ""

      if (detail.phase === "start" || detail.phase === "move") {
        updateActiveDropTargetFolder(targetFolder)
        return
      }

      clearActiveDropTargetFolder()

      if (!target.inside) {
        return
      }

      // Dropping over another file row should not silently move the file to root.
      if (!target.targetFolder && target.overTreeItem) {
        return
      }

      void moveInternalFile(detail.path, target.targetFolder)
    }

    window.addEventListener(LINGMO_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
    return () => {
      window.removeEventListener(LINGMO_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
      clearActiveDropTargetFolder()
    }
  }, [clearActiveDropTargetFolder, moveInternalFile, resolveInternalDropTarget, updateActiveDropTargetFolder])

  const visibleTree = useMemo(() => tree ?? fileTree, [fileTree, tree])
  const visibleFilePaths = useMemo(() => collectVisibleFilePaths(visibleTree), [visibleTree])

  const handleFileSelectionClick = useCallback((event: React.MouseEvent<HTMLElement>, path: string) => {
    if (event.shiftKey && selectionAnchorPath) {
      const start = visibleFilePaths.indexOf(selectionAnchorPath)
      const end = visibleFilePaths.indexOf(path)
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start]
        setSelectedFilePaths(visibleFilePaths.slice(from, to + 1))
        return true
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectionAnchorPath(path)
      setSelectedFilePaths(prev => (
        prev.includes(path)
          ? prev.filter(item => item !== path)
          : [...prev, path]
      ))
      return true
    }

    if (selectedFilePaths.length > 0) {
      setSelectedFilePaths([])
    }
    setSelectionAnchorPath(path)
    return false
  }, [selectedFilePaths.length, selectionAnchorPath, visibleFilePaths])

  const handleFileContextMenu = useCallback((path: string) => {
    setSelectionAnchorPath(path)
    setSelectedFilePaths(prev => prev.includes(path) ? prev : [path])
  }, [])

  const clearFileSelection = useCallback(() => {
    setSelectedFilePaths([])
  }, [])

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
                selectedFilePaths={selectedFilePaths}
                onFileSelectionClick={handleFileSelectionClick}
                onFileContextMenu={handleFileContextMenu}
                onClearFileSelection={clearFileSelection}
                activeDropTargetFolder={activeDropTargetFolder}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
