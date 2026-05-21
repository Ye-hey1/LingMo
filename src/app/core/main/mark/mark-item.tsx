'use client'
import React from "react"
import { delMark, delMarkForever, Mark, pinMark, unpinMark, restoreMark, restoreMarks, updateMark, TRASH_RETENTION_DAYS } from "@/db/marks";
import { useTranslations } from 'next-intl';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent
} from "@/components/ui/enhanced-context-menu"
import dayjs from "dayjs";
import relativeTime from 'dayjs/plugin/relativeTime'
import { useCallback, useEffect, useMemo, useState } from "react";
import useMarkStore from "@/stores/mark";
import useTagStore from "@/stores/tag";
import { LocalImage } from "@/components/local-image";
import { fetchAiDesc } from "@/lib/ai/description";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { appDataDir } from "@tauri-apps/api/path";
import { CheckSquare, Code2, ExternalLink, FileIcon, GitFork, ImageIcon, ImageUp, LinkIcon, ListTree, Loader2, Mic, NotebookText, Pencil, Pin, PinOff, RefreshCw, Save, Settings2, Sparkles, Square, Star, TextIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioPlayer } from "@/components/audio-player";
import { ImageViewer } from "@/components/image-viewer";
import ChatPreview from "../chat/chat-preview";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkMobileActions } from "./mark-mobile-actions";
import { markToMarkdown } from "@/lib/mark-to-markdown";
import useSettingStore from "@/stores/setting";
import { TodoItemContent } from "./todo-item-content";
import { useIsMobile } from "@/hooks/use-mobile";
import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { useRouter } from "next/navigation";
import { NO_TRANSCRIPTION_MESSAGE, transcribeRecording } from "@/lib/audio";
import { getMarkListItemContent } from "./mark-list-item-content";
import { TodoEditTrigger } from "./todo-edit-button";
import { canOpenMarkSource, getMarkOpenAction } from "./mark-open-path";
import useArticleStore from "@/stores/article";
import { useSidebarStore } from "@/stores/sidebar";
import { appendRecordsToNote, createNoteFromRecords } from "@/lib/record-to-note";
import { ToastAction } from "@/components/ui/toast";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getGitHubProjectDetailContent, getGitHubProjectDisplayName, getGitHubProjectIntro, getGitHubProjectMeta, isGitHubProjectMark, updateGitHubProjectMarkTitle } from "@/lib/github-project";
import { isVideoTranscriptMark, mergeVideoTranscriptSummary, parseVideoTranscriptRecord, summarizeVideoTranscript } from "@/lib/video-transcript-record";

dayjs.extend(relativeTime)

// Memoize line height mapping function
const getLineHeight = (textSize: string): string => {
  const heightMap: Record<string, string> = {
    'xs': 'leading-3',
    'sm': 'leading-4',
    'md': 'leading-5',
    'lg': 'leading-6',
    'xl': 'leading-7'
  }
  return heightMap[textSize] || 'leading-4'
}

// Memoize image size mapping function
const getImageSize = (textSize: string): string => {
  const sizeMap: Record<string, string> = {
    'xs': 'max-h-16',
    'sm': 'max-h-20',
    'md': 'max-h-24',
    'lg': 'max-h-32',
    'xl': 'max-h-40'
  }
  return sizeMap[textSize] || 'max-h-24'
}

// Memoize word count function
const getWordCount = (text: string): number => {
  if (!text) return 0;
  return text.replace(/\s/g, '').length;
};

