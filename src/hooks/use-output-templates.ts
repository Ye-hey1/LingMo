"use client"

import * as React from "react"
import {
  OUTPUT_TEMPLATES,
  INTERNAL_OUTPUT_TEMPLATES,
  OUTPUT_MODES,
  listAllTemplates,
  type OutputTemplate,
} from "@/lib/output-workshop/templates"
import { buildTemplatePreviewHtml } from "@/components/output-workshop/utils"

export function useOutputTemplates() {
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("article-editorial")
  const [allTemplates, setAllTemplates] = React.useState<OutputTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = React.useState(false)
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all")
  const [templateSearchQuery, setTemplateSearchQuery] = React.useState("")
  const [showTemplatePicker, setShowTemplatePicker] = React.useState(false)
  const [hoveredTemplateId, setHoveredTemplateId] = React.useState<string | null>(null)
  const [templatePreviewPosition, setTemplatePreviewPosition] = React.useState<{ top: number; left: number } | null>(null)

  // 浮窗 hover 250ms 黄金防抖计时器
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 状态包装 setter，确保在状态重置时同步清理挂载中的定时任务
  const setHoveredTemplateIdWithCleanup = React.useCallback((id: string | null) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredTemplateId(id)
    if (id === null) {
      setTemplatePreviewPosition(null)
    }
  }, [])

  const templateList = React.useMemo(() => {
    return allTemplates.length > 0 ? allTemplates : OUTPUT_TEMPLATES
  }, [allTemplates])

  const selectedTemplate = React.useMemo(() => {
    const list = allTemplates.length > 0 ? allTemplates : OUTPUT_TEMPLATES
    return list.find((t) => t.id === selectedTemplateId) ||
      INTERNAL_OUTPUT_TEMPLATES.find((t) => t.id === selectedTemplateId) ||
      list[0]
  }, [allTemplates, selectedTemplateId])

  const templateCategories = React.useMemo(() => {
    const presentModes = new Set(templateList.map((template) => template.mode))
    return OUTPUT_MODES.filter((mode) => presentModes.has(mode.id))
  }, [templateList])

  const filteredTemplates = React.useMemo(() => {
    const query = templateSearchQuery.trim().toLowerCase()
    return templateList.filter((template) => {
      const matchesCategory = selectedCategory === "all" || template.mode === selectedCategory
      if (!matchesCategory) return false
      if (!query) return true

      const haystack = [
        template.name,
        template.nameEn,
        template.description,
        template.bestFor,
        template.mode,
        template.scenario,
      ].join(" ").toLowerCase()

      return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))
    })
  }, [templateList, selectedCategory, templateSearchQuery])

  const hoveredTemplate = React.useMemo(() => {
    if (!hoveredTemplateId) return null
    return templateList.find((template) => template.id === hoveredTemplateId) || null
  }, [templateList, hoveredTemplateId])

  const activeTemplatePreview = hoveredTemplate || selectedTemplate

  const templatePreviewHtml = React.useMemo(() => {
    return buildTemplatePreviewHtml(activeTemplatePreview)
  }, [activeTemplatePreview])

  const selectedTemplatePreviewHtml = React.useMemo(() => {
    return buildTemplatePreviewHtml(selectedTemplate)
  }, [selectedTemplate])

  const loadTemplates = React.useCallback(async () => {
    setLoadingTemplates(true)
    try {
      const list = await listAllTemplates()
      setAllTemplates(list)
    } catch (e) {
      console.error("加载模板列表失败，降级使用静态模板列表:", e)
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  const handleSelectTemplate = React.useCallback((templateId: string) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setSelectedTemplateId(templateId)
    setShowTemplatePicker(false)
    setHoveredTemplateId(null)
    setTemplatePreviewPosition(null)
  }, [])

  const handleTemplateHover = React.useCallback((e: React.MouseEvent<HTMLButtonElement>, templateId: string) => {
    // 划过列表时，立即清除上一项的定时任务，使划过操作降为 0 次 iframe 重新渲染开销
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
    }

    const rowRect = e.currentTarget.getBoundingClientRect()
    const previewWidth = 208
    const previewHeight = 124
    const gap = 10

    const top = Math.min(
      Math.max(rowRect.top + rowRect.height / 2 - previewHeight / 2, 72),
      window.innerHeight - previewHeight - 16
    )
    const rightSideLeft = rowRect.right + gap
    const left = rightSideLeft + previewWidth <= window.innerWidth - 16
      ? rightSideLeft
      : Math.max(rowRect.left - previewWidth - gap, 16)

    // 延迟 250ms 执行，防范高频创建销毁 iframe 并重新解析大体积 srcDoc 导致的浏览器假死
    hoverTimerRef.current = setTimeout(() => {
      setHoveredTemplateId(templateId)
      setTemplatePreviewPosition({ top, left })
      hoverTimerRef.current = null
    }, 250)
  }, [])

  // 监听点击外部关闭模板选择器
  const templatePickerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templatePickerRef.current && !templatePickerRef.current.contains(e.target as Node)) {
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current)
          hoverTimerRef.current = null
        }
        setShowTemplatePicker(false)
        setHoveredTemplateId(null)
        setTemplatePreviewPosition(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  React.useEffect(() => {
    if (!showTemplatePicker) {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
      setHoveredTemplateId(null)
      setTemplatePreviewPosition(null)
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current)
          hoverTimerRef.current = null
        }
        setShowTemplatePicker(false)
        setHoveredTemplateId(null)
        setTemplatePreviewPosition(null)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showTemplatePicker])

  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  return {
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    allTemplates,
    templateList,
    loadingTemplates,
    selectedCategory,
    setSelectedCategory,
    templateSearchQuery,
    setTemplateSearchQuery,
    showTemplatePicker,
    setShowTemplatePicker,
    hoveredTemplateId,
    setHoveredTemplateId: setHoveredTemplateIdWithCleanup,
    templatePreviewPosition,
    setTemplatePreviewPosition,
    templateCategories,
    filteredTemplates,
    hoveredTemplate,
    activeTemplatePreview,
    templatePreviewHtml,
    selectedTemplatePreviewHtml,
    loadTemplates,
    handleSelectTemplate,
    handleTemplateHover,
    templatePickerRef,
  }
}
