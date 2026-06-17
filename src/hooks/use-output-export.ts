"use client"

import * as React from "react"
import { toast } from "@/hooks/use-toast"
import {
  toWechatHtml,
  copyHtmlToClipboard,
  copyTextToClipboard,
  copyIframeToClipboard,
  downloadIframeAsImage,
  downloadTextFile,
  exportDeckPngZip,
  exportDeckPptx,
  exportDeckPrint,
  exportIframeLongPng,
  exportIframeSlicesZip,
  saveHtmlToWorkspace,
  saveTextAs,
  type DeckParsed,
} from "@/lib/output-workshop/export"
import {
  exportSmartCardsZip,
  type SmartCard,
} from "@/lib/output-workshop/smart-card-export"
import { deployToVercel } from "@/lib/output-workshop/deploy"
import type { ExportRecord, PreviewSizePreset } from "@/components/output-workshop/types"

/**
 * 导出所需的最新生成状态（由 use-output-generation 通过 getLatest 提供）。
 * 用 getter 模式而非直接传 latestRef，避免 ref invariant 类型问题。
 */
export interface OutputExportLatest {
  generatedHtml: string
  sourceContent: string
  title: string
  selectedTemplate?: { name?: string } | null
  selectedTemplateId: string
  templateOverrides: { sizePresetId: string }
}

interface UseOutputExportParams {
  getLatest: () => OutputExportLatest
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  parsedDeckData: DeckParsed
}

/**
 * 输出工坊导出/部署逻辑：封装 export/deploy state、文件名生成、任务包装器、
 * 以及全部 15 个导出 handler。从 use-output-generation 提取，使其专注生成。
 */
