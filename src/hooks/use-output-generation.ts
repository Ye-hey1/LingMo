"use client"

import * as React from "react"
import { toast } from "@/hooks/use-toast"
import { fetchAiStream } from "@/lib/ai/chat"
import {
  buildEditorialArticle,
  buildKamiParchment,
  buildBrutalistStyle,
  buildGuizangDeck,
  buildTechSharing,
  buildMagazinePoster,
  buildHeroPoster,
  buildDataDashboard,
  buildInfographic,
  buildGuizangSocialCard,
  buildXiaohongshuStyle,
  buildLearningCards,
  buildMindmapStyle,
  buildWaterfallStyle,
  buildBentoStyle,
  buildBusinessReportStyle,
  buildLiquidGlassStyle,
  buildAccordionManualStyle,
  buildDarkTechStyle,
} from "@/lib/output-workshop/html-builders"
import { buildWechatArticle } from "@/lib/output-workshop/wechat-builder"
import { isWechatStyleId } from "@/lib/output-workshop/wechat-styles"
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
  saveCachedOutput,
  saveHtmlToWorkspace,
  saveTextAs,
  type DeckParsed,
} from "@/lib/output-workshop/export"
import {
  exportSmartCardsZip,
  type SmartCard,
} from "@/lib/output-workshop/smart-card-export"
import { deployToVercel } from "@/lib/output-workshop/deploy"
import { parseOutputExtractionResult } from "@/lib/output-workshop/extraction"
import type {
  BuildStage,
  ExportRecord,
  GenerationStatus,
  TemplateOverrides,
  PreviewSizePreset,
} from "@/components/output-workshop/types"
import type { OutputTemplate } from "@/lib/output-workshop/templates"
import {
  EXTRACTION_PROMPT,
  CREATIVE_DESIGN_PROMPT,
  REFINE_PROMPT,
  cleanStreamingHtml,
  prepareOutputHtml,
} from "@/components/output-workshop/utils"
import { normalizeOutputWorkshopHtml } from "@/lib/output-workshop/html-normalizer"
import { buildTemplateOverridePrompt } from "@/components/output-workshop/workshop-controls"
import {
  buildMokaGenerationPrompt,
  buildMokaRepairPrompt,
  buildMokaHtml,
  getMokaPalette,
  hasMokaContentQualityIssue,
  isMokaTemplateId,
  parseMokaGenerationResult,
} from "@/lib/output-workshop/moka"
import type { MokaParsedResult } from "@/lib/output-workshop/moka"

interface UseOutputGenerationOptions {
  // 外部只读值（通过 ref 避免频繁闭包更新）
  selectedTemplateId: string
  selectedTemplate: OutputTemplate
  title: string
  sourceContent: string
  sourceLabel: string
  customInstructions: string
  generatedHtml: string
  parsedDeckData: DeckParsed
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  templateOverrides: TemplateOverrides
  mokaMode?: "single" | "split"
  mokaPlatform?: "xhs" | "wechat"
  mokaStyleId?: string
  mokaPaletteId?: string
  mokaReferenceImageDataUrl?: string
  mokaReferenceImageName?: string
  // 父组件 setters
  setGeneratedHtml: (html: string) => void
  // 跨切面回调
  saveSnapshot: (
    html: string,
    title: string,
    templateId: string,
    instructions: string,
    source: string
  ) => void
}

const OUTPUT_WORKSHOP_MODEL_STORE_KEY = "outputWorkshopModel"

interface MokaRenderMemory {
  templateId: string
  title: string
  sourceLabel: string
  generatedAt: string
  referenceImageName?: string
  result: MokaParsedResult
}

function fetchOutputWorkshopAiStream(
  text: string,
  onUpdate: (content: string) => void,
  abortSignal?: AbortSignal,
  imageUrls?: string[],
  maxTokens?: number
): Promise<string> {
  return fetchAiStream(
    text,
    onUpdate,
    abortSignal,
    undefined,
    undefined,
    undefined,
    imageUrls,
    undefined,
    undefined,
    maxTokens,
    undefined,
    OUTPUT_WORKSHOP_MODEL_STORE_KEY
  )
}

function cloneMokaResult(result: MokaParsedResult): MokaParsedResult {
  return JSON.parse(JSON.stringify(result)) as MokaParsedResult
}

function isPathIndex(segment: string): boolean {
  return /^\d+$/.test(segment)
}

