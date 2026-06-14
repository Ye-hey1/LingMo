'use client'

import React, { useEffect, useRef, useState } from 'react'
import useMarkStore, { type MarkQueue } from '@/stores/mark'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Image as ImageIcon,
  Link,
  LoaderCircle,
  Mic,
  Sparkles,
  Video,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

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

function StepRail({
  steps,
  statuses,
}: {
  steps: ProgressStep[]
  statuses: StepStatus[]
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center">
        {steps.map((step, index) => {
          const status = statuses[index]
          const lineStatus = statuses[index + 1]

          return (
            <React.Fragment key={step.label}>
              <span
                className={cn(
                  'flex size-2.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  status === 'done' && 'border-foreground/35 bg-foreground/35',
                  status === 'active' && 'border-foreground/55 bg-background ring-2 ring-foreground/10',
                  status === 'pending' && 'border-border bg-muted/50'
                )}
              >
                {status === 'active' ? (
                  <span className="size-1 rounded-full bg-foreground/60" />
                ) : null}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className={cn(
                    'mx-1 h-px flex-1 rounded-full bg-border/70 transition-colors',
                    (status === 'done' && lineStatus !== 'pending') && 'bg-foreground/25',
                    status === 'active' && 'bg-foreground/15'
                  )}
                />
              ) : null}
            </React.Fragment>
          )
        })}
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => (
          <span
            key={step.label}
            className={cn(
              'truncate text-center text-[10px] leading-4 transition-colors',
              statuses[index] === 'active' && 'font-medium text-foreground',
              statuses[index] === 'done' && 'text-muted-foreground',
              statuses[index] === 'pending' && 'text-muted-foreground/45'
            )}
            title={step.label}
          >
            {step.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function GlobalProgress() {
  const { queues } = useMarkStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeNow, setTimeNow] = useState(Date.now())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const t = useTranslations('record.mark.type')

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

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[430px] max-w-[calc(100vw-32px)] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none">
      <section
        className="pointer-events-auto overflow-hidden rounded-xl border border-border/75 bg-background text-foreground"
        aria-live="polite"
        aria-label={getTaskTitle(activeQueue, totalCount)}
      >
        <div className="px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {totalCount === 1 ? (
                getTaskIcon(activeQueue.type, 'size-3.5')
              ) : (
                <Sparkles className="size-3.5" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-xs font-medium leading-5 text-foreground">
                  {getTaskTitle(activeQueue, totalCount)}
                </h2>
                {hasAvgPercent ? (
                  <span className="ml-auto shrink-0 text-[11px] leading-5 tabular-nums text-muted-foreground">
                    {avgPercent}%
                  </span>
                ) : null}
              </div>
              <p className="truncate text-[11px] leading-4 text-muted-foreground" title={activeMessage}>
                {activeMessage}
              </p>
            </div>

            {totalCount > 1 ? (
              <button
                type="button"
                onClick={() => setIsExpanded(value => !value)}
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={isExpanded ? '收起明细' : '展开明细'}
              >
                {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
              </button>
            ) : null}
          </div>

          <div className="mt-2.5">
            <StepRail steps={steps} statuses={stepStatuses} />
          </div>
        </div>

        {isExpanded && totalCount > 1 ? (
          <div className="max-h-36 overflow-y-auto border-t border-border/70 px-3 py-1.5">
            {queues.map((queue) => {
              const percent = parsePercent(queue.progress)
              const itemSteps = getProgressSteps(queue)
              const itemStatuses = getStepStatuses(queue, itemSteps)
              const message = cleanProgressMessage(queue.progress) || getFallbackMessage(itemSteps, itemStatuses)

              return (
                <div key={queue.queueId} className="flex items-center gap-2 py-1.5 text-[11px] leading-4">
                  <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  <span className="shrink-0 text-muted-foreground">
                    {t(queue.type) || queue.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/80" title={message}>
                    {message}
                  </span>
                  {percent !== null ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {percent}%
                    </span>
                  ) : null}
                  <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground/70">
                    {formatRunTime(timeNow, queue.startTime)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}

        <div
          className="h-px w-full bg-border/70"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasAvgPercent ? avgPercent : undefined}
          aria-valuetext={hasAvgPercent ? `${avgPercent}%` : activeMessage}
        >
          <div
            className={cn(
              'h-full bg-foreground/35 transition-[width] duration-500 ease-out',
              !hasAvgPercent && 'animate-pulse motion-reduce:animate-none'
            )}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      </section>
    </div>
  )
}
