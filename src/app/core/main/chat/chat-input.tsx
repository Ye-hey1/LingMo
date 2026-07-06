"use client"
import * as React from "react"
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore, { type ChatMode } from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import useVectorStore from "@/stores/vector"
import { useSkillsStore } from "@/stores/skills"
import { fetchAiQuickPrompts } from "@/lib/ai/placeholder"
import { enhanceChatPrompt } from "@/lib/ai/prompt-enhancer"
import { decideAutoWebSearch } from "@/lib/ai/auto-web-search"
import { decideDocumentGrounding } from "@/lib/ai/document-grounding"
import {
  DICTATION_POLISH_MODE_LABELS,
  isDictationPolishMode,
  type DictationPolishMode,
} from "@/lib/ai/dictation-polish"
import { estimateTokens } from "@/lib/ai/token-counter"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { ChatModeSelect } from "./chat-mode-select"
import { getWorkspacePath } from "@/lib/workspace"
import { ChatSend, type ChatSendOptions } from "./chat-send"
import { isLinkedFolder, type LinkedResource, type MarkdownFile, type LinkedFolder } from "@/lib/files"
import emitter from "@/lib/emitter"
import { useIsMobile } from '@/hooks/use-mobile'
import type { ImageAttachment } from "./image-attachments"
import { Loader2, Mic, MousePointer2, Square, WandSparkles } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import type { PendingQuote } from "@/stores/chat"
import { convertFileSrc } from "@tauri-apps/api/core"
import { readTextFile, writeFile, BaseDirectory, exists } from "@tauri-apps/plugin-fs"
import { toast } from "@/hooks/use-toast"
import { ChatInputContext } from "./chat-input-context"
import { ChatContextRing } from "./chat-token-display"
import { ChatInputAddMenu } from "./chat-input-add-menu"
import {
  getResearchDepthConfig,
  normalizeResearchDepthPreset,
  ResearchDepthControl,
  type ResearchDepthPreset,
} from "./research-depth-control"
import {
  getLingMoFilePointerDragDetail,
  isPointInsideElement,
  LINGMO_FILE_POINTER_DRAG_EVENT,
  type LingMoFilePointerDragDetail,
} from "@/lib/file-pointer-drag"
import { buildTypingFrames } from './onboarding-typing'
import type { ActivityCalendarData } from '@/lib/activity/types'
import type { AiConfig, ModelConfig } from '@/app/core/setting/config'
import { AiDocCommandPopover } from './ai-doc-command-popover'
import { filterSlashCommands, findSlashCommand, type SlashCommandItem } from '@/lib/ai-doc-commands/slash-bridge'
import { findAiDocCommand, type AiDocCommandId } from '@/lib/ai-doc-commands'
import { skillExecutor } from '@/lib/skills'
import { loadActivityCalendarData, loadCachedActivityCalendarData } from '@/lib/activity'
import { createActivityReviewNote } from '@/lib/activity/review-note'
import { matchesConfiguredModelSelection } from '@/lib/ai/model-selection'

import { FileAutocompletePopover, type FileAutocompleteItem } from './file-autocomplete-popover'
import type { DirTree } from '@/stores/article'
import { useChatDictation } from './use-chat-dictation'
import type { QuickPrompt } from '@/lib/ai/placeholder'
import { cn } from '@/lib/utils'

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

function isKeyboardEventComposing(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
  return nativeEvent.isComposing || nativeEvent.keyCode === 229
}

function isSendEnterKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  return event.key === 'Enter' && !event.shiftKey && !isKeyboardEventComposing(event)
}

function normalizeSlashCommandToken(value: string) {
  return value.trim().replace(/^\/+/, '').toLowerCase()
}

function getSlashCommandAliases(command: SlashCommandItem) {
  return [command.title, ...command.searchTerms]
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term, index, list) => list.findIndex((item) => item.toLowerCase() === term.toLowerCase()) === index)
    .sort((a, b) => normalizeSlashCommandToken(b).length - normalizeSlashCommandToken(a).length)
}

function getSlashCommandInsertToken(command: SlashCommandItem) {
  const title = command.title.trim()
  if (title && !/\s/.test(title)) return title

  const inlineAlias = command.searchTerms
    .map((term) => term.trim())
    .find((term) => term && !/\s/.test(term) && term.length <= 48)
  return inlineAlias || title.replace(/\s+/g, '-')
}

function parseSlashInput(input: string) {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const rawBody = trimmed.slice(1)
  const hasLeadingSpace = /^\s/.test(rawBody)
  const body = rawBody.trimStart()
  const delimiterMatch = body.match(/^[,，、;；:：。.!！?？]\s*([\s\S]*)$/)
  if (delimiterMatch) {
    return {
      commandToken: '',
      userRequest: delimiterMatch[1].trim(),
    }
  }
  if (hasLeadingSpace) {
    return {
      commandToken: '',
      userRequest: body.trim(),
    }
  }

  const match = body.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return {
    commandToken: match?.[1] || '',
    userRequest: (match?.[2] || '').trim(),
  }
}

type SlashTrigger = {
  commandToken: string
  from: number
  to: number
}

function findSlashCommandAliasMatch(command: SlashCommandItem, token: string) {
  const normalizedToken = normalizeSlashCommandToken(token)
  if (!normalizedToken) return null

  for (const alias of getSlashCommandAliases(command)) {
    if (/\s/.test(alias)) continue

    const normalizedAlias = normalizeSlashCommandToken(alias)
    if (!normalizedAlias) continue

    if (normalizedToken === normalizedAlias) {
      return {
        alias,
        length: token.length,
        isExact: true,
      }
    }

    if (normalizedToken.startsWith(normalizedAlias)) {
      return {
        alias,
        length: alias.length,
        isExact: false,
      }
    }
  }

  return null
}

function findSlashTriggerAtCursor(input: string, cursor: number): SlashTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, input.length))
  const prefix = input.slice(0, safeCursor)
  const lineStart = Math.max(prefix.lastIndexOf('\n') + 1, 0)
  const currentLinePrefix = prefix.slice(lineStart)
  const match = /\/([^\s/]*)$/.exec(currentLinePrefix)
  if (!match) return null

  const slashOffsetInLine = currentLinePrefix.length - match[0].length
  const from = lineStart + slashOffsetInLine
  return {
    commandToken: match[1] || '',
    from,
    to: safeCursor,
  }
}

