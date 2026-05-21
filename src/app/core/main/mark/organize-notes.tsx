"use client"
import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting"
import useMarkStore from "@/stores/mark"
import useArticleStore from "@/stores/article"
import useTagStore from "@/stores/tag"
import { fetchAiStream } from "@/lib/ai/chat"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCallback, useEffect, useMemo, useImperativeHandle, forwardRef, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, ChevronDown } from "lucide-react"
import { Store } from "@tauri-apps/plugin-store"
import { Label } from "@/components/ui/label"
import { useSidebarStore } from "@/stores/sidebar"
import { useRouter } from "next/navigation"
import dayjs, { Dayjs } from "dayjs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from "next-intl"
import { writeTextFile, exists } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { toast } from "@/hooks/use-toast"
import emitter from "@/lib/emitter"
import { shouldEmitOrganizeOnboardingComplete } from "./organize-onboarding"
import type { Mark } from "@/db/marks"
import { getTemplateRangeLabel, getTemplateRangeOptions } from "@/lib/template-range-utils"

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

const MAX_RECORDS_PER_ORGANIZE = 80
const MAX_FIELD_CHARS = 1600
const MAX_TOTAL_CONTEXT_CHARS = 28000
const STREAM_EDITOR_UPDATE_INTERVAL_MS = 500
const STREAM_FILE_WRITE_INTERVAL_MS = 1200

function compactRecordText(value?: string | null, maxLength = MAX_FIELD_CHARS) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function stripThinkingContent(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/```思考[\s\S]*?```/gi, '')
    .trim()
}

