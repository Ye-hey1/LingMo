'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { rename, readTextFile, readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { getCurrentWebview } from "@tauri-apps/api/webview"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { computedParentPath } from "@/lib/path"
import useArticleStore, { DirTree } from "@/stores/article"

import { FileItem } from "./file-item"
import { FolderItem } from "./folder-item"
import { writeDroppedFileToRoot } from "./root-drop"

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

  useEffect(() => {
    if (fileTree.length === 0) {
      loadFileTree()
    }
  }, [fileTree.length, loadFileTree])

  // 处理外部文件拖入（通过 Tauri 的 onDragDropEvent）
  const handleExternalDrop = useCallback(async (paths: string[]) => {
    const { getFilePathOptions } = await import("@/lib/workspace")

    for (const filePath of paths) {
      const fileName = filePath.split(/[/\\]/).pop() || filePath

      if (fileName.endsWith(".md")) {
        const content = await readTextFile(filePath)
        const sanitizedFileName = await writeDroppedFileToRoot(
          { fileName, getFilePathOptions, writeTextFile },
          { kind: "text", content },
        )
        useArticleStore.getState().addFile({
          name: sanitizedFileName,
          isEditing: false,
          isLocale: true,
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        })
        useArticleStore.getState().setActiveFilePath(sanitizedFileName)
      } else if (fileName.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
        const content = await readFile(filePath)
        const sanitizedFileName = await writeDroppedFileToRoot(
          { fileName, getFilePathOptions, writeFile },
          { kind: "binary", content },
        )
        useArticleStore.getState().addFile({
          name: sanitizedFileName,
          isEditing: false,
          isLocale: true,
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        })
      } else if (fileName.match(/\.pdf$/i)) {
        const content = await readFile(filePath)
        const sanitizedFileName = await writeDroppedFileToRoot(
          { fileName, getFilePathOptions, writeFile },
          { kind: "binary", content },
        )
        useArticleStore.getState().addFile({
          name: sanitizedFileName,
          isEditing: false,
          isLocale: true,
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        })
      }
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
        // 检查鼠标是否在文件树容器内
        if (type === 'over') {
          const { x, y } = event.payload.position
          const rect = el.getBoundingClientRect()
          isOverContainer = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
          if (isOverContainer) {
            setIsDragging(true)
          }
        }
        return
      }

      if (type === 'leave') {
        setIsDragging(false)
        isOverContainer = false
        return
      }

      if (type === 'drop') {
        setIsDragging(false)
        isOverContainer = false
        const { paths } = event.payload
        if (paths && paths.length > 0) {
          void handleExternalDrop(paths)
        }
      }
    })

    return () => {
      void unlisten.then(fn => fn())
    }
  }, [handleExternalDrop])

  // 内部文件拖拽（文件树内移动到根目录）仍使用 DOM 事件
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleNativeDrop(event: DragEvent) {
      const dt = event.dataTransfer
      if (!dt) return

      // 只处理内部拖拽（外部文件由 Tauri 事件处理）
      const renamePath = dt.getData("application/x-note-gen-file") || dt.getData("text")
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
        const workspace = await getWorkspacePath()

        const oldPathOptions = await getFilePathOptions(actualPath)
        const newPathOptions = await getFilePathOptions(filename)
        if (workspace.isCustom) {
          await rename(oldPathOptions.path, newPathOptions.path)
        } else {
          await rename(oldPathOptions.path, newPathOptions.path, {
            newPathBaseDir: newPathOptions.baseDir,
            oldPathBaseDir: oldPathOptions.baseDir,
          })
        }

        await useArticleStore.getState().loadFileTree()
        const { activeFilePath, setActiveFilePath } = useArticleStore.getState()
        if (actualPath === activeFilePath) {
          setActiveFilePath(filename)
        }
      })()
    }

    el.addEventListener('drop', handleNativeDrop)
    return () => el.removeEventListener('drop', handleNativeDrop)
  }, [])

  const visibleTree = useMemo(() => tree ?? fileTree, [fileTree, tree])

  return (
    <div ref={containerRef} className={`flex-1 overflow-y-auto ${isDragging && "outline-2 outline-black outline-dotted -outline-offset-4"}`}>
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
