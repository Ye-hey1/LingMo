'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useAgentMemoryCandidatesStore } from '@/stores/agent-memory-candidates'
import useMemoriesStore from '@/stores/memories'
import type { AgentMemoryCandidateKind, AgentMemoryCandidateRecord } from '@/db/agent'

type KindFilter = 'all' | AgentMemoryCandidateKind

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'preference', label: '偏好' },
  { id: 'memory', label: '长期记忆' },
  { id: 'workflow', label: '工作流' },
  { id: 'failure', label: '失败经验' },
]

function candidateKindLabel(kind: AgentMemoryCandidateKind) {
  switch (kind) {
    case 'preference': return '偏好'
    case 'memory': return '长期记忆'
    case 'workflow': return '工作流模板'
    case 'failure': return '失败经验'
    default: return kind
  }
}

function candidateKindClass(kind: AgentMemoryCandidateKind) {
  if (kind === 'failure') return 'border-border bg-muted/60 text-foreground'
  return 'border-border bg-muted/50 text-foreground/85'
}

function confidenceLabel(confidence: string) {
  switch (confidence) {
    case 'high': return '高置信'
    case 'medium': return '中置信'
    case 'low': return '低置信'
    default: return confidence
  }
}

function parseEvidence(candidate: AgentMemoryCandidateRecord): string[] {
  if (!candidate.evidenceJson) return []
  try {
    const parsed = JSON.parse(candidate.evidenceJson)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  } catch {
    return []
  }
}

function parseSourceRunIds(candidate: AgentMemoryCandidateRecord): string[] {
  if (!candidate.sourceRunIdsJson) return []
  try {
    const parsed = JSON.parse(candidate.sourceRunIdsJson)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  } catch {
    return []
  }
}

function compactText(value: string, maxLength = 240) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function formatRelativeTime(timestamp: number | null) {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

function cleanCandidateText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, ' '))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s*/g, '$1')
    .replace(/(^|\n)\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*(?=\n|$)/g, '\n')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/-{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function candidatePreview(candidate: AgentMemoryCandidateRecord) {
  const cleaned = cleanCandidateText(candidate.content)
    .replace(/^\[(Agent|Skill)[^\]]+\]\s*/i, '')
    .trim()
  const segments = cleaned.split(/(?<=[。！？.!?])\s+/).filter(Boolean)
  const title = compactText(segments[0] || cleaned || candidateKindLabel(candidate.kind), 96)
  const summarySource = segments.slice(1).join(' ').trim()
  const summary = summarySource ? compactText(summarySource, 460) : ''
  return { title, summary }
}

/**
 * AI 沉淀候选队列。
 * 从 Agent 运行历史中提炼偏好、长期记忆、工作流模板与失败经验，
 * 审核通过后写入记忆库（与「长期记忆」tab 同源），形成记忆全链路：来源 → 审核 → 存储。
 */
