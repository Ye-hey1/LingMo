"use client"

import * as React from "react"
import { toast } from "@/hooks/use-toast"
import { fetchAiStream } from "@/lib/ai/chat"
import { useOutputExport } from "@/hooks/use-output-export"
import {
  saveCachedOutput,
  type DeckParsed,
} from "@/lib/output-workshop/export"
import type {
  BuildStageId,
  GenerationTelemetry,
  GenerationStatus,
  TemplateOverrides,
} from "@/components/output-workshop/types"
import type { OutputTemplate } from "@/lib/output-workshop/templates"
import { isLocalWechatOutputTemplate } from "@/lib/output-workshop/template-routing"
import {
  REFINE_PROMPT,
  cleanStreamingHtml,
  prepareOutputHtml,
} from "@/components/output-workshop/utils"
import {
  CREATIVE_DIRECT_MAX_TOKENS,
  buildCreativeDirectPrompt,
} from "@/lib/output-workshop/prompt-blocks"
import {
  lintOutputWorkshopHtml,
  shouldRepairOutputHtml,
  type OutputLintResult,
} from "@/lib/output-workshop/output-lint"
import {
  buildAutoRedbookHtmlFromSource,
  isAutoRedbookTemplateId,
} from "@/lib/output-workshop/social-redbook-builder"
import { buildWechatArticle } from "@/lib/output-workshop/wechat-builder"

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

type BuildStageState = "idle" | BuildStageId

const OUTPUT_WORKSHOP_MODEL_STORE_KEY = "outputWorkshopModel"
const MAX_REPAIR_ATTEMPTS = 2
const MIN_ACCEPTABLE_REPAIR_RATIO = 0.6

const INITIAL_GENERATION_TELEMETRY: GenerationTelemetry = {
  phase: "idle",
  phaseLabel: "等待生成",
  startedAt: null,
  requestStartedAt: null,
  firstByteAt: null,
  lastChunkAt: null,
  completedAt: null,
  outputChars: 0,
  promptChars: 0,
  qualityChecked: false,
  qualityFindingCount: 0,
  severeFindingCount: 0,
  repairTriggered: false,
  qualitySummary: "尚未检查",
}

function summarizeLintResult(lintResult: OutputLintResult): string {
  if (lintResult.findings.length === 0) {
    return "检查通过"
  }
  const preview = lintResult.findings
    .slice(0, 3)
    .map((finding) => `${finding.id}:${finding.severity}`)
    .join("、")
  return `${lintResult.findings.length} 项提示，${preview}`
}

function hasMissingAutoRedbookCards(lintResult: OutputLintResult): boolean {
  return lintResult.severeFindings.some((finding) => finding.id === "missing-auto-redbook-cards")
}

function fetchOutputWorkshopAiStream(
  text: string,
  onUpdate: (content: string) => void,
  abortSignal?: AbortSignal,
  maxTokens?: number
): Promise<string> {
  return fetchAiStream({
    text,
    onUpdate,
    abortSignal,
    maxTokens,
    modelStoreKey: OUTPUT_WORKSHOP_MODEL_STORE_KEY,
  })
}

function buildRepairPrompt(refinePrompt: string, lintResult: OutputLintResult, html: string): string {
  const lintBlock = lintResult.repairPrompt.trim()
  const instructionLines = [
    refinePrompt.trim(),
    lintBlock ? `【质量检查发现的问题】\n${lintBlock}` : '',
    '【修复要求】',
    '- 只返回修复后的完整 HTML。',
    '- 必须保留用户材料中的真实内容和当前模板的交付形态。',
    '- 不要新增临时占位预览、占位文案或与材料无关的内容。',
    '- 优先修复结构完整性、标题层级、移动端安全区和可读性问题。',
    '- 如果需要删减内容，优先删除装饰块而不是删掉主体信息。',
    '',
    '【待修复 HTML】',
    html,
  ].filter(Boolean)

  return instructionLines.join('\n')
}

