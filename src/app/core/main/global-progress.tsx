'use client'

import { useEffect, useRef, useState } from 'react'
import useMarkStore, { type MarkQueue } from '@/stores/mark'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileText,
  Globe,
  Image as ImageIcon,
  Link,
  LoaderCircle,
  Mic,
  RefreshCw,
  Sparkles,
  Video,
} from 'lucide-react'
import { retryLinkCaptureJob } from '@/lib/link-pipeline/capture-runner'

type ProgressStep = {
  label: string
  threshold: number
}

type StepStatus = 'done' | 'active' | 'pending'

const LINK_STEPS: ProgressStep[] = [
  { label: '识别', threshold: 0 },
  { label: '抓取', threshold: 30 },
  { label: '提取', threshold: 55 },
  { label: '整理', threshold: 78 },
  { label: '保存', threshold: 94 },
]

const MEDIA_STEPS: ProgressStep[] = [
  { label: '载入', threshold: 0 },
  { label: '抽轨', threshold: 20 },
  { label: '切片', threshold: 40 },
  { label: '识别', threshold: 60 },
  { label: '保存', threshold: 94 },
]

const FILE_STEPS: ProgressStep[] = [
  { label: '读取', threshold: 0 },
  { label: '处理', threshold: 35 },
  { label: '保存', threshold: 80 },
]