function formatRecordForPrompt(mark: Mark, index: number, options?: { removeThinking?: boolean }) {
  const content = options?.removeThinking ? stripThinkingContent(mark.content || '') : mark.content || ''
  const desc = options?.removeThinking ? stripThinkingContent(mark.desc || '') : mark.desc || ''
  const lines = [
    `Record ${index + 1}`,
    `Type: ${mark.type}`,
    `Created at: ${dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}`,
    mark.url ? `URL: ${mark.url}` : '',
    desc ? `Title or description: ${compactRecordText(desc, 500)}` : '',
    content ? `Content: ${compactRecordText(content)}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function buildOrganizePrompt({
  marks,
  template,
  locale,
  inputValue,
  removeThinking,
}: {
  marks: Mark[]
  template?: GenTemplate
  locale: string
  inputValue?: string
  removeThinking: boolean
}) {
  const selectedMarks = [...marks]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_RECORDS_PER_ORGANIZE)

  const recordBlocks: string[] = []
  let usedChars = 0

  for (const [index, mark] of selectedMarks.entries()) {
    const block = formatRecordForPrompt(mark, index, { removeThinking })
    if (usedChars + block.length > MAX_TOTAL_CONTEXT_CHARS) {
      recordBlocks.push(`Record context truncated. ${selectedMarks.length - index} newer/older records were not included because the prompt reached the safety limit.`)
      break
    }
    recordBlocks.push(block)
    usedChars += block.length
  }

  return [
    'You are a note organization assistant. Convert the following collected records into one useful Markdown note.',
    `Output language: ${locale}.`,
    'Requirements:',
    '- Use Markdown syntax.',
    '- Include exactly one level 1 heading.',
    '- Keep useful code, commands, tables, links, and project metadata intact when they appear in records.',
    '- Do not invent facts not supported by the records.',
    '- If records contain GitHub project cards, preserve project name, link, intro, tech stack, installation, architecture, and use cases.',
    '- Put reference links at the end when link records are included.',
    inputValue ? `User extra requirements: ${inputValue}` : '',
    template?.content ? `Template instruction:\n${template.content}` : '',
    '',
    `Records included: ${recordBlocks.length}`,
    '---',
    recordBlocks.join('\n\n---\n\n'),
  ].filter(Boolean).join('\n')
}

interface OrganizeNotesProps {
  inputValue?: string;
}

export const OrganizeNotes = forwardRef<{ openOrganize: () => void }, OrganizeNotesProps>(({ inputValue }, ref) => {
  const [open, setOpen] = useState(false)
  const { primaryModel } = useSettingStore()
  const { fetchMarks, marks, isMultiSelectMode, selectedMarkIds } = useMarkStore()
  const { currentTag, currentTagId, tags, setCurrentTagId, getCurrentTag } = useTagStore()
  const { setActiveFilePath, loadFileTree, readArticle, setCurrentArticle, setSkipSyncOnSave, setAiGeneratingFilePath, setAiTerminateFn } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const router = useRouter()
  const [tab, setTab] = useState('0')
  const [genTemplate, setGenTemplate] = useState<GenTemplate[]>([])
  const [overrideRange, setOverrideRange] = useState<GenTemplateRange | null>(null)
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const organizingRef = useRef(false)
  const [isRemoveThinking, setIsRemoveThinking] = useState(true)
  const tRoot = useTranslations()
  const tMark = useTranslations('record.mark')

  async function initGenTemplates() {
    const store = await Store.load('store.json')
    const template = await store.get<GenTemplate[]>('templateList') || []
    setGenTemplate(template)
    setTab((currentTab) => {
      if (template.some((item) => item.id === currentTab)) {
        return currentTab
      }
      return '0'
    })
  }

  // 使用 useMemo 优化过滤的记录
  const marksByRange = useMemo(() => {
    const range = overrideRange || genTemplate.find(item => item.id === tab)?.range
    let subtractDate: Dayjs
    switch (range) {
      case GenTemplateRange.All:
        subtractDate = dayjs().subtract(99, 'year')
        break
      case GenTemplateRange.Today:
        subtractDate = dayjs().subtract(1, 'day')
        break
      case GenTemplateRange.Week:
        subtractDate = dayjs().subtract(1, 'week')
        break
      case GenTemplateRange.Month:
        subtractDate = dayjs().subtract(1, 'month')
        break
      case GenTemplateRange.ThreeMonth:
        subtractDate = dayjs().subtract(3, 'month')
        break
      case GenTemplateRange.Year:
        subtractDate = dayjs().subtract(1, 'year')
        break
      default:
        subtractDate = dayjs().subtract(99, 'year')
        break
    }
    return marks.filter(item => dayjs(item.createdAt).isAfter(subtractDate))
  }, [marks, genTemplate, tab, overrideRange])

  // 使用 useMemo 优化选中的模板
  const selectedTemplate = useMemo(() => {
    return genTemplate.find(item => item.id === tab) || genTemplate[0]
  }, [genTemplate, tab])

  const selectedRange = overrideRange || selectedTemplate?.range || GenTemplateRange.All
  const selectedRangeLabel = getTemplateRangeLabel(selectedRange, tRoot)
  const selectedTagName = currentTag?.name || tags.find(tag => tag.id === currentTagId)?.name || '-'

  const organizeSourceMarks = useMemo(() => {
    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      return marksByRange.filter(item => selectedMarkIds.has(item.id))
    }

    return marksByRange
  }, [isMultiSelectMode, marksByRange, selectedMarkIds])

  const organizePreviewStats = useMemo(() => {
    const included = Math.min(organizeSourceMarks.length, MAX_RECORDS_PER_ORGANIZE)
    const excluded = Math.max(0, organizeSourceMarks.length - included)
    return { included, excluded, total: organizeSourceMarks.length }
  }, [organizeSourceMarks.length])

  const terminateGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setLoading(false)
    }
  }, [])

  const openOrganize = useCallback(() => {
    setOpen(true)
    void initGenTemplates()
  }, [])

  const handleOrganize = useCallback(async () => {
    if (loading || organizingRef.current) {
      return
    }

    if (!primaryModel) {
      toast({
        title: '无法开始整理',
        description: '请先在设置中配置主模型。',
        variant: 'destructive',
      })
      return
    }

    if (organizePreviewStats.included === 0) {
      toast({
        title: '没有可整理的记录',
        description: isMultiSelectMode && selectedMarkIds.size > 0
          ? '当前选中的记录为空，请先勾选要整理的记录。'
          : '当前模板的时间范围内没有记录，请切换模板或调整记录范围。',
        variant: 'destructive',
      })
      return
    }

    organizingRef.current = true
    setOpen(false)
    setLoading(true)

    // Prepare file path outside try block for access in finally
    const timestamp = new Date().getTime()
    const fileName = `整理笔记_${timestamp}.md`
    const filePath = fileName

    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, '')
      } else {
        await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
      }

      await loadFileTree()
      await setActiveFilePath(filePath)

      // Switch to files tab in sidebar
      await setLeftSidebarTab('files')

      await new Promise(resolve => setTimeout(resolve, 500))

      await fetchMarks()

      // Get latest marks from store after fetch
      const latestMarks = useMarkStore.getState().marks

      // Calculate marksByRange with latest marks
      const range = selectedRange
      let subtractDate: Dayjs
      switch (range) {
        case GenTemplateRange.All:
          subtractDate = dayjs().subtract(99, 'year')
          break
        case GenTemplateRange.Today:
          subtractDate = dayjs().subtract(1, 'day')
          break
        case GenTemplateRange.Week:
          subtractDate = dayjs().subtract(1, 'week')
          break
        case GenTemplateRange.Month:
          subtractDate = dayjs().subtract(1, 'month')
          break
        case GenTemplateRange.ThreeMonth:
          subtractDate = dayjs().subtract(3, 'month')
          break
        case GenTemplateRange.Year:
          subtractDate = dayjs().subtract(1, 'year')
          break
        default:
          subtractDate = dayjs().subtract(99, 'year')
          break
      }
      const marksByRange = latestMarks.filter(item => dayjs(item.createdAt).isAfter(subtractDate))

      const marksForPrompt = organizeSourceMarks.slice(-MAX_RECORDS_PER_ORGANIZE)

      const store = await Store.load('store.json')
      const locale = await store.get<string>('locale') || 'zh'

      const request_content = buildOrganizePrompt({
        marks: marksForPrompt,
        template: selectedTemplate,
        locale,
        inputValue,
        removeThinking: isRemoveThinking,
      })

      // Emit AI streaming start event with target file path
      emitter.emit('editor-ai-streaming', {
        isStreaming: true,
        targetFilePath: filePath,
        terminate: () => {
          terminateGeneration()
        }
      })

      // 5. Stream generation to editor

      // Skip sync for AI-generated content
      setSkipSyncOnSave(true)
      setAiGeneratingFilePath(filePath)
      setAiTerminateFn(() => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
          abortControllerRef.current = null
          setLoading(false)
        }
      })

      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal
      const targetFilePath = filePath // 保存目标文件路径

      let fullContent = ''
      let streamFinished = false
      let lastEditorUpdateAt = 0
      let lastFileWriteAt = 0
      await fetchAiStream(request_content, async (content) => {
        // Check if user switched to a different file - stop writing if so
        const currentActivePath = useArticleStore.getState().activeFilePath
        if (currentActivePath !== targetFilePath) {
          return
        }

        fullContent = content
        const now = Date.now()

        if (now - lastEditorUpdateAt >= STREAM_EDITOR_UPDATE_INTERVAL_MS) {
          setCurrentArticle(content)
          emitter.emit('external-content-update', content)
          lastEditorUpdateAt = now
        }

        if (now - lastFileWriteAt >= STREAM_FILE_WRITE_INTERVAL_MS) {
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, content)
          } else {
            await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
          }
          lastFileWriteAt = now
        }
      }, signal)
      streamFinished = true
      setCurrentArticle(fullContent)
      emitter.emit('external-content-update', fullContent)

      // Re-enable sync after AI generation
      setSkipSyncOnSave(false)
      setAiGeneratingFilePath(null)
      setAiTerminateFn(null)

      // Emit AI streaming end event
      emitter.emit('editor-ai-streaming', {
        isStreaming: false,
        targetFilePath: filePath
      })

      // 6. Extract title and rename file
      const cleanedContent = fullContent

      // Try to extract title: H1 -> H2 -> H3
      let titleMatch = cleanedContent.match(/^#\s+(.+)$/m)
      if (!titleMatch) {
        titleMatch = cleanedContent.match(/^##\s+(.+)$/m)
      }
      if (!titleMatch) {
        titleMatch = cleanedContent.match(/^###\s+(.+)$/m)
      }

      if (titleMatch && titleMatch[1]) {
        const title = titleMatch[1].trim()
        const sanitizedTitle = title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50)

        // Check for duplicate filenames and add (1), (2) etc if needed
        let newFileName = `${sanitizedTitle}.md`
        let counter = 1
        let newFilePath = newFileName
        let newPathOptions = await getFilePathOptions(newFilePath)

        while (await exists(newPathOptions.path, workspace.isCustom ? undefined : { baseDir: newPathOptions.baseDir })) {
          newFileName = `${sanitizedTitle}(${counter}).md`
          newFilePath = newFileName
          newPathOptions = await getFilePathOptions(newFilePath)
          counter++
        }

        // Write to new file
        if (workspace.isCustom) {
          await writeTextFile(newPathOptions.path, cleanedContent)
        } else {
          await writeTextFile(newPathOptions.path, cleanedContent, { baseDir: newPathOptions.baseDir })
        }

        // Delete old file
        const { remove } = await import('@tauri-apps/plugin-fs')
        if (workspace.isCustom) {
          await remove(pathOptions.path)
        } else {
          await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // Update file tree and active file
        await loadFileTree()
        setActiveFilePath(newFilePath)
        await readArticle(newFilePath, '', shouldAutoSyncOnInitialRead({ isNewFile: true }))
        if (shouldEmitOrganizeOnboardingComplete({ streamFinished, aborted: signal.aborted })) {
          emitter.emit('onboarding-step-complete', { step: 'organize-note', filePath: newFilePath })
        }

        toast({
          description: tMark('toolbar.organizeSuccess', { title: sanitizedTitle }),
        })
      } else {
        // No title found, just save the cleaned content
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, cleanedContent)
        } else {
          await writeTextFile(pathOptions.path, cleanedContent, { baseDir: pathOptions.baseDir })
        }
        await readArticle(filePath, '', shouldAutoSyncOnInitialRead())
        if (shouldEmitOrganizeOnboardingComplete({ streamFinished, aborted: signal.aborted })) {
          emitter.emit('onboarding-step-complete', { step: 'organize-note', filePath })
        }

        toast({
          description: tMark('toolbar.organizeSuccess', { title: fileName }),
        })
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Organize error:', error)
        toast({
          description: tMark('toolbar.organizeError'),
          variant: 'destructive',
        })
      }
    } finally {
      organizingRef.current = false
      abortControllerRef.current = null
      setLoading(false)
      // Re-enable sync in case of termination
      setSkipSyncOnSave(false)
      setAiGeneratingFilePath(null)
      setAiTerminateFn(null)
      // Emit AI streaming end event
      emitter.emit('editor-ai-streaming', {
        isStreaming: false,
        targetFilePath: filePath
      })
    }
  }, [
    primaryModel,
    selectedTemplate,
    selectedRange,
    inputValue,
    fetchMarks,
    loadFileTree,
    setActiveFilePath,
    setLeftSidebarTab,
    setCurrentArticle,
    readArticle,
    tMark,
    loading,
    isRemoveThinking,
    setSkipSyncOnSave,
    setAiGeneratingFilePath,
    setAiTerminateFn,
    terminateGeneration,
    organizePreviewStats.included,
    organizeSourceMarks,
    isMultiSelectMode,
    selectedMarkIds.size,
  ])

  useImperativeHandle(ref, () => ({
    openOrganize
  }))

  // Listen for abort event from editor
  useEffect(() => {
    const handleAbortAiStreaming = () => {
      if (loading) {
        terminateGeneration()
      }
    }
    emitter.on('abort-ai-streaming', handleAbortAiStreaming)
    return () => {
      emitter.off('abort-ai-streaming', handleAbortAiStreaming)
    }
  }, [loading, terminateGeneration])

  const handleDialogKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open || e.nativeEvent.isComposing) return

    if (e.key === 'Escape') {
      e.preventDefault()
      if (loading) {
        terminateGeneration()
      } else {
        setOpen(false)
      }
    }
  }, [open, loading, terminateGeneration])

  const handleSetting = useCallback(() => {
    setOpen(false)
    router.push('/core/setting/template')
  }, [router])

  const handleSelectTag = useCallback(async (tagId: number) => {
    await setCurrentTagId(tagId)
    getCurrentTag()
    await fetchMarks()
  }, [fetchMarks, getCurrentTag, setCurrentTagId])

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogContent onKeyDown={handleDialogKeyDown}>
        <AlertDialogHeader>
          <AlertDialogTitle>AI 整理成笔记</AlertDialogTitle>
          <ScrollArea className="h-auto max-h-28">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {genTemplate.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>{item.title}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </ScrollArea>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          {!primaryModel ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="size-3.5 shrink-0" />
              请先在设置中配置主模型，否则无法调用 AI 整理。
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="name">模板内容</Label>
              <div className="flex min-w-0 items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 max-w-36 justify-between gap-1 px-2 text-xs">
                      <span className="truncate">标签：{selectedTagName}</span>
                      <ChevronDown className="size-3 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-64 min-w-40 overflow-y-auto">
                    {tags.map(tag => (
                      <DropdownMenuItem
                        key={tag.id}
                        onClick={() => void handleSelectTag(tag.id)}
                        className={tag.id === currentTagId ? 'bg-accent text-accent-foreground' : undefined}
                      >
                        {tag.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 justify-between gap-1 px-2 text-xs">
                      <span>范围：{selectedRangeLabel}</span>
                      <ChevronDown className="size-3 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-32">
                    {getTemplateRangeOptions(tRoot).map(option => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setOverrideRange(option.value)}
                        className={option.value === selectedRange ? 'bg-accent text-accent-foreground' : undefined}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                数据来源：{isMultiSelectMode && selectedMarkIds.size > 0 ? '已选记录' : '当前范围'}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                送入 AI：{organizePreviewStats.included} 条{organizePreviewStats.excluded > 0 ? `，已省略 ${organizePreviewStats.excluded} 条` : ''}
              </span>
            </div>
            <ScrollArea className="h-32 w-full p-2 rounded-md border">
              {selectedTemplate?.content ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {selectedTemplate.content}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  暂无模板内容
                </p>
              )}
            </ScrollArea>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="remove-thinking" checked={isRemoveThinking} onCheckedChange={(checked) => setIsRemoveThinking(checked === true)} />
            <Label htmlFor="remove-thinking">移除记录中的思考内容</Label>
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant={"ghost"} disabled={loading} onClick={handleSetting}>管理模板</Button>
          <Button variant={"outline"} onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleOrganize} disabled={organizePreviewStats.included === 0 || loading}>开始整理</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
})

OrganizeNotes.displayName = 'OrganizeNotes';
