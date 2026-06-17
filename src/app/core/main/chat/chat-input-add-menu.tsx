"use client"

import * as React from "react"
import {
  Check,
  ChevronRight,
  Clipboard,
  ClipboardX,
  Database,
  DatabaseZap,
  Drama,
  ImageIcon,
  Loader2,
  Mic,
  Plus,
  Plug,
  PlugZap,
  Server,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useMcpStore } from "@/stores/mcp"
import usePromptStore from "@/stores/prompt"
import { useSkillsStore } from "@/stores/skills"
import useVectorStore from "@/stores/vector"
import type { SkillMetadata } from "@/lib/skills/types"
import { checkEmbeddingModelAvailable } from "@/lib/rag"
import { toast } from "@/hooks/use-toast"
import { Store } from "@tauri-apps/plugin-store"
import {
  DICTATION_POLISH_MODE_LABELS,
  DICTATION_POLISH_MODE_OPTIONS,
  type DictationPolishMode,
} from "@/lib/ai/dictation-polish"

interface ChatInputAddMenuProps {
  onSelectImages: () => void
  disabled?: boolean
  dictationPolishMode: DictationPolishMode
  onDictationPolishModeChange: (mode: DictationPolishMode) => void
}

interface ToolMenuTriggerProps {
  icon: React.ReactNode
  title: string
  active?: boolean
  disabled?: boolean
  hasSubmenu?: boolean
  activeVariant?: 'filled' | 'plain'
  className?: string
}

interface DisplaySkill {
  key: string
  id: string
  name: string
  description?: string | null
  enabled: boolean
  source: string
  runtime: boolean
  updateStatus?: string
}

export function ToolMenuTrigger({
  icon,
  title,
  active,
  disabled,
  hasSubmenu,
  activeVariant = 'filled',
  className,
}: ToolMenuTriggerProps) {
  return (
    <span
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active
          ? activeVariant === 'plain'
            ? "text-primary hover:bg-muted/35"
            : "bg-primary/10 text-primary"
          : "hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        className
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md",
          active && activeVariant === 'plain' ? "bg-transparent" : "bg-muted/45"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-xs font-medium">{title}</span>
      {hasSubmenu && (
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
      )}
    </span>
  )
}

