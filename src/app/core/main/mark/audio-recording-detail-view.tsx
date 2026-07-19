'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileAudio,
  HelpCircle,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TriangleAlert,
  Users,
} from 'lucide-react'
import type { Mark } from '@/db/marks'
import { AudioPlayer } from '@/components/audio-player'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import useMarkStore from '@/stores/mark'
import {
  hasAudioRecordingMinutes,
  isAudioRecordingOrganizationStale,
  mergeAudioRecordingMeta,
  mergeAudioRecordingSummary,
  parseAudioRecordingRecord,
  summarizeAudioRecording,
  type AudioEvidenceRef,
  type AudioRecordingStatus,
} from '@/lib/audio-recording-record'

const CONVERSATION_TYPE_LABELS: Record<string, string> = {
  requirements_interview: '需求访谈',
  project_meeting: '项目会议',
  solution_review: '方案评审',
  retrospective: '复盘会议',
  training: '培训分享',
  interview: '访谈',
  brainstorm: '头脑风暴',
  voice_memo: '语音备忘',
  other: '会话记录',
}

const STATUS_LABELS: Record<AudioRecordingStatus, string> = {
  raw: '待整理',
  organizing: '正在整理',
  ready: '纪要已生成',
  failed: '整理失败',
}

const INTERRUPTED_ORGANIZATION_MESSAGE = '上次整理任务已中断，原始转写和音频均已保留，请重新生成智能纪要。'

const PRIORITY_LABELS: Record<string, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
  unknown: '优先级待确认',
}

function Evidence({ evidence }: { evidence?: AudioEvidenceRef }) {
  if (!evidence?.time && !evidence?.quote) return null
  return (
    <div className="mt-2 flex min-w-0 items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
      <Clock3 className="mt-0.5 size-3 shrink-0" />
      {evidence.time ? <span className="shrink-0 font-mono tabular-nums">{evidence.time}</span> : null}
      {evidence.quote ? <span className="min-w-0 text-pretty">“{evidence.quote}”</span> : null}
    </div>
  )
}

