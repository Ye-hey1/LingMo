"use client"
import * as React from "react"
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import useVectorStore from "@/stores/vector"
import { useSkillsStore } from "@/stores/skills"
import { fetchAiQuickPrompts } from "@/lib/ai/placeholder"
import { enhanceChatPrompt } from "@/lib/ai/prompt-enhancer"
import { estimateTokens } from "@/lib/ai/token-counter"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { ChatModeSelect } from "./chat-mode-select"
import { getWorkspacePath } from "@/lib/workspace"
import { ChatSend } from "./chat-send"
import { SkillsPopover } from "./skills-popover"
import { isLinkedFolder, type LinkedResource, type MarkdownFile, type LinkedFolder } from "@/lib/files"
import { McpButton } from "./mcp-button"
import { RagSwitch } from "./rag-switch"
import { ClipboardMonitor } from "./clipboard-monitor"
import emitter from "@/lib/emitter"
import { ChatToolsDrawer } from "@/app/mobile/chat/components/chat-tools-drawer"
import { useIsMobile } from '@/hooks/use-mobile'
import type { ImageAttachment } from "./image-attachments"
import { ChevronRight, GlobeIcon, ImageIcon, Loader2, MousePointer2, QuoteIcon, WandSparkles } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { isMobileDevice } from '@/lib/check'
import type { PendingQuote } from "@/stores/chat"
import { convertFileSrc } from "@tauri-apps/api/core"
import { readTextFile, writeFile, BaseDirectory, exists } from "@tauri-apps/plugin-fs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ShineBorder } from "@/components/ui/shine-border"
import { toast } from "@/hooks/use-toast"
import {
  getNoteGenFilePointerDragDetail,
  isPointInsideElement,
  NOTE_GEN_FILE_POINTER_DRAG_EVENT,
  type NoteGenFilePointerDragDetail,
} from "@/lib/file-pointer-drag"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildTypingFrames } from './onboarding-typing'
import type { AiConfig, ModelConfig } from '@/app/core/setting/config'
import { AiDocCommandPopover } from './ai-doc-command-popover'
import { filterAiDocCommands, findAiDocCommand, type AiDocCommandId } from '@/lib/ai-doc-commands'
import { loadActivityCalendarData, loadCachedActivityCalendarData } from '@/lib/activity'
import { createActivityReviewNote } from '@/lib/activity/review-note'

const IMAGE_CAPABLE_MODEL_PATTERNS = [
  /vlm/i,
  /\bvision\b/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /glm-4.*v/i,
  /qwen.*vl/i,
  /qvq/i,
  /minicpm.*v/i,
  /internvl/i,
  /llava/i,
  /pixtral/i,
  /gemini-1\.5/i,
  /gemini-2\./i,
  /claude-3/i,
  /claude-3\.5/i,
  /claude-3\.7/i,
  /claude-sonnet-4/i,
  /gemma-3/i,
]

function isVirtualEditorPath(path: string) {
  return path.includes('://')
}

function resolvePrimaryChatModel(aiModelList: AiConfig[], primaryModel: string): {
  config: AiConfig
  model?: ModelConfig
} | null {
  if (!primaryModel) {
    return null
  }

  for (const config of aiModelList) {
    const targetModel = config.models?.find(model => model.id === primaryModel)
    if (targetModel) {
      return { config, model: targetModel }
    }

    if (config.key === primaryModel) {
      return { config }
    }
  }

  return null
}

function supportsImageInputForModel(aiModelList: AiConfig[], primaryModel: string): boolean {
  const resolved = resolvePrimaryChatModel(aiModelList, primaryModel)

  if (resolved?.model?.supportsImageInput !== undefined) {
    return resolved.model.supportsImageInput
  }

  if (resolved?.config?.supportsImageInput !== undefined) {
    return resolved.config.supportsImageInput
  }

  const capabilityText = [
    primaryModel,
    resolved?.model?.id,
    resolved?.model?.model,
    resolved?.config?.key,
    resolved?.config?.title,
    resolved?.config?.model,
  ]
    .filter(Boolean)
    .join(' ')

  return IMAGE_CAPABLE_MODEL_PATTERNS.some(pattern => pattern.test(capabilityText))
}

// Memoize toolbar item rendering to reduce ChatInput re-renders caused by prop churn.
interface SortableToolbarItemProps {
  id: string
  loading: boolean
  enhancingPrompt: boolean
  webSearchEnabled: boolean
  onEnhancePrompt: () => void
  onToggleWebSearch: () => void
}