function compactTooltipText(value?: string) {
  const text = value?.replace(/\s+/g, ' ').trim() || ''
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function GitHubProjectDetailView({ mark }: { mark: Mark }) {
  const meta = useMemo(() => getGitHubProjectMeta(mark), [mark])
  const detailContent = useMemo(() => getGitHubProjectDetailContent(mark), [mark])
  const displayUrl = meta.url || mark.url
  const stats = [
    { label: '语言', value: meta.language, icon: Code2 },
    { label: 'Stars', value: meta.stars || '0', icon: Star },
    { label: 'Forks', value: meta.forks || '0', icon: GitFork },
    { label: 'License', value: meta.license, icon: FileIcon },
  ].filter(item => item.value)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
                <h2 className="truncate text-xl font-semibold tracking-normal text-foreground">
                  {meta.displayName || 'GitHub 项目'}
                </h2>
              </div>
              {meta.intro ? (
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {meta.intro}
                </p>
              ) : null}
            </div>
            {displayUrl ? (
              <a
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <ExternalLink className="size-3.5" />
                GitHub
              </a>
            ) : null}
          </div>
        </div>

        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="min-w-0 bg-muted/25 px-4 py-3">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="size-3.5" />
                {label}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-foreground" title={value}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {meta.topics ? (
          <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
            {meta.topics.split(',').map(topic => topic.trim()).filter(Boolean).slice(0, 12).map(topic => (
              <span key={topic} className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
                {topic}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-background px-5 py-5">
        <ChatPreview
          text={detailContent}
          className="github-project-markdown w-full max-w-none overflow-x-auto"
        />
      </div>
    </div>
  )
}

function VideoTranscriptDetailView({ mark }: { mark: Mark }) {
  const video = useMemo(() => parseVideoTranscriptRecord(mark), [mark])
  const [activeView, setActiveView] = useState<'timeline' | 'body' | 'summary'>('timeline')
  const [isSummarizing, setIsSummarizing] = useState(false)
  const { updateMark: updateMarkInStore } = useMarkStore()
  const views = [
    { key: 'timeline' as const, label: '时间线', icon: ListTree },
    { key: 'body' as const, label: '正文', icon: TextIcon },
    { key: 'summary' as const, label: '总结', icon: NotebookText },
  ]
  const text = activeView === 'timeline'
    ? video.timeline || video.body
    : activeView === 'body'
      ? video.body
      : video.summaryMarkdown || video.description
  const hasSummary = Boolean(video.meta.summary || video.meta.highlights?.length || video.meta.notes?.length)
  const platformLabel = video.meta.platform === 'youtube' ? 'YouTube' : 'B站'

  const handleGenerateSummary = useCallback(async () => {
    if (isSummarizing) return
    setIsSummarizing(true)
    try {
      const summary = await summarizeVideoTranscript({
        title: video.title,
        transcript: video.body || video.timeline,
        sourceUrl: video.meta.sourceUrl || mark.url || '',
      })
      if (!summary) {
        toast({
          title: '总结生成失败',
          description: '未获取到有效总结，请检查 AI 整理模型配置后重试。',
          variant: 'destructive',
        })
        return
      }
      const nextContent = mergeVideoTranscriptSummary(mark.content || '', summary)
      await updateMarkInStore({
        ...mark,
        desc: [video.title, summary.summary || '', video.meta.transcriptSource ? `提取方式：${video.meta.transcriptSource}` : ''].filter(Boolean).join('\n'),
        content: nextContent,
      })
      setActiveView('summary')
      toast({
        title: '视频总结已生成',
        description: '已从摘要、章节、要点、术语和复盘问题等角度完成整理。',
      })
    } catch (error) {
      toast({
        title: '总结生成失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setIsSummarizing(false)
    }
  }, [isSummarizing, mark, updateMarkInStore, video])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="bg-gradient-to-b from-muted/40 to-background px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {platformLabel}
                </span>
                <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {video.meta.transcriptSource || '视频转写'}
                </span>
              </div>
              <h2 className="max-w-4xl text-2xl font-semibold leading-snug tracking-normal text-foreground">{video.title}</h2>
              {video.description ? (
                <p className="max-w-4xl text-sm leading-6 text-muted-foreground">{video.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateSummary}
                disabled={isSummarizing}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSummarizing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {hasSummary ? '重新生成总结' : '生成总结'}
              </button>
              {video.meta.sourceUrl || mark.url ? (
                <a
                  href={video.meta.sourceUrl || mark.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <ExternalLink className="size-3.5" />
                  原视频
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-fit rounded-md border border-border bg-background p-1 shadow-sm">
        {views.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveView(key)}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${activeView === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background px-5 py-5 shadow-sm">
        {activeView === 'summary' && !hasSummary ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <NotebookText className="mb-3 size-8 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">还没有生成总结</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              点击“生成总结”后，会从摘要、章节导读、核心要点、关键观点、术语解释、行动清单和复盘问题等角度整理视频内容。
            </p>
            <button
              type="button"
              onClick={handleGenerateSummary}
              disabled={isSummarizing}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSummarizing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              生成总结
            </button>
          </div>
        ) : (
          <ChatPreview text={text || '暂无内容'} className="video-transcript-markdown w-full max-w-none overflow-x-auto" />
        )}
      </div>
    </div>
  )
}

const DetailViewer = React.memo(({
  mark,
  content,
  path,
  className,
  tooltipText,
}: {
  mark: Mark
  content: string
  path?: string
  className?: string
  tooltipText?: string
}) => {
  const [value, setValue] = useState('')
  const [descValue, setDescValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const { updateMark } = useMarkStore()
  const { recordTextSize } = useSettingStore()
  const t = useTranslations('record.mark.type');
  const markT = useTranslations('record.mark');
  const messageControlT = useTranslations('record.mark.mark.chat.messageControl');

  const lineHeight = useMemo(() => getLineHeight(recordTextSize), [recordTextSize])
  const imageSize = useMemo(() => getImageSize(recordTextSize), [recordTextSize])

  const isTextType = mark.type === 'text'
  const isGitHubProject = isGitHubProjectMark(mark)
  const isVideoTranscript = isVideoTranscriptMark(mark)

  const textDescChangeHandler = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescValue(e.target.value)
    await updateMark({ ...mark, desc: e.target.value })
  }, [mark, updateMark])

  const textMarkChangeHandler = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
  }, [])

  const handleSave = useCallback(async () => {
    await updateMark({ ...mark, desc: descValue, content: value })
    setIsEditing(false)
  }, [mark, value, descValue, updateMark])

  useEffect(() => {
    setValue(mark.content || '')
    setDescValue(mark.desc?.trim() || '')
  }, [mark])

  // For text type, always show Textarea
  const showEditor = isTextType || isEditing
  const compactTooltip = compactTooltipText(tooltipText)
  const trigger = (
    <DialogTrigger asChild>
      <span className={className || `line-clamp-2 ${lineHeight} mt-2 text-${recordTextSize} break-words cursor-pointer hover:underline`}>
        {content}
      </span>
    </DialogTrigger>
  )

  return (
    <Dialog>
      {compactTooltip ? (
        <TooltipProvider delayDuration={350}>
          <Tooltip>
            <TooltipTrigger asChild>
              {trigger}
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-[260px] bg-popover px-3 py-2 text-popover-foreground shadow-md">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">项目简介</div>
                <p className="line-clamp-4 text-xs leading-5">{compactTooltip}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : trigger}
      <DialogContent
        className={isGitHubProject || isVideoTranscript ? "lg:max-w-[1040px] max-h-[88vh] flex flex-col p-0" : "lg:max-w-[800px] max-h-[85vh] flex flex-col p-0"}
        onInteractOutside={(event) => {
          if (mark.type === 'image' || mark.type === 'scan') {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader className="p-4 border-b shrink-0">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle>{t(mark.type)}</DialogTitle>
            {!isTextType && (
              isEditing ? (
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Save className="size-3.5" />
                  {markT('save') || 'Save'}
                </button>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
                >
                  <Pencil className="size-3.5" />
                  {markT('edit') || 'Edit'}
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-${recordTextSize} text-zinc-500`}>{markT('createdAt')}：{dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
            <span className={`text-${recordTextSize} text-zinc-500`}>
              {getWordCount(value)} {messageControlT('words')}
            </span>
          </div>
        </DialogHeader>
        <div className={(isGitHubProject || isVideoTranscript) && !showEditor ? "flex-1 overflow-y-auto bg-muted/20 p-4 md:p-6" : "flex-1 overflow-y-auto md:p-8 p-2"}>
          {
            mark.url && (mark.type === 'image' || mark.type === 'scan') ?
            <div className="mb-5 flex justify-center">
              <ImageViewer
                url={mark.url}
                path={path}
                imageClassName="max-h-[360px] w-auto max-w-full rounded-md border border-border bg-muted/30 object-contain cursor-zoom-in"
              />
            </div> :
            null
          }
          {
            isGitHubProject || isVideoTranscript || mark.type === 'text' || mark.desc === mark.content ? null :
            <>
              <span className="block my-4 text-md text-zinc-900 font-bold">{markT('desc')}</span>
              <Textarea placeholder="在此输入文本记录内容..." rows={3} value={descValue} onChange={textDescChangeHandler} />
            </>
          }
          {(isGitHubProject || isVideoTranscript) && !showEditor ? null : (
            <span className="block my-4 text-md text-zinc-900 font-bold">{markT('content')}</span>
          )}
          {showEditor ? (
            <Textarea placeholder="在此输入文本记录内容..." rows={14} value={value} onChange={textMarkChangeHandler} />
          ) : isGitHubProject ? (
            <GitHubProjectDetailView mark={mark} />
          ) : isVideoTranscript ? (
            <VideoTranscriptDetailView mark={mark} />
          ) : (
            <ChatPreview text={mark.content || ''} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
})
DetailViewer.displayName = 'DetailViewer'

export type MarkItemVariant = 'list' | 'compact' | 'cards'

function MarkProcessedChip({ processed }: { processed: boolean }) {
  return null
}

function getMarkTypeIcon(markType: Mark['type']) {
  switch (markType) {
  case 'scan':
    return <ImageIcon className="size-3.5" />
  case 'image':
    return <ImageIcon className="size-3.5" />
  case 'link':
    return <LinkIcon className="size-3.5" />
  case 'recording':
    return <Mic className="size-3.5" />
  case 'file':
    return <FileIcon className="size-3.5" />
  case 'todo':
    return <CheckSquare className="size-3.5" />
  case 'text':
  default:
    return <TextIcon className="size-3.5" />
  }
}

function MarkTypeIcon({ markType, label }: { markType: Mark['type']; label: string }) {
  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      title={label}
      aria-label={label}
    >
      {getMarkTypeIcon(markType)}
    </span>
  )
}

function ProjectNameDialog({
  open,
  value,
  onOpenChange,
  onChange,
  onSave,
}: {
  open: boolean
  value: string
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑项目名称</DialogTitle>
          <DialogDescription>
            只修改记录列表里的显示名，原始仓库链接和项目内容会保留。
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSave()
            }
          }}
          autoFocus
        />
        <DialogFooter>
          <button
            type="button"
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
            onClick={onSave}
          >
            保存
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const MarkWrapper = React.memo(({
  mark,
  variant = 'list',
}: {
  mark: Mark
  variant?: MarkItemVariant
}) => {
  const t = useTranslations('record.mark.type');
  const todoT = useTranslations('record.mark.todo');
  const recordingT = useTranslations('recording');
  const { isMultiSelectMode, selectedMarkIds, toggleMarkSelection } = useMarkStore();
  const { recordTextSize, sttModel } = useSettingStore();
  const { fetchMarks } = useMarkStore();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isRetryingTranscription, setIsRetryingTranscription] = useState(false);

  const lineHeight = useMemo(() => getLineHeight(recordTextSize), [recordTextSize])
  const isProcessed = mark.processed === 1
  const shouldShowRecordingAction = mark.type === 'recording' && mark.content === NO_TRANSCRIPTION_MESSAGE
  const itemContent = useMemo(() => getMarkListItemContent(mark), [mark])
  const isGitHubProject = isGitHubProjectMark(mark)
  const gitHubProjectIntro = useMemo(
    () => isGitHubProject ? getGitHubProjectIntro(mark) : '',
    [isGitHubProject, mark]
  )

  const todoPriorityDotClass = itemContent.todo
    ? itemContent.todo.priority === 'high'
      ? 'bg-red-500'
      : itemContent.todo.priority === 'low'
        ? 'bg-green-500'
        : 'bg-orange-500'
    : ''

  const handleCheckboxChange = useCallback(() => {
    toggleMarkSelection(mark.id);
  }, [mark.id, toggleMarkSelection]);

  const handleRecordingAction = useCallback(async () => {
    if (!sttModel) {
      router.push(isMobile ? '/mobile/setting/pages/audio' : '/core/setting/audio')
      return
    }

    if (!mark.url || isRetryingTranscription) {
      return
    }

    try {
      setIsRetryingTranscription(true)
      const fileData = await readFile(mark.url, { baseDir: BaseDirectory.AppData })
      const extension = mark.url.split('.').pop()?.toLowerCase()
      const mimeType = extension === 'wav' ? 'audio/wav' :
        extension === 'mp3' ? 'audio/mpeg' :
        extension === 'm4a' || extension === 'mp4' ? 'audio/mp4' :
        extension === 'ogg' ? 'audio/ogg' :
        extension === 'webm' ? 'audio/webm' :
        'audio/webm'
      const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
      const audioBlob = new Blob([buffer], { type: mimeType })
      const transcription = await transcribeRecording(audioBlob)

      if (!transcription.trim()) {
        toast({
          title: recordingT('error'),
          description: recordingT('transcriptionEmpty'),
          variant: 'destructive',
        })
        return
      }

      await updateMark({
        ...mark,
        desc: transcription.substring(0, 100),
        content: transcription,
      })
      await fetchMarks()

      toast({
        title: recordingT('success'),
        description: recordingT('retrySuccess'),
      })
    } catch (error) {
      console.error('重新识别录音失败:', error)
      toast({
        title: recordingT('error'),
        description: error instanceof Error ? error.message : recordingT('retryError'),
        variant: 'destructive',
      })
    } finally {
      setIsRetryingTranscription(false)
    }
  }, [fetchMarks, isMobile, isRetryingTranscription, mark, recordingT, router, sttModel])

  if (variant === 'compact') {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {isMultiSelectMode && (
          <div className="pr-1">
            <Checkbox
              checked={selectedMarkIds.has(mark.id)}
              onCheckedChange={handleCheckboxChange}
            />
          </div>
        )}
        <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
        <MarkProcessedChip processed={isProcessed} />
        {mark.type === 'todo' && itemContent.todo ? (
          <span className={`size-2 shrink-0 rounded-full ${todoPriorityDotClass}`} />
        ) : null}
        <div className="min-w-0 flex-1">
          {mark.type === 'todo' ? (
            <TodoEditTrigger mark={mark} className={`block truncate text-${recordTextSize} font-medium hover:underline`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </TodoEditTrigger>
          ) : (
            <DetailViewer
              mark={mark}
              content={itemContent.title || itemContent.preview || t(mark.type)}
              path={mark.type === 'scan' ? 'screenshot' : mark.type === 'image' ? 'image' : undefined}
              className={`block truncate text-${recordTextSize} font-medium hover:underline`}
              tooltipText={gitHubProjectIntro || undefined}
            />
          )}
        </div>
        {mark.type === 'recording' && mark.url ? (
          <AudioPlayer audioPath={mark.url} compact />
        ) : null}
        <span className="shrink-0 text-xs text-zinc-500">{dayjs(mark.createdAt).format('HH:mm')}</span>
      </div>
    )
  }

  if (variant === 'cards') {
    const isImageCard = mark.type === 'image' || mark.type === 'scan'

    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-zinc-500">
          <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
          <MarkProcessedChip processed={isProcessed} />
          {mark.type === 'todo' && itemContent.todo ? (
            <span className={`size-2 shrink-0 rounded-full ${todoPriorityDotClass}`} />
          ) : null}
          <span className="ml-auto text-xs">{dayjs(mark.createdAt).format('MM-DD HH:mm')}</span>
        </div>
        {isImageCard && mark.url ? (
          <div className="overflow-hidden rounded-md bg-zinc-100">
            <ImageViewer
              url={mark.url}
              path={mark.type === 'scan' ? 'screenshot' : 'image'}
              imageClassName="h-auto max-h-56 w-full object-cover"
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          {mark.type === 'todo' ? (
            <TodoEditTrigger mark={mark} className={`block truncate text-${recordTextSize} font-semibold hover:underline`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </TodoEditTrigger>
          ) : (
            <DetailViewer
              mark={mark}
              content={itemContent.title || itemContent.preview || t(mark.type)}
              path={mark.type === 'scan' ? 'screenshot' : mark.type === 'image' ? 'image' : undefined}
              className={`block truncate text-${recordTextSize} font-semibold hover:underline`}
              tooltipText={gitHubProjectIntro || undefined}
            />
          )}
          {!isImageCard && itemContent.preview ? (
            <p className={`line-clamp-6 text-${recordTextSize} ${lineHeight} text-muted-foreground`}>
              {itemContent.preview}
            </p>
          ) : null}
          {!isImageCard && mark.type === 'link' && mark.url ? (
            <a
              href={mark.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`block truncate text-xs text-blue-600 hover:underline`}
            >
              {mark.url}
            </a>
          ) : null}
          {!isImageCard && mark.type === 'todo' && itemContent.todo ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                {itemContent.todo.completed ? <CheckSquare className="size-3.5 text-green-600" /> : <Square className="size-3.5 text-zinc-400" />}
                <span>{itemContent.todo.completed ? todoT('completed') : todoT('uncompleted')}</span>
              </div>
            </div>
          ) : null}
          {!isImageCard && mark.type === 'recording' && mark.url ? (
            <div className="pt-1">
              <AudioPlayer audioPath={mark.url} />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (mark.type) {
    case 'scan':
    return (
        <div className={`flex-1 overflow-hidden text-${recordTextSize} ${lineHeight} pr-10 md:pr-2`}>
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
            <MarkProcessedChip processed={isProcessed} />
            <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="screenshot" />
        </div>
    )
    case 'image':
    return (
        <div className={`flex-1 overflow-hidden text-${recordTextSize} ${lineHeight} pr-10 md:pr-2`}>
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
            <MarkProcessedChip processed={isProcessed} />
            {mark.url.includes('http') ? <ImageUp className="size-3 text-zinc-400" /> : null}
            <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="image" />
        </div>
    )
    case 'link':
    return (
        <div className="flex-1 pr-10 md:pr-0">
          <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
            <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
            <MarkProcessedChip processed={isProcessed} />
            <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={itemContent.title || mark.desc || ''} tooltipText={gitHubProjectIntro || undefined} />
          <div className="mt-1">
            <a 
              href={mark.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className={`text-${recordTextSize} text-blue-500 hover:underline truncate block`}
            >
              {mark.url}
            </a>
          </div>
        </div>
    )
    case 'text':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
              <MarkProcessedChip processed={isProcessed} />
              <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} />
          </div>
      )
    case 'recording':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
              <MarkProcessedChip processed={isProcessed} />
              {shouldShowRecordingAction && (
                <button
                  type="button"
                  className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleRecordingAction}
                  disabled={isRetryingTranscription}
                  title={sttModel
                    ? (isRetryingTranscription ? recordingT('retrying') : recordingT('retryTranscription'))
                    : recordingT('configureModel')}
                >
                  {sttModel ? (
                    <RefreshCw className={`size-3.5 ${isRetryingTranscription ? 'animate-spin' : ''}`} />
                  ) : (
                    <Settings2 className="size-3.5" />
                  )}
                </button>
              )}
              <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} />
            {mark.url && (
              <div className="mt-2">
                <AudioPlayer audioPath={mark.url} />
              </div>
            )}
          </div>
      )
    case 'file':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <MarkTypeIcon markType={mark.type} label={t(mark.type)} />
              <MarkProcessedChip processed={isProcessed} />
              <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} />
            {mark.url && (
              <div className="mt-1">
                <span className={`text-${recordTextSize}`}>
                  {mark.desc}
                </span>
              </div>
            )}
          </div>
      )
    case 'todo':
      return <TodoItemContent mark={mark} />
    default:
      return null
    }
  }

  return (
    <div className="flex p-2 items-start">
      {isMultiSelectMode && (
        <div className="pr-2 flex items-start pt-1">
          <Checkbox
            checked={selectedMarkIds.has(mark.id)}
            onCheckedChange={handleCheckboxChange}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {renderContent()}
      </div>
      {(mark.type === 'scan' || mark.type === 'image') && (
        <div className="bg-zinc-900 flex items-center justify-center ml-2">
          <ImageViewer url={mark.url} path={mark.type === 'scan' ? 'screenshot' : 'image'} />
        </div>
      )}
    </div>
  )
})
MarkWrapper.displayName = 'MarkWrapper'

export const MarkItem = React.memo(({mark, variant = 'list'}: {mark: Mark, variant?: MarkItemVariant}) => {
  const t = useTranslations();
  const isMobile = useIsMobile()
  const {
    marks,
    fetchMarks,
    trashState,
    fetchAllTrashMarks,
    isMultiSelectMode,
    selectedMarkIds,
    clearSelection,
    highlightedMarkId,
    setMarksProcessed,
  } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const {
    activeFilePath,
    currentArticle,
    loadFileTree,
    setActiveFilePath,
    setCurrentArticle,
    saveCurrentArticle,
  } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const { fetchAllMarks } = useMarkStore()
  const isGitHubProject = isGitHubProjectMark(mark)
  const gitHubProjectDisplayName = useMemo(
    () => isGitHubProject ? getGitHubProjectDisplayName(mark) : '',
    [isGitHubProject, mark]
  )
  const [editingProjectName, setEditingProjectName] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')

  const getActionMarks = useCallback(() => {
    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      return marks.filter((item: Mark) => selectedMarkIds.has(item.id))
    }

    return [mark]
  }, [isMultiSelectMode, mark, marks, selectedMarkIds])

  const getActionTagName = useCallback((targetMarks: Mark[]) => {
    const tagId = targetMarks.length === 1 ? targetMarks[0].tagId : currentTagId
    return tags.find(tag => tag.id === tagId)?.name
  }, [currentTagId, tags])

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isMultiSelectMode) {
      e.preventDefault()
      return
    }

    const markdownContent = markToMarkdown(mark);
    e.dataTransfer.setData('text/plain', markdownContent);
    e.dataTransfer.setData('application/json', JSON.stringify(mark));
    e.dataTransfer.effectAllowed = 'copy';

    // 添加拖拽时的视觉反馈
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [isMultiSelectMode, mark]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
  }, []);

  const handleOpenProjectNameEditor = useCallback((event?: React.MouseEvent) => {
    event?.stopPropagation()
    setProjectNameDraft(gitHubProjectDisplayName || getMarkListItemContent(mark).title || '')
    setEditingProjectName(true)
  }, [gitHubProjectDisplayName, mark])

  const handleSaveProjectName = useCallback(async () => {
    const nextTitle = projectNameDraft.trim()
    if (!nextTitle) {
      toast({
        title: '项目名称不能为空',
        variant: 'destructive',
      })
      return
    }

    try {
      const next = updateGitHubProjectMarkTitle(mark, nextTitle)
      await updateMark({
        ...mark,
        desc: next.desc,
        content: next.content,
      })
      await fetchMarks()
      await fetchAllMarks()
      setEditingProjectName(false)
      toast({
        title: '已更新项目名称',
        description: nextTitle,
      })
    } catch (error) {
      toast({
        title: '更新项目名称失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [fetchAllMarks, fetchMarks, mark, projectNameDraft])

  const handleDelMark = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const targetMarks = getActionMarks()
    const ids = targetMarks.map(item => item.id)

    if (ids.length > 1) {
      const confirmed = await confirm(`确定要删除 ${ids.length} 条记录吗？删除后会进入回收站。`, {
        title: '删除记录',
        kind: 'warning',
      })
      if (!confirmed) return
    }

    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      for (const markId of ids) {
        await delMark(markId)
      }
      clearSelection()
    } else {
      await delMark(mark.id)
    }
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
    toast({
      title: ids.length > 1 ? `已删除 ${ids.length} 条记录` : '已删除记录',
      description: '记录已移入回收站',
      action: (
        <ToastAction
          altText="撤销删除"
          onClick={() => {
            void (async () => {
              await restoreMarks(ids)
              await fetchMarks()
              await fetchTags()
              getCurrentTag()
            })()
          }}
        >
          撤销
        </ToastAction>
      ),
    })
  }, [clearSelection, fetchMarks, fetchTags, getActionMarks, getCurrentTag, isMultiSelectMode, mark.id, selectedMarkIds.size])

  const handleDelForever = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      // 多选永久删除
      const selectedMarks = Array.from(selectedMarkIds)
      for (const markId of selectedMarks) {
        await delMarkForever(markId)
      }
      clearSelection()
    } else {
      // 单个永久删除
      await delMarkForever(mark.id)
    }
    await fetchAllTrashMarks()
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, fetchAllTrashMarks, mark.id])

  const handleRestore = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    await restoreMark(mark.id)
    if (trashState) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
    }
  }, [mark.id, trashState, fetchAllTrashMarks, fetchMarks])

  const handleTogglePin = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (mark.pinned === 1) {
      await unpinMark(mark.id)
    } else {
      await pinMark(mark.id)
    }
    await fetchMarks()
  }, [mark.id, mark.pinned, fetchMarks])

  const handleTransfer = useCallback(async (tagId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      // 多选转移 - 只处理选中的记录
      const selectedMarks = Array.from(selectedMarkIds)
      for (const markId of selectedMarks) {
        // 获取完整的mark对象并更新tagId
        const existingMark = marks.find((m: Mark) => m.id === markId)
        if (existingMark) {
          await updateMark({ ...existingMark, tagId })
        }
      }
      clearSelection()
    } else {
      // 单个转移
      await updateMark({ ...mark, tagId })
    }
    await fetchTags()
    getCurrentTag()
    fetchMarks()
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, marks, mark, fetchTags, getCurrentTag, fetchMarks])

  const regenerateDesc = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const desc = await fetchAiDesc(mark.content || '') || ''
    await updateMark({ ...mark, desc })
    fetchMarks()
  }, [mark, fetchMarks])

  const handelShowInFolder = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const appDir = await appDataDir()
      const action = getMarkOpenAction(mark, appDir, 'folder')

      if (!action?.path) {
        return
      }

      if (action.mode === 'reveal') {
        await revealItemInDir(action.path)
        return
      }

      await openPath(action.path)
    } catch (error) {
      console.error('Failed to open source folder:', error)
    }
  }, [mark])

  const handelShowInFile = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const appDir = await appDataDir()
      const action = getMarkOpenAction(mark, appDir, 'file')

      if (!action?.path) {
        return
      }

      await openPath(action.path)
    } catch (error) {
      console.error('Failed to open source file:', error)
    }
  }, [mark])

  const handleCopyLink = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    await navigator.clipboard.writeText(mark.url)
    toast({
      title: t('record.mark.toolbar.copied')
    })
  }, [mark.url, t])

  const handleSetProcessed = useCallback(async (processed: boolean, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const targetMarks = getActionMarks()
    const ids = targetMarks.map(item => item.id)

    try {
      await setMarksProcessed(ids, processed)
      if (isMultiSelectMode) {
        clearSelection()
      }
      toast({
        title: processed ? '已标记为已处理' : '已标记为未处理',
        description: `${ids.length} 条记录`,
      })
    } catch (error) {
      toast({
        title: '更新处理状态失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [clearSelection, getActionMarks, isMultiSelectMode, setMarksProcessed])

  const markRecordsAsProcessed = useCallback(async (targetMarks: Mark[]) => {
    try {
      await setMarksProcessed(targetMarks.map(item => item.id), true)
    } catch (error) {
      console.error('标记记录为已处理失败:', error)
    }
  }, [setMarksProcessed])

  const handleCreateNoteFromRecords = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const targetMarks = getActionMarks()

    try {
      const { filePath } = await createNoteFromRecords(targetMarks, {
        tagName: getActionTagName(targetMarks),
      })
      await loadFileTree({ skipRemoteSync: true })
      await setLeftSidebarTab('files')
      setActiveFilePath(filePath)
      await markRecordsAsProcessed(targetMarks)
      if (isMultiSelectMode) {
        clearSelection()
      }
      toast({
        title: '已转为笔记',
        description: filePath,
      })
    } catch (error) {
      toast({
        title: '转为笔记失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [clearSelection, getActionMarks, getActionTagName, isMultiSelectMode, loadFileTree, markRecordsAsProcessed, setActiveFilePath, setLeftSidebarTab])

  const handleAppendRecordsToCurrentNote = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const targetMarks = getActionMarks()

    if (!activeFilePath || !/\.md$/i.test(activeFilePath)) {
      toast({
        title: '请先打开一篇 Markdown 笔记',
        description: '打开目标笔记后，可以把记录追加到正文末尾。',
        variant: 'destructive',
      })
      return
    }

    try {
      const nextContent = await appendRecordsToNote(activeFilePath, targetMarks, {
        currentContent: currentArticle || undefined,
        tagName: getActionTagName(targetMarks),
      })
      setCurrentArticle(nextContent)
      await saveCurrentArticle(nextContent)
      await markRecordsAsProcessed(targetMarks)
      if (isMultiSelectMode) {
        clearSelection()
      }
      toast({
        title: '已追加到当前笔记',
        description: activeFilePath,
      })
    } catch (error) {
      toast({
        title: '追加失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [activeFilePath, clearSelection, currentArticle, getActionMarks, getActionTagName, isMultiSelectMode, markRecordsAsProcessed, saveCurrentArticle, setCurrentArticle])

  // Memoize filtered tags to prevent unnecessary re-renders
  const filteredTags = useMemo(() =>
    tags.filter(tag => tag.id !== currentTagId),
    [tags, currentTagId]
  )

  const markCard = (
    <div
      data-mark-item="true"
      data-mark-id={mark.id}
      className={`relative transition-colors ${
        variant === 'cards'
          ? 'rounded-md border border-border/70 bg-background p-2.5'
          : variant === 'compact'
            ? 'rounded-md border border-border/60 bg-background px-3 py-2'
            : 'rounded-lg border border-border/60 bg-background'
      } ${highlightedMarkId === mark.id ? 'record-search-highlight border-amber-400/80 bg-amber-50/80 dark:border-amber-400/70 dark:bg-amber-500/10' : ''} ${isMobile ? 'cursor-default active:bg-accent/40' : 'cursor-pointer hover:bg-accent/50'}`}
      draggable={!isMultiSelectMode && !isMobile}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {!trashState && mark.pinned === 1 ? (
        <div className="flex items-center gap-1 px-2.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
          <Pin className="size-2.5" />
          <span>已置顶</span>
        </div>
      ) : null}
      {trashState && mark.deletedAt ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-muted-foreground border-b border-border/50">
          <span>
            {(() => {
              const elapsed = Date.now() - mark.deletedAt
              const remaining = Math.max(0, Math.ceil((TRASH_RETENTION_DAYS * 86400000 - elapsed) / 86400000))
              return remaining > 0
                ? `${remaining} 天后自动删除`
                : '即将自动删除'
            })()}
          </span>
          <span className="ml-auto">{dayjs(mark.deletedAt).format('MM-DD HH:mm')} 删除</span>
        </div>
      ) : null}
      <MarkWrapper mark={mark} variant={variant} />
      <div className="absolute top-2 right-2">
        <MarkMobileActions
          mark={mark}
          tags={tags}
          currentTagId={currentTagId}
          trashState={trashState}
          isMultiSelectMode={isMultiSelectMode}
          selectedMarkIds={selectedMarkIds}
          onTransfer={handleTransfer}
          onCopyLink={handleCopyLink}
          onRegenerateDesc={regenerateDesc}
          onShowInFolder={handelShowInFolder}
          onShowInFile={handelShowInFile}
          onRestore={handleRestore}
          onDelete={handleDelMark}
          onDeleteForever={handleDelForever}
        />
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <>
        {markCard}
        {isGitHubProject ? (
          <ProjectNameDialog
            open={editingProjectName}
            value={projectNameDraft}
            onOpenChange={setEditingProjectName}
            onChange={setProjectNameDraft}
            onSave={handleSaveProjectName}
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {markCard}
        </ContextMenuTrigger>
        <ContextMenuContent>
        {
          trashState ? null :
          <>
            <ContextMenuItem inset onClick={handleCreateNoteFromRecords} menuType="record">
              {isMultiSelectMode && selectedMarkIds.size > 0
                ? `转为笔记（${selectedMarkIds.size} 条）`
                : '转为笔记'}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={handleAppendRecordsToCurrentNote} disabled={!activeFilePath || !/\.md$/i.test(activeFilePath)} menuType="record">
              {isMultiSelectMode && selectedMarkIds.size > 0
                ? `追加到当前笔记（${selectedMarkIds.size} 条）`
                : '追加到当前笔记'}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={(event) => handleSetProcessed(true, event)} menuType="record">
              {isMultiSelectMode && selectedMarkIds.size > 0
                ? `标记为已处理（${selectedMarkIds.size} 条）`
                : '标记为已处理'}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={(event) => handleSetProcessed(false, event)} menuType="record">
              {isMultiSelectMode && selectedMarkIds.size > 0
                ? `标记为未处理（${selectedMarkIds.size} 条）`
                : '标记为未处理'}
            </ContextMenuItem>
            <ContextMenuItem inset disabled={isMultiSelectMode} onClick={handleTogglePin} menuType="record">
              <span className="flex items-center gap-1.5">
                {mark.pinned === 1 ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                {mark.pinned === 1 ? '取消置顶' : '置顶'}
              </span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        }
        {
          trashState ? null :
          <ContextMenuSub>
            <ContextMenuSubTrigger inset menuType="record">
              {isMultiSelectMode && selectedMarkIds.size > 0
                ? t('record.mark.toolbar.moveSelectedTags', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.moveTag')
              }
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {
                filteredTags.map((tag) => (
                  <ContextMenuItem
                    disabled={tag.id === currentTagId}
                    key={tag.id}
                    onClick={() => handleTransfer(tag.id)}
                    menuType="record"
                  >
                    {tag.name}
                  </ContextMenuItem>
                ))
              }
            </ContextMenuSubContent>
          </ContextMenuSub>
        }
        <ContextMenuItem inset disabled={isMultiSelectMode || !mark.url} onClick={handleCopyLink} menuType="record">
          {t('record.mark.toolbar.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || mark.type === 'text'} onClick={regenerateDesc} menuType="record">
          {t('record.mark.toolbar.regenerateDesc')}
        </ContextMenuItem>
        {isGitHubProject ? (
          <ContextMenuItem inset disabled={isMultiSelectMode} onClick={handleOpenProjectNameEditor} menuType="record">
            编辑项目名称
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled={isMultiSelectMode || !canOpenMarkSource(mark)} onClick={handelShowInFolder} menuType="record">
          {t('record.mark.toolbar.viewFolder')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || !canOpenMarkSource(mark)} onClick={handelShowInFile} menuType="record">
          {t('record.mark.toolbar.viewFile')}
        </ContextMenuItem>
        {
          trashState ? 
          <>
            <ContextMenuItem inset disabled={isMultiSelectMode} onClick={handleRestore} menuType="record">
              {t('record.mark.toolbar.restore')}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={handleDelForever} menuType="record">
              <span className="text-red-900">
                {isMultiSelectMode && selectedMarkIds.size > 0 
                  ? t('record.mark.toolbar.deleteSelectedForever', { count: selectedMarkIds.size })
                  : t('record.mark.toolbar.deleteForever')
                }
              </span>
            </ContextMenuItem>
          </> :
          <ContextMenuItem inset onClick={handleDelMark} menuType="record">
            <span className="text-red-900">
              {isMultiSelectMode && selectedMarkIds.size > 0 
                ? t('record.mark.toolbar.deleteSelected', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.delete')
              }
            </span>
          </ContextMenuItem>
        }
        </ContextMenuContent>
      </ContextMenu>
      {isGitHubProject ? (
        <ProjectNameDialog
          open={editingProjectName}
          value={projectNameDraft}
          onOpenChange={setEditingProjectName}
          onChange={setProjectNameDraft}
          onSave={handleSaveProjectName}
        />
      ) : null}
    </>
  )
})
MarkItem.displayName = 'MarkItem'