function parsePercent(progressStr: string): number | null {
  const match = progressStr.match(/(\d+)%/)
  if (!match) return null

  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

function cleanProgressMessage(progressStr: string) {
  return progressStr
    .trim()
    .replace(/^\d+%\s*/, '')
    .replace(/\s*\(\d+%\)\s*/g, ' ')
    .replace(/\s+\d+%\s*(?:\.\.\.|…)?$/g, '')
    .replace(/\s*(?:\.\.\.|…)+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getProgressSteps(queue: MarkQueue): ProgressStep[] {
  const text = queue.progress
  if (
    queue.type === 'recording'
    || /音轨|切片|语音|转写|音频|多媒体/.test(text)
  ) {
    return MEDIA_STEPS
  }

  if (queue.type === 'file' || queue.type === 'image') {
    return FILE_STEPS
  }

  return LINK_STEPS
}

function getKeywordStepIndex(text: string, steps: ProgressStep[]) {
  const findStep = (pattern: RegExp) => steps.findIndex(step => pattern.test(step.label))

  if (/完成|保存|写入|上传/.test(text)) {
    return steps.length - 1
  }

  if (/整理|结构化|清洗|资料卡|生成/.test(text)) {
    const index = findStep(/整理|处理/)
    return index >= 0 ? index : steps.length - 2
  }

  if (/切片|分片/.test(text)) {
    const index = findStep(/切片/)
    return index >= 0 ? index : null
  }

  if (/识别|转写/.test(text)) {
    const index = findStep(/识别/)
    return index >= 0 ? index : null
  }

  if (/抽轨|音轨/.test(text)) {
    const index = findStep(/抽轨/)
    return index >= 0 ? index : null
  }

  if (/抓取|读取|提取|字幕|正文/.test(text)) {
    const index = findStep(/提取|抓取|处理/)
    return index >= 0 ? index : null
  }

  return null
}

function getStepStatuses(queue: MarkQueue, steps: ProgressStep[]): StepStatus[] {
  const percent = parsePercent(queue.progress)
  const message = cleanProgressMessage(queue.progress)
  const keywordIndex = getKeywordStepIndex(message, steps)

  if (percent !== null && percent >= 100) {
    return steps.map(() => 'done')
  }

  if (keywordIndex !== null) {
    return steps.map((_, index) => {
      if (index < keywordIndex) return 'done'
      if (index === keywordIndex) return 'active'
      return 'pending'
    })
  }

  if (percent === null) {
    return steps.map((_, index) => index === 0 ? 'active' : 'pending')
  }

  return steps.map((step, index) => {
    const nextThreshold = steps[index + 1]?.threshold ?? 101
    if (percent >= nextThreshold) return 'done'
    if (percent >= step.threshold) return 'active'
    return 'pending'
  })
}

function getFallbackMessage(steps: ProgressStep[], statuses: StepStatus[]) {
  const activeStep = steps[statuses.findIndex(status => status === 'active')] || steps[0]

  switch (activeStep.label) {
    case '识别':
      return '正在识别链接类型'
    case '抓取':
      return '正在抓取网页内容'
    case '提取':
      return '正在提取正文'
    case '整理':
      return '正在整理结构化正文'
    case '保存':
      return '正在保存记录'
    case '载入':
      return '正在载入媒体文件'
    case '抽轨':
      return '正在提取音轨'
    case '切片':
      return '正在切分音频'
    case '读取':
      return '正在读取文件'
    case '处理':
      return '正在处理内容'
    default:
      return '正在后台处理'
  }
}

function getTaskTitle(queue: MarkQueue, totalCount: number) {
  if (queue.status === 'failed') {
    return '链接抓取失败'
  }
  if (totalCount > 1) {
    return `${totalCount} 个后台任务`
  }

  if (/视频|字幕/.test(queue.progress)) {
    return '视频提取中'
  }

  switch (queue.type) {
    case 'link':
      return '链接提取中'
    case 'file':
      return '文件保存中'
    case 'image':
      return '图片处理中'
    case 'recording':
      return '音频识别中'
    case 'scan':
      return '扫描保存中'
    case 'todo':
      return '待办保存中'
    default:
      return '后台处理中'
  }
}

function getTaskIcon(type: string, className = 'size-3.5') {
  switch (type) {
    case 'link':
      return <Globe className={className} />
    case 'file':
      return <FileText className={className} />
    case 'image':
      return <ImageIcon className={className} />
    case 'video':
      return <Video className={className} />
    case 'recording':
      return <Mic className={className} />
    default:
      return <Link className={className} />
  }
}

function formatRunTime(timeNow: number, startTime: number) {
  const seconds = Math.max(0, Math.round((timeNow - startTime) / 1000))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`
}

export function GlobalProgress() {
  const { queues } = useMarkStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeNow, setTimeNow] = useState(Date.now())
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (queues && queues.length > 0) {
      timer.current = setInterval(() => {
        setTimeNow(Date.now())
      }, 1000)
    }

    return () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [queues])

  if (!queues || queues.length === 0) {
    return null
  }

  const totalCount = queues.length
  const activeQueue = queues[0]
  const percentList = queues.map(queue => parsePercent(queue.progress)).filter((value): value is number => value !== null)
  const hasAvgPercent = percentList.length > 0
  const avgPercent = hasAvgPercent
    ? Math.round(percentList.reduce((sum, value) => sum + value, 0) / percentList.length)
    : 0
  const steps = getProgressSteps(activeQueue)
  const stepStatuses = getStepStatuses(activeQueue, steps)
  const activeMessage = cleanProgressMessage(activeQueue.progress) || getFallbackMessage(steps, stepStatuses)
  const progressWidth = hasAvgPercent ? avgPercent : 100
  const retryCapture = async (queue: MarkQueue) => {
    if (!queue.jobId || retryingJobId) return
    setRetryingJobId(queue.jobId)
    try {
      await retryLinkCaptureJob(queue.jobId)
    } finally {
      setRetryingJobId(null)
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none">
      <section
        className="pointer-events-auto overflow-hidden rounded-full border border-border/60 bg-background/95 text-foreground shadow-sm backdrop-blur-sm"
        aria-live="polite"
        aria-label={getTaskTitle(activeQueue, totalCount)}
      >
        <div className="flex items-center gap-2 px-3.5 py-2">
          {activeQueue.status === 'failed' ? (
            <AlertCircle className="size-3.5 shrink-0 text-red-500" />
          ) : activeQueue.status === 'queued' || activeQueue.status === 'running' ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : totalCount === 1 ? (
            <span className="shrink-0 text-muted-foreground">{getTaskIcon(activeQueue.type, 'size-3.5')}</span>
          ) : (
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          )}

          <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-foreground/80" title={`${getTaskTitle(activeQueue, totalCount)} · ${activeMessage}`}>
            <span className="font-medium text-foreground">{getTaskTitle(activeQueue, totalCount)}</span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{activeMessage}</span>
          </span>

          {activeQueue.status === 'failed' ? (
            <button
              type="button"
              onClick={() => void retryCapture(activeQueue)}
              disabled={!activeQueue.jobId || retryingJobId === activeQueue.jobId}
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
            >
              <RefreshCw className={cn('size-3', retryingJobId === activeQueue.jobId && 'animate-spin')} />
              重试
            </button>
          ) : hasAvgPercent ? (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {avgPercent}%
            </span>
          ) : null}

          {totalCount > 1 ? (
            <button
              type="button"
              onClick={() => setIsExpanded(value => !value)}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={isExpanded ? '收起明细' : '展开明细'}
            >
              {isExpanded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
            </button>
          ) : null}
        </div>

        {isExpanded && totalCount > 1 ? (
          <div className="max-h-32 overflow-y-auto rounded-b-full border-t border-border/50 px-3.5 py-1">
            {queues.map((queue) => {
              const percent = parsePercent(queue.progress)
              const itemSteps = getProgressSteps(queue)
              const itemStatuses = getStepStatuses(queue, itemSteps)
              const message = cleanProgressMessage(queue.progress) || getFallbackMessage(itemSteps, itemStatuses)

              return (
                <div key={queue.queueId} className="flex items-center gap-2 py-1 text-[10px] leading-4">
                  {queue.status === 'failed' ? (
                    <AlertCircle className="size-2.5 shrink-0 text-red-500" />
                  ) : (
                    <LoaderCircle className="size-2.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={message}>
                    {message}
                  </span>
                  {percent !== null ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground/70">
                      {percent}%
                    </span>
                  ) : null}
                  <span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground/50">
                    {formatRunTime(timeNow, queue.startTime)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}

        <div
          className="h-px w-full bg-border/50"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasAvgPercent ? avgPercent : undefined}
          aria-valuetext={hasAvgPercent ? `${avgPercent}%` : activeMessage}
        >
          <div
            className={cn(
              'h-full bg-foreground/30 transition-[width] duration-500 ease-out',
              !hasAvgPercent && 'animate-pulse motion-reduce:animate-none'
            )}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      </section>
    </div>
  )
}