const SortableToolbarItem = React.memo(function SortableToolbarItem({
  id,
  loading,
  enhancingPrompt,
  webSearchEnabled,
  onEnhancePrompt,
  onToggleWebSearch,
}: SortableToolbarItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Render the configured toolbar item by id.
  const renderToolbarItem = () => {
    switch (id) {
      case 'chatModeSelect':
        return <ChatModeSelect />
      case 'mcpButton':
        return <McpButton />
      case 'ragSwitch':
        return <RagSwitch />
      case 'clipboardMonitor':
        return <ClipboardMonitor />
      case 'skillsPopover':
        return <SkillsPopover />
      case 'promptEnhancer':
        return (
          <TooltipButton
            variant={enhancingPrompt ? "secondary" : "ghost"}
            size="icon"
            icon={enhancingPrompt ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
            tooltipText={enhancingPrompt ? '正在增强提示词...' : '增强提示词'}
            onClick={onEnhancePrompt}
            disabled={loading || enhancingPrompt}
            buttonClassName={enhancingPrompt ? 'bg-primary/10 text-primary' : undefined}
          />
        )
      case 'webSearch':
        return (
          <TooltipButton
            variant={webSearchEnabled ? "secondary" : "ghost"}
            size="icon"
            icon={<GlobeIcon className={webSearchEnabled ? "size-4 text-primary" : "size-4"} />}
            tooltipText={webSearchEnabled ? '已启用 Web 搜索（Tavily）' : '启用 Web 搜索（Tavily）'}
            onClick={onToggleWebSearch}
            disabled={loading}
            buttonClassName={webSearchEnabled ? 'bg-primary/10 text-primary hover:bg-primary/15' : undefined}
          />
        )
      default:
        return null
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="shrink-0 cursor-grab active:cursor-grabbing"
    >
      {renderToolbarItem()}
    </div>
  )
})
SortableToolbarItem.displayName = 'SortableToolbarItem'

const REQUIRED_CHAT_TOOLBAR_ITEMS = [
  'chatModeSelect',
  'promptEnhancer',
  'mcpButton',
  'ragSwitch',
  'clipboardMonitor',
  'skillsPopover',
  'webSearch',
  'newChat',
]

const CHAT_TOOLBAR_ORDER: Record<string, number> = {
  chatModeSelect: 0,
}

type ResourceContextOrigin = 'auto' | 'manual' | 'diagram'
type ResourceContentMode = 'active-editor' | 'full-file' | 'folder-rag' | 'pdf-active' | 'pdf-pending' | 'diagram-file'

interface ResourceContextMeta {
  origin: ResourceContextOrigin
  contentMode: ResourceContentMode
  estimatedTokens?: number
  note?: string
}

interface ResourcePreviewResult {
  preview: string | null
  estimatedTokens?: number
  contentMode: Extract<ResourceContentMode, 'active-editor' | 'full-file'>
  note?: string
}

export const ChatInput = React.memo(function ChatInput() {
  const [text, setText] = useState("")
  const {
    primaryModel,
    aiModelList,
    chatToolbarConfigPc,
    setChatToolbarConfigPc,
    tavilyApiKey,
    webSearchEnabled,
    setWebSearchEnabled,
  } = useSettingStore()
  const {
    chats,
    loading,
    researchRunning,
    chatMode,
    setLinkedResources: setChatLinkedResources,
    clearLinkedResources: clearChatLinkedResources,
    setLinkedResourcePreview,
    onboardingPromptDraft,
    setOnboardingPromptDraft,
    pendingQuote,
    setPendingQuote,
    clearPendingQuote,
    startNewConversation,
  } = useChatStore()
  const { marks, trashState } = useMarkStore()
  const { activeFilePath, currentArticle, loadFileTree } = useArticleStore()
  const { isRagEnabled } = useVectorStore()
  const { skills, enabled: skillsEnabled } = useSkillsStore()
  const [isComposing, setIsComposing] = useState(false)
  const [enhancingPrompt, setEnhancingPrompt] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const isResearchActive = researchRunning || (loading && chatMode === 'research')
  const effectivePlaceholder = isResearchActive
    ? '深度研究运行中，预计 3-6 分钟完成。你可以点击停止按钮中断。'
    : placeholder

  // 斜杠命令面板状态
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const slashCommandsCountRef = useRef(0)

  // 当输入以 / 开头时显示命令面板
  const slashQuery = useMemo(() => {
    if (!text.startsWith('/')) return null
    // 不允许跨行的命令查询；包含空格仍允许（用于模糊搜索）
    if (text.includes('\n')) return null
    return text.slice(1)
  }, [text])
  const slashOpen = slashQuery !== null
  const slashFilteredCommands = useMemo(
    () => (slashOpen ? filterAiDocCommands(slashQuery || '') : []),
    [slashOpen, slashQuery],
  )

  useEffect(() => {
    slashCommandsCountRef.current = slashFilteredCommands.length
    // query 改变时重置选中索引
    setSlashSelectedIndex((prev) => {
      if (slashFilteredCommands.length === 0) return 0
      return Math.min(prev, slashFilteredCommands.length - 1)
    })
  }, [slashFilteredCommands])

  // 待发送的斜杠命令：display 是输入框中显示的命令名，instruction 是真正发给 LLM 的完整提示词
  const pendingSendRef = useRef<{ display: string; instruction: string; maxTokens?: number; temperature?: number } | null>(null)

  const executeAiDocCommand = useCallback(async (commandId: AiDocCommandId) => {
    const command = findAiDocCommand(commandId)
    if (!command) return

    if (command.executionMode === 'agent' && chatMode !== 'agent') {
      toast({
        title: '请切换到 Agent 模式',
        description: `/${command.title} 需要执行本地工具或编辑文件，对话模式只用于问答、联网搜索和阅读上下文。`,
        variant: 'destructive',
      })
      setText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      return
    }

    // 立即清空 popover（先把 text 置空，等下面再写入 prompt）
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // 知识管理类命令不需要活动数据，直接执行
    const knowledgeCommands = new Set(['discover-connections', 'generate-flashcards', 'feynman-socratic', 'note-summary', 'note-to-mindmap', 'auto-wikilink'])
    let data: any = null

    if (!knowledgeCommands.has(commandId)) {
      try {
        data = (await loadCachedActivityCalendarData({ includeExternalAiDetails: true }))
          || (await loadActivityCalendarData({ includeExternalAiDetails: true }))
      } catch (error) {
        toast({
          title: '加载活动数据失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
        return
      }
    }

    const exec = await command.buildExecution(data)
    if (exec.skipReason) {
      toast({ title: '无法生成', description: exec.skipReason, variant: 'destructive' })
      return
    }

    // 非 AI 命令：直接执行（不需要发送给 Agent）
    if (exec.prompt === null) {
      try {
        if (exec.directContent?.startsWith('已生成')) {
          // 图表等已直接生成的内容，只显示提示
          toast({ title: '完成', description: exec.directContent })
        } else if (exec.directContent) {
          // 有内容需要保存为笔记（如沉淀对话）
          const filePath = await createActivityReviewNote(exec.title, exec.directContent)
          await loadFileTree({ skipRemoteSync: true })
          const articleStore = useArticleStore.getState()
          await articleStore.setActiveFilePath(filePath)
          toast({ title: '已保存为笔记', description: filePath })
        }
      } catch (error) {
        toast({
          title: '执行失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
      return
    }

    // AI 命令：输入框只显示 /命令名，但发送给 LLM 的是完整 prompt
    const displayLabel = `/${command.title}`
    const commandInstruction = `你正在执行一个应用内命令：${displayLabel}。
这是明确的操作任务，不要先解释概念，不要做泛化介绍，必须直接按命令目标执行工具。

${exec.prompt}`
    pendingSendRef.current = { display: displayLabel, instruction: commandInstruction, maxTokens: exec.maxTokens, temperature: exec.temperature }
    setText(displayLabel)
  }, [chatMode, loadFileTree])

  // 当显示文本已同步到 input 后，使用 instruction override 触发发送
  useEffect(() => {
    const pending = pendingSendRef.current
    if (!pending) return
    if (text !== pending.display) return
    pendingSendRef.current = null
    const timer = window.setTimeout(() => {
      try {
        chatSendRef.current?.sendChat(pending.instruction, { maxTokens: pending.maxTokens, temperature: pending.temperature })
      } catch (error) {
        toast({
          title: '发送失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
    }, 30)
    return () => window.clearTimeout(timer)
  }, [text])
  const t = useTranslations()
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [tempInput, setTempInput] = useState('')
  const [linkedResources, setLinkedResources] = useState<LinkedResource[]>([])
  const [linkedResourcePreviews, setLinkedResourcePreviews] = useState<Record<string, string | null>>({})
  const [resourceContextMetaByKey, setResourceContextMetaByKey] = useState<Record<string, ResourceContextMeta>>({})
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [isContextExpanded, setIsContextExpanded] = useState(false)
  const [contextPanelExpandedPref, setContextPanelExpandedPref] = useLocalStorage<boolean>('chat-input-context-expanded', false)
  const [isFilePointerOverInput, setIsFilePointerOverInput] = useState(false)
  const [isFilePointerDragging, setIsFilePointerDragging] = useState(false)
  const hasContext = !!pendingQuote || linkedResources.length > 0 || attachedImages.length > 0
  const chatSendRef = useRef<any>(null)
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputDropZoneRef = useRef<HTMLDivElement>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const isMobileDevice_ = isMobileDevice()
  const onboardingAgentPromptArmedRef = useRef(false)
  const onboardingTypingTimerRefs = useRef<number[]>([])
  const linkedResourcesRef = useRef<LinkedResource[]>([])
  const resourceContextMetaRef = useRef<Record<string, ResourceContextMeta>>({})
  const attachResourceWithContextRef = useRef<((resource: LinkedResource, origin: ResourceContextOrigin) => Promise<string>) | null>(null)
  const autoLinkSuppressedRef = useRef(false)
  const currentModelSupportsImages = useMemo(
    () => supportsImageInputForModel(aiModelList, primaryModel),
    [aiModelList, primaryModel]
  )

  const applyTypedText = useCallback((value: string) => {
    setText(value)

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    window.requestAnimationFrame(() => {
      textarea.style.height = 'auto'
      const newHeight = Math.min(textarea.scrollHeight, 240)
      textarea.style.height = `${newHeight}px`
    })
  }, [])

  const ensureImageInputSupported = useCallback(() => {
    if (currentModelSupportsImages) {
      return true
    }

    toast({
      title: '当前模型不支持图片输入',
      description: '请切换到支持视觉能力的模型（如 GPT-4o、Gemini、Qwen-VL）后再添加图片。',
      variant: 'destructive',
    })
    return false
  }, [currentModelSupportsImages])

  useEffect(() => {
    linkedResourcesRef.current = linkedResources
  }, [linkedResources])

  useEffect(() => {
    resourceContextMetaRef.current = resourceContextMetaByKey
  }, [resourceContextMetaByKey])

  const getLinkedResourceKey = useCallback((resource: LinkedResource) => {
    return resource.relativePath || resource.path || resource.name
  }, [])

  const normalizeLinkedResources = useCallback((resources: LinkedResource[]) => {
    const seen = new Set<string>()
    const normalized: LinkedResource[] = []

    for (const resource of resources) {
      const key = getLinkedResourceKey(resource)
      if (!key || seen.has(key)) {
        continue
      }

      seen.add(key)
      normalized.push(resource)
    }

    return normalized
  }, [getLinkedResourceKey])

  const addLinkedResource = useCallback((
    resource: LinkedResource,
    options?: {
      preview?: string | null
      meta?: ResourceContextMeta
    }
  ) => {
    const key = getLinkedResourceKey(resource)
    const next = normalizeLinkedResources([
      ...linkedResourcesRef.current.filter(item => getLinkedResourceKey(item) !== key),
      resource,
    ])

    linkedResourcesRef.current = next
    setLinkedResources(next)
    setChatLinkedResources(next)

    if (options?.preview !== undefined) {
      setLinkedResourcePreviews(prev => ({
        ...prev,
        [key]: options.preview ?? null,
      }))
      setLinkedResourcePreview(options.preview ?? null)
    }

    if (options?.meta) {
      setResourceContextMetaByKey(prev => ({
        ...prev,
        [key]: options.meta!,
      }))

      if (options.meta.origin !== 'auto') {
        autoLinkSuppressedRef.current = false
      }
    }
  }, [getLinkedResourceKey, normalizeLinkedResources, setChatLinkedResources, setLinkedResourcePreview])

  const removeLinkedResourceByKey = useCallback((
    key: string,
    options?: {
      suppressAutoLinkOnEmpty?: boolean
    }
  ) => {
    const next = linkedResourcesRef.current.filter(item => getLinkedResourceKey(item) !== key)

    linkedResourcesRef.current = next
    setLinkedResources(next)
    setChatLinkedResources(next)
    setLinkedResourcePreview(null)

    setLinkedResourcePreviews(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })

    setResourceContextMetaByKey(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })

    const shouldSuppress = options?.suppressAutoLinkOnEmpty ?? true
    if (shouldSuppress && next.length === 0) {
      autoLinkSuppressedRef.current = true
    }
  }, [getLinkedResourceKey, setChatLinkedResources, setLinkedResourcePreview])

  const clearLinkedFiles = useCallback(() => {
    linkedResourcesRef.current = []
    autoLinkSuppressedRef.current = true
    setLinkedResources([])
    setLinkedResourcePreviews({})
    setResourceContextMetaByKey({})
    clearChatLinkedResources()
  }, [clearChatLinkedResources])

  const clearAllContexts = useCallback(() => {
    clearLinkedFiles()
    clearPendingQuote()
    setAttachedImages([])
  }, [clearLinkedFiles, clearPendingQuote])

  const sendPresetMessage = useCallback(async (detail: {
    content: string
    images?: string[]
    quoteData?: PendingQuote | null
    restartConversation?: boolean
  }) => {
    const content = detail.content.trim()
    if (!content || loading) return

    if (detail.restartConversation) {
      await startNewConversation()
    }

    const restoredImages: ImageAttachment[] = (detail.images || []).map((url, index) => ({
      id: `resend-${Date.now()}-${index}`,
      url,
      name: url.split('/').pop() || `image-${index + 1}`,
      source: 'record',
    }))

    clearLinkedFiles()
    setPendingQuote(detail.quoteData || null)
    setAttachedImages(restoredImages)
    applyTypedText(content)

    window.setTimeout(() => {
      chatSendRef.current?.sendChat()
    }, 30)
  }, [applyTypedText, clearLinkedFiles, loading, setPendingQuote, startNewConversation])

  useEffect(() => {
    const handleResend = (detail: unknown) => {
      const payload = detail as {
        content?: string
        images?: string[]
        quoteData?: PendingQuote | null
        restartConversation?: boolean
      }

      if (!payload?.content) return
      void sendPresetMessage({
        content: payload.content,
        images: payload.images,
        quoteData: payload.quoteData,
        restartConversation: payload.restartConversation,
      })
    }

    emitter.on('chat-message-resend', handleResend)
    return () => {
      emitter.off('chat-message-resend', handleResend)
    }
  }, [sendPresetMessage])

  // 拖拽排序传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  // 输入历史（最多保留 50 条，自动去重）
  function addToHistory(input: string) {
    if (!input.trim()) return

    const newHistory = [input, ...(inputHistory || []).filter(item => item !== input)]
    const limitedHistory = newHistory.slice(0, 50)
    setInputHistory(limitedHistory)
  }

  function navigateHistory(direction: 'up' | 'down', currentText: string) {
    if (!inputHistory || inputHistory.length === 0) return

    let newIndex: number
    if (direction === 'up') {
      if (historyIndex === -1) {
        setTempInput(currentText)
      }
      newIndex = historyIndex + 1
      if (newIndex >= inputHistory.length) {
        newIndex = inputHistory.length - 1
      }
    } else {
      newIndex = historyIndex - 1
      if (newIndex < -1) {
        newIndex = -1
      }
    }

    setHistoryIndex(newIndex)

    if (newIndex === -1) {
      setText(tempInput)
    } else {
      setText(inputHistory[newIndex])
    }
  }

  const handleLinkedTagsWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    const canScrollX = container.scrollWidth > container.clientWidth
    if (!canScrollX) {
      return
    }

    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault()
      container.scrollLeft += event.deltaY
    }
  }, [])

  function handleToggleWebSearch() {
    if (!webSearchEnabled && !tavilyApiKey.trim()) {
      toast({
        title: '请先配置 Tavily API Key',
        description: '你可以在“设置 > 联网搜索”中填写 API Key，然后再开启联网搜索。',
        variant: 'destructive',
      })
      return
    }

    void setWebSearchEnabled(!webSearchEnabled)
  }

  async function handleEnhancePrompt() {
    const input = text.trim()
    if (!input) {
      toast({
        title: '请先输入内容',
        description: '当前输入为空，请先输入问题或指令。',
      })
      textareaRef.current?.focus()
      return
    }

    if (!primaryModel) {
      toast({
        title: '请先配置 AI 模型',
        description: '在发送或增强前，请先在底部工具栏选择可用模型。',
        variant: 'destructive',
      })
      return
    }

    setEnhancingPrompt(true)
    try {
      const enabledSkillNames = skillsEnabled
        ? skills.filter(skill => skill.enabled).map(skill => skill.name)
        : []

      const enhanced = await enhanceChatPrompt({
        userInput: input,
        currentFilePath: activeFilePath,
        currentArticle,
        linkedResources,
        linkedResourcePreviews,
        quoteData: pendingQuote
          ? {
              fileName: pendingQuote.fileName,
              startLine: pendingQuote.startLine,
              endLine: pendingQuote.endLine,
              fullContent: pendingQuote.fullContent,
            }
          : null,
        isRagEnabled,
        webSearchEnabled,
        enabledSkillNames,
      })

      if (enhanced) {
        applyTypedText(enhanced)
      }
    } finally {
      setEnhancingPrompt(false)
      textareaRef.current?.focus()
    }
  }

  async function handleSelectLocalImages() {
    try {
      if (!ensureImageInputSupported()) {
        return
      }

      // On mobile, use the native HTML file input.
      if (isMobileDevice_) {
        imageInputRef.current?.click()
        return
      }

      // On desktop, use the Tauri file dialog.
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
        }]
      })

      if (selected && Array.isArray(selected)) {
        const newImages: ImageAttachment[] = selected.map((path) => ({
          id: `local-${Date.now()}-${Math.random()}`,
          url: convertFileSrc(path),
          name: path.split('/').pop() || path,
          source: 'file' as const
        }))
        
        setAttachedImages(prev => [...prev, ...newImages])
      }
    } catch (error) {
      console.error('Failed to select files:', error)
    }
  }

  // Open the gallery picker on mobile.
  async function handleSelectFromGallery() {
    if (!ensureImageInputSupported()) {
      return
    }

    if (isMobileDevice_) {
      if (imageInputRef.current) {
        imageInputRef.current.removeAttribute('capture')
        imageInputRef.current.click()
      }
    }
  }

  // Handle images selected from the hidden file input.
  async function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      if (!ensureImageInputSupported()) {
        event.target.value = ''
        return
      }

      const files = event.target.files
      if (!files || files.length === 0) return

      const newImages: ImageAttachment[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const url = URL.createObjectURL(file)
        newImages.push({
          id: `local-${Date.now()}-${Math.random()}`,
          url,
          name: file.name,
          source: 'file' as const
        })
      }

      setAttachedImages(prev => [...prev, ...newImages])
      
      // Clear the input so selecting the same file again still triggers change.
      event.target.value = ''
    } catch (error) {
      console.error('Error in handleImageInputChange:', error)
    }
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    if (!ensureImageInputSupported()) {
      e.preventDefault()
      return
    }

    e.preventDefault()

    const newImages: ImageAttachment[] = []
    for (const item of imageItems) {
      const blob = item.getAsFile()
      if (!blob) continue

      try {
        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        const fileName = `paste-${Date.now()}-${Math.random().toString(36).substring(7)}.png`
        const filePath = `screenshot/${fileName}`
        
        await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })
        
        const fullPath = await (async () => {
          const { appDataDir, join } = await import('@tauri-apps/api/path')
          const appData = await appDataDir()
          return await join(appData, filePath)
        })()

        newImages.push({
          id: `paste-${Date.now()}-${Math.random()}`,
          url: convertFileSrc(fullPath),
          name: fileName,
          source: 'paste'
        })
      } catch (error) {
        console.error('Failed to save pasted image:', error)
      }
    }

    if (newImages.length > 0) {
      setAttachedImages(prev => [...prev, ...newImages])
    }
  }

  function handleSent() {
    if (onboardingAgentPromptArmedRef.current) {
      onboardingAgentPromptArmedRef.current = false
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    }
    addToHistory(text)
    setText('')
    setHistoryIndex(-1)
    setAttachedImages([])
    clearPendingQuote()
    const textarea = document.querySelector('textarea')
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  async function genInputPlaceholder() {
    if (!primaryModel) return
    if (trashState) return
    const lastClearIndex = chats.findLastIndex(item => item.type === 'clear')
    const chatsAfterClear = chats.slice(lastClearIndex + 1)
    const request_content = `
      ${chatsAfterClear.slice(0, 5).map(item => item.content?.slice(0, 60)).join(';\n\n')}
    `.trim()

    const prompts = await fetchAiQuickPrompts(request_content)
    if (prompts.length >= 3) {
      emitter.emit('ai-prompts-generated', prompts)
    }
    if (prompts.length >= 4 && prompts[3]?.text) {
      setPlaceholder(prompts[3].text + ' [Tab]')
    }
  }

  // Debounce quick prompt placeholder generation.
  const debouncedGenPlaceholder = useCallback(() => {
    if (placeholderTimerRef.current) {
      clearTimeout(placeholderTimerRef.current)
    }

    placeholderTimerRef.current = setTimeout(() => {
      genInputPlaceholder()
    }, 5000)
  }, [primaryModel, marks, chats, trashState, t])

  function insertPlaceholder() {
    if (placeholder.includes('[Tab]')) {
      setText(placeholder.replace('[Tab]', ''))
      setPlaceholder('')
    }
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const enabledItems = chatToolbarConfigPc.filter(item => item.enabled)
      const oldIndex = enabledItems.findIndex((item) => item.id === active.id)
      const newIndex = enabledItems.findIndex((item) => item.id === over.id)

      const reorderedItems = arrayMove(enabledItems, oldIndex, newIndex)
      const allItems = [...chatToolbarConfigPc]

      reorderedItems.forEach((item, index) => {
        const globalIndex = allItems.findIndex(i => i.id === item.id)
        if (globalIndex !== -1) {
          allItems[globalIndex] = { ...item, order: enabledItems[0].order + index }
        }
      })

      setChatToolbarConfigPc(allItems)
    }
  }, [chatToolbarConfigPc, setChatToolbarConfigPc])

  const bottomToolbarItems = useMemo(() => {
    return chatToolbarConfigPc
      .filter(item => item.enabled && item.id !== 'newChat' && item.id !== 'modelSelect' && item.id !== 'promptSelect')
      .sort((a, b) => (CHAT_TOOLBAR_ORDER[a.id] ?? a.order + 10) - (CHAT_TOOLBAR_ORDER[b.id] ?? b.order + 10))
  }, [chatToolbarConfigPc])

  useEffect(() => {
    const missingIds = REQUIRED_CHAT_TOOLBAR_ITEMS.filter(
      id => !chatToolbarConfigPc.some(item => item.id === id)
    )

    if (missingIds.length === 0) {
      return
    }

    const maxOrder = Math.max(...chatToolbarConfigPc.map(item => item.order), -1)
    void setChatToolbarConfigPc([
      ...chatToolbarConfigPc,
      ...missingIds.map((id, index) => ({
        id,
        enabled: true,
        order: maxOrder + index + 1,
      })),
    ])
  }, [chatToolbarConfigPc, setChatToolbarConfigPc])

  useEffect(() => {
    // Generate AI placeholder suggestions when marks are available.
    if (marks.length > 0) {
      genInputPlaceholder()
    } else {
      setPlaceholder(t('record.chat.input.placeholder.default'))
    }
  }, [primaryModel, marks, t])

  useEffect(() => {
    emitter.on('revertChat', (event: unknown) => {
      setText(event as string)
    })
    emitter.on('fileSelected', (event: unknown) => {
      void attachResourceWithContextRef.current?.(event as MarkdownFile, 'manual')
    })
    emitter.on('folderSelected', (event: unknown) => {
      void attachResourceWithContextRef.current?.(event as LinkedFolder, 'manual')
    })
    emitter.on('insert-quote', (event: unknown) => {
      const data = event as PendingQuote
      setPendingQuote(data)
      // Focus the textarea after inserting a quote.
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
      // Refresh placeholder suggestions after quote insertion.
      debouncedGenPlaceholder()
    })
    emitter.on('diagramSelected', (event: unknown) => {
      void attachResourceWithContextRef.current?.(event as MarkdownFile, 'diagram')
      textareaRef.current?.focus()
    })
    emitter.on('quick-prompt-insert', (prompt: string) => {
      setText(prompt)
      textareaRef.current?.focus()
    })
    emitter.on('ai-placeholder-generated', (event: unknown) => {
      const promptText = event as string
      if (promptText) {
        setPlaceholder(promptText)
      }
    })
    return () => {
      onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
      onboardingTypingTimerRefs.current = []
      emitter.off('revertChat')
      emitter.off('fileSelected')
      emitter.off('folderSelected')
      emitter.off('insert-quote')
      emitter.off('diagramSelected')
      emitter.off('quick-prompt-insert')
      emitter.off('ai-placeholder-generated')
    }
  }, [debouncedGenPlaceholder, setPendingQuote])

  useEffect(() => {
    if (!onboardingPromptDraft) {
      return
    }

    onboardingAgentPromptArmedRef.current = true
    onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
    onboardingTypingTimerRefs.current = []
    setText('')
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)

    const frames = buildTypingFrames(onboardingPromptDraft, 2)
    frames.forEach((frame, index) => {
      const timerId = window.setTimeout(() => {
        applyTypedText(frame)
        if (index === frames.length - 1) {
          onboardingTypingTimerRefs.current = []
          setOnboardingPromptDraft(null)
        }
      }, 160 + index * 42)
      onboardingTypingTimerRefs.current.push(timerId)
    })
  }, [applyTypedText, onboardingPromptDraft, setOnboardingPromptDraft])

      const generateFilePreview = useCallback(async (
    filePath: string,
    isCustom: boolean,
    preferEditorContent: boolean = false
  ): Promise<ResourcePreviewResult> => {
    try {
      if (preferEditorContent) {
        const editorContent = await new Promise<{
          markdown: string
          totalLines?: number
          numberedLines?: string
          version: number
        } | null>((resolve) => {
          emitter.emit('editor-get-content', {
            resolve: (data: { markdown: string; totalLines?: number; numberedLines?: string; version: number }) => {
              resolve(data)
            },
          })

          window.setTimeout(() => resolve(null), 300)
        })

        if (editorContent?.numberedLines) {
          const numberedLines = editorContent.numberedLines.split('\n')
          const previewLines = numberedLines.slice(0, 100)
          const totalLines = editorContent.totalLines || numberedLines.length
          const truncatedNote =
            totalLines > 100
              ? `\n... (共 ${totalLines} 行，已显示前 100 行，剩余 ${totalLines - 100} 行)`
              : ''

          return {
            preview: `文件预览：${filePath.split('/').pop() || filePath}\n以下内容来自当前编辑器（建议使用 \`replace_editor_content\` 精确修改，内容版本号：${editorContent.version}）\n\n\`\`\`\n${previewLines.join('\n')}\n\`\`\`${truncatedNote}\n`,
            estimatedTokens: estimateTokens(editorContent.markdown || editorContent.numberedLines),
            contentMode: 'active-editor',
          }
        }
      }

      const fileExists = isCustom
        ? await exists(filePath)
        : await exists(filePath, { baseDir: BaseDirectory.AppData })

      if (!fileExists) {
        return {
          preview: `文件不存在：${filePath.split('/').pop() || filePath}`,
          contentMode: 'full-file',
          note: '请确认路径是否正确，或先在左侧文件树中打开该文件后再发送。',
        }
      }

      const content = isCustom
        ? await readTextFile(filePath)
        : await readTextFile(filePath, { baseDir: BaseDirectory.AppData })

      const lines = content.split('\n')
      const previewLines = lines.slice(0, 100).map((line, index) => {
        const lineNum = index + 1
        const preview = line.length > 60 ? line.slice(0, 60) + '...' : line
        return `${String(lineNum).padStart(4)} | ${preview}`
      })

      const totalLines = lines.length
      const truncatedNote =
        totalLines > 100
          ? `\n... (共 ${totalLines} 行，已显示前 100 行，剩余 ${totalLines - 100} 行)`
          : ''

      return {
        preview: `文件预览：${filePath.split('/').pop() || filePath}\n以下内容来自文件读取（建议使用 \`replace_editor_content\` 精确修改）\n\n\`\`\`\n${previewLines.join('\n')}\n\`\`\`${truncatedNote}\n`,
        estimatedTokens: estimateTokens(content),
        contentMode: 'full-file',
      }
    } catch (error) {
      console.error('Failed to generate file preview:', error)
      return {
        preview: `读取文件失败：${filePath.split('/').pop() || filePath}`,
        contentMode: 'full-file',
        note: '请检查文件编码和访问权限后重试。',
      }
    }
  }, [])

  const attachResourceWithContext = useCallback(async (
    resource: LinkedResource,
    origin: ResourceContextOrigin
  ) => {
    const key = getLinkedResourceKey(resource)

    if (isLinkedFolder(resource)) {
      addLinkedResource(resource, {
        meta: {
          origin,
          contentMode: 'folder-rag',
          note: '该目录将作为 RAG 检索范围使用。',
        },
      })
      return key
    }

    const workspace = await getWorkspacePath()
    const resourcePath = resource.relativePath || resource.path || resource.name
    const isPdf = /\.pdf$/i.test(resourcePath)
    const isActiveResource = activeFilePath === resource.relativePath

    if (isPdf) {
      addLinkedResource(resource, {
        preview: isActiveResource && currentArticle
          ? '已使用当前 PDF 可读文本作为上下文。'
          : 'PDF 文件已附加。若需要提取文本，请先在编辑区打开该 PDF。',
        meta: {
          origin,
          contentMode: isActiveResource && currentArticle ? 'pdf-active' : 'pdf-pending',
          estimatedTokens: isActiveResource && currentArticle ? estimateTokens(currentArticle) : undefined,
          note: isActiveResource && currentArticle
            ? '当前 PDF 文本已注入上下文。'
            : '当前仅附加 PDF 文件路径，尚未注入可读文本。',
        },
      })
      return key
    }

    const previewResult = await generateFilePreview(resource.path, workspace.isCustom, isActiveResource)
    addLinkedResource(resource, {
      preview: previewResult.preview,
      meta: {
        origin,
        contentMode: origin === 'diagram' ? 'diagram-file' : previewResult.contentMode,
        estimatedTokens: previewResult.estimatedTokens,
        note: origin === 'diagram'
          ? '该资源来自图表文件，会按图表上下文注入。'
          : previewResult.note,
      },
    })
    return key
  }, [activeFilePath, addLinkedResource, currentArticle, generateFilePreview, getLinkedResourceKey])

  useEffect(() => {
    attachResourceWithContextRef.current = attachResourceWithContext
  }, [attachResourceWithContext])

  const attachDraggedResourceToChat = useCallback(async (detail: NoteGenFilePointerDragDetail) => {
    if (!detail.path || detail.isDirectory) return

    const relativePath = detail.path
    const workspace = await getWorkspacePath()
    const fullPath = workspace.isCustom
      ? `${workspace.path}/${relativePath.split('/').join('/')}`
      : relativePath

    await attachResourceWithContext({
      name: detail.name || detail.displayName || relativePath.split('/').pop() || relativePath,
      path: fullPath,
      relativePath,
    }, 'manual')

    setIsContextExpanded(true)
  }, [attachResourceWithContext])

  useEffect(() => {
    function handleFilePointerDrag(event: Event) {
      const detail = getNoteGenFilePointerDragDetail(event)
      if (!detail?.path || detail.isDirectory) return

      const overInput = isPointInsideElement(inputDropZoneRef.current, detail.x, detail.y)

      if (detail.phase === 'start' || detail.phase === 'move') {
        setIsFilePointerDragging(true)
        setIsFilePointerOverInput(overInput)
        return
      }

      setIsFilePointerDragging(false)
      setIsFilePointerOverInput(false)

      if (detail.phase === 'end' && overInput) {
        void attachDraggedResourceToChat(detail)
      }
    }

    window.addEventListener(NOTE_GEN_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)

    return () => {
      window.removeEventListener(NOTE_GEN_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
      setIsFilePointerDragging(false)
      setIsFilePointerOverInput(false)
    }
  }, [attachDraggedResourceToChat])

  const autoLinkedKeyRef = useRef<string | null>(null)

  // Auto-link the current editor file when it can provide useful context.
  useEffect(() => {
    async function linkCurrentResource() {
      const previousAutoKey = autoLinkedKeyRef.current

      const removePreviousAutoResource = () => {
        if (!previousAutoKey) {
          return
        }

        const previousMeta = resourceContextMetaRef.current[previousAutoKey]
        if (previousMeta?.origin === 'auto') {
          removeLinkedResourceByKey(previousAutoKey, { suppressAutoLinkOnEmpty: false })
        }
        autoLinkedKeyRef.current = null
      }

      if (autoLinkSuppressedRef.current) {
        // 如果当前打开的文件和之前自动链接的不同，说明用户打开了新文件
        // 此时重置抑制状态，允许自动链接新文件
        if (activeFilePath && previousAutoKey !== activeFilePath && !isVirtualEditorPath(activeFilePath)) {
          autoLinkSuppressedRef.current = false
          // 继续执行下面的自动链接逻辑
        } else {
          removePreviousAutoResource()
          return
        }
      }

      if (!activeFilePath) {
        removePreviousAutoResource()
        return
      }

      if (isVirtualEditorPath(activeFilePath)) {
        removePreviousAutoResource()
        return
      }

      if (previousAutoKey && previousAutoKey !== activeFilePath) {
        removePreviousAutoResource()
      }

      const workspace = await getWorkspacePath()

      // Only auto-link text-like files that can be read as Markdown/context.
      if (activeFilePath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|pdf)$/i)) {
        const fileName = activeFilePath.split('/').pop() || activeFilePath
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeFilePath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeFilePath
        }

        const resource: LinkedResource = {
          name: fileName,
          path: fullPath,
          relativePath: activeFilePath
        }

        const attachedKey = await attachResourceWithContext(resource, 'auto')
        autoLinkedKeyRef.current = attachedKey
      } else if (!activeFilePath.includes('.')) {
        const folderName = activeFilePath.split('/').pop() || activeFilePath
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeFilePath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeFilePath
        }

                const { collectMarkdownFiles } = await import('@/lib/files')
        const files = await collectMarkdownFiles(activeFilePath)
        const { vectorIndexedFiles } = useArticleStore.getState()
        const indexedCount = files.filter(f =>
          vectorIndexedFiles.has(f.path)
        ).length

        if (indexedCount > 0) {
          const resource: LinkedResource = {
            name: folderName,
            path: fullPath,
            relativePath: activeFilePath,
            fileCount: files.length,
            indexedCount: indexedCount
          }
          const attachedKey = await attachResourceWithContext(resource, 'auto')
          autoLinkedKeyRef.current = attachedKey
        } else {
          removePreviousAutoResource()
        }
      } else {
        removePreviousAutoResource()
      }
    }

    void linkCurrentResource()
  }, [activeFilePath, attachResourceWithContext, removeLinkedResourceByKey])

    useEffect(() => {
    if (linkedResources.length > 0) {
      debouncedGenPlaceholder()
    }
  }, [linkedResources, debouncedGenPlaceholder])

  useEffect(() => {
    if (!hasContext) {
      setIsContextExpanded(false)
    }
  }, [hasContext])

  useEffect(() => {
    if (typeof contextPanelExpandedPref === 'boolean') {
      setIsContextExpanded(contextPanelExpandedPref)
    }
  }, [contextPanelExpandedPref])

  const contextSummary = useMemo(() => {
    const firstLinked = linkedResources[0]
    const linkedCount = linkedResources.length
    const firstLabel = firstLinked
      ? (() => {
          const firstLinkedLabel = firstLinked.relativePath || firstLinked.name || getLinkedResourceKey(firstLinked)
          if (linkedCount > 1) {
            return `@${firstLinkedLabel}（共 ${linkedCount} 个文件）`
          }
          return `@${firstLinkedLabel}`
        })()
      : pendingQuote
        ? pendingQuote.fileName
        : attachedImages.length > 0
          ? '图片附件'
          : ''

    return {
      firstLabel,
    }
  }, [attachedImages.length, getLinkedResourceKey, linkedResources, pendingQuote])

  return (
    <footer id="onboarding-target-chat-input" className="flex flex-col w-full p-1 justify-between items-center">
      {/* Hidden image input for mobile selection */}
      {isMobileDevice_ && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageInputChange}
          className="hidden"
        />
      )}
                  {hasContext && (
        <Collapsible
          open={isContextExpanded}
          onOpenChange={(next) => {
            setIsContextExpanded(next)
            setContextPanelExpandedPref(next)
          }}
          className="mb-1 w-full overflow-hidden rounded-md border border-border/45 bg-muted/5"
        >
          <div className="flex items-center justify-between gap-1.5 px-2 py-1">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
              >
                <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform ${isContextExpanded ? 'rotate-90' : ''}`} />
                <span className="truncate text-[11px] font-medium text-foreground/90">
                  {contextSummary.firstLabel || '上下文'}
                </span>
              </button>
            </CollapsibleTrigger>
            <button
              type="button"
              className="shrink-0 text-[10px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={clearAllContexts}
            >
              清空
            </button>
          </div>
          <CollapsibleContent className="border-t border-border/45 px-2 pb-1 pt-1">
            <div className="flex min-w-0 items-center gap-1">
              {linkedResources.length > 0 && (
                <div
                  className="min-w-0 flex-1 overflow-x-auto scrollbar-hide"
                  onWheel={handleLinkedTagsWheel}
                >
                  <div className="flex min-w-max items-center gap-1">
                    {linkedResources.map((resource) => {
                      const key = getLinkedResourceKey(resource)
                      const label = resource.relativePath || resource.name || key
                      return (
                        <span
                          key={key}
                          className="inline-flex h-5 max-w-[140px] items-center rounded-md border border-border/55 bg-background/80 px-1.5 text-[10px] text-muted-foreground"
                          title={`@${label}`}
                        >
                          <span className="truncate">@{label}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
              {pendingQuote && (
                <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border/55 bg-background/80 px-1.5 text-[10px] text-muted-foreground">
                  <QuoteIcon className="size-2.5" />
                  已附加引用
                </span>
              )}
              {attachedImages.length > 0 && (
                <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border/55 bg-background/80 px-1.5 text-[10px] text-muted-foreground">
                  <ImageIcon className="size-2.5" />
                  已附加图片
                </span>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      <div
        ref={inputDropZoneRef}
        className={`group relative z-10 flex w-full flex-col gap-1 overflow-hidden rounded-xl border border-border/80 bg-background p-1 transition-colors focus-within:border-primary ${isFilePointerOverInput ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]' : ''}`}
      >
        {isFilePointerDragging ? (
          <div
            className={`pointer-events-none absolute right-3 top-2 z-20 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${isFilePointerOverInput ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-background/95 text-muted-foreground'}`}
          >
            <MousePointer2 className="size-3" />
            <span>拖到这里附加为上下文</span>
          </div>
        ) : null}
        {isResearchActive && (
          <ShineBorder
            borderWidth={1}
            duration={5}
            shineColor={["#5B8DEF", "#7DD3FC", "#34D399"]}
          />
        )}
        <div className="relative w-full flex items-start">
          <AiDocCommandPopover
            open={slashOpen}
            query={slashQuery || ''}
            selectedIndex={slashSelectedIndex}
            onSelectionChange={setSlashSelectedIndex}
            onSelect={(commandId) => void executeAiDocCommand(commandId)}
            anchorRef={textareaRef}
          />
          <Textarea
            ref={textareaRef}
            className="flex-1 p-2 relative border-none text-xs placeholder:text-sm md:placeholder:text-sm md:text-sm focus-visible:ring-0 shadow-none min-h-[36px] max-h-[240px] resize-none overflow-y-auto"
            rows={1}
            disabled={!primaryModel || isResearchActive}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              const textarea = e.target
              textarea.style.height = 'auto'
              const newHeight = Math.min(textarea.scrollHeight, 240)
              textarea.style.height = `${newHeight}px`
            }}
            placeholder={effectivePlaceholder}
            onKeyDown={(e) => {
              const textarea = e.target as HTMLTextAreaElement
              const cursorPosition = textarea.selectionStart
              const isAtStart = cursorPosition === 0
              const isAtEnd = cursorPosition === text.length

              // 斜杠命令面板按键拦截
              if (slashOpen && !isComposing) {
                if (e.key === 'ArrowDown') {
                  if (slashFilteredCommands.length > 0) {
                    e.preventDefault()
                    setSlashSelectedIndex((prev) => (prev + 1) % slashFilteredCommands.length)
                    return
                  }
                }
                if (e.key === 'ArrowUp') {
                  if (slashFilteredCommands.length > 0) {
                    e.preventDefault()
                    setSlashSelectedIndex((prev) =>
                      prev <= 0 ? slashFilteredCommands.length - 1 : prev - 1,
                    )
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (slashFilteredCommands.length > 0) {
                    e.preventDefault()
                    const target = slashFilteredCommands[Math.min(slashSelectedIndex, slashFilteredCommands.length - 1)]
                    void executeAiDocCommand(target.id)
                    return
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setText('')
                  return
                }
              }

              if (e.key === "Enter" && !isComposing && !e.shiftKey && e.keyCode === 13) {
                e.preventDefault()
                chatSendRef.current?.sendChat()
              }
              if (e.key === "Tab") {
                e.preventDefault()
                insertPlaceholder()
              }
              if (e.key === "ArrowUp" && !isComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('up', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  // Move caret to the beginning before navigating history upward.
                  textarea.setSelectionRange(0, 0)
                }
              }
              if (e.key === "ArrowDown" && !isComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('down', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  // Move caret to the beginning before navigating history downward.
                  textarea.setSelectionRange(0, 0)
                }
              }
              if (e.key === "Backspace") {
                if (text === '') {
                  setPlaceholder(t('record.chat.input.placeholder.default'))
                }
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setTimeout(() => {
              setIsComposing(false)
            }, 0)}
            onPaste={handlePaste}
          />
        </div>
        
        <div className="flex w-full items-center gap-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg bg-muted/30 px-1 py-0.5">
            <div className="min-w-0 flex-1">
              {/* Bottom toolbar */}
              {!isMobile ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={bottomToolbarItems.map(item => item.id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    <div className="flex max-w-full items-center gap-1.5 overflow-x-auto scrollbar-hide">
                      {bottomToolbarItems.map(item => (
                        <SortableToolbarItem
                          key={item.id}
                          id={item.id}
                          loading={loading}
                          enhancingPrompt={enhancingPrompt}
                          webSearchEnabled={webSearchEnabled}
                          onEnhancePrompt={handleEnhancePrompt}
                          onToggleWebSearch={handleToggleWebSearch}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="flex max-w-full items-center gap-1.5 overflow-x-auto scrollbar-hide">
                  <ChatToolsDrawer />
                </div>
              )}
            </div>

          </div>

          <div className="h-5 w-px shrink-0 bg-border/70" />

          <div className="flex shrink-0 items-center justify-end gap-1 pr-1">
            <TooltipButton
              variant="ghost"
              size="icon"
              icon={<ImageIcon className="size-4" />}
              tooltipText={t('record.chat.input.attachImage')}
              onClick={isMobile ? handleSelectFromGallery : handleSelectLocalImages}
              disabled={!primaryModel || isResearchActive}
              buttonClassName="h-8 w-8 rounded-lg"
            />
            <ChatSend
              inputValue={text}
              onSent={handleSent}
              linkedResource={linkedResources[0] || null}
              linkedResources={linkedResources}
              linkedResourcePreviews={linkedResourcePreviews}
              attachedImages={attachedImages}
              quoteData={pendingQuote}
              webSearchEnabled={webSearchEnabled}
              allowAutoCurrentFileContext={!autoLinkSuppressedRef.current}
              ref={chatSendRef}
            />
          </div>
        </div>

      </div>
    </footer>
  )
})
ChatInput.displayName = 'ChatInput'