function getPathValue(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function setPathValue(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.split(".").filter(Boolean)
  if (parts.length === 0) return false

  let current: Record<string, unknown> | unknown[] = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    const nextPart = parts[i + 1]
    const key = isPathIndex(part) ? Number(part) : part
    const holder = current as Record<string, unknown>
    if (!holder[key] || typeof holder[key] !== "object") {
      holder[key] = isPathIndex(nextPart) ? [] : {}
    }
    current = holder[key] as Record<string, unknown> | unknown[]
  }

  const finalPart = parts[parts.length - 1]
  const finalKey = isPathIndex(finalPart) ? Number(finalPart) : finalPart
  ;(current as Record<string, unknown>)[finalKey] = value
  return true
}

function applyMokaTextEdit(result: MokaParsedResult, path: string, value: string): MokaParsedResult | null {
  if (result.kind !== "ai-single" && result.kind !== "ai-split") return null
  const next = cloneMokaResult(result)
  if (next.kind !== "ai-single" && next.kind !== "ai-split") return null
  const root = next.design as unknown as Record<string, unknown>
  const normalizedValue = path.includes(".tags.") ? value.replace(/^#/, "").trim() : value.trim()
  return setPathValue(root, path, normalizedValue) ? next : null
}

function sanitizeMokaInlineStyle(style: Record<string, string>): Record<string, string> {
  const allowed = new Set(["left", "top", "marginLeft", "marginTop"])
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => allowed.has(key) && /^-?\d+(?:\.\d+)?px$/.test(value))
  )
}

function applyMokaStyleEdit(result: MokaParsedResult, path: string, style: Record<string, string>): MokaParsedResult | null {
  if (result.kind !== "ai-single" && result.kind !== "ai-split") return null
  const cleanStyle = sanitizeMokaInlineStyle(style)
  if (Object.keys(cleanStyle).length === 0) return null
  const next = cloneMokaResult(result)
  if (next.kind !== "ai-single" && next.kind !== "ai-split") return null
  const root = next.design as unknown as Record<string, unknown>
  const existing = getPathValue(root, path)
  const merged = {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {}),
    ...cleanStyle,
  }
  if ("left" in cleanStyle || "top" in cleanStyle) {
    delete merged.marginLeft
    delete merged.marginTop
  }
  return setPathValue(root, path, merged) ? next : null
}

function applyMokaReorder(result: MokaParsedResult, from: number, to: number): MokaParsedResult | null {
  if (result.kind !== "ai-split") return null
  const slides = result.design.slides
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 0 || to < 0 || from >= slides.length || to >= slides.length || from === to) return null
  const next = cloneMokaResult(result)
  if (next.kind !== "ai-split") return null
  const [moved] = next.design.slides.splice(from, 1)
  next.design.slides.splice(to > from ? to - 1 : to, 0, moved)
  return next
}