function replaceTextRange(input: string, from: number, to: number, replacement: string) {
  return `${input.slice(0, from)}${replacement}${input.slice(to)}`
}

function removeTextRange(input: string, from: number, to: number) {
  const safeFrom = Math.max(0, Math.min(from, input.length))
  const safeTo = Math.max(safeFrom, Math.min(to, input.length))
  const removeTo = safeFrom > 0 && /\s/.test(input[safeFrom - 1] || '') && /\s/.test(input[safeTo] || '')
    ? safeTo + 1
    : safeTo

  return {
    text: `${input.slice(0, safeFrom)}${input.slice(removeTo)}`,
    cursor: safeFrom,
  }
}

function getSlashReplacementRange(
  input: string,
  trigger: SlashTrigger,
  command: SlashCommandItem,
) {
  const token = input.slice(trigger.from + 1, trigger.to)
  const aliasMatch = findSlashCommandAliasMatch(command, token)

  if (aliasMatch && aliasMatch.length < token.length) {
    return {
      from: trigger.from,
      to: trigger.from + 1 + aliasMatch.length,
    }
  }

  return {
    from: trigger.from,
    to: trigger.to,
  }
}

function isExactSlashCommandInput(input: string, command: SlashCommandItem, trigger?: SlashTrigger | null) {
  const token = trigger?.commandToken ?? parseSlashInput(input)?.commandToken ?? input
  const aliasMatch = findSlashCommandAliasMatch(command, token)
  return Boolean(aliasMatch?.isExact)
}

function getSlashCommandInvocation(input: string, command: SlashCommandItem) {
  const slashPattern = /\/([^\s/，。！？；：、,.!?;:]+)/g
  let match: RegExpExecArray | null
  while ((match = slashPattern.exec(input)) !== null) {
    const aliasMatch = findSlashCommandAliasMatch(command, match[1] || '')
    if (!aliasMatch) {
      continue
    }

    const from = match.index
    const to = from + 1 + aliasMatch.length
    const userRequest = replaceTextRange(input, from, to, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()

    return {
      command,
      userRequest,
      range: { from, to },
    }
  }

  return null
}

function getSlashToolLabel(command: SlashCommandItem) {
  return `/${getSlashCommandInsertToken(command)}`
}

function buildSlashHighlightSegments(input: string, command: SlashCommandItem | null) {
  if (!command) return [{ text: input, isCommand: false }]

  const invocation = getSlashCommandInvocation(input, command)
  if (!invocation) return [{ text: input, isCommand: false }]

  const { from, to } = invocation.range
  const label = command.title.trim() || input.slice(from, to)
  return [
    { text: input.slice(0, from), isCommand: false },
    { text: input.slice(from, to), label, isCommand: true },
    { text: input.slice(to), isCommand: false },
  ].filter(segment => segment.text.length > 0)
}

function getSlashCaretBoundary(
  input: string,
  command: SlashCommandItem | null,
  cursor: number,
  preference: 'start' | 'end' | 'nearest' = 'nearest',
) {
  if (!command) return null

  const invocation = getSlashCommandInvocation(input, command)
  if (!invocation) return null

  const { from, to } = invocation.range
  if (cursor <= from || cursor >= to) return null

  if (preference === 'start') return from
  if (preference === 'end') return to
  return cursor - from < to - cursor ? from : to
}

function getAtomicSlashArrowBoundary(
  input: string,
  command: SlashCommandItem | null,
  key: string,
  selectionStart: number,
  selectionEnd: number,
) {
  if (!command || (key !== 'ArrowLeft' && key !== 'ArrowRight') || selectionStart !== selectionEnd) {
    return null
  }

  const invocation = getSlashCommandInvocation(input, command)
  if (!invocation) return null

  const { from, to } = invocation.range
  const cursor = selectionStart
  if (key === 'ArrowLeft' && cursor > from && cursor <= to) return from
  if (key === 'ArrowRight' && cursor >= from && cursor < to) return to

  return null
}

function getAtomicSlashDeleteRange(
  input: string,
  command: SlashCommandItem | null,
  key: string,
  selectionStart: number,
  selectionEnd: number,
) {
  if (!command || (key !== 'Backspace' && key !== 'Delete')) return null

  const invocation = getSlashCommandInvocation(input, command)
  if (!invocation) return null

  const { from, to } = invocation.range
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)

  if (start !== end) {
    const overlapsCommand = start < to && end > from
    return overlapsCommand
      ? { from: Math.min(start, from), to: Math.max(end, to) }
      : null
  }

  if (
    key === 'Backspace'
    && (start > from && start <= to || (start === to + 1 && /\s/.test(input[to] || '')))
  ) {
    return { from, to }
  }

  if (
    key === 'Delete'
    && (start >= from && start < to || (start === from - 1 && /\s/.test(input[start] || '')))
  ) {
    return { from, to }
  }

  return null
}

const SENSITIVE_KEYWORDS = [
  '修改代码', '修改文件', '编辑文件', '编辑代码', '替换文件',
  '新建文件', '创建文件', '写入文件', '删除文件', '执行指令',
  '运行命令', '跑命令', '跑指令', '新建文件夹', '创建文件夹',
  'replace_file_content', 'write_to_file', 'create_file', 'modify_file'
]

const RESEARCH_KEYWORDS = [
  '调研', '研究', '深度研究', '资料检索', '联网检索', '查资料',
  '市场分析', '竞品分析', '文献综述', '研究报告', '信息源', '引用来源',
  'research', 'deep research', 'market research', 'competitive analysis',
  'literature review', 'sources', 'citations'
]

const CHAT_DICTATION_POLISH_MODE_STORAGE_KEY = 'chat-dictation-polish-mode'
const CHAT_RESEARCH_DEPTH_PRESET_STORAGE_KEY = 'chat-research-depth-preset'
const CHAT_PRIMARY_ACTION_MODE_STORAGE_KEY = 'chat-primary-action-mode'

function isSensitiveInstruction(val: string): boolean {
  const normalized = val.toLowerCase()
  return SENSITIVE_KEYWORDS.some(k => normalized.includes(k))
}