export function CandidateQueue() {
  const {
    candidates,
    loading,
    generating,
    clearing,
    reviewingIds,
    error,
    lastGeneratedAt,
    lastGeneratedCount,
    inspectedRunCount,
    loadCandidates,
    generateCandidates,
    approveCandidate,
    rejectCandidate,
    clearPendingCandidates,
    clearError,
  } = useAgentMemoryCandidatesStore()
  const loadMemories = useMemoriesStore((s) => s.loadMemories)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')

  useEffect(() => {
    void loadCandidates('pending')
  }, [loadCandidates])

  const filtered = useMemo(
    () => kindFilter === 'all' ? candidates : candidates.filter((c) => c.kind === kindFilter),
    [candidates, kindFilter],
  )

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: candidates.length }
    for (const c of candidates) counts[c.kind] = (counts[c.kind] || 0) + 1
    return counts
  }, [candidates])

  const handleApprove = async (id: string) => {
    await approveCandidate(id)
    // 沉淀后同步刷新长期记忆列表（写入同一张 memories 表）
    await loadMemories()
  }

  const handleClearAll = async () => {
    const archivedCount = await clearPendingCandidates()
    if (archivedCount > 0) {
      setKindFilter('all')
      toast({
        title: '已清空 AI 沉淀候选',
        description: `${archivedCount} 条待审核候选已移出队列，长期记忆不受影响。`,
      })
    }
  }

  const queueBusy = loading || generating || clearing || reviewingIds.length > 0
  const emptyTitle = candidates.length === 0 ? '暂无待审核的候选' : '当前类型没有候选'
  const emptyHint = candidates.length === 0
    ? '点击「生成候选」，从最近的 Agent 运行中提炼可沉淀的知识。'
    : '切换到其他类型，或查看全部候选。'

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col">
      <div className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="size-4" />
                <span>AI 沉淀候选</span>
              </div>
              <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px] font-medium">
                <span className="tabular-nums">{candidates.length}</span>
                <span className="ml-1">待审核</span>
              </Badge>
            </div>
            <p className="mt-1 max-w-[72ch] text-xs leading-5 text-muted-foreground">
              审核 Agent 运行中提炼的偏好、长期记忆、工作流模板与失败经验。确认后写入记忆库，清空只会移出候选队列。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadCandidates('pending')} disabled={loading || clearing}>
              {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
              刷新
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={candidates.length === 0 || queueBusy}
                >
                  {clearing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}
                  全部清除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清空 AI 沉淀候选？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将 {candidates.length} 条待审核候选移出队列。已经确认沉淀的长期记忆不会被删除。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void handleClearAll()}
                  >
                    全部清除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={() => void generateCandidates()} disabled={generating || clearing}>
              {generating ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
              生成候选
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 border-b bg-muted/20 px-3 py-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1">
            {KIND_FILTERS.map((f) => {
              const count = kindCounts[f.id] || 0
              const active = kindFilter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-foreground/15 bg-background text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  )}
                  onClick={() => setKindFilter(f.id)}
                >
                  {f.label}
                  <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground')}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          {lastGeneratedAt ? (
            <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock3 className="size-3.5" />
              <span>上次生成 {lastGeneratedCount} 条，检查 {inspectedRunCount} 次运行，{formatRelativeTime(lastGeneratedAt)}</span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="break-words">{error}</span>
            <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs text-destructive hover:text-destructive" onClick={clearError}>关闭</Button>
          </div>
        ) : null}

        {loading && candidates.length === 0 ? (
          <div className="space-y-0 divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="mt-3 h-4 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Archive className="size-5" />
            </div>
            <div>
              <div className="text-sm font-medium">{emptyTitle}</div>
              <div className="mt-1 text-xs text-muted-foreground">{emptyHint}</div>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                reviewing={reviewingIds.includes(candidate.id)}
                onApprove={() => void handleApprove(candidate.id)}
                onReject={() => void rejectCandidate(candidate.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  reviewing,
  onApprove,
  onReject,
}: {
  candidate: AgentMemoryCandidateRecord
  reviewing: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const [showEvidence, setShowEvidence] = useState(false)
  const evidence = parseEvidence(candidate)
  const sourceRunIds = parseSourceRunIds(candidate)
  const preview = candidatePreview(candidate)

  return (
    <div className="px-4 py-3 transition-colors hover:bg-muted/20">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="outline" className={cn('h-5 rounded px-1.5 py-0 text-[10px] font-medium', candidateKindClass(candidate.kind))}>
              {candidateKindLabel(candidate.kind)}
            </Badge>
            <Badge variant="secondary" className="h-5 rounded px-1.5 py-0 text-[10px] font-medium">{confidenceLabel(candidate.confidence)}</Badge>
            {sourceRunIds.length > 0 ? <span>{sourceRunIds.length} 次来源运行</span> : null}
            <span>{formatRelativeTime(candidate.updatedAt)}</span>
          </div>
          <div className="mt-2 break-words text-sm font-medium leading-5 text-foreground">{preview.title}</div>
          {preview.summary ? (
            <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-muted-foreground">
              {preview.summary}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 lg:self-start">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={onApprove} disabled={reviewing}>
            {reviewing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            确认沉淀
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onReject} disabled={reviewing}>
            <XCircle className="size-3.5" />
            忽略
          </Button>
        </div>
      </div>
      {evidence.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowEvidence((v) => !v)}
          >
            <ChevronDown className={cn('size-3 transition-transform', showEvidence ? 'rotate-180' : '')} />
            {showEvidence ? '收起证据' : `查看运行证据 (${evidence.length})`}
          </button>
          {showEvidence ? (
            <div className="mt-2 space-y-1 rounded-md bg-muted/35 px-3 py-2">
              {evidence.slice(0, 6).map((item, i) => (
                <div key={`${candidate.id}-evidence-${i}`} className="break-words text-xs leading-5 text-muted-foreground">
                  {compactText(cleanCandidateText(item), 220)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
