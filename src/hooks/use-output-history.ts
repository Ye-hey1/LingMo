"use client"

import * as React from "react"
import { toast } from "@/hooks/use-toast"
import type {
  GenerationStatus,
  PreviewWorkspaceTab,
  SourceWorkspaceTab,
  HistorySnapshot,
} from "@/components/output-workshop/types"

interface UseOutputHistoryOptions {
  setGeneratedHtml: (html: string) => void
  setSourceContent: (content: string) => void
  setTitle: (title: string) => void
  setSelectedTemplateId: (id: string) => void
  setCustomInstructions: (instructions: string) => void
  setStatus: (status: GenerationStatus) => void
  setErrorMessage: (msg: string) => void
  setPreviewTab: (tab: PreviewWorkspaceTab) => void
  setSourceWorkspaceTab: (tab: SourceWorkspaceTab) => void
}

export function useOutputHistory({
  setGeneratedHtml,
  setSourceContent,
  setTitle,
  setSelectedTemplateId,
  setCustomInstructions,
  setStatus,
  setErrorMessage,
  setPreviewTab,
  setSourceWorkspaceTab,
}: UseOutputHistoryOptions) {
  const [historyList, setHistoryList] = React.useState<HistorySnapshot[]>([])
  const [renamingSnapshotId, setRenamingSnapshotId] = React.useState<string | null>(null)
  const [renamingSnapshotTitle, setRenamingSnapshotTitle] = React.useState("")

  // 挂载时加载历史快照
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("lingmo_output_history")
        if (saved) {
          setHistoryList(JSON.parse(saved))
        }
      } catch (e) {
        console.error("加载历史快照失败:", e)
      }
    }
  }, [])

  const persistHistoryList = React.useCallback((nextList: HistorySnapshot[]) => {
    try {
      localStorage.setItem("lingmo_output_history", JSON.stringify(nextList))
    } catch (e) {
      console.error("保存历史快照失败:", e)
    }
  }, [])

  const updateHistoryList = React.useCallback((updater: (prev: HistorySnapshot[]) => HistorySnapshot[]) => {
    setHistoryList((prev) => {
      const nextList = updater(prev)
      persistHistoryList(nextList)
      return nextList
    })
  }, [persistHistoryList])

  const saveSnapshot = React.useCallback((
    html: string,
    currentTitle: string,
    currentTemplateId: string,
    currentInstructions: string,
    currentSource: string
  ) => {
    if (!html) return
    setHistoryList((prev) => {
      if (prev.length > 0 && prev[0].generatedHtml === html) {
        return prev
      }
      const newSnapshot: HistorySnapshot = {
        id: String(Date.now()),
        timestamp: Date.now(),
        title: currentTitle || "未命名生成",
        templateId: currentTemplateId,
        customInstructions: currentInstructions,
        sourceContent: currentSource,
        generatedHtml: html,
      }
      const nextList = [newSnapshot, ...prev].slice(0, 10)
      persistHistoryList(nextList)
      return nextList
    })
  }, [persistHistoryList])

  const restoreSnapshot = React.useCallback((snapshot: HistorySnapshot) => {
    setGeneratedHtml(snapshot.generatedHtml)
    setSourceContent(snapshot.sourceContent)
    setTitle(snapshot.title)
    setSelectedTemplateId(snapshot.templateId)
    setCustomInstructions(snapshot.customInstructions)
    setStatus("done")
    setErrorMessage("")
    setPreviewTab("preview")
    setSourceWorkspaceTab("edit")
    toast({ title: "已恢复快照" })
  }, [setGeneratedHtml, setSourceContent, setTitle, setSelectedTemplateId, setCustomInstructions, setStatus, setErrorMessage, setPreviewTab, setSourceWorkspaceTab])

  const formatSnapshotTime = React.useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }, [])

  const startRenameSnapshot = React.useCallback((snapshot: HistorySnapshot) => {
    setRenamingSnapshotId(snapshot.id)
    setRenamingSnapshotTitle(snapshot.title)
  }, [])

  const cancelRenameSnapshot = React.useCallback(() => {
    setRenamingSnapshotId(null)
    setRenamingSnapshotTitle("")
  }, [])

  const commitRenameSnapshot = React.useCallback(() => {
    if (!renamingSnapshotId) return
    const nextTitle = renamingSnapshotTitle.trim()
    if (!nextTitle) {
      cancelRenameSnapshot()
      return
    }

    updateHistoryList((prev) =>
      prev.map((snapshot) =>
        snapshot.id === renamingSnapshotId
          ? { ...snapshot, title: nextTitle }
          : snapshot
      )
    )
    cancelRenameSnapshot()
    toast({ title: "快照已重命名" })
  }, [cancelRenameSnapshot, renamingSnapshotId, renamingSnapshotTitle, updateHistoryList])

  const deleteSnapshot = React.useCallback((snapshotId: string) => {
    updateHistoryList((prev) => prev.filter((snapshot) => snapshot.id !== snapshotId))
    if (renamingSnapshotId === snapshotId) {
      cancelRenameSnapshot()
    }
    toast({ title: "快照已删除" })
  }, [cancelRenameSnapshot, renamingSnapshotId, updateHistoryList])

  const clearAllSnapshots = React.useCallback(() => {
    updateHistoryList(() => [])
    cancelRenameSnapshot()
    toast({ title: "已清空全部快照" })
  }, [cancelRenameSnapshot, updateHistoryList])

  const exportSnapshotPack = React.useCallback(() => {
    if (historyList.length === 0) {
      toast({ title: "没有可导出的快照", variant: "destructive" })
      return
    }
    try {
      const pack = {
        version: 1,
        exportedAt: new Date().toISOString(),
        source: "LingMo 智能排版",
        snapshots: historyList,
      }
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `lingmo-snapshots-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: "快照包已导出" })
    } catch (e) {
      toast({ title: "导出失败", description: String(e), variant: "destructive" })
    }
  }, [historyList])

  return {
    historyList,
    renamingSnapshotId,
    renamingSnapshotTitle,
    setRenamingSnapshotTitle,
    saveSnapshot,
    restoreSnapshot,
    formatSnapshotTime,
    startRenameSnapshot,
    cancelRenameSnapshot,
    commitRenameSnapshot,
    deleteSnapshot,
    clearAllSnapshots,
    exportSnapshotPack,
  }
}