function isResearchInstruction(val: string): boolean {
  const normalized = val.toLowerCase()
  return RESEARCH_KEYWORDS.some(k => normalized.includes(k))
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
    const targetModel = config.models?.find(model => matchesConfiguredModelSelection({
      configKey: config.key,
      modelId: model.id,
      selectionId: primaryModel,
    }))
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
type ChatSendHandle = {
  sendChat: (instructionOverride?: string, options?: ChatSendOptions) => void
  stopChat: () => Promise<void>
}

type ChatInputProps = {
  expanded?: boolean
}

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

export const ChatInput = React.memo(function ChatInput({ expanded = false }: ChatInputProps) {
  const [text, setText] = useState("")
  const {
    primaryModel,
    aiModelList,
    imageMethodModel,
    sttModel,
    webSearchEnabled,
  } = useSettingStore()
  const {
    chats,
    loading,
    researchRunning,
    agentState,
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
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const currentArticle = useArticleStore((state) => state.currentArticle)
  const fileTree = useArticleStore((state) => state.fileTree)
  const loadFileTree = useArticleStore((state) => state.loadFileTree)

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
  // 对话模式下,对需要工具或长任务的指令给出模式切换建议。
  const [suggestedMode, setSuggestedMode] = useState<null | {
    mode: Extract<ChatMode, 'agent' | 'research'>
    title: string
    description: string
  }>(null)
  useEffect(() => {
    if (chatMode !== 'chat') {
      setSuggestedMode(null)
    }
  }, [chatMode])

  const { isRagEnabled } = useVectorStore()
  const { skills, enabled: skillsEnabled } = useSkillsStore()
  const [isComposing, setIsComposing] = useState(false)
  const [enhancingPrompt, setEnhancingPrompt] = useState(false)
  const [placeholder, setPlaceholder] = useState('')
  const [, setAiQuickPrompts] = useState<QuickPrompt[]>([])
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<SlashCommandItem | null>(null)
  const isAgentMode = chatMode === 'agent'
  const isModelRunning = researchRunning || (isAgentMode ? agentState.isRunning : loading)
  const isResearchActive = researchRunning || (loading && chatMode === 'research')
  const textareaMaxHeight = expanded ? 320 : 240
  const slashHighlightSegments = useMemo(
    () => buildSlashHighlightSegments(text, selectedSlashCommand),
    [selectedSlashCommand, text],
  )
  const effectivePlaceholder = isResearchActive
    ? '研究运行中,预计 3-6 分钟完成。你可以点击停止按钮中断。'
    : selectedSlashCommand
      ? `输入「${selectedSlashCommand.title}」的具体要求`
    : placeholder

  // 斜杠命令面板状态
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const slashCommandsCountRef = useRef(0)
  // 已选中但尚未提交的命令：选择后仅填入输入框，按 Enter 才真正执行
  const pendingCommandRef = useRef<SlashCommandItem | null>(null)
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null)
  const slashHighlightRef = useRef<HTMLDivElement>(null)

  const updateSlashTriggerFromTextarea = useCallback((textarea?: HTMLTextAreaElement | null, nextValue?: string) => {
    const value = nextValue ?? textarea?.value ?? text
    const cursor = textarea?.selectionStart ?? value.length
    setSlashTrigger(findSlashTriggerAtCursor(value, cursor))
  }, [text])

  const syncSlashHighlightScroll = useCallback((textarea?: HTMLTextAreaElement | null) => {
    const highlight = slashHighlightRef.current
    if (!textarea || !highlight) return
    highlight.scrollTop = textarea.scrollTop
    highlight.scrollLeft = textarea.scrollLeft
  }, [])

  const keepSlashCommandCaretAtomic = useCallback((
    textarea: HTMLTextAreaElement,
    preference: 'start' | 'end' | 'nearest' = 'nearest',
  ) => {
    if (textarea.selectionStart !== textarea.selectionEnd) return false

    const boundary = getSlashCaretBoundary(
      textarea.value,
      selectedSlashCommand,
      textarea.selectionStart,
      preference,
    )
    if (boundary === null) return false

    textarea.setSelectionRange(boundary, boundary)
    updateSlashTriggerFromTextarea(textarea)
    return true
  }, [selectedSlashCommand, updateSlashTriggerFromTextarea])

  const slashQuery = selectedSlashCommand ? null : slashTrigger?.commandToken ?? null
  const slashOpen = slashQuery !== null

  // 异步加载命令列表（包含 Skills）
  const [slashFilteredCommands, setSlashFilteredCommands] = useState<SlashCommandItem[]>([])
  useEffect(() => {
    if (!slashOpen) {
      setSlashFilteredCommands([])
      return
    }
    let cancelled = false
    void filterSlashCommands(slashQuery || '').then((result) => {
      if (!cancelled) setSlashFilteredCommands(result)
    })
    return () => { cancelled = true }
  }, [slashOpen, slashQuery])

  useEffect(() => {
    slashCommandsCountRef.current = slashFilteredCommands.length
    setSlashSelectedIndex((prev) => {
      if (slashFilteredCommands.length === 0) return 0
      return Math.min(prev, slashFilteredCommands.length - 1)
    })
  }, [slashFilteredCommands])

  const updateSuggestedModeFromText = useCallback((val: string) => {
    if (chatMode === 'chat' && isSensitiveInstruction(val)) {
      setSuggestedMode({
        mode: 'agent',
        title: '建议切换到 Agent',
        description: '这看起来需要编辑文件、运行工具或处理本地资源。',
      })
    } else if (chatMode === 'chat' && isResearchInstruction(val)) {
      setSuggestedMode({
        mode: 'research',
        title: '建议切换到 Research',
        description: '这看起来需要持续检索、分析资料或生成研究报告。',
      })
    } else {
      setSuggestedMode(null)
    }
  }, [chatMode])

  const updateTextFromTextarea = useCallback((textarea: HTMLTextAreaElement) => {
    const val = textarea.value
    const selectedInvocation = selectedSlashCommand
      ? getSlashCommandInvocation(val, selectedSlashCommand)
      : null
    const pendingInvocation = pendingCommandRef.current
      ? getSlashCommandInvocation(val, pendingCommandRef.current)
      : null

    if (selectedSlashCommand && !selectedInvocation) {
      pendingCommandRef.current = null
      setSelectedSlashCommand(null)
    } else if (!selectedSlashCommand && pendingCommandRef.current && !pendingInvocation) {
      pendingCommandRef.current = null
    }

    setText(val)
    updateSuggestedModeFromText(val)
    updateSlashTriggerFromTextarea(textarea, val)

    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, textareaMaxHeight)
    textarea.style.height = `${newHeight}px`
    syncSlashHighlightScroll(textarea)
  }, [selectedSlashCommand, syncSlashHighlightScroll, textareaMaxHeight, updateSlashTriggerFromTextarea, updateSuggestedModeFromText])

  // ---- 阶段 1：选中命令，仅填入输入框 ----
  const selectSlashCommand = useCallback(async (commandId: string) => {
    const slashCommand = await findSlashCommand(commandId)
    if (!slashCommand) return

    if (slashCommand.executionMode === 'agent' && chatMode !== 'agent') {
      toast({
        title: '请切换到 Agent 模式',
        description: `/${slashCommand.title} 需要执行本地工具或编辑文件，对话模式只用于问答、联网搜索和阅读上下文。`,
        variant: 'destructive',
      })
      return
    }

    const trigger = slashTrigger || findSlashTriggerAtCursor(text, textareaRef.current?.selectionStart ?? text.length)
    const replacement = getSlashToolLabel(slashCommand)
    const replacementRange = trigger
      ? getSlashReplacementRange(text, trigger, slashCommand)
      : null
    const nextText = replacementRange
      ? replaceTextRange(text, replacementRange.from, replacementRange.to, replacement)
      : text.trim()
        ? `${text} ${replacement}`
        : `${replacement} `
    const cursor = replacementRange ? replacementRange.from + replacement.length : nextText.length
    pendingCommandRef.current = slashCommand
    setSelectedSlashCommand(slashCommand)
    setSlashTrigger(null)
    setText(nextText)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(cursor, cursor)
      })
    }
  }, [chatMode, slashTrigger, text])

  // ---- 阶段 2：按 Enter 后真正执行 ----
  const executeSlashCommand = useCallback(async (slashCommand: SlashCommandItem, userRequest?: string) => {
    if (slashCommand.executionMode === 'agent' && chatMode !== 'agent') {
      toast({
        title: '请切换到 Agent 模式',
        description: `/${slashCommand.title} 需要执行本地工具或编辑文件，对话模式只用于问答、联网搜索和阅读上下文。`,
        variant: 'destructive',
      })
      return
    }

    if (slashCommand.source === 'skill') {
      if (!slashCommand.skillContent) return

      pendingCommandRef.current = null
      setSelectedSlashCommand(null)
      setSlashTrigger(null)
      setText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }

      const actualRequest = userRequest?.trim() || `执行 /${slashCommand.title}`
      const displayText = userRequest?.trim()
        ? `/${slashCommand.title} ${userRequest.trim()}`
        : `/${slashCommand.title}`
      const routeOverride = slashCommand.runtimeProfile
      const skillInstruction = routeOverride === 'writer' || routeOverride === 'advisor'
        ? actualRequest
        : skillExecutor.formatSkillForExecution(slashCommand.skillContent, actualRequest)

      try {
        const isAgentSkill = slashCommand.executionMode === 'agent'
        if (process.env.NODE_ENV !== 'production') {
          // 调试日志：记录斜杠命令路由信息
          console.debug('[SlashSkill] route', {
            id: slashCommand.id,
            runtimeProfile: slashCommand.runtimeProfile,
            reason: slashCommand.runtimeProfileReason,
          })
        }
        chatSendRef.current?.sendChat(skillInstruction, {
          forcedSkillIds: [slashCommand.skillContent.metadata.id],
          displayText,
          routeOverride: slashCommand.runtimeProfile,
          modeOverride: isAgentSkill ? 'agent' : 'chat',
        })
      } catch (error) {
        toast({
          title: '发送失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
      return
    }

    const command = findAiDocCommand(slashCommand.id as AiDocCommandId)
    if (!command) return

    // 加载活动数据（回顾类命令需要，其他命令可接受 null）
    let data: ActivityCalendarData | null = null
    if (command.category === 'review') {
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

    // 清空输入框
    pendingCommandRef.current = null
    setSelectedSlashCommand(null)
    setSlashTrigger(null)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const exec = await command.buildExecution(data)
    if (exec.skipReason) {
      toast({ title: '无法生成', description: exec.skipReason, variant: 'destructive' })
      return
    }

    // 非 AI 命令：直接执行
    if (exec.prompt === null) {
      try {
        if (exec.directContent?.startsWith('已生成')) {
          toast({ title: '完成', description: exec.directContent })
        } else if (exec.directContent) {
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

    // AI 命令：发送给 LLM
    const commandRequest = userRequest?.trim()
    const displayLabel = commandRequest
      ? `/${command.title} ${commandRequest}`
      : `/${command.title}`
    const commandInstruction = `你正在执行一个应用内命令：${displayLabel}。
这是明确的操作任务，不要先解释概念，不要做泛化介绍，必须直接按命令目标执行工具。
如果上下文中已经包含"当前打开的笔记""关联文件内容"或"用户引用内容"，必须优先直接基于这些内容完成任务，不要再要求用户粘贴原文。
${commandRequest ? `\n用户在命令后的补充要求：${commandRequest}` : ''}

${exec.prompt}`
    try {
      chatSendRef.current?.sendChat(commandInstruction, {
        maxTokens: exec.maxTokens,
        temperature: exec.temperature,
        displayText: displayLabel,
      })
    } catch (error) {
      toast({
        title: '发送失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [chatMode, loadFileTree])
  const t = useTranslations()
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [dictationPolishModeValue, setDictationPolishModeValue] = useLocalStorage<string>(
    CHAT_DICTATION_POLISH_MODE_STORAGE_KEY,
    'raw'
  )
  const [researchDepthPresetValue, setResearchDepthPresetValue] = useLocalStorage<string>(
    CHAT_RESEARCH_DEPTH_PRESET_STORAGE_KEY,
    'auto'
  )
  const [primaryActionModeValue, setPrimaryActionModeValue] = useLocalStorage<string>(
    CHAT_PRIMARY_ACTION_MODE_STORAGE_KEY,
    'send'
  )
  const dictationPolishMode: DictationPolishMode = isDictationPolishMode(dictationPolishModeValue)
    ? dictationPolishModeValue
    : 'raw'
  const researchDepthPreset = normalizeResearchDepthPreset(researchDepthPresetValue)
  const primaryActionMode: 'send' | 'voice' = primaryActionModeValue === 'voice' ? 'voice' : 'send'
  const setResearchDepthPreset = useCallback((preset: ResearchDepthPreset) => {
    setResearchDepthPresetValue(preset)
  }, [setResearchDepthPresetValue])
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
  const autoWebSearchDecision = useMemo(() => {
    const baseDecision = decideAutoWebSearch({
      userInput: text,
      manualDefaultEnabled: webSearchEnabled,
      hasSearchProvider: true,
    })
    const documentDecision = decideDocumentGrounding({
      userInput: text,
      hasDocumentContext: Boolean(
        (currentArticle && activeFilePath) ||
        linkedResources.length > 0 ||
        pendingQuote
      ),
    })
    if (!documentDecision.suppressWebSearch || !baseDecision.enabled) {
      return baseDecision
    }

    return {
      ...baseDecision,
      enabled: false,
      shouldSearch: false,
      reason: 'stable' as const,
      label: '自动',
      detail: `${baseDecision.detail} 当前输入更适合先使用工作台文档上下文。`,
      matchedSignals: [...baseDecision.matchedSignals, '工作台上下文'],
    }
  }, [activeFilePath, currentArticle, linkedResources.length, pendingQuote, text, webSearchEnabled])
  const inputDropZoneStateClassName = isFilePointerOverInput
    ? 'border-primary bg-primary/5'
    : ''
  const inputModeBorderClassName = !isFilePointerOverInput && !isModelRunning
    ? chatMode === 'agent'
      ? 'border-amber-500/45 focus-within:border-amber-500/60'
      : chatMode === 'research'
        ? 'border-emerald-500/45 focus-within:border-emerald-500/60'
        : 'border-sky-500/45 focus-within:border-sky-500/60'
    : ''
  const inputFlowBorderClassName = !isFilePointerOverInput && isModelRunning
    ? chatMode === 'agent'
      ? 'chat-input-flow-border chat-input-flow-border-agent'
      : chatMode === 'research'
        ? 'chat-input-flow-border chat-input-flow-border-research'
        : 'chat-input-flow-border chat-input-flow-border-chat'
    : ''
  const hasContext = !!pendingQuote || linkedResources.length > 0 || attachedImages.length > 0
  const chatSendRef = useRef<ChatSendHandle>(null)
  const sendCurrentChat = useCallback((currentInput?: string) => {
    const depthConfig = getResearchDepthConfig(researchDepthPreset)
    const liveInput = currentInput?.trim()
    const researchOptions = chatMode === 'research'
      ? {
          researchDepthPreset: depthConfig.preset,
          researchBreadth: depthConfig.breadth,
          researchDepth: depthConfig.depth,
        }
      : undefined

    if (liveInput) {
      chatSendRef.current?.sendChat(liveInput, {
        ...researchOptions,
        displayText: liveInput,
      })
      return
    }

    chatSendRef.current?.sendChat(undefined, researchOptions)
  }, [chatMode, researchDepthPreset])
  const submitInput = useCallback((currentInput?: string) => {
    const value = currentInput ?? text
    const selectedCommand = selectedSlashCommand || pendingCommandRef.current
    if (selectedCommand) {
      const invocation = getSlashCommandInvocation(value, selectedCommand)
      const commandRequest = invocation?.userRequest || parseSlashInput(value)?.userRequest || value.trim()
      void executeSlashCommand(selectedCommand, commandRequest)
      return
    }
    sendCurrentChat(value)
  }, [executeSlashCommand, selectedSlashCommand, sendCurrentChat, text])
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputDropZoneRef = useRef<HTMLDivElement>(null)
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingAutoSendTimerRef = useRef<number | null>(null)
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
  const visionBridgeAvailable = useMemo(
    () => supportsImageInputForModel(aiModelList, imageMethodModel),
    [aiModelList, imageMethodModel]
  )

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, textareaMaxHeight)
    textarea.style.height = `${newHeight}px`
  }, [textareaMaxHeight])

  const clearPendingAutoSend = useCallback(() => {
    if (pendingAutoSendTimerRef.current === null) {
      return
    }

    window.clearTimeout(pendingAutoSendTimerRef.current)
    pendingAutoSendTimerRef.current = null
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

  const togglePrimaryActionMode = useCallback(() => {
    const nextMode = primaryActionMode === 'send' ? 'voice' : 'send'
    setPrimaryActionModeValue(nextMode)
    toast({
      title: nextMode === 'send' ? '已切换为发送' : '已切换为语音输入',
      description: '左键执行当前按钮功能，右键可再次切换。',
    })
  }, [primaryActionMode, setPrimaryActionModeValue])

  const handleVoiceActionClick = useCallback(() => {
    if (isModelRunning) {
      void chatSendRef.current?.stopChat()
      return
    }

    if (dictation.isActive) {
      dictation.toggle()
      return
    }

    if (!sttModel) {
      toast({
        title: '请先配置语音识别模型',
        description: '配置后即可使用语音输入。',
        variant: 'destructive',
      })
      return
    }

    dictation.toggle()
  }, [dictation, isModelRunning, sttModel])

  const primaryActionBusy = dictation.phase === "transcribing" || dictation.phase === "polishing" || dictation.phase === "starting"
  const primaryActionDisabled = !isModelRunning && (
    !primaryModel ||
    isResearchActive ||
    primaryActionBusy ||
    dictation.isOtherRecordingActive
  )
  const primaryActionIcon = isModelRunning || dictation.isListening
    ? <Square className="size-4" />
    : primaryActionBusy
      ? <Loader2 className="size-4 animate-spin" />
      : <Mic className="size-4" />
  const primaryActionTooltip = isModelRunning
    ? '停止生成'
    : dictation.phase === "transcribing"
      ? '正在识别语音...'
      : dictation.phase === "polishing"
        ? `正在整理语音文本:${DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}`
        : dictation.phase === "starting"
          ? '正在启动录音...'
          : dictation.isListening
            ? `停止录音并转文字 ${dictation.formattedDuration},模式:${DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}`
            : dictation.isOtherRecordingActive
                ? '当前已有录音任务。右键可切回发送'
                : !sttModel
                  ? '请先配置语音识别模型。右键可切回发送'
                  : `语音输入,整理模式:${DICTATION_POLISH_MODE_LABELS[dictationPolishMode]}。右键切换为发送`
  const primaryActionButtonClassName = isModelRunning || dictation.isListening
    ? 'h-8 w-8 shrink-0 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90'
    : primaryActionBusy
      ? 'h-8 w-8 shrink-0 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15'
      : 'h-8 w-8 shrink-0 rounded-lg border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'

  const ensureImageInputSupported = useCallback(() => {
    if (currentModelSupportsImages || visionBridgeAvailable) {
      return true
    }

    toast({
      title: '当前模型无法解析图片',
      description: '请切换到支持视觉能力的主模型,或在"设置 > 图片识别 > VLM"配置一个视觉模型用于 Vision Bridge。',
      variant: 'destructive',
    })
    return false
  }, [currentModelSupportsImages, visionBridgeAvailable])

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

    clearPendingAutoSend()
    pendingAutoSendTimerRef.current = window.setTimeout(() => {
      pendingAutoSendTimerRef.current = null
      sendCurrentChat(content)
    }, 30)
  }, [applyTypedText, clearLinkedFiles, clearPendingAutoSend, loading, sendCurrentChat, setPendingQuote, startNewConversation])

  const restoreMessageDraft = useCallback((detail: {
    content: string
    images?: string[]
    quoteData?: PendingQuote | null
  }) => {
    const content = detail.content
    if (!content.trim() || loading) return

    const restoredImages: ImageAttachment[] = (detail.images || []).map((url, index) => ({
      id: `draft-${Date.now()}-${index}`,
      url,
      name: url.split('/').pop() || `image-${index + 1}`,
      source: 'record',
    }))

    clearPendingAutoSend()
    pendingCommandRef.current = null
    clearLinkedFiles()
    setPendingQuote(detail.quoteData || null)
    setAttachedImages(restoredImages)
    setIsContextExpanded(Boolean(detail.quoteData || restoredImages.length > 0))
    applyTypedText(content)
    setPlaceholder('')

    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }, [applyTypedText, clearLinkedFiles, clearPendingAutoSend, loading, setPendingQuote])

  const handleQuickPromptSend = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return

    clearAllContexts()
    setPendingQuote(null)

    if (chatMode !== 'agent') {
      await setChatMode('agent')
    }

    applyTypedText(prompt)

    clearPendingAutoSend()
    pendingAutoSendTimerRef.current = window.setTimeout(() => {
      pendingAutoSendTimerRef.current = null
      sendCurrentChat(prompt)
    }, 30)
  }, [applyTypedText, chatMode, clearAllContexts, clearPendingAutoSend, sendCurrentChat, setChatMode, setPendingQuote])

  useEffect(() => {
    return () => {
      clearPendingAutoSend()
    }
  }, [clearPendingAutoSend])

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
    const handleDraft = (detail: unknown) => {
      const payload = detail as {
        content?: string
        images?: string[]
        quoteData?: PendingQuote | null
      }

      if (!payload?.content) return
      restoreMessageDraft({
        content: payload.content,
        images: payload.images,
        quoteData: payload.quoteData,
      })
    }

    emitter.on('chat-message-draft', handleDraft)
    return () => {
      emitter.off('chat-message-draft', handleDraft)
    }
  }, [restoreMessageDraft])

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

  // 输入历史(最多保留 50 条,自动去重)
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

  async function handleEnhancePrompt() {
    const input = text.trim()
    if (!input) {
      toast({
        title: '请先输入内容',
        description: '当前输入为空,请先输入问题或指令。',
      })
      textareaRef.current?.focus()
      return
    }

    if (!primaryModel) {
      toast({
        title: '请先配置 AI 模型',
        description: '在发送或增强前,请先在底部工具栏选择可用模型。',
        variant: 'destructive',
      })
      return
    }

    setEnhancingPrompt(true)
    try {
      const enabledSkillNames = skillsEnabled
        ? skills.filter(skill => skill.enabled).map(skill => skill.name)
        : []

      // 从当前对话中提取最近的消息，用于解析"继续"、"上面"等上下文引用
      const recentMessages = chats
        .filter(chat => chat.type === 'chat' && chat.content?.trim())
        .slice(-6)
        .map(chat => ({
          role: (chat.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: chat.content || '',
        }))

      const enhanced = await enhanceChatPrompt({
        userInput: input,
        chatMode,
        currentFilePath: activeFilePath,
        currentArticle: useArticleStore.getState().currentArticle,
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
        webSearchEnabled: autoWebSearchDecision.enabled,
        enabledSkillNames,
        recentMessages,
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

  function handleSent(sentText?: string) {
    if (onboardingAgentPromptArmedRef.current) {
      onboardingAgentPromptArmedRef.current = false
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    }
    addToHistory(sentText || text)
    setText('')
    pendingCommandRef.current = null
    setSelectedSlashCommand(null)
    setSlashTrigger(null)
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

    pendingCommandRef.current = null
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
    const handleQuotedPromptSendToChat = (event: unknown) => {
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
    emitter.on('github-stars-send-to-chat', handleQuotedPromptSendToChat)
    emitter.on('ai-hotspot-send-to-chat', handleQuotedPromptSendToChat)
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
      emitter.off('github-stars-send-to-chat', handleQuotedPromptSendToChat)
      emitter.off('ai-hotspot-send-to-chat', handleQuotedPromptSendToChat)
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
              ? `\n... (共 ${totalLines} 行,已显示前 100 行,剩余 ${totalLines - 100} 行)`
              : ''

          return {
            preview: `文件预览:${filePath.split('/').pop() || filePath}\n以下内容来自当前编辑器(建议使用 \`replace_editor_content\` 精确修改,内容版本号:${editorContent.version})\n\n\`\`\`\n${previewLines.join('\n')}\n\`\`\`${truncatedNote}\n`,
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
          preview: `文件不存在:${filePath.split('/').pop() || filePath}`,
          contentMode: 'full-file',
          note: '请确认路径是否正确,或先在左侧文件树中打开该文件后再发送。',
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
          ? `\n... (共 ${totalLines} 行,已显示前 100 行,剩余 ${totalLines - 100} 行)`
          : ''

      return {
        preview: `文件预览:${filePath.split('/').pop() || filePath}\n以下内容来自文件读取(建议使用 \`replace_editor_content\` 精确修改)\n\n\`\`\`\n${previewLines.join('\n')}\n\`\`\`${truncatedNote}\n`,
        estimatedTokens: estimateTokens(content),
        contentMode: 'full-file',
      }
    } catch (error) {
      console.error('Failed to generate file preview:', error)
      return {
        preview: `读取文件失败:${filePath.split('/').pop() || filePath}`,
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
    const currentArticle = isActiveResource
      ? useArticleStore.getState().currentArticle
      : ''

    if (isPdf) {
      addLinkedResource(resource, {
        preview: isActiveResource && currentArticle
          ? '已使用当前 PDF 可读文本作为上下文。'
          : 'PDF 文件已附加。若需要提取文本,请先在编辑区打开该 PDF。',
        meta: {
          origin,
          contentMode: isActiveResource && currentArticle ? 'pdf-active' : 'pdf-pending',
          estimatedTokens: isActiveResource && currentArticle ? estimateTokens(currentArticle) : undefined,
          note: isActiveResource && currentArticle
            ? '当前 PDF 文本已注入上下文。'
            : '当前仅附加 PDF 文件路径,尚未注入可读文本。',
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
          ? '该资源来自图表文件,会按图表上下文注入。'
          : previewResult.note,
      },
    })
    return key
  }, [activeFilePath, addLinkedResource, generateFilePreview, getLinkedResourceKey])

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
        // 如果当前打开的文件和之前自动链接的不同,说明用户打开了新文件
        // 此时重置抑制状态,允许自动链接新文件
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
    <footer
      id="onboarding-target-chat-input"
      className={cn(
        "relative z-20 flex w-full shrink-0 flex-col items-center justify-between bg-background",
        expanded ? "px-4 pb-4 lg:px-8" : "px-2 pb-2",
      )}
    >
      {/* 对话模式智能路由提示 Banner */}
      {suggestedMode && (
        <div className={cn(
          "mb-2 flex w-full items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-foreground animate-in slide-in-from-top-1 duration-200",
          expanded && "max-w-[1280px]",
        )}>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span>
              <strong>{suggestedMode.title}</strong>
              <span className="ml-1 text-muted-foreground">{suggestedMode.description}</span>
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 font-semibold text-primary hover:underline"
            onClick={async () => {
              await setChatMode(suggestedMode.mode)
              setSuggestedMode(null)
            }}
          >
            一键切换
          </button>
        </div>
      )}

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
      <div className={cn("w-full", expanded && "max-w-[1280px]")}>
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
      </div>

      {/* 输入框容器 - 相对定位,用于放置 Token 气泡 */}
      <div className={cn("relative w-full", expanded && "max-w-[1280px]")}>
        <div
          ref={inputDropZoneRef}
          className={cn(
            "group relative z-10 flex w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background transition-colors duration-200",
            expanded ? "gap-2 p-2" : "gap-1.5 p-1.5",
            inputDropZoneStateClassName,
            inputModeBorderClassName,
            inputFlowBorderClassName,
          )}
        >
        {isFilePointerDragging ? (
          <div
            className={`pointer-events-none absolute right-3 top-3 z-20 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium shadow-sm transition-colors ${isFilePointerOverInput ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-background/95 text-muted-foreground'}`}
          >
            <MousePointer2 className="size-3" />
            <span>拖到这里附加为上下文</span>
          </div>
        ) : null}
        <div className="relative flex w-full flex-col rounded-lg bg-muted/15 transition-colors group-focus-within:bg-muted/10">
          <AiDocCommandPopover
            open={slashOpen}
            query={slashQuery || ''}
            selectedIndex={slashSelectedIndex}
            onSelectionChange={setSlashSelectedIndex}
            onSelect={(commandId) => selectSlashCommand(commandId)}
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
          <div className="relative w-full">
            <div
              ref={slashHighlightRef}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-sm leading-6 text-foreground",
                expanded ? "min-h-[72px] max-h-[320px] px-4 py-3" : "min-h-[44px] max-h-[240px] px-3 py-2.5",
              )}
            >
              {text ? slashHighlightSegments.map((segment, index) => (
                segment.isCommand ? (
                  <span
                    key={`${index}-${segment.text}`}
                    className="inline font-medium text-sky-600 dark:text-sky-300"
                  >
                    {segment.label}
                  </span>
                ) : (
                  <span key={`${index}-${segment.text}`}>
                    {segment.text}
                  </span>
                )
              )) : null}
            </div>
            <Textarea
              ref={textareaRef}
              className={cn(
                "relative flex-1 resize-none overflow-y-auto border-none bg-transparent text-sm leading-6 text-transparent caret-foreground shadow-none outline-none placeholder:!text-muted-foreground/60 placeholder:text-sm focus-visible:ring-0 disabled:opacity-60",
                expanded ? "min-h-[72px] max-h-[320px] px-4 py-3" : "min-h-[44px] max-h-[240px] px-3 py-2.5",
              )}
              rows={1}
              disabled={!primaryModel || isResearchActive}
              value={text}
              onChange={(e) => {
                updateTextFromTextarea(e.target)
              }}
              onClick={(e) => {
                if (!keepSlashCommandCaretAtomic(e.currentTarget)) {
                  updateSlashTriggerFromTextarea(e.currentTarget)
                }
              }}
              onKeyUp={(e) => {
                if (!keepSlashCommandCaretAtomic(e.currentTarget)) {
                  updateSlashTriggerFromTextarea(e.currentTarget)
                }
              }}
              onSelect={(e) => {
                if (!keepSlashCommandCaretAtomic(e.currentTarget)) {
                  updateSlashTriggerFromTextarea(e.currentTarget)
                }
              }}
              onScroll={(e) => syncSlashHighlightScroll(e.currentTarget)}
              placeholder={effectivePlaceholder}
              onKeyDown={(e) => {
              const textarea = e.target as HTMLTextAreaElement
              const cursorPosition = textarea.selectionStart
              const isAtStart = cursorPosition === 0
              const isAtEnd = cursorPosition === text.length
              const keyIsComposing = isKeyboardEventComposing(e) || (isComposing && e.key !== 'Enter')
              const isSendEnter = isSendEnterKey(e)
              const atomicDeleteRange = getAtomicSlashDeleteRange(
                textarea.value,
                selectedSlashCommand,
                e.key,
                textarea.selectionStart,
                textarea.selectionEnd,
              )
              const atomicArrowBoundary = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
                ? getAtomicSlashArrowBoundary(
                  textarea.value,
                  selectedSlashCommand,
                  e.key,
                  textarea.selectionStart,
                  textarea.selectionEnd,
                )
                : null

              if (atomicDeleteRange && !keyIsComposing) {
                e.preventDefault()
                const next = removeTextRange(textarea.value, atomicDeleteRange.from, atomicDeleteRange.to)
                pendingCommandRef.current = null
                setSelectedSlashCommand(null)
                setSlashTrigger(null)
                setText(next.text)
                updateSuggestedModeFromText(next.text)
                requestAnimationFrame(() => {
                  textarea.focus()
                  textarea.setSelectionRange(next.cursor, next.cursor)
                  textarea.style.height = 'auto'
                  textarea.style.height = `${Math.min(textarea.scrollHeight, textareaMaxHeight)}px`
                  syncSlashHighlightScroll(textarea)
                })
                return
              }

              if (atomicArrowBoundary !== null && !keyIsComposing) {
                e.preventDefault()
                textarea.setSelectionRange(atomicArrowBoundary, atomicArrowBoundary)
                updateSlashTriggerFromTextarea(textarea)
                return
              }

              // @ 文件联想面板按键拦截
              if (atOpen && !keyIsComposing) {
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
                if (isSendEnter) {
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

              // ---- 待定命令按 Enter 提交 ----
              if (
                pendingCommandRef.current &&
                isSendEnter
              ) {
                const slashCommand = pendingCommandRef.current
                if (slashCommand && selectedSlashCommand?.id === slashCommand.id) {
                  e.preventDefault()
                  const invocation = getSlashCommandInvocation(text, slashCommand)
                  void executeSlashCommand(slashCommand, invocation?.userRequest || text.trim())
                  return
                }

                const invocation = slashCommand ? getSlashCommandInvocation(text, slashCommand) : null
                if (slashCommand && invocation) {
                  e.preventDefault()
                  void executeSlashCommand(slashCommand, invocation.userRequest)
                  return
                }
                // 文字已被用户修改，走正常 Enter 逻辑
                pendingCommandRef.current = null
              }

              // 斜杠命令面板按键拦截
              if (slashOpen && !keyIsComposing) {
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
                if (isSendEnter) {
                  e.preventDefault()
                  const activeTrigger = slashTrigger || findSlashTriggerAtCursor(textarea.value, textarea.selectionStart)
                  const exactTarget = activeTrigger
                    ? slashFilteredCommands.find(command =>
                      isExactSlashCommandInput(textarea.value, command, activeTrigger),
                    )
                    : undefined
                  const selectedTarget = slashFilteredCommands[Math.min(slashSelectedIndex, slashFilteredCommands.length - 1)]
                  const target = exactTarget || selectedTarget

                  if (target) {
                    void selectSlashCommand(target.id)
                    return
                  }

                  void (async () => {
                    const refreshedCommands = await filterSlashCommands(slashQuery || '')
                    const refreshedTarget = activeTrigger
                      ? refreshedCommands.find(command =>
                        isExactSlashCommandInput(textarea.value, command, activeTrigger),
                      )
                      : refreshedCommands[0]

                    if (refreshedTarget) {
                      await selectSlashCommand(refreshedTarget.id)
                      return
                    }

                    pendingCommandRef.current = null
                    setSlashTrigger(null)
                    submitInput(textarea.value)
                  })()
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSlashTrigger(null)
                  return
                }
              }

              if (isSendEnter) {
                e.preventDefault()
                if (dictation.isActive) {
                  return
                }
                pendingCommandRef.current = null
                submitInput(textarea.value)
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
              if (e.key === "ArrowUp" && !keyIsComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('up', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  // Move caret to the beginning before navigating history upward.
                  textarea.setSelectionRange(0, 0)
                }
              }
              if (e.key === "ArrowDown" && !keyIsComposing) {
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
                updateSlashTriggerFromTextarea(textareaRef.current)
              }, 0)}
              onPaste={(event) => {
                handlePaste(event)
                requestAnimationFrame(() => updateSlashTriggerFromTextarea(event.currentTarget))
              }}
            />
          </div>
        </div>

        <div className="flex w-full min-w-0 items-center gap-1 overflow-hidden border-t border-border/50 px-1 pt-1.5 pb-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-muted/20 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ChatInputAddMenu
              onSelectImages={isMobile ? handleSelectFromGallery : handleSelectLocalImages}
              disabled={!primaryModel || isResearchActive}
              dictationPolishMode={dictationPolishMode}
              onDictationPolishModeChange={setDictationPolishModeValue}
            />
            <ChatModeSelect variant="compact" />
          </div>

          <div className="ml-auto flex min-w-fit shrink-0 items-center justify-end gap-1 rounded-lg bg-muted/20 p-0.5">
            {chatMode === 'research' && (
              <ResearchDepthControl
                value={researchDepthPreset}
                onChange={setResearchDepthPreset}
                disabled={isModelRunning}
              />
            )}
            <ChatContextRing
              inputText={text}
              model={currentModelContextKey}
              contextWindow={currentModelContextWindow}
              className="h-7 w-7 shrink-0 rounded-md hover:bg-background/70"
            />
            <TooltipButton
              variant={enhancingPrompt ? "secondary" : "ghost"}
              size="icon"
              icon={enhancingPrompt ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
              tooltipText={enhancingPrompt ? '正在增强提示词...' : '增强提示词'}
              onClick={handleEnhancePrompt}
              disabled={loading || enhancingPrompt || isResearchActive}
              buttonClassName={enhancingPrompt ? 'h-7 w-7 shrink-0 rounded-md bg-primary/10 text-primary hover:bg-primary/15' : 'h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground'}
            />
            <div
              className="shrink-0"
              onContextMenu={(event) => {
                event.preventDefault()
                if (isModelRunning || dictation.isActive) return
                togglePrimaryActionMode()
              }}
            >
              {isModelRunning || primaryActionMode === 'send' ? (
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
                  getLiveInputValue={() => textareaRef.current?.value || text}
                  onSubmitOverride={(value) => {
                    if (!selectedSlashCommand) return false
                    submitInput(value)
                    return true
                  }}
                  canSubmitOverride={Boolean(selectedSlashCommand)}
                  hideIdleButton={false}
                  ref={chatSendRef}
                />
              ) : (
                <TooltipButton
                  variant={dictation.isListening ? "destructive" : "ghost"}
                  size="icon"
                  icon={primaryActionIcon}
                  tooltipText={primaryActionTooltip}
                  onClick={handleVoiceActionClick}
                  disabled={primaryActionDisabled}
                  buttonClassName={primaryActionButtonClassName}
                />
              )}
            </div>
            {primaryActionMode === 'voice' && !isModelRunning ? (
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
                getLiveInputValue={() => textareaRef.current?.value || text}
                onSubmitOverride={(value) => {
                  if (!selectedSlashCommand) return false
                  submitInput(value)
                  return true
                }}
                canSubmitOverride={Boolean(selectedSlashCommand)}
                hideButton
                ref={chatSendRef}
              />
            ) : null}
          </div>
        </div>
        </div> {/* 关闭输入框外层容器 */}
      </div>
    </footer>
  )
})
ChatInput.displayName = 'ChatInput'