export function useOutputExport({ getLatest, iframeRef, parsedDeckData }: UseOutputExportParams) {
  const [exportBusy, setExportBusy] = React.useState(false)
  const [exportProgressText, setExportProgressText] = React.useState("")
  const [lastExportRecord, setLastExportRecord] = React.useState<ExportRecord | null>(null)
  const [vercelToken, setVercelToken] = React.useState("")
  const [showDeployModal, setShowDeployModal] = React.useState(false)
  const [isDeploying, setIsDeploying] = React.useState(false)
  const [deployProgress, setDeployProgress] = React.useState("")
  const [deployedUrl, setDeployedUrl] = React.useState("")

  const buildExportBaseName = React.useCallback(() => {
    const current = getLatest()
    const date = new Date()
    const timestamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
    ].join("")
    const raw = [
      current.title || "lingmo-output",
      current.selectedTemplate?.name || current.selectedTemplateId,
      current.templateOverrides.sizePresetId,
      timestamp,
    ].filter(Boolean).join("-")
    return raw
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120)
      .replace(/^-|-$/g, "") || "lingmo-output"
  }, [getLatest])

  const rememberExport = React.useCallback((record: Omit<ExportRecord, "finishedAt">) => {
    setLastExportRecord({ ...record, finishedAt: Date.now() })
  }, [])

  const runExportTask = React.useCallback(async (taskName: string, fn: () => Promise<boolean | void>) => {
    setExportBusy(true)
    setExportProgressText(`正在${taskName}...`)
    try {
      const completed = await fn()
      if (completed !== false) {
        toast({ title: `${taskName}成功！` })
      }
    } catch (e) {
      console.error(e)
      toast({
        title: `${taskName}失败`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setExportBusy(false)
      setExportProgressText("")
    }
  }, [])

  // 复制微信/知乎 Inline HTML
  const handleCopyWechatHtml = React.useCallback(() => {
    void runExportTask("转换并复制微信排版", async () => {
      const html = toWechatHtml(getLatest().generatedHtml)
      await copyHtmlToClipboard(html)
    })
  }, [runExportTask, getLatest])

  // 复制为高清图片到剪贴板
  const handleCopyAsImage = React.useCallback(() => {
    void runExportTask("生成并复制高清图片", async () => {
      const iframe = iframeRef.current
      if (!iframe) throw new Error("预览区域尚未加载完毕")
      await copyIframeToClipboard(iframe)
    })
  }, [runExportTask, iframeRef])

  // 高清下载 PNG 图片
  const handleDownloadAsImage = React.useCallback(() => {
    void runExportTask("生成高清图片并下载", async () => {
      const iframe = iframeRef.current
      if (!iframe) throw new Error("预览区域尚未加载完毕")
      const result = await downloadIframeAsImage(iframe, buildExportBaseName())
      if (result.canceled) return false
      rememberExport({ target: "png", label: "PNG", fileName: result.fileName, filePath: result.filePath })
    })
  }, [runExportTask, iframeRef, buildExportBaseName, rememberExport])

  const handleDownloadLongImage = React.useCallback(() => {
    void runExportTask("生成长图并下载", async () => {
      const iframe = iframeRef.current
      if (!iframe) throw new Error("预览区域尚未加载完毕")
      const result = await exportIframeLongPng(iframe, buildExportBaseName())
      if (result.canceled) return false
      rememberExport({ target: "long-png", label: "长图", fileName: result.fileName, filePath: result.filePath })
    })
  }, [runExportTask, iframeRef, buildExportBaseName, rememberExport])

  const handleExportSlices = React.useCallback((sliceHeight: number | { top: number; height: number }[] = 1440) => {
    void runExportTask("切割导出 PNG 包", async () => {
      const iframe = iframeRef.current
      if (!iframe) throw new Error("预览区域尚未加载完毕")
      const result = await exportIframeSlicesZip(iframe, buildExportBaseName(), sliceHeight, (cur, total) => {
        setExportProgressText(`切割图片中 (${cur}/${total})`)
      })
      if (result.canceled) return false
      rememberExport({ target: "split-png", label: "切割导出", fileName: result.fileName, filePath: result.filePath })
    })
  }, [runExportTask, iframeRef, buildExportBaseName, rememberExport])

  // 智能卡片导出
  const handleExportSmartCards = React.useCallback((cards: SmartCard[], preset: PreviewSizePreset, selectedIndices: number[]) => {
    void runExportTask("智能卡片导出", async () => {
      const result = await exportSmartCardsZip(
        cards,
        preset.width,
        preset.height,
        buildExportBaseName(),
        selectedIndices,
        (cur, total) => {
          setExportProgressText(`渲染卡片中 (${cur}/${total})`)
        }
      )
      if (result.canceled) return false
      rememberExport({ target: "smart-card", label: "智能卡片导出", fileName: result.fileName, filePath: result.filePath })
      if (result.skipped?.length) {
        const skippedPages = result.skipped.slice(0, 4).map((item) => `#${item.index + 1}`).join("、")
        toast({
          title: "智能卡片导出完成，部分页面已跳过",
          description: `已导出 ${result.exportedCount ?? 0}/${result.totalCount ?? selectedIndices.length} 张；跳过 ${skippedPages}${result.skipped.length > 4 ? " 等页面" : ""}。`,
        })
        return false
      }
    })
  }, [runExportTask, buildExportBaseName, rememberExport])

  // 导出 PDF 打印
  const handleExportPDF = React.useCallback(() => {
    void runExportTask("调用系统打印导出 PDF", async () => {
      const latest = getLatest()
      if (parsedDeckData.isDeck) {
        exportDeckPrint(parsedDeckData.slides, latest.title || "lingmo-deck")
      } else {
        const fakeSlide = {
          html: latest.generatedHtml,
          notes: "",
          id: "1",
          title: "page",
        }
        exportDeckPrint([fakeSlide], latest.title || "lingmo-output")
      }
      rememberExport({ target: "pdf", label: "PDF", fileName: `${buildExportBaseName()}.pdf` })
    })
  }, [runExportTask, parsedDeckData, getLatest, buildExportBaseName, rememberExport])

  // 导出 PPTX
  const handleExportPPTX = React.useCallback(() => {
    if (!parsedDeckData.isDeck) return
    void runExportTask("生成 PPTX 报告", async () => {
      const result = await exportDeckPptx(parsedDeckData.slides, buildExportBaseName(), (cur, total) => {
        setExportProgressText(`导出 PPTX 中 (${cur}/${total})`)
      })
      if (result.canceled) return false
      rememberExport({ target: "pptx", label: "PPTX", fileName: result.fileName, filePath: result.filePath })
    })
  }, [runExportTask, parsedDeckData, buildExportBaseName, rememberExport])

  // 打包 ZIP 图片集下载
  const handleExportZip = React.useCallback(() => {
    if (!parsedDeckData.isDeck) return
    void runExportTask("打包下载 PNG 图片集", async () => {
      const result = await exportDeckPngZip(parsedDeckData.slides, buildExportBaseName(), (cur, total) => {
        setExportProgressText(`打包图片中 (${cur}/${total})`)
      })
      if (result.canceled) return false
      rememberExport({ target: "split-png", label: "PNG ZIP", fileName: result.fileName, filePath: result.filePath })
    })
  }, [runExportTask, parsedDeckData, buildExportBaseName, rememberExport])

  // 复制原始 HTML 源码
  const handleCopyRawHtml = React.useCallback(() => {
    void runExportTask("复制 HTML 源码", async () => {
      await copyTextToClipboard(getLatest().generatedHtml)
    })
  }, [runExportTask, getLatest])

  // 复制原生 Markdown 纯文本
  const handleCopyRawText = React.useCallback(() => {
    void runExportTask("复制 Markdown 文本", async () => {
      await copyTextToClipboard(getLatest().sourceContent)
    })
  }, [runExportTask, getLatest])

  const handleDownloadMarkdown = React.useCallback(() => {
    void runExportTask("下载 Markdown", async () => {
      const result = await downloadTextFile(getLatest().sourceContent, `${buildExportBaseName()}.md`, "text/markdown;charset=utf-8")
      if (result.canceled) return false
      rememberExport({ target: "markdown", label: "Markdown", fileName: result.fileName })
    })
  }, [runExportTask, getLatest, buildExportBaseName, rememberExport])

  // 保存到本地笔记至工作区的 visual-reports 目录
  const handleSaveToNotes = React.useCallback(() => {
    const html = getLatest().generatedHtml
    if (!html) return
    void runExportTask("保存至项目本地 visual-reports 目录", async () => {
      const fileName = `${buildExportBaseName()}.html`
      const result = await saveHtmlToWorkspace(html, fileName)
      rememberExport({ target: "html", label: "保存到项目", fileName: result.fileName, filePath: result.filePath })
    })
  }, [getLatest, buildExportBaseName, rememberExport, runExportTask])

  // 下载原始 HTML 文件，支持原生的"另存为到自定义目录"
  const handleDownloadRawHtml = React.useCallback(() => {
    const html = getLatest().generatedHtml
    if (!html) return

    void runExportTask("另存为 HTML", async () => {
      const result = await saveTextAs(html, `${buildExportBaseName()}.html`, "text/html;charset=utf-8")
      if (result.canceled) return false
      rememberExport({ target: "html", label: "HTML", fileName: result.fileName, filePath: result.filePath })
    })
  }, [getLatest, buildExportBaseName, rememberExport, runExportTask])

  // Vercel 一键云端部署
  const handleDeployToVercel = React.useCallback(async () => {
    const latest = getLatest()
    const html = latest.generatedHtml
    if (!html) {
      toast({ title: "请先生成页面内容", variant: "destructive" })
      return
    }

    const savedToken = vercelToken.trim() || (typeof window !== "undefined" ? localStorage.getItem("lingmo_vercel_token") || "" : "")
    if (!savedToken.trim()) {
      setShowDeployModal(true)
      return
    }

    setIsDeploying(true)
    setDeployProgress("开始准备部署...")
    setShowDeployModal(true)
    setDeployedUrl("")

    try {
      const result = await deployToVercel(
        html,
        latest.title || "lingmo-share",
        savedToken,
        (msg) => {
          setDeployProgress(msg)
        }
      )

      if (result.status === "ready") {
        setDeployedUrl(result.url)
        setDeployProgress("网页已部署就绪，公网已开放访问！")
        toast({ title: "云端部署成功！" })
      } else {
        setDeployedUrl(result.url)
        setDeployProgress(`部署已转入后台。Vercel: ${result.statusMessage}`)
      }
    } catch (e) {
      setDeployProgress(`部署失败: ${e instanceof Error ? e.message : String(e)}`)
      toast({
        title: "部署出错",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive"
      })
    } finally {
      setIsDeploying(false)
    }
  }, [vercelToken, getLatest])

  return {
    // 导出状态
    exportBusy,
    exportProgressText,
    lastExportRecord,
    // 部署状态
    vercelToken,
    setVercelToken,
    showDeployModal,
    setShowDeployModal,
    isDeploying,
    deployProgress,
    deployedUrl,
    // 导出方法
    handleCopyWechatHtml,
    handleCopyAsImage,
    handleDownloadAsImage,
    handleDownloadLongImage,
    handleExportSlices,
    handleExportSmartCards,
    handleExportPDF,
    handleExportPPTX,
    handleExportZip,
    handleCopyRawHtml,
    handleCopyRawText,
    handleDownloadMarkdown,
    handleSaveToNotes,
    handleDownloadRawHtml,
    handleDeployToVercel,
  }
}