export function ChatInputAddMenu({
  onSelectImages,
  disabled,
  dictationPolishMode,
  onDictationPolishModeChange,
}: ChatInputAddMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [ragLoading, setRagLoading] = React.useState(false)
  const [clipboardEnabled, setClipboardEnabled] = React.useState(true)

  const { isRagEnabled, setRagEnabled } = useVectorStore()
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const {
    servers,
    selectedServerIds,
    toggleServerSelection,
    initMcpData,
    serverStates,
  } = useMcpStore()
  const {
    installedSkills,
    fetchSkills,
    loading: skillsLoading,
    skills: runtimeSkills,
    initSkills,
  } = useSkillsStore()

  React.useEffect(() => {
    if (!open) return

    void initMcpData()
    void fetchSkills()
    void initSkills()
    void initPromptData()

    void (async () => {
      try {
        const store = await Store.load('store.json')
        const storedValue = await store.get<boolean>('clipboardMonitor')
        if (storedValue !== undefined) {
          setClipboardEnabled(storedValue)
        }
      } catch (error) {
        console.error('Failed to load clipboard monitor state from store:', error)
      }
    })()
  }, [fetchSkills, initMcpData, initSkills, open])

  const displaySkills = React.useMemo(() => {
    const runtimeById = new Map(runtimeSkills.map(skill => [skill.id, skill]))
    const representedRuntimeIds = new Set<string>()

    const installedRows: DisplaySkill[] = installedSkills.map(skill => {
      const runtimeId = toSkillId(skill.name)
      const runtimeSkill = runtimeById.get(runtimeId)
      if (runtimeSkill) {
        representedRuntimeIds.add(runtimeSkill.id)
      }

      return {
        key: `installed-${skill.id}`,
        id: runtimeSkill?.id || runtimeId || skill.id,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        source: skill.source_type,
        runtime: Boolean(runtimeSkill),
        updateStatus: skill.update_status,
      }
    })

    const runtimeRows: DisplaySkill[] = runtimeSkills
      .filter(skill => !representedRuntimeIds.has(skill.id))
      .map(runtimeRow)

    return [...installedRows, ...runtimeRows].sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }, [installedSkills, runtimeSkills])

  const enabledServers = React.useMemo(
    () => servers.filter(server => server.enabled),
    [servers]
  )

  const handleSelectImages = React.useCallback(() => {
    if (disabled) return
    setOpen(false)
    onSelectImages()
  }, [disabled, onSelectImages])

  const handleToggleRag = React.useCallback(async () => {
    if (isRagEnabled) {
      await setRagEnabled(false)
      return
    }

    setRagLoading(true)
    try {
      const embeddingModelAvailable = await checkEmbeddingModelAvailable()
      if (!embeddingModelAvailable) {
        toast({
          variant: "destructive",
          description: "当前嵌入模型不可用，无法启用知识库检索。",
        })
        return
      }
      await setRagEnabled(true)
    } finally {
      setRagLoading(false)
    }
  }, [isRagEnabled, setRagEnabled])

  const handleToggleClipboard = React.useCallback(async () => {
    const nextValue = !clipboardEnabled
    setClipboardEnabled(nextValue)
    const store = await Store.load('store.json')
    await store.set('clipboardMonitor', nextValue)
    await store.save()
  }, [clipboardEnabled])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label="添加上下文和工具"
              >
                <Plus className="size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>添加上下文和工具</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-40 p-0.5"
      >
        <div className="space-y-px">
          {/* 图片 */}
          <button
            type="button"
            className="w-full"
            onClick={handleSelectImages}
            disabled={disabled}
          >
            <ToolMenuTrigger
              icon={<ImageIcon className="size-3.5" />}
              title="图片"
              disabled={disabled}
            />
          </button>

          {/* 语音整理 — 侧边弹窗 */}
          <Popover modal={false}>
            <PopoverTrigger asChild>
              <button type="button" className="w-full">
                <ToolMenuTrigger
                  icon={<Mic className="size-3.5" />}
                  title="语音整理"
                  active={dictationPolishMode !== 'raw'}
                  activeVariant="plain"
                  hasSubmenu
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="left"
              align="start"
              sideOffset={4}
              className="w-36 p-0.5"
            >
              <div className="rounded-md py-0.5">
                {DICTATION_POLISH_MODE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors",
                      option.value === dictationPolishMode ? "text-primary" : "hover:bg-muted/45"
                    )}
                    onClick={() => onDictationPolishModeChange(option.value)}
                  >
                    <Check className={option.value === dictationPolishMode ? 'size-3 shrink-0 opacity-100' : 'size-3 shrink-0 opacity-0'} />
                    <span className="min-w-0 flex-1 truncate">{DICTATION_POLISH_MODE_LABELS[option.value]}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* 提示词 — 侧边弹窗 */}
          <Popover modal={false}>
            <PopoverTrigger asChild>
              <button type="button" className="w-full">
                <ToolMenuTrigger
                  icon={<Drama className="size-3.5" />}
                  title="提示词"
                  active={!!currentPrompt}
                  activeVariant="plain"
                  hasSubmenu
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="left"
              align="start"
              sideOffset={4}
              className="w-40 p-0.5"
            >
              <div className="max-h-52 overflow-y-auto rounded-md py-0.5">
                {promptList.length === 0 ? (
                  <div className="px-2 py-2.5 text-[11px] text-muted-foreground">
                    当前没有可用的提示词
                  </div>
                ) : (
                  promptList.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors",
                        currentPrompt?.id === item.id ? "text-primary" : "hover:bg-muted/45"
                      )}
                      onClick={async () => {
                        await setCurrentPrompt(item)
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {currentPrompt?.id === item.id && (
                        <Check className="size-3 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Skills — 侧边弹窗 */}
          <Popover modal={false}>
            <PopoverTrigger asChild>
              <button type="button" className="w-full">
                <ToolMenuTrigger
                  icon={<Sparkles className="size-3.5" />}
                  title="Skills"
                  hasSubmenu
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="left"
              align="start"
              sideOffset={4}
              className="w-44 p-0.5"
            >
              <div className="max-h-52 overflow-y-auto rounded-md py-0.5">
                {skillsLoading ? (
                  <div className="flex items-center gap-1.5 px-2 py-2.5 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    加载中
                  </div>
                ) : displaySkills.length === 0 ? (
                  <div className="px-2 py-2.5 text-[11px] text-muted-foreground">
                    当前没有已安装 Skills
                  </div>
                ) : (
                  displaySkills.map(skill => (
                    <div
                      key={skill.key}
                      className={cn(
                        "flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px]",
                        !skill.enabled && "text-muted-foreground"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                      {skill.updateStatus === 'available' && (
                        <span className="shrink-0 text-[10px] text-primary">更新</span>
                      )}
                      {skill.enabled ? (
                        <Check className="size-3 shrink-0" />
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground">停用</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* 知识库 */}
          <button
            type="button"
            className="w-full"
            onClick={handleToggleRag}
            disabled={ragLoading}
          >
            <ToolMenuTrigger
              icon={ragLoading
                ? <Loader2 className="size-3.5 animate-spin" />
                : isRagEnabled
                  ? <DatabaseZap className="size-3.5" />
                  : <Database className="size-3.5" />
              }
              title="知识库"
              active={isRagEnabled}
              disabled={ragLoading}
            />
          </button>

          {/* MCP — 侧边弹窗 */}
          <Popover modal={false}>
            <PopoverTrigger asChild>
              <button type="button" className="w-full">
                <ToolMenuTrigger
                  icon={<Server className="size-3.5" />}
                  title="MCP"
                  hasSubmenu
                  active={selectedServerIds.length > 0}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="left"
              align="start"
              sideOffset={4}
              className="w-48 p-0.5"
            >
              <div className="max-h-56 overflow-y-auto rounded-md py-0.5">
                {enabledServers.length === 0 ? (
                  <div className="px-2 py-2.5 text-[11px] text-muted-foreground">
                    当前没有已启用的 MCP 服务器
                  </div>
                ) : (
                  enabledServers.map(server => {
                    const state = serverStates.get(server.id)
                    const status = state?.status || 'disconnected'
                    const toolCount = state?.tools?.length || 0

                    return (
                      <div
                        key={server.id}
                        className="flex items-center gap-1.5 rounded px-1.5 py-1"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium leading-tight">{server.name}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            {status === 'connected' ? (
                              <PlugZap className="size-2.5 text-green-500" />
                            ) : (
                              <Plug className="size-2.5" />
                            )}
                            <span className="truncate">
                              {status === 'connected' ? `${toolCount} tools` : status}
                            </span>
                          </div>
                        </div>
                        <Switch
                          checked={selectedServerIds.includes(server.id)}
                          aria-label={`选择 MCP 服务器 ${server.name}`}
                          onCheckedChange={() => toggleServerSelection(server.id)}
                        />
                      </div>
                    )
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* 剪贴板 */}
          <button
            type="button"
            className="w-full"
            onClick={handleToggleClipboard}
          >
            <ToolMenuTrigger
              icon={clipboardEnabled ? <Clipboard className="size-3.5" /> : <ClipboardX className="size-3.5" />}
              title="剪贴板"
              active={clipboardEnabled}
            />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function toSkillId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function runtimeRow(skill: SkillMetadata): DisplaySkill {
  return {
    key: `runtime-${skill.id}`,
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled !== false,
    source: skill.scope,
    runtime: true,
  }
}