function SectionTitle({ icon, title, count }: { icon: ReactNode; title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {typeof count === 'number' ? (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </div>
  )
}

function StatusBadge({ status }: { status: AudioRecordingStatus }) {
  const Icon = status === 'ready'
    ? CheckCircle2
    : status === 'failed'
      ? AlertCircle
      : status === 'organizing'
        ? Loader2
        : CircleDot
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <Icon className={`size-3.5 ${status === 'organizing' ? 'animate-spin' : ''}`} />
      {STATUS_LABELS[status]}
    </span>
  )
}

function OrganizingState({ message }: { message: string }) {
  return (
    <div className="space-y-7 py-2" aria-label="正在生成会话纪要">
      <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span>{message}</span>
      </div>
      <div className="space-y-3 border-l-2 border-primary/40 pl-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1, 2, 3].map(item => (
          <div key={item} className="space-y-3 border-t border-border pt-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AudioRecordingDetailView({ mark }: { mark: Mark }) {
  const [localMark, setLocalMark] = useState(mark)
  const [activeView, setActiveView] = useState<'minutes' | 'transcript'>('minutes')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState('正在准备会话内容...')
  const { updateMark } = useMarkStore()

  useEffect(() => {
    setLocalMark(mark)
  }, [mark])

  const recording = useMemo(() => parseAudioRecordingRecord(localMark), [localMark])
  const staleOrganization = !isGenerating && isAudioRecordingOrganizationStale(recording.meta)
  const status = isGenerating ? 'organizing' : staleOrganization ? 'failed' : recording.meta.status || 'raw'
  const organizationError = staleOrganization ? INTERRUPTED_ORGANIZATION_MESSAGE : recording.meta.error
  const conversationType = recording.meta.conversationType
    ? CONVERSATION_TYPE_LABELS[recording.meta.conversationType]
    : '会话记录'

  useEffect(() => {
    if (!staleOrganization) return
    const failedContent = mergeAudioRecordingMeta(localMark.content || recording.body, {
      status: 'failed',
      error: INTERRUPTED_ORGANIZATION_MESSAGE,
    })
    const failedMark = { ...localMark, content: failedContent }
    setLocalMark(failedMark)
    void updateMark(failedMark).catch(error => {
      console.warn('[AudioRecordingDetailView] Failed to recover interrupted organization:', error)
    })
  }, [localMark, recording.body, staleOrganization, updateMark])

  const handleGenerateMinutes = useCallback(async () => {
    if (isGenerating) return
    setIsGenerating(true)
    setGenerationProgress('正在准备会话内容...')

    const organizingContent = mergeAudioRecordingMeta(localMark.content || recording.body, {
      status: 'organizing',
      organizationStartedAt: Date.now(),
      error: '',
    })
    const organizingMark = { ...localMark, content: organizingContent }
    setLocalMark(organizingMark)
    await updateMark(organizingMark)

    try {
      const minutes = await summarizeAudioRecording({
        title: recording.title,
        content: recording.body,
        url: localMark.url,
      }, {
        onProgress: progress => setGenerationProgress(progress.message),
      })
      if (!hasAudioRecordingMinutes(minutes)) {
        throw new Error('AI 未返回可用的会话纪要')
      }
      const nextContent = mergeAudioRecordingSummary(organizingContent, minutes)
      const nextMark = {
        ...localMark,
        desc: minutes.title?.trim() || recording.title,
        content: nextContent,
      }
      setLocalMark(nextMark)
      await updateMark(nextMark)
      setActiveView('minutes')
      toast({
        title: '会话纪要已生成',
        description: '已更新重点、需求、决策、行动项与待确认问题。',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedContent = mergeAudioRecordingMeta(organizingContent, {
        status: 'failed',
        error: message.slice(0, 500),
      })
      const failedMark = { ...localMark, content: failedContent }
      setLocalMark(failedMark)
      await updateMark(failedMark)
      toast({
        title: '智能纪要生成失败',
        description: '原始转写和音频仍然可用，请稍后重试。',
        variant: 'destructive',
      })
    } finally {
      setIsGenerating(false)
    }
  }, [isGenerating, localMark, recording.body, recording.title, updateMark])

  const hasMinutes = recording.hasMinutes
  const highlights = recording.meta.highlights || []
  const requirements = recording.meta.requirements || []
  const decisions = recording.meta.decisions || []
  const actionItems = recording.meta.actionItems || []
  const risks = recording.meta.risks || []
  const openQuestions = recording.meta.openQuestions || []
  const participants = recording.meta.participants || []

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="border-b border-border pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background">
                <FileAudio className="size-3.5" />
                {conversationType}
              </span>
              <StatusBadge status={status} />
            </div>
            <h2 className="mt-3 max-w-3xl text-lg font-semibold leading-7 text-foreground">
              {recording.title}
            </h2>
            {recording.meta.sourceFileName ? (
              <p className="mt-1 truncate text-xs text-muted-foreground" title={recording.meta.sourceFileName}>
                来源文件：{recording.meta.sourceFileName}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant={hasMinutes ? 'outline' : 'default'}
            onClick={handleGenerateMinutes}
            disabled={isGenerating}
            className="shrink-0 gap-1.5"
          >
            {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : hasMinutes ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
            {hasMinutes ? '重新整理' : '生成智能纪要'}
          </Button>
        </div>
        {localMark.url ? (
          <div className="mt-4">
            <AudioPlayer audioPath={localMark.url} />
          </div>
        ) : null}
      </header>

      <div className="py-4">
        <div className="inline-flex max-w-full rounded-md border border-border bg-muted/25 p-0.5" role="tablist" aria-label="录音内容视图">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'minutes'}
            onClick={() => setActiveView('minutes')}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${activeView === 'minutes' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Sparkles className="size-3.5" />
            智能纪要
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'transcript'}
            onClick={() => setActiveView('transcript')}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${activeView === 'transcript' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ListChecks className="size-3.5" />
            完整原文
          </button>
        </div>
      </div>

      {activeView === 'transcript' ? (
        <section aria-label="完整原文" className="pb-3">
          {recording.segments.length ? (
            <div className="divide-y divide-border border-y border-border">
              {recording.segments.map((segment, index) => (
                <div key={`${segment.time}-${index}`} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-3 py-4 md:grid-cols-[4.5rem_minmax(0,1fr)] md:gap-5">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{segment.time}</span>
                  <p className="min-w-0 whitespace-pre-wrap text-sm leading-7 text-foreground/90">{segment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">暂无可展示的转写原文</p>
          )}
        </section>
      ) : status === 'organizing' ? (
        <OrganizingState message={isGenerating ? generationProgress : '正在后台分析完整转写...'} />
      ) : !hasMinutes ? (
        <section className="flex min-h-64 flex-col items-center justify-center border-y border-dashed border-border px-5 py-12 text-center">
          {status === 'failed' ? <TriangleAlert className="size-7 text-amber-600" /> : <Sparkles className="size-7 text-muted-foreground" />}
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {status === 'failed' ? '智能纪要暂未生成' : '将转写整理为会话纪要'}
          </h3>
          <p className="mt-1.5 max-w-md text-xs leading-5 text-muted-foreground">
            {organizationError || '模型会判断会话类型，并提取重点、需求、决策、任务、风险与待确认信息。'}
          </p>
          <Button type="button" size="sm" onClick={handleGenerateMinutes} disabled={isGenerating} className="mt-4 gap-1.5">
            <Sparkles className="size-3.5" />
            生成智能纪要
          </Button>
        </section>
      ) : (
        <div className="grid gap-x-10 gap-y-8 pb-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.75fr)]">
          <main className="min-w-0 space-y-8">
            {recording.meta.summary ? (
              <section className="border-l-2 border-primary/50 pl-4">
                <p className="text-[11px] font-semibold text-muted-foreground">会话摘要</p>
                <p className="mt-2 text-sm leading-7 text-foreground">{recording.meta.summary}</p>
              </section>
            ) : null}

            {highlights.length ? (
              <section>
                <SectionTitle icon={<Target className="size-4" />} title="核心结论" count={highlights.length} />
                <ul className="space-y-2">
                  {highlights.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-3 rounded-md bg-muted/30 px-3.5 py-3 text-sm leading-6 text-foreground">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {requirements.length ? (
              <section>
                <SectionTitle icon={<Target className="size-4" />} title="需求识别" count={requirements.length} />
                <div className="space-y-2.5">
                  {requirements.map((item, index) => (
                    <article key={`${item.requirement}-${index}`} className="rounded-md border border-border px-3.5 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 text-sm font-medium leading-6 text-foreground">{item.requirement}</p>
                        {item.priority ? (
                          <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {PRIORITY_LABELS[item.priority]}
                          </span>
                        ) : null}
                      </div>
                      {item.requester ? <p className="mt-1 text-xs text-muted-foreground">提出方：{item.requester}</p> : null}
                      <Evidence evidence={item.evidence} />
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {decisions.length ? (
              <section>
                <SectionTitle icon={<CheckCircle2 className="size-4" />} title="决策事项" count={decisions.length} />
                <div className="space-y-2.5">
                  {decisions.map((item, index) => (
                    <article key={`${item.decision}-${index}`} className="rounded-md border border-border px-3.5 py-3">
                      <p className="text-sm font-medium leading-6 text-foreground">{item.decision}</p>
                      {item.rationale ? <p className="mt-1 text-xs leading-5 text-muted-foreground">理由：{item.rationale}</p> : null}
                      <Evidence evidence={item.evidence} />
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {actionItems.length ? (
              <section>
                <SectionTitle icon={<ListChecks className="size-4" />} title="行动项" count={actionItems.length} />
                <div className="overflow-hidden rounded-md border border-border">
                  {actionItems.map((item, index) => (
                    <article key={`${item.task}-${index}`} className="border-b border-border px-3.5 py-3 last:border-b-0">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-1.5 size-3.5 shrink-0 rounded border border-muted-foreground/50" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-6 text-foreground">{item.task}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>负责人：{item.owner || '待确认'}</span>
                            <span>截止：{item.dueDate || '待确认'}</span>
                          </div>
                          <Evidence evidence={item.evidence} />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </main>

          <aside className="min-w-0 space-y-7 lg:border-l lg:border-border lg:pl-7">
            {participants.length ? (
              <section>
                <SectionTitle icon={<Users className="size-4" />} title="参与角色" count={participants.length} />
                <div className="space-y-2">
                  {participants.map((participant, index) => (
                    <div key={`${participant.name}-${index}`} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-xs last:border-b-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{participant.name}</p>
                        {participant.role ? <p className="mt-0.5 truncate text-muted-foreground">{participant.role}</p> : null}
                      </div>
                      {participant.confidence === 'inferred' ? <span className="shrink-0 text-[10px] text-amber-600">模型推断</span> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {risks.length ? (
              <section>
                <SectionTitle icon={<TriangleAlert className="size-4" />} title="风险与阻塞" count={risks.length} />
                <div className="space-y-2.5">
                  {risks.map((item, index) => (
                    <article key={`${item.risk}-${index}`} className="border-l-2 border-amber-500/60 pl-3">
                      <p className="text-xs font-medium leading-5 text-foreground">{item.risk}</p>
                      {item.impact ? <p className="mt-1 text-xs leading-5 text-muted-foreground">影响：{item.impact}</p> : null}
                      {item.mitigation ? <p className="mt-1 text-xs leading-5 text-muted-foreground">建议：{item.mitigation}</p> : null}
                      <Evidence evidence={item.evidence} />
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {openQuestions.length ? (
              <section>
                <SectionTitle icon={<HelpCircle className="size-4" />} title="待确认" count={openQuestions.length} />
                <div className="space-y-2.5">
                  {openQuestions.map((item, index) => (
                    <article key={`${item.question}-${index}`} className="rounded-md bg-muted/30 px-3 py-2.5">
                      <p className="text-xs font-medium leading-5 text-foreground">{item.question}</p>
                      {item.owner ? <p className="mt-1 text-[11px] text-muted-foreground">确认人：{item.owner}</p> : null}
                      <Evidence evidence={item.evidence} />
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {!participants.length && !risks.length && !openQuestions.length ? (
              <section className="border-y border-dashed border-border py-5 text-center">
                <HelpCircle className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-xs leading-5 text-muted-foreground">本次会话没有识别到额外风险或待确认问题。</p>
              </section>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  )
}
