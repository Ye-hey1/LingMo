"use client"

import * as React from "react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { toast } from "@/hooks/use-toast"
import { readWorkspaceTextFile } from "@/lib/file-binary"
import { getAllMarkdownFiles, type MarkdownFile } from "@/lib/files"
import type { SourceWorkspaceTab } from "@/components/output-workshop/types"
import { getOutputFileName, getOutputTitleFromPath } from "@/lib/output-workshop/path-utils"

interface UseOutputFilesOptions {
  linkedFilePath?: string | null
  linkedFileContent?: string | null
  setSourceContent: (content: string) => void
  setSourceLabel: (label: string) => void
  setTitle: (title: string) => void
  setSourceWorkspaceTab: (tab: SourceWorkspaceTab) => void
  onSourceLoaded?: () => void
}

export function useOutputFiles({
  linkedFilePath,
  linkedFileContent,
  setSourceContent,
  setSourceLabel,
  setTitle,
  setSourceWorkspaceTab,
  onSourceLoaded,
}: UseOutputFilesOptions) {
  const [showFilePicker, setShowFilePicker] = React.useState(false)
  const [availableFiles, setAvailableFiles] = React.useState<MarkdownFile[]>([])
  const [fileSearchQuery, setFileSearchQuery] = React.useState("")
  const [loadingFiles, setLoadingFiles] = React.useState(false)

  const canLoadLinkedFile = React.useMemo(() => {
    if (linkedFileContent?.trim()) return true
    if (!linkedFilePath || linkedFilePath.startsWith("lingmo://")) return false
    return (linkedFilePath.split("/").pop() || "").includes(".")
  }, [linkedFileContent, linkedFilePath])

  const loadAvailableFiles = async () => {
    setLoadingFiles(true)
    try {
      const files = await getAllMarkdownFiles()
      setAvailableFiles(files)
    } catch (error) {
      console.error("加载文件列表失败:", error)
    } finally {
      setLoadingFiles(false)
    }
  }

  const filteredFiles = React.useMemo(() => {
    if (!fileSearchQuery.trim()) return availableFiles.slice(0, 50)
    const query = fileSearchQuery.toLowerCase()
    return availableFiles
      .filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.relativePath.toLowerCase().includes(query)
      )
      .slice(0, 50)
  }, [availableFiles, fileSearchQuery])

  const handleSelectFile = async (file: MarkdownFile) => {
    setShowFilePicker(false)
    setFileSearchQuery("")
    try {
      const content = await readWorkspaceTextFile(file.path)
      setSourceContent(content)
      setSourceLabel(file.relativePath || file.name)
      setTitle(getOutputTitleFromPath(file.name, "输出"))
      onSourceLoaded?.()
      toast({ title: "已载入笔记", description: file.name })
    } catch (error) {
      toast({
        title: "读取文件失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      })
    }
  }

  const browseLocalMarkdownFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "选择 Markdown 文件",
        filters: [
          { name: "Markdown / Text", extensions: ["md", "markdown", "txt"] },
        ],
      })

      if (!selected || Array.isArray(selected)) return

      const content = await readTextFile(selected)
      const fileName = getOutputFileName(selected)
      setSourceContent(content)
      setSourceLabel(fileName)
      setTitle(getOutputTitleFromPath(fileName, "输出"))
      setSourceWorkspaceTab("edit")
      onSourceLoaded?.()
      toast({ title: "已载入文件", description: fileName })
    } catch (error) {
      toast({
        title: "读取文件失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      })
    }
  }

  const loadLinkedFile = async () => {
    if (!canLoadLinkedFile) return
    if (linkedFileContent?.trim()) {
      setSourceContent(linkedFileContent)
      setSourceLabel(linkedFilePath || "当前文件")
      setTitle(getOutputTitleFromPath(linkedFilePath, "输出"))
      onSourceLoaded?.()
      return
    }
    if (!linkedFilePath) return
    try {
      const content = await readWorkspaceTextFile(linkedFilePath)
      setSourceContent(content)
      setSourceLabel(linkedFilePath)
      setTitle(getOutputTitleFromPath(linkedFilePath, "输出"))
      onSourceLoaded?.()
    } catch (error) {
      toast({
        title: "读取文件失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      })
    }
  }

  // 自动加载笔记列表
  React.useEffect(() => {
    if (showFilePicker && availableFiles.length === 0) {
      void loadAvailableFiles()
    }
  }, [showFilePicker])

  return {
    showFilePicker,
    setShowFilePicker,
    availableFiles,
    fileSearchQuery,
    setFileSearchQuery,
    loadingFiles,
    filteredFiles,
    canLoadLinkedFile,
    handleSelectFile,
    browseLocalMarkdownFile,
    loadLinkedFile,
  }
}