export function useOutputGeneration({
  selectedTemplateId,
  selectedTemplate,
  title,
  sourceContent,
  sourceLabel,
  customInstructions,
  generatedHtml,
  parsedDeckData,
  iframeRef,
  templateOverrides,
  mokaMode = "split",
  mokaPlatform = "xhs",
  mokaStyleId = "ai",
  mokaPaletteId = "coral",
  mokaReferenceImageDataUrl,
  mokaReferenceImageName,
  setGeneratedHtml,
  saveSnapshot,
}: UseOutputGenerationOptions) {
  const [status, setStatus] = React.useState<GenerationStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState("")
  const [elapsed, setElapsed] = React.useState(0)
  const [progressText, setProgressText] = React.useState("")
  const [streamingHtml, setStreamingHtml] = React.useState("")
  const [mokaRenderMemory, setMokaRenderMemory] = React.useState<MokaRenderMemory | null>(null)
  const mokaRenderMemoryRef = React.useRef<MokaRenderMemory | null>(null)

  const [refining, setRefining] = React.useState(false)
  const [refineQuery, setRefineQuery] = React.useState("")

  const [exportBusy, setExportBusy] = React.useState(false)
  const [exportProgressText, setExportProgressText] = React.useState("")
  const [lastExportRecord, setLastExportRecord] = React.useState<ExportRecord | null>(null)
  const [buildStageId, setBuildStageId] = React.useState<BuildStage["id"] | null>(null)

  // 部署公网状态
  const [vercelToken, setVercelToken] = React.useState("")
  const [showDeployModal, setShowDeployModal] = React.useState(false)
  const [isDeploying, setIsDeploying] = React.useState(false)
  const [deployProgress, setDeployProgress] = React.useState("")
  const [deployedUrl, setDeployedUrl] = React.useState("")

  const abortControllerRef = React.useRef<AbortController | null>(null)
  const startTimeRef = React.useRef<number>(0)
  const lastStreamingUpdateRef = React.useRef<number>(0)

  // 用 ref 持有最新的外部值，避免 handleGenerate 闭包过期
  const latestRef = React.useRef({
    selectedTemplateId,
    selectedTemplate,
    title,
    sourceContent,
    sourceLabel,
    customInstructions,
    generatedHtml,
    templateOverrides,
    mokaMode,
    mokaPlatform,
    mokaStyleId,
    mokaPaletteId,
    mokaReferenceImageDataUrl,
    mokaReferenceImageName,
  })
  latestRef.current = {
    selectedTemplateId,
    selectedTemplate,
    title,
    sourceContent,
    sourceLabel,
    customInstructions,
    generatedHtml,
    templateOverrides,
    mokaMode,
    mokaPlatform,
    mokaStyleId,
    mokaPaletteId,
    mokaReferenceImageDataUrl,
    mokaReferenceImageName,
  }

  const buildExportBaseName = React.useCallback(() => {
    const current = latestRef.current
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
  }, [])

  const rememberExport = React.useCallback((record: Omit<ExportRecord, "finishedAt">) => {
    setLastExportRecord({ ...record, finishedAt: Date.now() })
  }, [])

  const clearMokaRenderMemory = React.useCallback(() => {
    mokaRenderMemoryRef.current = null
    setMokaRenderMemory(null)
  }, [])

  const resetGenerationState = React.useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setStatus("idle")
    setErrorMessage("")
    setElapsed(0)
    setProgressText("")
    setStreamingHtml("")
    clearMokaRenderMemory()
    setRefining(false)
    setRefineQuery("")
    setBuildStageId(null)
  }, [clearMokaRenderMemory])

  // 耗时计时器
  React.useEffect(() => {
    if (status === "generating" || status === "streaming") {
      const interval = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current)
      }, 100)
      return () => clearInterval(interval)
    }
  }, [status])

  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const renderMokaFromMemory = React.useCallback((memory: MokaRenderMemory) => {
    const current = latestRef.current
    const html = normalizeOutputWorkshopHtml(buildMokaHtml({
      templateId: current.selectedTemplateId,
      title: memory.title,
      styleId: current.mokaStyleId,
      sourceLabel: memory.sourceLabel,
      generatedAt: memory.generatedAt,
      themeColor: current.templateOverrides.themeColor,
      paletteId: current.mokaPaletteId,
      referenceImageName: memory.referenceImageName,
      result: memory.result,
    }))
    return html
  }, [])

  React.useEffect(() => {
    mokaRenderMemoryRef.current = mokaRenderMemory
  }, [mokaRenderMemory])

  const commitMokaResultUpdate = React.useCallback((updater: (result: MokaParsedResult) => MokaParsedResult | null) => {
    const current = mokaRenderMemoryRef.current
    if (!current) return
    const nextResult = updater(current.result)
    if (!nextResult) return
    const nextMemory: MokaRenderMemory = {
      ...current,
      result: nextResult,
    }
    mokaRenderMemoryRef.current = nextMemory
    setMokaRenderMemory(nextMemory)
    setStreamingHtml("")
    setGeneratedHtml(renderMokaFromMemory(nextMemory))
  }, [renderMokaFromMemory, setGeneratedHtml])

  const handleMokaTextEdit = React.useCallback((path: string, value: string) => {
    commitMokaResultUpdate((result) => applyMokaTextEdit(result, path, value))
  }, [commitMokaResultUpdate])

  const handleMokaStyleEdit = React.useCallback((path: string, style: Record<string, string>) => {
    commitMokaResultUpdate((result) => applyMokaStyleEdit(result, path, style))
  }, [commitMokaResultUpdate])

  const handleMokaReorder = React.useCallback((from: number, to: number) => {
    commitMokaResultUpdate((result) => applyMokaReorder(result, from, to))
  }, [commitMokaResultUpdate])

  React.useEffect(() => {
    if (!mokaRenderMemory) return
    if (status === "generating" || status === "streaming" || refining) return

    const current = latestRef.current
    if (!isMokaTemplateId(current.selectedTemplateId)) return

    const expectedKind = current.mokaMode === "single" ? "ai-single" : "ai-split"
    if (mokaRenderMemory.result.kind !== expectedKind) return

    const nextHtml = renderMokaFromMemory(mokaRenderMemory)
    if (nextHtml && nextHtml !== current.generatedHtml) {
      setGeneratedHtml(nextHtml)
    }
  }, [
    mokaRenderMemory,
    mokaMode,
    mokaPaletteId,
    mokaStyleId,
    selectedTemplateId,
    templateOverrides.themeColor,
    status,
    refining,
    renderMokaFromMemory,
    setGeneratedHtml,
  ])

  // ---------------------------------------------------------------------------
  // AI 结构化内容生成
  // ---------------------------------------------------------------------------

  const handleGenerate = React.useCallback(async () => {
    const {
      selectedTemplateId: tplId,
      selectedTemplate: tpl,
      title: t,
      sourceContent: src,
      sourceLabel: label,
      customInstructions: instructions,
      mokaMode: currentMokaMode,
      mokaPlatform: currentMokaPlatform,
      mokaStyleId: currentMokaStyleId,
      mokaPaletteId: currentMokaPaletteId,
      mokaReferenceImageDataUrl: referenceImage,
      mokaReferenceImageName: referenceImageName,
    } = latestRef.current

    const trimmed = src.trim()
    if (!trimmed) {
      toast({ title: "请输入材料内容或选择笔记", variant: "destructive" })
      return
    }

    if (trimmed.length < 10) {
      toast({ title: "材料内容过短，请提供更多信息", variant: "destructive" })
      return
    }

    setStatus("generating")
    setErrorMessage("")
    setGeneratedHtml("")
    setStreamingHtml("")
    clearMokaRenderMemory()
    setProgressText("正在提炼内容结构...")
    setBuildStageId("parse")
    startTimeRef.current = Date.now()
    setElapsed(0)

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      if (isWechatStyleId(tplId)) {
        setProgressText("正在套用公众号排版...")
        setBuildStageId("template")

        const html = normalizeOutputWorkshopHtml(buildWechatArticle({
          styleId: tplId,
          title: t || tpl?.name || "公众号图文",
          subtitle: instructions || tpl?.description,
          markdown: trimmed,
          sourceLabel: label || "手动输入",
          generatedAt: new Date().toLocaleString(),
        }))

        if (abortController.signal.aborted) {
          setStatus("idle")
          return
        }

        setProgressText("正在生成预览...")
        setBuildStageId("preview")
        setGeneratedHtml(html)
        setStreamingHtml("")
        saveSnapshot(html, t || tpl?.name || "公众号图文", tplId, instructions, trimmed)
        setStatus("done")
        setProgressText("生成完成")
        toast({ title: "公众号排版生成完成！" })

        try {
          await saveCachedOutput(html)
        } catch (debugError) {
          console.error("缓存写入失败:", debugError)
        }
        return
      }

      if (isMokaTemplateId(tplId)) {
        const forceMokaAiDesign = currentMokaStyleId === "ai"
        const effectiveMokaKind = currentMokaMode === "single" ? "ai-single" : "ai-split"
        const streamingReadyPattern = forceMokaAiDesign ? "styleConfig" : currentMokaMode === "single" ? "sections" : "slides"
        const imageUrls = forceMokaAiDesign && referenceImage ? [referenceImage] : undefined
        const mokaGenerationMaxTokens = forceMokaAiDesign
          ? currentMokaMode === "single" ? 3200 : 4200
          : currentMokaMode === "single" ? 1800 : 2800
        const mokaRepairMaxTokens = forceMokaAiDesign
          ? currentMokaMode === "single" ? 3600 : 4600
          : currentMokaMode === "single" ? 2000 : 3000
        const generatedAt = new Date().toLocaleString()
        setProgressText(
          forceMokaAiDesign
            ? imageUrls ? "Moka AI 正在参考图片生成设计..." : "Moka AI 正在生成视觉设计..."
            : "Moka AI 正在提炼卡片内容..."
        )
        setBuildStageId("parse")

        const mokaPrompt = buildMokaGenerationPrompt({
          templateId: tplId,
          templateName: tpl?.name || "Moka 模板",
          mokaMode: currentMokaMode,
          mokaPlatform: currentMokaPlatform,
          mokaStyleId: currentMokaStyleId,
          mokaPaletteLabel: `${getMokaPalette(currentMokaPaletteId).label} ${getMokaPalette(currentMokaPaletteId).a}`,
          forceAiDesign: forceMokaAiDesign,
          title: t || tpl?.name || "Moka 卡片",
          sourceLabel: label || "手动输入",
          customInstructions: instructions,
          sourceContent: trimmed,
          hasReferenceImage: Boolean(imageUrls?.length),
        })

        let rawMokaJson = ""
        await fetchOutputWorkshopAiStream(
          mokaPrompt,
          (content) => {
            if (abortController.signal.aborted) return
            rawMokaJson = content
            setProgressText(forceMokaAiDesign ? "Moka AI 正在完善视觉结构..." : "Moka AI 正在提炼内容结构...")
            setBuildStageId("parse")
            const now = Date.now()
            if (now - lastStreamingUpdateRef.current > 650 && content.includes(streamingReadyPattern)) {
              lastStreamingUpdateRef.current = now
              try {
                const partial = parseMokaGenerationResult(tplId, content, trimmed, t || tpl?.name || "Moka 卡片", effectiveMokaKind)
                if (!hasMokaContentQualityIssue(partial)) {
                  const partialHtml = normalizeOutputWorkshopHtml(buildMokaHtml({
                    templateId: tplId,
                    title: t || tpl?.name || "Moka 卡片",
                    styleId: currentMokaStyleId,
                    sourceLabel: label || "手动输入",
                    generatedAt,
                    themeColor: latestRef.current.templateOverrides.themeColor,
                    paletteId: currentMokaPaletteId,
                    referenceImageName,
                    result: partial,
                  }))
                  setStreamingHtml(partialHtml)
                }
              } catch {
                // Partial AI design output can be incomplete while streaming.
              }
            }
          },
          abortController.signal,
          imageUrls,
          mokaGenerationMaxTokens
        )

        if (abortController.signal.aborted) {
          setStatus("idle")
          return
        }

        setProgressText(forceMokaAiDesign ? "正在渲染 Moka AI 设计..." : "正在套用 Moka 模板结构...")
        setBuildStageId("template")

        let parsed = parseMokaGenerationResult(tplId, rawMokaJson, trimmed, t || tpl?.name || "Moka 卡片", effectiveMokaKind)
        if (hasMokaContentQualityIssue(parsed)) {
          console.warn("【输出工坊】Moka AI 内容提炼未通过:", parsed.warning)
          setProgressText("Moka AI 正在重新提炼文章精华...")
          setBuildStageId("parse")

          let repairedMokaJson = ""
          const repairPrompt = buildMokaRepairPrompt({
            mokaMode: currentMokaMode,
            mokaPlatform: currentMokaPlatform,
            mokaStyleId: currentMokaStyleId,
            mokaPaletteLabel: `${getMokaPalette(currentMokaPaletteId).label} ${getMokaPalette(currentMokaPaletteId).a}`,
            forceAiDesign: forceMokaAiDesign,
            title: t || tpl?.name || "Moka 卡片",
            sourceLabel: label || "手动输入",
            customInstructions: instructions,
            sourceContent: trimmed,
            previousWarning: parsed.warning || "内容没有充分提炼原文核心观点",
          })

          await fetchOutputWorkshopAiStream(
            repairPrompt,
            (content) => {
              if (abortController.signal.aborted) return
              repairedMokaJson = content
            },
            abortController.signal,
            imageUrls,
            mokaRepairMaxTokens
          )

          if (abortController.signal.aborted) {
            setStatus("idle")
            return
          }

          const repaired = parseMokaGenerationResult(tplId, repairedMokaJson, trimmed, t || tpl?.name || "Moka 卡片", effectiveMokaKind)
          const repairedHasIssue = hasMokaContentQualityIssue(repaired)
          if (!repairedHasIssue) {
            parsed = repaired
          } else {
            console.warn("【输出工坊】Moka AI 二次提炼仍未通过:", repaired.warning)
          }
        }

        if (hasMokaContentQualityIssue(parsed)) {
          throw new Error("Moka AI 没有从原文中提炼出可用的真实卡片内容，请补充材料细节或重新生成。")
        }

        const html = normalizeOutputWorkshopHtml(buildMokaHtml({
          templateId: tplId,
          title: t || tpl?.name || "Moka 卡片",
          styleId: currentMokaStyleId,
          sourceLabel: label || "手动输入",
          generatedAt,
          themeColor: latestRef.current.templateOverrides.themeColor,
          paletteId: currentMokaPaletteId,
          referenceImageName,
          result: parsed,
        }))

        setProgressText("正在生成预览...")
        setBuildStageId("preview")
        setGeneratedHtml(html)
        setStreamingHtml("")
        const nextMokaMemory: MokaRenderMemory = {
          templateId: tplId,
          title: t || tpl?.name || "Moka 卡片",
          sourceLabel: label || "手动输入",
          generatedAt,
          referenceImageName,
          result: parsed,
        }
        mokaRenderMemoryRef.current = nextMokaMemory
        setMokaRenderMemory(nextMokaMemory)
        saveSnapshot(html, t || tpl?.name || "Moka 卡片", tplId, instructions, trimmed)
        setStatus("done")
        setProgressText("生成完成")
        toast({ title: forceMokaAiDesign ? "Moka AI 设计生成完成！" : "Moka 卡片生成完成！" })

        try {
          await saveCachedOutput(html)
        } catch (debugError) {
          console.error("缓存写入失败:", debugError)
        }
        return
      }

      const isCustomAiOrCreativeTemplate = tplId === "custom-ai-design" || !!tpl?.skillPrompt
      if (isCustomAiOrCreativeTemplate) {
        setProgressText(tpl?.skillPrompt ? "AI 正在根据创意模板规范直绘页面..." : "AI 正在根据设计规范自主构思并绘制排版中...")
        setBuildStageId("template")
        setStatus("streaming")

        const customTemplateConstraints = tpl?.skillPrompt
          ? `\n**当前选用的 AI 自由创意模板规范 (${tpl.name})**:\n${tpl.skillPrompt}\n`
          : ""

        const creativePrompt = `${CREATIVE_DESIGN_PROMPT}
${customTemplateConstraints}
**界面参数偏好（只作为输出边界，不是固定模板）**:
下面的参数只约束尺寸、字体、主题色、安全区和导出偏好。请优先依据输入材料决定视觉母题、信息结构和布局骨架，不要因为这些参数生成固定套路。
${buildTemplateOverridePrompt(templateOverrides)}
${instructions ? `**用户额外设计要求**: ${instructions}\n` : ""}
**主标题**: ${t || tpl?.name || "AI 创意设计成果"}
**来源**: ${label || "手动输入材料"}

**输入材料**:
---
${trimmed.slice(0, 15000)}
---`

        let finalHtml = ""
        const rawHtml = await fetchOutputWorkshopAiStream(
          creativePrompt,
          (content) => {
            if (abortController.signal.aborted) return
            const cleaned = cleanStreamingHtml(content)
            finalHtml = cleaned
            setProgressText("AI 正在生成预览...")
            setBuildStageId("preview")
            const now = Date.now()
            if (now - lastStreamingUpdateRef.current > 150) {
              lastStreamingUpdateRef.current = now
              const repaired = prepareOutputHtml(cleaned)
              setStreamingHtml(repaired)
            }
          },
          abortController.signal
        )

        if (rawHtml && (!finalHtml || finalHtml.length < rawHtml.length)) {
          finalHtml = cleanStreamingHtml(rawHtml)
        }

        if (abortController.signal.aborted) {
          setStatus("idle")
          return
        }

        const repairedHtml = prepareOutputHtml(finalHtml)
        console.log("【输出工坊】AI直绘生成完成。原始长度:", finalHtml.length, "修复后长度:", repairedHtml.length)
        if (repairedHtml.length < 200) {
          console.warn("【输出工坊】警告：生成的 HTML 代码过短，内容如下：", repairedHtml)
        }
        setGeneratedHtml(repairedHtml)
        setStreamingHtml("")
        saveSnapshot(repairedHtml, t, tplId, instructions, trimmed)
        setStatus("done")
        setBuildStageId("preview")
        setProgressText("生成完成")
        toast({ title: "自由设计生成完成！" })

        try {
          await saveCachedOutput(repairedHtml)
        } catch (debugError) {
          console.error("缓存写入失败:", debugError)
        }
        return
      }

      setProgressText("AI 正在提炼页面数据...")
      setBuildStageId("parse")

      const extractionPrompt = `${EXTRACTION_PROMPT}

${instructions ? `**用户额外要求**: ${instructions}\n` : ""}
${buildTemplateOverridePrompt(templateOverrides)}
**输入材料**:
来源: ${label || "手动输入"}
标题: ${t || "输出报告"}

---
${trimmed.slice(0, 15000)}
---`

      let extractedJson = ""

      await fetchOutputWorkshopAiStream(
        extractionPrompt,
        (content) => {
          if (abortController.signal.aborted) return
          extractedJson = content
          setProgressText("AI 正在提炼页面数据...")
          setBuildStageId("parse")
        },
        abortController.signal
      )

      if (abortController.signal.aborted) {
        setStatus("idle")
        return
      }

      setProgressText("正在套用模板...")
      setBuildStageId("template")

      const extractionResult = parseOutputExtractionResult(extractedJson, trimmed, t || "可视化输出")
      const reportTitle = extractionResult.title
      const reportSubtitle = extractionResult.subtitle
      const sections = extractionResult.sections

      if (extractionResult.usedFallback) {
        console.warn("【输出工坊】结构化解析降级为 Markdown 分段:", extractionResult.warning)
      }

      setProgressText("正在渲染图表...")
      setBuildStageId("mermaid")
      await new Promise((resolve) => setTimeout(resolve, 120))

      const buildOptions = {
        title: reportTitle,
        subtitle: reportSubtitle || '',
        sections,
        sourceLabel: label || "手动输入",
        generatedAt: new Date().toLocaleString(),
      }

      let html = ""
      setProgressText("正在生成预览...")
      setBuildStageId("preview")
      switch (tplId) {
        case "article-editorial":
          html = buildEditorialArticle(buildOptions)
          break
        case "article-kami":
          html = buildKamiParchment(buildOptions)
          break
        case "article-brutalist":
          html = buildBrutalistStyle(buildOptions)
          break
        case "deck-minimal":
          html = buildGuizangDeck(buildOptions)
          break
        case "deck-tech":
          html = buildTechSharing(buildOptions)
          break
        case "poster-magazine":
          html = buildMagazinePoster(buildOptions)
          break
        case "poster-hero":
          html = buildHeroPoster(buildOptions)
          break
        case "data-dashboard":
          html = buildDataDashboard(buildOptions)
          break
        case "data-infographic":
          html = buildInfographic(buildOptions)
          break
        case "social-card":
          html = buildGuizangSocialCard(buildOptions)
          break
        case "social-xiaohongshu":
          html = buildXiaohongshuStyle(buildOptions)
          break
        case "social-waterfall":
          html = buildWaterfallStyle(buildOptions)
          break
        case "visual-bento":
          html = buildBentoStyle(buildOptions)
          break
        case "report-business":
          html = buildBusinessReportStyle(buildOptions)
          break
        case "read-glass":
          html = buildLiquidGlassStyle(buildOptions)
          break
        case "read-accordion":
          html = buildAccordionManualStyle(buildOptions)
          break
        case "read-dark-tech":
          html = buildDarkTechStyle(buildOptions)
          break
        case "learning-flashcard":
          html = buildLearningCards(buildOptions)
          break
        case "learning-mindmap":
          html = buildMindmapStyle(buildOptions)
          break
        default:
          html = buildEditorialArticle(buildOptions)
      }

      html = normalizeOutputWorkshopHtml(html)
      setGeneratedHtml(html)
      saveSnapshot(html, reportTitle, tplId, instructions, trimmed)
      setStatus("done")
      setBuildStageId("preview")
      setProgressText("生成完成")
      toast({ title: "可视化页面构建成功！" })

      try {
        await saveCachedOutput(html)
      } catch (debugError) {
        console.error("缓存写入失败:", debugError)
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setStatus("idle")
        return
      }
      setStatus("error")
      setBuildStageId(null)
      const msg = error instanceof Error ? error.message : String(error)
      setErrorMessage(msg)
      toast({ title: "生成失败", description: msg, variant: "destructive" })
    }
  }, [setGeneratedHtml, saveSnapshot])

  // ---------------------------------------------------------------------------
  // 对话式局部微调修补逻辑
  // ---------------------------------------------------------------------------

  const handleRefine = React.useCallback(async () => {
    const query = refineQuery.trim()
    if (!query) return
    const currentHtml = latestRef.current.generatedHtml
    if (!currentHtml) {
      toast({ title: "当前没有任何已生成的网页，无法进行修补", variant: "destructive" })
      return
    }

    setRefining(true)
    setStatus("streaming")
    setProgressText("AI 正在分析并修补页面...")
    setBuildStageId("template")
    startTimeRef.current = Date.now()
    setElapsed(0)

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const refinePrompt = `${REFINE_PROMPT}

【旧 HTML 页面代码】:
${currentHtml}

【用户的修补微调指令】:
${query}
`

      let finalHtml = ""
      await fetchOutputWorkshopAiStream(
        refinePrompt,
        (content) => {
          if (abortController.signal.aborted) return
          const cleaned = cleanStreamingHtml(content)
          finalHtml = cleaned
          setProgressText("AI 正在生成预览...")
          setBuildStageId("preview")
          // 流式实时预览：150ms 节流注入
          const now = Date.now()
          if (now - lastStreamingUpdateRef.current > 150) {
            lastStreamingUpdateRef.current = now
            const repaired = prepareOutputHtml(cleaned)
            setStreamingHtml(repaired)
          }
        },
        abortController.signal
      )
      if (abortController.signal.aborted) {
        setStatus("idle")
        setRefining(false)
        return
      }

      // 熔断防护
      const oldLen = currentHtml ? currentHtml.length : 0
      const newLen = finalHtml ? finalHtml.length : 0
      const hasHtmlTag = finalHtml.toLowerCase().includes("<html") || finalHtml.toLowerCase().includes("<body")

      if (oldLen > 2000 && newLen < oldLen * 0.3 && !hasHtmlTag) {
        toast({
          title: "微调修补被熔断拦截",
          description: "检测到 AI 输出了残缺的代码片段。为了防止白屏，系统已自动拦截并保留了原页面。请尝试重新发送更详细的微调指令。",
          variant: "destructive"
        })
        setStatus("done")
        setBuildStageId("preview")
        setRefining(false)
        return
      }

      const repairedHtml = prepareOutputHtml(finalHtml)
      console.log("【输出工坊】AI微调修补完成。原始长度:", finalHtml.length, "修复后长度:", repairedHtml.length)
      clearMokaRenderMemory()
      setGeneratedHtml(repairedHtml)
      setStreamingHtml("")
      const { title: t, selectedTemplateId: tplId, customInstructions: instr, sourceContent: src } = latestRef.current
      saveSnapshot(repairedHtml, t, tplId, instr, src)
      setStatus("done")
      setBuildStageId("preview")
      setRefining(false)
      setRefineQuery("")
      setProgressText("修补完成")
      toast({ title: "页面样式已成功修补！" })

      try {
        await saveCachedOutput(repairedHtml)
      } catch (debugError) {
        console.error("缓存写入失败:", debugError)
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setStatus("idle")
        setRefining(false)
        return
      }
      setStatus("error")
      setBuildStageId(null)
      setRefining(false)
      const msg = error instanceof Error ? error.message : String(error)
      setErrorMessage(msg)
      toast({ title: "微调修补失败", description: msg, variant: "destructive" })
    }
  }, [refineQuery, setGeneratedHtml, saveSnapshot])

  // ---------------------------------------------------------------------------
  // 停止生成
  // ---------------------------------------------------------------------------

  const handleStop = React.useCallback(() => {
    abortControllerRef.current?.abort()
    setStatus("idle")
    setProgressText("")
    setStreamingHtml("")
    setBuildStageId(null)
  }, [])

  // ---------------------------------------------------------------------------
  // 导出任务包装器
  // ---------------------------------------------------------------------------

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
      const html = toWechatHtml(latestRef.current.generatedHtml)
      await copyHtmlToClipboard(html)
    })
  }, [runExportTask])

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
      if (parsedDeckData.isDeck) {
        exportDeckPrint(parsedDeckData.slides, latestRef.current.title || "lingmo-deck")
      } else {
        const fakeSlide = {
          html: latestRef.current.generatedHtml,
          notes: "",
          id: "1",
          title: "page",
        }
        exportDeckPrint([fakeSlide], latestRef.current.title || "lingmo-output")
      }
      rememberExport({ target: "pdf", label: "PDF", fileName: `${buildExportBaseName()}.pdf` })
    })
  }, [runExportTask, parsedDeckData, buildExportBaseName, rememberExport])

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
      await copyTextToClipboard(latestRef.current.generatedHtml)
    })
  }, [runExportTask])

  // 复制原生 Markdown 纯文本
  const handleCopyRawText = React.useCallback(() => {
    void runExportTask("复制 Markdown 文本", async () => {
      await copyTextToClipboard(latestRef.current.sourceContent)
    })
  }, [runExportTask])

  const handleDownloadMarkdown = React.useCallback(() => {
    void runExportTask("下载 Markdown", async () => {
      const result = await downloadTextFile(latestRef.current.sourceContent, `${buildExportBaseName()}.md`, "text/markdown;charset=utf-8")
      if (result.canceled) return false
      rememberExport({ target: "markdown", label: "Markdown", fileName: result.fileName })
    })
  }, [runExportTask, buildExportBaseName, rememberExport])

  // 保存到本地笔记至工作区的 visual-reports 目录
  const handleSaveToNotes = React.useCallback(() => {
    const html = latestRef.current.generatedHtml
    if (!html) return
    void runExportTask("保存至项目本地 visual-reports 目录", async () => {
      const fileName = `${buildExportBaseName()}.html`
      const result = await saveHtmlToWorkspace(html, fileName)
      rememberExport({ target: "html", label: "保存到项目", fileName: result.fileName, filePath: result.filePath })
    })
  }, [runExportTask, buildExportBaseName, rememberExport])

  // 下载原始 HTML 文件，支持原生的“另存为到自定义目录”
  const handleDownloadRawHtml = React.useCallback(() => {
    const html = latestRef.current.generatedHtml
    if (!html) return

    void runExportTask("另存为 HTML", async () => {
      const result = await saveTextAs(html, `${buildExportBaseName()}.html`, "text/html;charset=utf-8")
      if (result.canceled) return false
      rememberExport({ target: "html", label: "HTML", fileName: result.fileName, filePath: result.filePath })
    })
  }, [buildExportBaseName, rememberExport, runExportTask])

  // Vercel 一键云端部署
  const handleDeployToVercel = React.useCallback(async () => {
    const html = latestRef.current.generatedHtml
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
        latestRef.current.title || "lingmo-share",
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
  }, [vercelToken])

  return {
    // 生成状态
    status,
    setStatus,
    errorMessage,
    setErrorMessage,
    elapsed,
    progressText,
    streamingHtml,
    setStreamingHtml,

    // 微调状态
    refining,
    refineQuery,
    setRefineQuery,

    // 导出状态
    exportBusy,
    exportProgressText,
    lastExportRecord,
    buildStageId,
    mokaRenderMemory,

    // 部署状态
    vercelToken,
    setVercelToken,
    showDeployModal,
    setShowDeployModal,
    isDeploying,
    deployProgress,
    deployedUrl,

    // 核心方法
    resetGenerationState,
    handleGenerate,
    handleRefine,
    handleStop,
    handleMokaTextEdit,
    handleMokaStyleEdit,
    handleMokaReorder,

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