function shouldAcceptRepairedHtml(previousHtml: string, candidateHtml: string, candidateLint: OutputLintResult): boolean {
  if (candidateLint.severeFindings.length === 0 && candidateHtml.length >= previousHtml.length * MIN_ACCEPTABLE_REPAIR_RATIO) {
    return true
  }

  const previousHasErrors = previousHtml.length > 0
  if (!previousHasErrors) return candidateLint.severeFindings.length === 0

  return false
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
  setGeneratedHtml,
  saveSnapshot,
}: UseOutputGenerationOptions) {
  const [status, setStatus] = React.useState<GenerationStatus>("idle")
  const [buildStageId, setBuildStageId] = React.useState<BuildStageState>("idle")
  const [progressText, setProgressText] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [telemetry, setTelemetry] = React.useState<GenerationTelemetry>(INITIAL_GENERATION_TELEMETRY)
  const [streamingHtml, setStreamingHtml] = React.useState("")
  const [refineQuery, setRefineQuery] = React.useState("")
  const [refining, setRefining] = React.useState(false)
  const [elapsedClock, setElapsedClock] = React.useState(() => Date.now())

  const telemetryRef = React.useRef(telemetry)
  const abortRef = React.useRef<AbortController | null>(null)
  const lastStreamingUpdateRef = React.useRef(0)
  const generationRunIdRef = React.useRef(0)

  React.useEffect(() => {
    if (status !== "generating" && status !== "streaming") {
      return
    }
    const timer = window.setInterval(() => {
      setElapsedClock(Date.now())
    }, 250)
    return () => window.clearInterval(timer)
  }, [status])

  const elapsed = React.useMemo(() => {
    const startedAt = telemetry.startedAt
    if (!startedAt) return 0
    const endAt = telemetry.completedAt ?? elapsedClock
    return Math.max(0, endAt - startedAt)
  }, [elapsedClock, telemetry.completedAt, telemetry.startedAt])

  const getLatest = React.useCallback(() => ({
    generatedHtml,
    sourceContent,
    title,
    selectedTemplate,
    selectedTemplateId,
    templateOverrides,
  }), [
    generatedHtml,
    selectedTemplate,
    selectedTemplateId,
    sourceContent,
    templateOverrides,
    title,
  ])

  const updateTelemetry = React.useCallback((patch: Partial<GenerationTelemetry>) => {
    setTelemetry((current) => {
      const next = { ...current, ...patch }
      telemetryRef.current = next
      return next
    })
  }, [])

  const markAiRequestStarted = React.useCallback((phaseLabel: string, promptChars: number) => {
    const now = Date.now()
    updateTelemetry({
      phase: "requesting-ai",
      phaseLabel,
      startedAt: telemetryRef.current.startedAt ?? now,
      requestStartedAt: now,
      promptChars,
    })
  }, [updateTelemetry])

  const markAiChunkThrottled = React.useCallback((outputChars: number, phaseLabel: string) => {
    const now = Date.now()
    updateTelemetry({
      phase: "receiving",
      phaseLabel,
      firstByteAt: telemetryRef.current.firstByteAt ?? now,
      lastChunkAt: now,
      outputChars,
    })
  }, [updateTelemetry])

  const handleStop = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus("idle")
    setBuildStageId("idle")
    setProgressText("")
    setRefining(false)
  }, [])

  const resetGenerationState = React.useCallback(() => {
    setStreamingHtml("")
    setRefineQuery("")
    setRefining(false)
    setErrorMessage(null)
    setTelemetry(INITIAL_GENERATION_TELEMETRY)
    telemetryRef.current = INITIAL_GENERATION_TELEMETRY
    lastStreamingUpdateRef.current = 0
  }, [])

  const exportApi = useOutputExport({
    getLatest,
    iframeRef,
    parsedDeckData,
  })
  const { exportBusy } = exportApi

  const runRepairCycle = React.useCallback(async (
    initialHtml: string,
    abortSignal: AbortSignal,
    qualityLint: OutputLintResult
  ) => {
    let repairedHtml = initialHtml
    let lintResult = qualityLint

    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS && shouldRepairOutputHtml(lintResult); attempt += 1) {
      setProgressText(attempt === 0 ? "正在修复生成结果..." : "正在再次修复生成结果...")
      setBuildStageId("template")
      updateTelemetry({
        phase: attempt === 0 ? "repairing" : "repairing",
        phaseLabel: attempt === 0 ? "正在修复生成结果" : "正在再次修复生成结果",
        repairTriggered: true,
      })

      const repairPrompt = buildRepairPrompt(REFINE_PROMPT, lintResult, repairedHtml)
      markAiRequestStarted(attempt === 0 ? "正在等待 AI 返回修复结果" : "正在等待 AI 返回再次修复结果", repairPrompt.length)

      let repairedByAi = ""
      const repairRawHtml = await fetchOutputWorkshopAiStream(
        repairPrompt,
        (content) => {
          if (abortSignal.aborted) return
          repairedByAi = cleanStreamingHtml(content)
          if (repairedByAi.length > 0) {
            markAiChunkThrottled(repairedByAi.length, attempt === 0 ? "AI 正在修复页面" : "AI 正在再次修复页面")
          }
        },
        abortSignal,
        CREATIVE_DIRECT_MAX_TOKENS
      )

      if (abortSignal.aborted) {
        setStatus("idle")
        return { html: repairedHtml, lintResult }
      }

      const candidate = prepareOutputHtml(repairedByAi || repairRawHtml)
      const candidateLint = lintOutputWorkshopHtml(candidate, { templateId: selectedTemplateId })
      if (shouldAcceptRepairedHtml(repairedHtml, candidate, candidateLint)) {
        repairedHtml = candidate
        lintResult = candidateLint
      } else {
        lintResult = candidateLint.severeFindings.length < lintResult.severeFindings.length ? candidateLint : lintResult
      }

      updateTelemetry({
        phase: "quality-check",
        phaseLabel: "修复后检查完成",
        qualityChecked: true,
        qualityFindingCount: lintResult.findings.length,
        severeFindingCount: lintResult.severeFindings.length,
        qualitySummary: summarizeLintResult(lintResult),
        outputChars: repairedHtml.length,
      })
    }

    return { html: repairedHtml, lintResult }
  }, [markAiChunkThrottled, markAiRequestStarted, selectedTemplateId, updateTelemetry])

  const rebuildAutoRedbookIfNeeded = React.useCallback((
    html: string,
    lintResult: OutputLintResult,
    phaseLabel: string
  ) => {
    if (!isAutoRedbookTemplateId(selectedTemplateId) || !hasMissingAutoRedbookCards(lintResult)) {
      return { html, lintResult, rebuilt: false }
    }

    setProgressText("正在按社交组图模板重建卡片...")
    setBuildStageId("template")
    updateTelemetry({
      phase: "local-build",
      phaseLabel,
      repairTriggered: true,
    })

    const rebuiltHtml = prepareOutputHtml(buildAutoRedbookHtmlFromSource({
      templateId: selectedTemplateId,
      title: typeof title === "string" ? title : selectedTemplate?.name || "社交传播组图",
      sourceContent: typeof sourceContent === "string" ? sourceContent : "",
      sourceLabel: typeof sourceLabel === "string" ? sourceLabel : "",
      fallbackHtml: html,
    }))
    const rebuiltLint = lintOutputWorkshopHtml(rebuiltHtml, { templateId: selectedTemplateId })

    updateTelemetry({
      phase: "quality-check",
      phaseLabel: "社交组图结构检查完成",
      qualityChecked: true,
      qualityFindingCount: rebuiltLint.findings.length,
      severeFindingCount: rebuiltLint.severeFindings.length,
      qualitySummary: summarizeLintResult(rebuiltLint),
      outputChars: rebuiltHtml.length,
    })

    return { html: rebuiltHtml, lintResult: rebuiltLint, rebuilt: true }
  }, [
    selectedTemplate,
    selectedTemplateId,
    sourceContent,
    sourceLabel,
    title,
    updateTelemetry,
  ])

  const generateLocalWechatOutput = React.useCallback(async () => {
    generationRunIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null

    try {
      const startedAt = Date.now()
      setStatus("generating")
      setStreamingHtml("")
      setErrorMessage(null)
      setBuildStageId("template")
      setProgressText("正在套用一键排版模板...")
      updateTelemetry({
        phase: "local-build",
        phaseLabel: "正在套用一键排版模板",
        startedAt,
        requestStartedAt: null,
        firstByteAt: null,
        lastChunkAt: null,
        completedAt: null,
        outputChars: 0,
        promptChars: 0,
        qualityChecked: false,
        qualityFindingCount: 0,
        severeFindingCount: 0,
        repairTriggered: false,
        qualitySummary: "尚未检查",
      })

      const normalizedSourceContent = typeof sourceContent === "string" ? sourceContent.trim() : ""
      const normalizedTitle = typeof title === "string" ? title.trim() : ""
      const normalizedCustomInstructions = typeof customInstructions === "string" ? customInstructions.trim() : ""
      const html = prepareOutputHtml(buildWechatArticle({
        styleId: selectedTemplateId,
        title: normalizedTitle || selectedTemplate?.name || "一键排版",
        subtitle: normalizedCustomInstructions,
        markdown: normalizedSourceContent || normalizedTitle || selectedTemplate?.description || "",
        sourceLabel: typeof sourceLabel === "string" ? sourceLabel : "",
        generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      }))
      const lintResult = lintOutputWorkshopHtml(html, { templateId: selectedTemplateId })

      console.info("【智能排版】一键排版本地生成完成:", selectedTemplateId)
      setGeneratedHtml(html)
      saveSnapshot(html, normalizedTitle || selectedTemplate?.name || "一键排版", selectedTemplateId, normalizedCustomInstructions, normalizedSourceContent)
      setStatus("done")
      setBuildStageId("preview")
      setProgressText("排版完成")
      updateTelemetry({
        phase: "done",
        phaseLabel: "排版完成",
        completedAt: Date.now(),
        outputChars: html.length,
        qualityChecked: true,
        qualityFindingCount: lintResult.findings.length,
        severeFindingCount: lintResult.severeFindings.length,
        qualitySummary: summarizeLintResult(lintResult),
      })
      toast({ title: "一键排版完成" })

      try {
        await saveCachedOutput(html)
      } catch (debugError) {
        console.error("缓存写入失败:", debugError)
      }
    } catch (error) {
      console.error("一键排版本地生成失败:", error)
      setStatus("error")
      setBuildStageId("preview")
      setErrorMessage(error instanceof Error ? error.message : "一键排版失败，请稍后重试")
      updateTelemetry({
        phase: "error",
        phaseLabel: "一键排版失败",
        completedAt: Date.now(),
      })
      toast({
        title: "一键排版失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    }
  }, [
    customInstructions,
    saveSnapshot,
    selectedTemplate,
    selectedTemplateId,
    setGeneratedHtml,
    sourceContent,
    sourceLabel,
    title,
    updateTelemetry,
  ])

  const generateCreativeOutput = React.useCallback(async () => {
    if (isLocalWechatOutputTemplate(selectedTemplate, selectedTemplateId)) {
      console.warn("【智能排版】已拦截一键排版模板进入 AI 直绘，改用本地排版:", selectedTemplateId)
      void generateLocalWechatOutput()
      return
    }

    const runId = ++generationRunIdRef.current
    const abortController = new AbortController()
    abortRef.current = abortController
    const isCurrentRun = () => generationRunIdRef.current === runId && !abortController.signal.aborted

    try {
      setStatus("generating")
      setBuildStageId("parse")
      setProgressText("正在构建智能排版提示词...")
      updateTelemetry({
        phase: "preparing",
        phaseLabel: "正在构建智能排版提示词",
        startedAt: Date.now(),
      })

      const creativePrompt = buildCreativeDirectPrompt({
        template: selectedTemplate,
        title: typeof title === "string" ? title : "",
        sourceContent: typeof sourceContent === "string" ? sourceContent : "",
        sourceLabel: typeof sourceLabel === "string" ? sourceLabel : "",
        customInstructions: typeof customInstructions === "string" ? customInstructions : "",
        templateOverrides,
      })

      markAiRequestStarted("正在等待 AI 生成页面", creativePrompt.length)

      let finalHtml = ""
      const rawHtml = await fetchOutputWorkshopAiStream(
        creativePrompt,
        (content) => {
          if (!isCurrentRun()) return
          const cleaned = cleanStreamingHtml(content)
          finalHtml = cleaned
          setProgressText("AI 正在生成预览...")
          setBuildStageId("preview")
          if (cleaned.length > 0) {
            markAiChunkThrottled(cleaned.length, "AI 正在直绘页面")
          }
          const now = Date.now()
          if (now - lastStreamingUpdateRef.current > 150) {
            lastStreamingUpdateRef.current = now
            const repaired = prepareOutputHtml(cleaned)
            setStreamingHtml(repaired)
          }
        },
        abortController.signal,
        CREATIVE_DIRECT_MAX_TOKENS
      )

      if (rawHtml && (!finalHtml || finalHtml.length < rawHtml.length)) {
        finalHtml = cleanStreamingHtml(rawHtml)
      }

      if (!isCurrentRun()) {
        setStatus("idle")
        return
      }

      let repairedHtml = prepareOutputHtml(finalHtml)
      updateTelemetry({
        phase: "quality-check",
        phaseLabel: "正在检查页面完整性",
        outputChars: repairedHtml.length,
      })
      let lintResult = lintOutputWorkshopHtml(repairedHtml, { templateId: selectedTemplateId })
      updateTelemetry({
        phase: "quality-check",
        phaseLabel: "页面完整性检查完成",
        qualityChecked: true,
        qualityFindingCount: lintResult.findings.length,
        severeFindingCount: lintResult.severeFindings.length,
        qualitySummary: summarizeLintResult(lintResult),
        outputChars: repairedHtml.length,
      })

      const autoRedbookFallback = rebuildAutoRedbookIfNeeded(repairedHtml, lintResult, "正在重建社交组图卡片")
      repairedHtml = autoRedbookFallback.html
      lintResult = autoRedbookFallback.lintResult

      if (!autoRedbookFallback.rebuilt && shouldRepairOutputHtml(lintResult)) {
        setProgressText("正在修复生成结果...")
        setBuildStageId("template")
        updateTelemetry({
          phase: "repairing",
          phaseLabel: "正在修复生成结果",
          repairTriggered: true,
        })

        const repaired = await runRepairCycle(repairedHtml, abortController.signal, lintResult)
        repairedHtml = repaired.html
        lintResult = repaired.lintResult

        const repairedFallback = rebuildAutoRedbookIfNeeded(repairedHtml, lintResult, "正在重建社交组图卡片")
        repairedHtml = repairedFallback.html
        lintResult = repairedFallback.lintResult
      }

      if (!isCurrentRun()) return

      console.info("【智能排版】AI直绘生成完成。原始长度:", finalHtml.length, "修复后长度:", repairedHtml.length, "质量提示:", lintResult.findings.length)
      if (lintResult.findings.length > 0) {
        console.warn("【智能排版】生成质量提示:", lintResult.findings.map((finding) => `${finding.id}:${finding.severity}`).join(", "))
      }
      setGeneratedHtml(repairedHtml)
      setStreamingHtml("")
      updateTelemetry({
        phase: "finalizing",
        phaseLabel: "正在写入最终预览",
        outputChars: repairedHtml.length,
      })
      const normalizedSourceContent = typeof sourceContent === "string" ? sourceContent.trim() : ""
      const normalizedTitle = typeof title === "string" ? title.trim() : ""
      const normalizedCustomInstructions = typeof customInstructions === "string" ? customInstructions.trim() : ""
      saveSnapshot(repairedHtml, normalizedTitle || selectedTemplate?.name || "AI 创意设计成果", selectedTemplateId, normalizedCustomInstructions, normalizedSourceContent)
      setStatus("done")
      setBuildStageId("preview")
      setProgressText("生成完成")
      updateTelemetry({
        phase: "done",
        phaseLabel: "生成完成",
        completedAt: Date.now(),
        outputChars: repairedHtml.length,
      })
      toast({ title: "自由设计生成完成！" })

      try {
        await saveCachedOutput(repairedHtml)
      } catch (debugError) {
        console.error("缓存写入失败:", debugError)
      }
    } finally {
      if (generationRunIdRef.current === runId) {
        abortRef.current = null
      }
    }
  }, [
    customInstructions,
    generateLocalWechatOutput,
    markAiChunkThrottled,
    markAiRequestStarted,
    saveSnapshot,
    selectedTemplate,
    selectedTemplateId,
    setGeneratedHtml,
    sourceContent,
    sourceLabel,
    title,
    updateTelemetry,
    runRepairCycle,
    rebuildAutoRedbookIfNeeded,
    templateOverrides,
  ])

  const handleGenerate = React.useCallback(() => {
    if (isLocalWechatOutputTemplate(selectedTemplate, selectedTemplateId)) {
      void generateLocalWechatOutput()
      return
    }
    void generateCreativeOutput()
  }, [generateCreativeOutput, generateLocalWechatOutput, selectedTemplate, selectedTemplateId])

  const handleRefine = React.useCallback(async () => {
    const query = typeof refineQuery === "string" ? refineQuery.trim() : ""
    const currentHtml = typeof generatedHtml === "string" ? generatedHtml.trim() : ""

    if (!query || status === "generating" || status === "streaming" || exportBusy) {
      return
    }

    if (!currentHtml) {
      toast({
        title: "请先生成预览",
        description: "生成出页面后，再发送微调指令。",
      })
      return
    }

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      setRefining(true)
      setStatus("streaming")
      setBuildStageId("template")
      setProgressText("正在微调页面...")
      setErrorMessage(null)
      setStreamingHtml(currentHtml)
      updateTelemetry({
        phase: "preparing",
        phaseLabel: "正在构建微调提示词",
        startedAt: Date.now(),
        completedAt: null,
        outputChars: currentHtml.length,
        qualityChecked: false,
        qualityFindingCount: 0,
        severeFindingCount: 0,
        qualitySummary: "尚未检查",
      })

      const refinePrompt = [
        REFINE_PROMPT,
        "",
        "【微调修补指令】",
        query,
        "",
        "【当前模板】",
        `${selectedTemplate?.name || selectedTemplateId} (${selectedTemplateId})`,
        "",
        "【源材料标题】",
        title || selectedTemplate?.name || "",
        "",
        "【源材料标签】",
        sourceLabel || "",
        "",
        "【自定义要求】",
        customInstructions || "",
        "",
        "【旧 HTML 页面代码】",
        currentHtml,
      ].join("\n")

      markAiRequestStarted("正在等待 AI 微调页面", refinePrompt.length)

      let refinedHtml = ""
      const rawHtml = await fetchOutputWorkshopAiStream(
        refinePrompt,
        (content) => {
          if (abortController.signal.aborted) return
          const cleaned = cleanStreamingHtml(content)
          refinedHtml = cleaned
          setProgressText("AI 正在微调预览...")
          setBuildStageId("preview")
          if (cleaned.length > 0) {
            markAiChunkThrottled(cleaned.length, "AI 正在微调页面")
          }
          const now = Date.now()
          if (now - lastStreamingUpdateRef.current > 150) {
            lastStreamingUpdateRef.current = now
            setStreamingHtml(prepareOutputHtml(cleaned))
          }
        },
        abortController.signal,
        CREATIVE_DIRECT_MAX_TOKENS
      )

      if (abortController.signal.aborted) {
        setStatus("idle")
        return
      }

      let finalHtml = prepareOutputHtml(refinedHtml || rawHtml)
      updateTelemetry({
        phase: "quality-check",
        phaseLabel: "正在检查微调结果",
        outputChars: finalHtml.length,
      })
      let lintResult = lintOutputWorkshopHtml(finalHtml, { templateId: selectedTemplateId })
      updateTelemetry({
        phase: "quality-check",
        phaseLabel: "微调结果检查完成",
        qualityChecked: true,
        qualityFindingCount: lintResult.findings.length,
        severeFindingCount: lintResult.severeFindings.length,
        qualitySummary: summarizeLintResult(lintResult),
        outputChars: finalHtml.length,
      })

      const autoRedbookFallback = rebuildAutoRedbookIfNeeded(finalHtml, lintResult, "正在重建社交组图卡片")
      finalHtml = autoRedbookFallback.html
      lintResult = autoRedbookFallback.lintResult

      if (!autoRedbookFallback.rebuilt && shouldRepairOutputHtml(lintResult)) {
        const repaired = await runRepairCycle(finalHtml, abortController.signal, lintResult)
        finalHtml = repaired.html
        lintResult = repaired.lintResult

        const repairedFallback = rebuildAutoRedbookIfNeeded(finalHtml, lintResult, "正在重建社交组图卡片")
        finalHtml = repairedFallback.html
        lintResult = repairedFallback.lintResult
      }

      if (abortController.signal.aborted) {
        setStatus("idle")
        return
      }

      setGeneratedHtml(finalHtml)
      setStreamingHtml("")
      setRefineQuery("")
      updateTelemetry({
        phase: "finalizing",
        phaseLabel: "正在写入微调结果",
        outputChars: finalHtml.length,
      })

      const normalizedSourceContent = typeof sourceContent === "string" ? sourceContent.trim() : ""
      const normalizedTitle = typeof title === "string" ? title.trim() : ""
      const normalizedCustomInstructions = typeof customInstructions === "string" ? customInstructions.trim() : ""
      const snapshotInstructions = [normalizedCustomInstructions, `微调：${query}`].filter(Boolean).join("\n")
      saveSnapshot(finalHtml, normalizedTitle || selectedTemplate?.name || "AI 创意设计成果", selectedTemplateId, snapshotInstructions, normalizedSourceContent)

      setStatus("done")
      setBuildStageId("preview")
      setProgressText("微调完成")
      updateTelemetry({
        phase: "done",
        phaseLabel: "微调完成",
        completedAt: Date.now(),
        outputChars: finalHtml.length,
      })
      toast({ title: "微调完成" })

      try {
        await saveCachedOutput(finalHtml)
      } catch (debugError) {
        console.error("缓存写入失败:", debugError)
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        console.error("智能排版微调失败:", error)
        setStatus("error")
        setBuildStageId("preview")
        setErrorMessage(error instanceof Error ? error.message : "微调失败，请稍后重试")
        updateTelemetry({
          phase: "error",
          phaseLabel: "微调失败",
          completedAt: Date.now(),
        })
        toast({
          title: "微调失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "destructive",
        })
      }
    } finally {
      abortRef.current = null
      setRefining(false)
    }
  }, [
    customInstructions,
    exportBusy,
    generatedHtml,
    markAiChunkThrottled,
    markAiRequestStarted,
    refineQuery,
    runRepairCycle,
    saveSnapshot,
    selectedTemplate,
    selectedTemplateId,
    setGeneratedHtml,
    sourceContent,
    sourceLabel,
    status,
    title,
    updateTelemetry,
    rebuildAutoRedbookIfNeeded,
  ])

  return {
    ...exportApi,
    status,
    buildStageId,
    progressText,
    errorMessage,
    elapsed,
    telemetry,
    generationTelemetry: telemetry,
    streamingHtml,
    refineQuery,
    setRefineQuery,
    refining,
    handleStop,
    resetGenerationState,
    handleGenerate,
    handleRefine,
    generateLocalWechatOutput,
    generateCreativeOutput,
  }
}
