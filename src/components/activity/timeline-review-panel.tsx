'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Brain, FileText, Goal, Loader2, MessageSquare, NotebookPen, Sparkles, Target } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import {
  appendActivityReviewToNote,
  createActivityReviewNote,
  isAppendableActivityNote,
  wrapReviewAsRetrospective,
  wrapReviewAsWeeklyReport,
} from '@/lib/activity/review-note'
import {
  analyzeActivityScope,
  buildActivityReviewPrompt,
  buildHighValueConversationNote,
  getRecentDays,
  type ActivityReviewKind,
} from '@/lib/activity/review'
import {
  buildActivityGoalProgress,
  buildActivityGoalReminder,
  DEFAULT_ACTIVITY_GOALS,
  loadActivityGoalSettings,
  saveActivityGoalSettings,
  type ActivityGoalSettings,
} from '@/lib/activity/goals'
import { createOpenAIClient, getAISettings, validateAIService } from '@/lib/ai/utils'
import type { ActivityCalendarData, ActivityDaySummary, ActivityEntry, ActivityViewSource } from '@/lib/activity/types'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'

function ReviewMetric({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background px-3 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function formatConversationMeta(entry: {
  kind: 'chat' | 'ai'
  count: number
  tagName?: string
  platform?: string
  score: number
}) {
  return [
    entry.kind === 'ai' ? (entry.platform || 'AI') : (entry.tagName || '未分类'),
    `${entry.count} 次`,
    `${entry.score} 分`,
  ].join(' · ')
}

function canOpenEntry(entry?: ActivityEntry) {
  if (!entry) return false
  if (entry.source === 'ai') {
    return typeof entry.meta?.platform === 'string' && typeof entry.meta?.sessionKey === 'string'
  }
  return Boolean(entry.path)
}

type ReviewSaveMode = 'plain' | 'weekly' | 'retrospective'

export function TimelineReviewPanel({
  data,
  scopeDays,
  source,
  rangeLabel,
  onOpenEntryPath,
  onOpenFile,
}: {
  data: ActivityCalendarData
  scopeDays: ActivityDaySummary[]
  source: ActivityViewSource | 'all'
  rangeLabel: string
  onOpenEntryPath: (entry: ActivityEntry) => void
  onOpenFile: (filePath: string) => Promise<void>
}) {
  const [goalSettings, setGoalSettings] = useState<ActivityGoalSettings>(DEFAULT_ACTIVITY_GOALS)
  const [goalSaving, setGoalSaving] = useState(false)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewMarkdown, setReviewMarkdown] = useState('')
  const [reviewTitle, setReviewTitle] = useState('')
  const [lastReviewKind, setLastReviewKind] = useState<ActivityReviewKind | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const {
    activeFilePath,
    currentArticle,
    setCurrentArticle,
    saveCurrentArticle,
    loadFileTree,
  } = useArticleStore()

  useEffect(() => {
    let cancelled = false

    void loadActivityGoalSettings().then((settings) => {
      if (!cancelled) {
        setGoalSettings(settings)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const todayDay = data.days.find((day) => day.day === data.insights.today.day)
  const weekDays = getRecentDays(data, 7)
  const appendableCurrentNote = isAppendableActivityNote(activeFilePath)

  const scopeAnalysis = useMemo(
    () => analyzeActivityScope(scopeDays, source, rangeLabel),
    [rangeLabel, scopeDays, source],
  )
  const todayAnalysis = useMemo(
    () => analyzeActivityScope(todayDay ? [todayDay] : [], 'all', '今日'),
    [todayDay],
  )
  const weekAnalysis = useMemo(
    () => analyzeActivityScope(weekDays, 'all', '近 7 天'),
    [weekDays],
  )

  const goalProgress = useMemo(
    () =>
      buildActivityGoalProgress(goalSettings, {
        record: todayAnalysis.counts.record,
        writing: todayAnalysis.counts.writing,
        conversation: todayAnalysis.effectiveConversationCount,
      }),
    [goalSettings, todayAnalysis],
  )
  const goalReminder = useMemo(
    () => buildActivityGoalReminder(goalProgress),
    [goalProgress],
  )
  const goalInputItems = [
    { key: 'record', label: '记录', value: goalSettings.record },
    { key: 'writing', label: '写作', value: goalSettings.writing },
    { key: 'conversation', label: '有效对话', value: goalSettings.conversation },
  ] as const
  const topRecordTypes = scopeAnalysis.recordTypeDistribution.slice(0, 6)
  const topTags = scopeAnalysis.recordTagDistribution.slice(0, 8)

  function getReviewAnalysis(kind: ActivityReviewKind) {
    if (kind === 'today') return todayAnalysis
    if (kind === 'week') return weekAnalysis
    return scopeAnalysis
  }

  function getReviewDraftTitle(kind: ActivityReviewKind, day: string) {
    if (kind === 'today') return `今日回顾-${day}`
    if (kind === 'week') return `本周回顾-${day}`
    if (kind === 'report') return `活动复盘-${day}`
    return `当前产出整理-${day}`
  }

  function buildReviewPayload(mode: ReviewSaveMode) {
    const baseTitle = reviewTitle || `活动回顾-${scopeAnalysis.endDay || data.insights.today.day}`

    if (mode === 'weekly') {
      return {
        title: `周报-${scopeAnalysis.endDay || data.insights.today.day}`,
        content: wrapReviewAsWeeklyReport(baseTitle, reviewMarkdown, scopeAnalysis.rangeLabel),
      }
    }

    if (mode === 'retrospective') {
      return {
        title: `复盘-${scopeAnalysis.endDay || data.insights.today.day}`,
        content: wrapReviewAsRetrospective(baseTitle, reviewMarkdown, scopeAnalysis.rangeLabel),
      }
    }

    return {
      title: baseTitle,
      content: reviewMarkdown,
    }
  }

  async function persistGoals(nextSettings: ActivityGoalSettings) {
    setGoalSaving(true)
    try {
      await saveActivityGoalSettings(nextSettings)
      setGoalSettings(nextSettings)
    } catch (error) {
      toast({
        title: '保存目标失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setGoalSaving(false)
    }
  }

  async function generateReview(kind: ActivityReviewKind) {
    const analysis = getReviewAnalysis(kind)

    if (!analysis.totalCount) {
      toast({
        title: '暂无可总结内容',
        description: '当前范围内没有足够的活动数据。',
        variant: 'destructive',
      })
      return
    }

    setReviewLoading(true)
    setLastReviewKind(kind)

    try {
      const aiConfig = await getAISettings('primaryModel')
      const validated = await validateAIService(aiConfig?.baseURL)
      if (!validated) return

      const openai = await createOpenAIClient(aiConfig)
      const prompt = buildActivityReviewPrompt(kind, analysis)
      const completion = await openai.chat.completions.create({
        model: aiConfig?.model || '',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: kind === 'report' ? 2200 : 1600,
      })
      const content = completion.choices[0]?.message?.content?.trim()

      if (!content) {
        throw new Error('模型没有返回可用内容。')
      }

      setReviewMarkdown(content)
      setReviewTitle(getReviewDraftTitle(kind, analysis.endDay || data.insights.today.day))
    } catch (error) {
      toast({
        title: '生成回顾失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setReviewLoading(false)
    }
  }

  async function saveReviewAsNote(mode: ReviewSaveMode) {
    if (!reviewMarkdown.trim()) return

    setSavingNote(true)
    try {
      const payload = buildReviewPayload(mode)
      const filePath = await createActivityReviewNote(payload.title, payload.content)
      await loadFileTree({ skipRemoteSync: true })
      await onOpenFile(filePath)
      toast({
        title: mode === 'plain' ? '已保存为笔记' : mode === 'weekly' ? '已保存为周报' : '已保存为复盘',
        description: filePath,
      })
    } catch (error) {
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setSavingNote(false)
    }
  }

  async function appendReviewToCurrentNote() {
    if (!reviewMarkdown.trim()) return

    if (!activeFilePath || !appendableCurrentNote) {
      toast({
        title: '请先打开一篇笔记',
        description: '当前只支持追加到 Markdown 或文本笔记。',
        variant: 'destructive',
      })
      return
    }

    setSavingNote(true)
    try {
      const nextContent = await appendActivityReviewToNote(activeFilePath, reviewMarkdown, {
        currentContent: currentArticle || undefined,
        title: reviewTitle || '活动回顾',
        rangeLabel: scopeAnalysis.rangeLabel,
      })
      setCurrentArticle(nextContent)
      await saveCurrentArticle(nextContent)
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
    } finally {
      setSavingNote(false)
    }
  }

  async function saveHighValueConversationNote() {
    if (!scopeAnalysis.highValueConversations.length) {
      toast({
        title: '暂无高价值对话',
        description: '当前范围内还没有值得沉淀的高价值对话。',
        variant: 'destructive',
      })
      return
    }

    setSavingNote(true)
    try {
      const title = `高价值对话沉淀-${scopeAnalysis.endDay || data.insights.today.day}`
      const filePath = await createActivityReviewNote(title, buildHighValueConversationNote(scopeAnalysis))
      await loadFileTree({ skipRemoteSync: true })
      await onOpenFile(filePath)
      toast({
        title: '已沉淀高价值对话',
        description: filePath,
      })
    } catch (error) {
      toast({
        title: '保存沉淀笔记失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[0.84fr_1.16fr]">
      <div className="space-y-4">
        <div className="rounded-lg border border-border/70 bg-background p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">目标回顾</h3>
              <p className="mt-1 text-xs text-muted-foreground">{scopeAnalysis.rangeLabel}</p>
            </div>
            <Badge variant="outline">{scopeAnalysis.totalCount} 次活动</Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReviewMetric
              label="有效对话"
              value={scopeAnalysis.effectiveConversationCount}
              hint={scopeAnalysis.rangeLabel}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <ReviewMetric
              label="高价值对话"
              value={scopeAnalysis.highValueConversationCount}
              hint="已按会话合并"
              icon={<Sparkles className="h-4 w-4" />}
            />
            <ReviewMetric
              label="高价值记录"
              value={scopeAnalysis.highValueRecordCount}
              hint="适合继续整理"
              icon={<NotebookPen className="h-4 w-4" />}
            />
            <ReviewMetric
              label="转笔记率"
              value={`${scopeAnalysis.noteConversionRate}%`}
              hint={`${scopeAnalysis.noteConversionCount}/${scopeAnalysis.counts.record}`}
              icon={<FileText className="h-4 w-4" />}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">每日目标</h4>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-xs"
              disabled={goalSaving}
              onClick={() => void persistGoals(goalSettings)}
            >
              保存
            </Button>
          </div>

          <div className="space-y-2.5">
            {goalProgress.map((item) => {
              const inputValue = goalInputItems.find(goal => goal.key === item.key)?.value ?? 0

              return (
                <div key={item.key} className="rounded-md border border-border/60 bg-muted/25 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{item.label}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{item.current}/{item.target}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            item.completed ? 'bg-emerald-500' : 'bg-sky-500',
                          )}
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      value={inputValue}
                      className="h-8 w-20 shrink-0 text-center"
                      onChange={(event) => {
                        const nextValue = Math.max(0, Number(event.target.value) || 0)
                        setGoalSettings((prev) => ({ ...prev, [item.key]: nextValue }))
                      }}
                      onBlur={() => void persistGoals(goalSettings)}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">轻量提醒：</span> {goalReminder}
            {goalSaving ? <span className="ml-2">保存中...</span> : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Goal className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">数据洞察</h4>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-muted/25 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">记录类型</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{scopeAnalysis.recordTypeDistribution.length} 类</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {topRecordTypes.length ? topRecordTypes.map((item) => (
                  <Badge key={item.key} variant="outline" className="bg-background/80">
                    {item.label} {item.count}
                  </Badge>
                )) : <span className="text-xs text-muted-foreground">暂无记录</span>}
              </div>
            </div>

            <div className="rounded-md bg-muted/25 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">标签分布</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{scopeAnalysis.recordTagDistribution.length} 个</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {topTags.length ? topTags.map((item) => (
                  <Badge key={item.key} variant="outline" className="bg-background/80">
                    {item.label} {item.count}
                  </Badge>
                )) : <span className="text-xs text-muted-foreground">暂无标签</span>}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 text-xs text-muted-foreground">高价值对话</div>
              <div className="space-y-2">
                {scopeAnalysis.highValueConversations.length ? scopeAnalysis.highValueConversations.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!canOpenEntry(item.entries[item.entries.length - 1])}
                    className="block w-full rounded-md border border-transparent bg-background/70 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-background disabled:cursor-default disabled:opacity-100"
                    onClick={() => {
                      const targetEntry = item.entries[item.entries.length - 1]
                      if (targetEntry && canOpenEntry(targetEntry)) {
                        onOpenEntryPath(targetEntry)
                      }
                    }}
                  >
                    <div className="line-clamp-1 text-sm font-medium">{item.title}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{formatConversationMeta(item)}</div>
                  </button>
                )) : <p className="text-xs text-muted-foreground">暂无高价值对话</p>}
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 text-xs text-muted-foreground">建议继续推进</div>
              <div className="space-y-2">
                {scopeAnalysis.recommendedNextNotes.length ? scopeAnalysis.recommendedNextNotes.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!canOpenEntry(item.entry)}
                    className="block w-full rounded-md border border-transparent bg-background/70 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-background disabled:cursor-default disabled:opacity-100"
                    onClick={() => {
                      if (item.entry && canOpenEntry(item.entry)) {
                        onOpenEntryPath(item.entry)
                      }
                    }}
                  >
                    <div className="line-clamp-1 text-sm font-medium">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.reason}</div>
                  </button>
                )) : <p className="text-xs text-muted-foreground">暂无明显的继续推进项</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-background p-4 shadow-sm">
        <div className="flex h-full min-h-[720px] flex-col">
          <div className="mb-4 flex flex-col gap-4 border-b border-border/60 pb-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h4 className="text-sm font-semibold">AI 回顾结果</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  在右侧集中生成、编辑和保存回顾结果，减少来回切换。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {reviewTitle ? <Badge variant="outline">{reviewTitle}</Badge> : null}
                <Badge variant="secondary">{scopeAnalysis.rangeLabel}</Badge>
                {appendableCurrentNote && activeFilePath ? (
                  <Badge variant="secondary" className="max-w-[240px] truncate">
                    当前笔记：{activeFilePath.split('/').pop() || activeFilePath}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-md bg-muted/25 p-3">
                <div className="mb-2 text-xs text-muted-foreground">生成回顾</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={reviewLoading} onClick={() => generateReview('today')}>
                    {reviewLoading && lastReviewKind === 'today' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    今日回顾
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={reviewLoading} onClick={() => generateReview('week')}>
                    {reviewLoading && lastReviewKind === 'week' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    本周回顾
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={reviewLoading} onClick={() => generateReview('scope')}>
                    {reviewLoading && lastReviewKind === 'scope' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <NotebookPen className="mr-1.5 h-3.5 w-3.5" />}
                    整理产出
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={reviewLoading} onClick={() => generateReview('report')}>
                    {reviewLoading && lastReviewKind === 'report' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
                    复盘文档
                  </Button>
                  <Button type="button" size="sm" disabled={savingNote} onClick={saveHighValueConversationNote}>
                    <Brain className="mr-1.5 h-3.5 w-3.5" />
                    沉淀对话
                  </Button>
                </div>
              </div>

              <div className="rounded-md bg-muted/25 p-3">
                <div className="mb-2 text-xs text-muted-foreground">写入方式</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={!reviewMarkdown.trim() || savingNote} onClick={() => void saveReviewAsNote('plain')}>
                    保存笔记
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!reviewMarkdown.trim() || savingNote} onClick={() => void saveReviewAsNote('weekly')}>
                    周报模板
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!reviewMarkdown.trim() || savingNote} onClick={() => void saveReviewAsNote('retrospective')}>
                    复盘模板
                  </Button>
                  <Button type="button" size="sm" disabled={!reviewMarkdown.trim() || savingNote} onClick={() => void appendReviewToCurrentNote()}>
                    继续写入
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <Textarea
            value={reviewMarkdown}
            onChange={(event) => setReviewMarkdown(event.target.value)}
            placeholder={reviewLoading ? '正在生成回顾...' : '点击右上区域按钮生成 AI 回顾结果'}
            className="min-h-[420px] flex-1 resize-none"
          />
        </div>
      </div>
    </section>
  )
}
