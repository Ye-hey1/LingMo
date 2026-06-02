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
import {
  DICTATION_POLISH_MODE_LABELS,
  DICTATION_POLISH_MODE_OPTIONS,
  isDictationPolishMode,
  type DictationPolishMode,
} from "@/lib/ai/dictation-polish"
import { estimateTokens } from "@/lib/ai/token-counter"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { ChatModeSelect } from "./chat-mode-select"
import { getWorkspacePath } from "@/lib/workspace"
import { ChatSend } from "./chat-send"
import { isLinkedFolder, type LinkedResource, type MarkdownFile, type LinkedFolder } from "@/lib/files"
import emitter from "@/lib/emitter"
import { useIsMobile } from '@/hooks/use-mobile'
import type { ImageAttachment } from "./image-attachments"
import { Check, ChevronDown, GlobeIcon, Loader2, Mic, MousePointer2, Square, WandSparkles } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { PendingQuote } from "@/stores/chat"
import { convertFileSrc } from "@tauri-apps/api/core"
import { readTextFile, writeFile, BaseDirectory, exists } from "@tauri-apps/plugin-fs"
import { ShineBorder } from "@/components/ui/shine-border"
import { toast } from "@/hooks/use-toast"
import { AgentStatusBar } from "./agent-status-bar"
import { ChatInputContext } from "./chat-input-context"
import { ChatContextRing } from "./chat-token-display"
import { ChatInputAddMenu } from "./chat-input-add-menu"
import {
  getLingMoFilePointerDragDetail,
  isPointInsideElement,
  LINGMO_FILE_POINTER_DRAG_EVENT,
  type LingMoFilePointerDragDetail,
} from "@/lib/file-pointer-drag"
import { buildTypingFrames } from './onboarding-typing'
import type { AiConfig, ModelConfig } from '@/app/core/setting/config'
import { AiDocCommandPopover } from './ai-doc-command-popover'
import { filterAiDocCommands, findAiDocCommand, type AiDocCommandId } from '@/lib/ai-doc-commands'
import { loadActivityCalendarData, loadCachedActivityCalendarData } from '@/lib/activity'
import { createActivityReviewNote } from '@/lib/activity/review-note'

import { FileAutocompletePopover, type FileAutocompleteItem } from './file-autocomplete-popover'
import type { DirTree } from '@/stores/article'
import { useChatDictation } from './use-chat-dictation'
import type { QuickPrompt } from '@/lib/ai/placeholder'

function flattenFileTree(tree: DirTree[]): FileAutocompleteItem[] {
  const list: FileAutocompleteItem[] = []
  const traverse = (items: DirTree[], curFolder = '') => {
    for (const item of items) {
      const itemRelPath = curFolder ? `${curFolder}/${item.name}` : item.name
      if (item.isFile) {
        list.push({
          name: item.name,
          path: item.name,
          relativePath: itemRelPath
        })
      } else if (item.isDirectory && item.children) {
        traverse(item.children, itemRelPath)
      }
    }
  }
  traverse(tree)
  return list
}

const SENSITIVE_KEYWORDS = [
  '修改代码', '修改文件', '编辑文件', '编辑代码', '替换文件',
  '新建文件', '创建文件', '写入文件', '删除文件', '执行指令',
  '运行命令', '跑命令', '跑指令', '新建文件夹', '创建文件夹',
  'replace_file_content', 'write_to_file', 'create_file', 'modify_file'
]

const CHAT_DICTATION_POLISH_MODE_STORAGE_KEY = 'chat-dictation-polish-mode'

function isSensitiveInstruction(val: string): boolean {
  const normalized = val.toLowerCase()
  return SENSITIVE_KEYWORDS.some(k => normalized.includes(k))
}

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
    sttModel,
    tavilyApiKey,
    webSearchEnabled,
    setWebSearchEnabled,
  } = useSettingStore()
  const {
    chats,
    loading,
    researchRunning,
    chatMode,
    setChatMode,
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
  const { activeFilePath, currentArticle, loadFileTree, fileTree } = useArticleStore()

  // 行内文件联想输入状态
  const [atSelectedIndex, setAtSelectedIndex] = useState(0)
  const flattenedFiles = useMemo(() => flattenFileTree(fileTree), [fileTree])
  const atQuery = useMemo(() => {
    const match = text.match(/@([^\s@]*)$/)
    if (!match) return null
    if (text.includes('\n')) return null
    return match[1]
  }, [text])
  const atOpen = atQuery !== null

  // 敏感指令意图预检 Banner 状态
  const [showSuggestAgentBanner, setShowSuggestAgentBanner] = useState(false)
  useEffect(() => {
    if (chatMode !== 'chat') {
      setShowSuggestAgentBanner(false)
    }
  }, [chatMode])

  const { isRagEnabled } = useVectorStore()
  const { skills, enabled: skillsEnabled } = useSkillsStore()
  const [isComposing, setIsComposing] = useState(false)
  const [enhancingPrompt, setEnhancingPrompt] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const [aiQuickPrompts, setAiQuickPrompts] = useState<QuickPrompt[]>([])
  const isResearchActive = researchRunning || (loading && chatMode === 'research')
  const effectivePlaceholder = isResearchActive
    ? '深度研究运行中，预计 3-6 分钟完成。你可以点击停止按钮中断。'
    : placeholder

  // 斜杠命令面板状态
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const slashCommandsCountRef = useRef(0)
  const selectedSlashCommandRef = useRef<{ display: string; instruction: string; maxTokens?: number; temperature?: number } | null>(null)

  // 当输入以 / 开头时显示命令面板
  const slashQuery = useMemo(() => {
    if (selectedSlashCommandRef.current?.display === text) return null
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
    const knowledgeCommands = new Set(['discover-connections', 'generate-flashcards', 'feynman-socratic', 'note-summary', 'note-to-mindmap', 'note-to-visual-report', 'note-to-deck-brief', 'note-to-poster-card', 'auto-wikilink'])
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
如果上下文中已经包含“当前打开的笔记”“关联文件内容”或“用户引用内容”，必须优先直接基于这些内容完成任务，不要再要求用户粘贴原文。

${exec.prompt}`
    selectedSlashCommandRef.current = {
      display: displayLabel,
      instruction: commandInstruction,
      maxTokens: exec.maxTokens,
      temperature: exec.temperature,
    }
    setText(displayLabel)
    window.setTimeout(() => {
      try {
        chatSendRef.current?.sendChat(commandInstruction, { maxTokens: exec.maxTokens, temperature: exec.temperature })
        selectedSlashCommandRef.current = null
      } catch (error) {
        toast({
          title: '发送失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
    }, 0)
  }, [chatMode, loadFileTree])
  const t = useTranslations()
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [dictationPolishModeValue, setDictationPolishModeValue] = useLocalStorage<string>(
    CHAT_DICTATION_POLISH_MODE_STORAGE_KEY,
    'raw'
  )
  const dictationPolishMode: DictationPolishMode = isDictationPolishMode(dictationPolishModeValue)
    ? dictationPolishModeValue
    : 'raw'
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
  const isMobileDevice_ = isMobile
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

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, 240)
    textarea.style.height = `${newHeight}px`
  }, [])

  const applyTypedText = useCallback((value: string) => {
    setText(value)

    window.requestAnimationFrame(() => {
      resizeTextarea()
    })
  }, [resizeTextarea])

  const insertTextAtCursor = useCallback((insertedText: string) => {
    const normalizedText = insertedText.trim()
    if (!normalizedText) {
      return
    }

    const textarea = textareaRef.current
    const currentValue = textarea?.value ?? text
    const start = textarea?.selectionStart ?? currentValue.length
    const end = textarea?.selectionEnd ?? currentValue.length
    let nextCursor = start + normalizedText.length

    setText(() => {
      const prefix = currentValue.slice(0, start)
      const suffix = currentValue.slice(end)
      const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
      const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix)
      nextCursor = start + (needsLeadingSpace ? 1 : 0) + normalizedText.length

      return [
        prefix,
        needsLeadingSpace ? ' ' : '',
        normalizedText,
        needsTrailingSpace ? ' ' : '',
        suffix,
      ].join('')
    })

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
      resizeTextarea()
    })
  }, [resizeTextarea, text])

  const dictation = useChatDictation({
    blocked: isResearchActive || loading,
    sttModel,
    polishMode: dictationPolishMode,
    onTranscript: insertTextAtCursor,
  })

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

  const handleQuickPromptSend = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return

    clearAllContexts()
    setPendingQuote(null)

    if (chatMode !== 'agent') {
      await setChatMode('agent')
    }

    applyTypedText(prompt)

    window.setTimeout(() => {
      chatSendRef.current?.sendChat()
    }, 30)
  }, [applyTypedText, chatMode, clearAllContexts, setChatMode, setPendingQuote])

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

  useEffect(() => {
    const handleAttachImage = (detail: unknown) => {
      const payload = detail as ImageAttachment & { prompt?: string }
      if (!payload?.url) return

      if (!ensureImageInputSupported()) {
        return
      }

      setAttachedImages(prev => [
        ...prev,
        {
          id: payload.id || `workspace-image-${Date.now()}-${Math.random()}`,
          url: payload.url,
          name: payload.name,
          source: payload.source || 'file',
        },
      ])
      setIsContextExpanded(true)

      if (payload.prompt) {
        applyTypedText(payload.prompt)
      }
    }

    emitter.on('chat-attach-image', handleAttachImage)
    return () => {
      emitter.off('chat-attach-image', handleAttachImage)
    }
  }, [applyTypedText, ensureImageInputSupported])

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

  const applyQuickPrompt = useCallback((prompt: string) => {
    const nextText = prompt.trim()
    if (!nextText) return

    selectedSlashCommandRef.current = null
    applyTypedText(nextText)
    setPlaceholder('')
    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }, [applyTypedText])

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
      setAiQuickPrompts(prompts.slice(0, 3))
      emitter.emit('ai-prompts-generated', prompts)
    } else {
      setAiQuickPrompts([])
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
      applyQuickPrompt(placeholder.replace('[Tab]', ''))
      setPlaceholder('')
    }
  }

  useEffect(() => {
    // Generate AI placeholder suggestions when there is useful chat context.
    if (chats.length > 0 || marks.length > 0) {
      genInputPlaceholder()
    } else {
      setAiQuickPrompts([])
      setPlaceholder(t('record.chat.input.placeholder.default'))
    }
  }, [primaryModel, marks, chats, trashState, t])

  useEffect(() => {
    const handleGithubStarSendToChat = (event: unknown) => {
      const data = event as { prompt?: string; quoteData?: PendingQuote }
      if (!data?.quoteData) return

      setPendingQuote(data.quoteData)
      setIsContextExpanded(true)
      setContextPanelExpandedPref(true)
      if (data.prompt) {
        applyTypedText(data.prompt)
      }
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
      debouncedGenPlaceholder()
    }
    const handleAiPlaceholderGenerated = (event: unknown) => {
      const promptText = event as string
      if (promptText) {
        setPlaceholder(promptText)
      }
    }
    const handleAiPromptsGenerated = (event: unknown) => {
      const prompts = Array.isArray(event) ? event as QuickPrompt[] : []
      setAiQuickPrompts(prompts.slice(0, 3))
    }

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
    emitter.on('quick-prompt-insert', applyQuickPrompt)
    emitter.on('quick-prompt-send', handleQuickPromptSend)
    emitter.on('ai-placeholder-generated', handleAiPlaceholderGenerated)
    emitter.on('ai-prompts-generated', handleAiPromptsGenerated)
    emitter.on('github-stars-send-to-chat', handleGithubStarSendToChat)
    return () => {
      onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
      onboardingTypingTimerRefs.current = []
      emitter.off('revertChat')
      emitter.off('fileSelected')
      emitter.off('folderSelected')
      emitter.off('insert-quote')
      emitter.off('diagramSelected')
      emitter.off('quick-prompt-insert')
      emitter.off('quick-prompt-send')
      emitter.off('ai-placeholder-generated', handleAiPlaceholderGenerated)
      emitter.off('ai-prompts-generated', handleAiPromptsGenerated)
      emitter.off('github-stars-send-to-chat', handleGithubStarSendToChat)
    }
  }, [applyQuickPrompt, applyTypedText, debouncedGenPlaceholder, handleQuickPromptSend, setContextPanelExpandedPref, setPendingQuote])

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

  const attachDraggedResourceToChat = useCallback(async (detail: LingMoFilePointerDragDetail) => {
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
      const detail = getLingMoFilePointerDragDetail(event)
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

    window.addEventListener(LINGMO_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)

    return () => {
      window.removeEventListener(LINGMO_FILE_POINTER_DRAG_EVENT, handleFilePointerDrag)
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

  const currentModelContextKey = useMemo(() => {
    const resolved = resolvePrimaryChatModel(aiModelList, primaryModel)
    return [
      primaryModel,
      resolved?.model?.model,
      resolved?.config.model,
      resolved?.config.title,
    ].filter(Boolean).join(' ')
  }, [aiModelList, primaryModel])

  const currentModelContextWindow = useMemo(() => {
    const resolved = resolvePrimaryChatModel(aiModelList, primaryModel)
    return resolved?.model?.contextWindow || resolved?.config.contextWindow
  }, [aiModelList, primaryModel])

  return (
    <footer id="onboarding-target-chat-input" className="relative z-20 flex w-full shrink-0 flex-col justify-between bg-background px-2 pb-2">
      {/* 敏感指令智能路由提示 Banner */}
      {showSuggestAgentBanner && (
        <div className="mb-2 w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground animate-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span>检测到编辑修改操作，建议切换到 <strong>Agent 模式</strong> 以自动运行本地工具</span>
          </div>
          <button
            type="button"
            className="shrink-0 font-semibold text-primary hover:underline"
            onClick={async () => {
              await setChatMode('agent')
              setShowSuggestAgentBanner(false)
            }}
          >
            一键切换
          </button>
        </div>
      )}

      {/* Agent 状态栏 - 只在 Agent 模式下显示 */}
      {chatMode === 'agent' && <AgentStatusBar />}

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
      {/* 上下文面板 */}
      <ChatInputContext
        hasContext={hasContext}
        isExpanded={isContextExpanded}
        onToggleExpand={() => {
          setIsContextExpanded(!isContextExpanded)
          setContextPanelExpandedPref(!isContextExpanded)
        }}
        pendingQuote={pendingQuote}
        onClearQuote={clearPendingQuote}
        linkedResources={linkedResources}
        onRemoveResource={(key) => removeLinkedResourceByKey(key)}
        onClearAllResources={clearLinkedFiles}
        attachedImages={attachedImages}
        onRemoveImage={(id) => setAttachedImages(prev => prev.filter(img => img.id !== id))}
        onClearAllImages={() => setAttachedImages([])}
        onClearAllContexts={clearAllContexts}
      />

      {/* 输入框容器 - 相对定位，用于放置 Token 气泡 */}
      <div className="relative">
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
        {aiQuickPrompts.length > 0 && !text.trim() && !isResearchActive ? (
          <div className="flex w-full min-w-0 gap-1 overflow-x-auto px-1 pb-0.5">
            {aiQuickPrompts.map((prompt) => (
              <button
                key={prompt.id}
                type="button"
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border/70 bg-muted/35 px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                onClick={() => applyQuickPrompt(prompt.text)}
              >
                <span className="max-w-[12rem] truncate">{prompt.text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="relative w-full flex items-start">
          <AiDocCommandPopover
            open={slashOpen}
            query={slashQuery || ''}
            selectedIndex={slashSelectedIndex}
            onSelectionChange={setSlashSelectedIndex}
            onSelect={(commandId) => void executeAiDocCommand(commandId)}
            anchorRef={textareaRef}
          />
          <FileAutocompletePopover
            open={atOpen}
            query={atQuery || ''}
            selectedIndex={atSelectedIndex}
            onSelectionChange={setAtSelectedIndex}
            onSelect={(item) => {
              void (async () => {
                const workspace = await getWorkspacePath()
                await attachResourceWithContext({
                  name: item.name,
                  path: workspace.isCustom ? `${workspace.path}/${item.relativePath}` : item.relativePath,
                  relativePath: item.relativePath
                }, 'manual')
                setText(prev => prev.replace(/@([^\s@]*)$/, ''))
                setIsContextExpanded(true)
                setTimeout(() => textareaRef.current?.focus(), 50)
              })()
            }}
            files={flattenedFiles}
            anchorRef={textareaRef}
          />
          <Textarea
            ref={textareaRef}
            className="flex-1 p-2 relative border-none text-xs placeholder:text-sm md:placeholder:text-sm md:text-sm focus-visible:ring-1 focus-visible:ring-ring/30 shadow-none min-h-[36px] max-h-[240px] resize-none overflow-y-auto"
            rows={1}
            disabled={!primaryModel || isResearchActive}
            value={text}
            onChange={(e) => {
              const val = e.target.value
              if (selectedSlashCommandRef.current?.display !== val) {
                selectedSlashCommandRef.current = null
              }
              setText(val)
              if (chatMode === 'chat' && isSensitiveInstruction(val)) {
                setShowSuggestAgentBanner(true)
              } else {
                setShowSuggestAgentBanner(false)
              }
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

              // @ 文件联想面板按键拦截
              if (atOpen && !isComposing) {
                const filteredCount = flattenedFiles.filter(
                  file => file.name.toLowerCase().includes((atQuery || '').toLowerCase()) ||
                          file.relativePath.toLowerCase().includes((atQuery || '').toLowerCase())
                ).slice(0, 8).length

                if (e.key === 'ArrowDown') {
                  if (filteredCount > 0) {
                    e.preventDefault()
                    setAtSelectedIndex((prev) => (prev + 1) % filteredCount)
                    return
                  }
                }
                if (e.key === 'ArrowUp') {
                  if (filteredCount > 0) {
                    e.preventDefault()
                    setAtSelectedIndex((prev) =>
                      prev <= 0 ? filteredCount - 1 : prev - 1,
                    )
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  const filtered = flattenedFiles.filter(
                    file => file.name.toLowerCase().includes((atQuery || '').toLowerCase()) ||
                            file.relativePath.toLowerCase().includes((atQuery || '').toLowerCase())
                  ).slice(0, 8)

                  if (filtered.length > 0) {
                    e.preventDefault()
                    const target = filtered[Math.min(atSelectedIndex, filtered.length - 1)]

                    void (async () => {
                      const workspace = await getWorkspacePath()
                      await attachResourceWithContext({
                        name: target.name,
                        path: workspace.isCustom ? `${workspace.path}/${target.relativePath}` : target.relativePath,
                        relativePath: target.relativePath
                      }, 'manual')

                      setText(prev => prev.replace(/@([^\s@]*)$/, ''))
                      setIsContextExpanded(true)
                      setTimeout(() => textareaRef.current?.focus(), 50)
                    })()
                    return
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setText(prev => prev.replace(/@([^\s@]*)$/, ''))
                  return
                }
              }

              const selectedSlashCommand = selectedSlashCommandRef.current
              if (
                selectedSlashCommand &&
                selectedSlashCommand.display === text &&
                e.key === 'Enter' &&
                !isComposing &&
                !e.shiftKey
              ) {
                e.preventDefault()
                chatSendRef.current?.sendChat(selectedSlashCommand.instruction, {
                  maxTokens: selectedSlashCommand.maxTokens,
                  temperature: selectedSlashCommand.temperature,
                })
                selectedSlashCommandRef.current = null
                return
              }

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
                if (dictation.isActive) {
                  return
                }
                selectedSlashCommandRef.current = null
                chatSendRef.current?.sendChat()
              }
              if (e.key === "Escape" && dictation.isActive) {
                e.preventDefault()
                dictation.cancel()
                return
              }
              if (e.key === "Tab" && placeholder.includes('[Tab]')) {
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
        
        <div className="flex w-full min-w-0 items-center gap-0.5 overflow-hidden px-0.5 pb-0.5">
          <div className="flex min-w-0 shrink-0 items-center gap-0.5">
            <ChatInputAddMenu
              onSelectImages={isMobile ? handleSelectFromGallery : handleSelectLocalImages}
              disabled={!primaryModel || isResearchActive}
            />
            <TooltipButton
              variant={webSearchEnabled ? "secondary" : "ghost"}
              size="icon"
              icon={<GlobeIcon className={webSearchEnabled ? "size-4 text-primary" : "size-4"} />}
              tooltipText={webSearchEnabled ? '已启用 Web 搜索（Tavily）' : '启用 Web 搜索（Tavily）'}
              onClick={handleToggleWebSearch}
              disabled={loading || isResearchActive}
              buttonClassName={webSearchEnabled ? 'h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary hover:bg-primary/10' : 'h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground'}
            />
            <ChatModeSelect variant="compact" />
          </div>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-0.5 pr-0.5">
            <ChatContextRing
              inputText={text}
              model={currentModelContextKey}
              contextWindow={currentModelContextWindow}
              className="h-7 w-7 shrink-0 rounded-md hover:bg-muted/40"
            />
            <TooltipButton
              variant={enhancingPrompt ? "secondary" : "ghost"}
              size="icon"
              icon={enhancingPrompt ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
              tooltipText={enhancingPrompt ? '正在增强提示词...' : '增强提示词'}
              onClick={handleEnhancePrompt}
              disabled={loading || enhancingPrompt || isResearchActive}
              buttonClassName={enhancingPrompt ? 'h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary hover:bg-primary/10' : 'h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground'}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={dictationPolishMode === 'raw' ? 'ghost' : 'secondary'}
                  size="sm"
                  disabled={dictation.isActive || loading || isResearchActive}
                  className={dictationPolishMode === 'raw'
                    ? 'h-7 shrink-0 gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    : 'h-7 shrink-0 gap-1 rounded-md bg-primary/10 px-2 text-xs text-primary hover:bg-primary/10'
                  }
                  aria-label="语音文本整理模式"
                >
                  <span>{DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}</span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-32">
                {DICTATION_POLISH_MODE_OPTIONS.map(option => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => setDictationPolishModeValue(option.value)}
                    className="gap-2"
                  >
                    <Check className={option.value === dictationPolishMode ? 'size-4 opacity-100' : 'size-4 opacity-0'} />
                    <span className="text-sm">{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipButton
              variant={dictation.isListening ? "destructive" : dictation.phase === "transcribing" || dictation.phase === "polishing" || dictation.phase === "starting" ? "secondary" : "ghost"}
              size="icon"
              icon={
                dictation.phase === "transcribing" || dictation.phase === "polishing" || dictation.phase === "starting"
                  ? <Loader2 className="size-4 animate-spin" />
                  : dictation.isListening
                    ? <Square className="size-4" />
                    : <Mic className="size-4" />
              }
              tooltipText={
                dictation.phase === "transcribing"
                  ? '正在识别语音...'
                  : dictation.phase === "polishing"
                    ? `正在整理语音文本：${DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}`
                  : dictation.phase === "starting"
                    ? '正在启动录音...'
                    : dictation.isListening
                    ? `停止录音并转文字 ${dictation.formattedDuration}，模式：${DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}`
                    : dictation.isOtherRecordingActive
                      ? '当前已有录音任务'
                      : !sttModel
                        ? '请先配置语音识别模型'
                        : `语音输入，整理模式：${DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}`
              }
              onClick={dictation.toggle}
              disabled={!primaryModel || isResearchActive || dictation.phase === "transcribing" || dictation.phase === "polishing" || dictation.isOtherRecordingActive || (loading && !dictation.isListening)}
              buttonClassName={dictation.isListening
                ? 'h-7 w-7 shrink-0 rounded-md'
                : dictation.phase === "transcribing" || dictation.phase === "polishing" || dictation.phase === "starting"
                  ? 'h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary hover:bg-primary/10'
                  : 'h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }
            />
            <div className="shrink-0">
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
                hideIdleButton
                ref={chatSendRef}
              />
            </div>
          </div>
        </div>
        </div> {/* 关闭输入框外层容器 */}
      </div>
    </footer>
  )
})
ChatInput.displayName = 'ChatInput'
