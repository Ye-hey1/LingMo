'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  FileDiff,
  FileText,
  GitBranch,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  RefreshCw,
  ShieldCheck,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import { useAgentRunsStore } from '@/stores/agent-runs'
import { buildAgentEventEnvelope } from '@/lib/agent/event-envelope'
import type {
  AgentEvent,
  AgentEventEnvelope,
} from '@/lib/agent/types'
import type {
  AgentRunSnapshot,
  VfsRef,
} from '@/lib/agent-harness/types'
import type {
  AgentRuntimeSnapshot,
  SkillRuntimeEntry,
} from '@/lib/agent/runtime-snapshot'
import type {
  AgentApprovalRecord,
  AgentArtifactRecord,
  AgentEventRecord,
  AgentFailedToolCallRow,
  AgentRunDetail,
  AgentRunRecord,
  AgentStepRecord,
  AgentToolCallRecord,
} from '@/db/agent'
import type {
  KnowledgeIndexHealth,
  KnowledgeIndexHealthIssue,
  ReindexProgress,
  ReindexResult,
} from '@/lib/knowledge/reindex'

type AgentRunMetricsView = {
  durationMs?: number
  modelRequests?: number
  modelInputTokens?: number
  modelOutputTokens?: number
  toolCalls?: number
  successfulToolCalls?: number
  failedToolCalls?: number
  cachedToolCalls?: number
  blockedToolCalls?: number
  contextTokenEstimate?: number
  finalAnswerRetries?: number
}

type AgentPanelId = 'overview' | 'live' | 'failures' | 'knowledge' | 'review' | 'run' | 'context' | 'tree' | 'runtime'

type GlobalPanelId = 'overview' | 'live' | 'failures' | 'knowledge'
type DetailPanelId = 'review' | 'run' | 'context' | 'tree' | 'runtime'

const GLOBAL_PANELS: GlobalPanelId[] = ['overview', 'live', 'failures', 'knowledge']

type ContextSegment = {
  index: number
  role: 'user' | 'assistant' | 'toolResult' | 'event' | 'artifact'
  label: string
  chars: number
  preview: string
}

const AGENT_PANELS: Array<{
  id: AgentPanelId
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'overview', label: '概览', icon: BarChart3 },
  { id: 'live', label: '实时', icon: Radio },
  { id: 'failures', label: '失败', icon: AlertTriangle },
  { id: 'knowledge', label: '知识库', icon: Database },
  { id: 'review', label: '审查', icon: FileDiff },
  { id: 'run', label: '运行', icon: Activity },
  { id: 'context', label: '上下文', icon: Layers },
  { id: 'tree', label: '执行树', icon: GitBranch },
  { id: 'runtime', label: '运行时', icon: ShieldCheck },
]

function parseJson<T>(value?: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function compactText(value?: string | null, maxLength = 120) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function prettyJson(value?: string | null) {
  const parsed = parseJson<unknown>(value)
  if (parsed === null) return value || ''
  return JSON.stringify(parsed, null, 2)
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function parseAgentRunSnapshot(detail: AgentRunDetail): AgentRunSnapshot | null {
  const parsed = parseJson<AgentRunSnapshot>(detail.run.runtimeSnapshotJson)
  return parsed && typeof parsed.status === 'string' ? parsed : null
}

function parseAgentRuntimeSnapshot(detail: AgentRunDetail): AgentRuntimeSnapshot | null {
  const parsed = parseJson<AgentRuntimeSnapshot>(detail.run.runtimeSnapshotJson)
  return parsed && typeof parsed === 'object' && 'skills' in parsed && 'mcp' in parsed && 'tools' in parsed
    ? parsed
    : null
}

function parseEventPayload(event: AgentEventRecord): Record<string, any> {
  return parseJson<Record<string, any>>(event.payloadJson) || {}
}

function agentEventFromRecord(event: AgentEventRecord): AgentEvent {
  const parsedEnvelope = parseJson<AgentEventEnvelope>(event.envelopeJson)
  return {
    id: event.id,
    runId: event.runId,
    sequence: typeof event.seq === 'number' ? event.seq : undefined,
    schemaVersion: event.schemaVersion || undefined,
    spanId: event.spanId || undefined,
    parentId: event.parentId || undefined,
    type: event.type as AgentEvent['type'],
    level: event.level as AgentEvent['level'],
    iteration: typeof event.iteration === 'number' ? event.iteration : undefined,
    payload: parseEventPayload(event),
    timestamp: event.createdAt,
    envelope: parsedEnvelope || undefined,
  }
}

function getEventEnvelope(event: AgentEventRecord): AgentEventEnvelope {
  const parsed = parseJson<AgentEventEnvelope>(event.envelopeJson)
  if (parsed) return parsed
  return buildAgentEventEnvelope(agentEventFromRecord(event))
}

function getRuntimeSnapshot(detail: AgentRunDetail): AgentRuntimeSnapshot | undefined {
  const snapshot = parseAgentRunSnapshot(detail)
  return snapshot?.partSnapshot?.runtimeSnapshot || parseAgentRuntimeSnapshot(detail) || undefined
}

function latestEventByType(detail: AgentRunDetail, type: string): AgentEventRecord | undefined {
  return [...detail.events].reverse().find(event => event.type === type)
}

function getModelThinkingSnapshot(detail: AgentRunDetail) {
  const modelEvent = latestEventByType(detail, 'model.request.started')
  const payload = modelEvent ? parseEventPayload(modelEvent) : {}
  const envelope = modelEvent ? getEventEnvelope(modelEvent) : undefined
  const snapshot = parseAgentRunSnapshot(detail)
  const model = envelope?.model?.model
    || (typeof payload.model === 'string' ? payload.model : undefined)
    || detail.run.model
    || undefined
  const thinkingLevel = envelope?.model?.thinkingLevel
    || (typeof payload.thinkingLevel === 'string' ? payload.thinkingLevel : undefined)
  const thinkingRequestMode = typeof payload.thinkingRequestMode === 'string' ? payload.thinkingRequestMode : undefined
  const thinkingSupported = typeof envelope?.model?.thinkingSupported === 'boolean'
    ? envelope.model.thinkingSupported
    : typeof payload.thinkingSupported === 'boolean'
      ? payload.thinkingSupported
      : undefined

  return {
    model,
    mode: envelope?.model?.mode || (typeof payload.mode === 'string' ? payload.mode : undefined),
    thinkingLevel,
    thinkingRequestMode,
    thinkingSupported,
    messageCount: typeof payload.messageCount === 'number' ? payload.messageCount : undefined,
    toolCount: typeof payload.toolCount === 'number' ? payload.toolCount : undefined,
    inputTokens: typeof payload.inputTokens === 'number'
      ? payload.inputTokens
      : snapshot?.partSnapshot?.telemetry?.inputTokens,
    outputTokens: snapshot?.partSnapshot?.telemetry?.outputTokens,
  }
}

function getEnvelopeAuditRows(detail: AgentRunDetail) {
  const rows = new Map<string, {
    key: string
    label: string
    count: number
    lastStatus?: string
    lastSource?: string
    lastChannel?: string
    lastPhase?: string
    lastAt?: number
  }>()

  for (const event of detail.events) {
    const envelope = getEventEnvelope(event)
    const key = `${envelope.source}:${envelope.channel}:${envelope.type}`
    const current = rows.get(key) || {
      key,
      label: String(envelope.type),
      count: 0,
    }
    rows.set(key, {
      ...current,
      count: current.count + 1,
      lastStatus: envelope.status,
      lastSource: envelope.source,
      lastChannel: envelope.channel,
      lastPhase: envelope.phase,
      lastAt: envelope.timestamp,
    })
  }

  return [...rows.values()]
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
    .slice(0, 14)
}

function formatRef(ref?: VfsRef | null) {
  if (!ref) return ''
  return ref.summary ? `${ref.path} · ${ref.summary}` : ref.path
}

function compactArray(values?: string[], max = 4) {
  const cleaned = (values || []).filter(Boolean)
  if (cleaned.length === 0) return ''
  const preview = cleaned.slice(0, max).join(', ')
  return cleaned.length > max ? `${preview} +${cleaned.length - max}` : preview
}

function formatSkillPermission(skill: SkillRuntimeEntry) {
  const manifest = skill.permissionManifest
  const parts = [
    compactArray(manifest?.capabilities),
    compactArray(manifest?.tools),
    manifest?.filesystem?.length ? `${manifest.filesystem.length} fs` : '',
    manifest?.network?.length ? `${manifest.network.length} net` : '',
    manifest?.requiresConfirmation ? 'confirm' : '',
  ].filter(Boolean)
  return parts.join(' · ') || '-'
}

function formatSkillArtifacts(skill: SkillRuntimeEntry) {
  return skill.artifactSchema?.map(item => item.path ? `${item.type}:${item.path}` : item.type).join(', ') || '-'
}

function getRuntimeSkills(detail: AgentRunDetail): SkillRuntimeEntry[] {
  const runtime = getRuntimeSnapshot(detail)
  if (runtime?.skills.skills.length) {
    return runtime.skills.skills
  }

  const selected = latestEventByType(detail, 'skills.selected')
  if (!selected) return []
  const skillIds = parseEventPayload(selected).skillIds
  if (!Array.isArray(skillIds)) return []
  return skillIds
    .filter((id): id is string => typeof id === 'string')
    .map(id => ({
      id,
      name: id,
      source: 'unknown',
      enabled: true,
      userInvocable: true,
      selected: true,
      allowedTools: [],
      lazyLoad: false,
      scriptCount: 0,
      referenceCount: 0,
      assetCount: 0,
      warnings: [],
    } satisfies SkillRuntimeEntry))
}

function estimateTokensFromChars(chars: number) {
  return Math.max(0, Math.ceil(chars / 4))
}

function formatTokenCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function formatDateTime(timestamp?: number | null) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDuration(ms?: number | null) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes > 0) return `${minutes}m ${restSeconds}s`
  return `${restSeconds}s`
}

function getRunMetrics(run: AgentRunRecord): AgentRunMetricsView {
  return parseJson<AgentRunMetricsView>(run.metricsJson) || {}
}

function getRunDuration(run: AgentRunRecord) {
  const metrics = getRunMetrics(run)
  if (typeof metrics.durationMs === 'number') return metrics.durationMs
  if (run.endedAt && run.startedAt) return Math.max(0, run.endedAt - run.startedAt)
  return Math.max(0, run.updatedAt - run.startedAt)
}

function statusLabel(status: string) {
  switch (status) {
    case 'completed': return '完成'
    case 'running': return '运行中'
    case 'failed': return '失败'
    case 'paused': return '暂停'
    default: return status
  }
}

function statusClass(status: string) {
  if (status === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'running') return 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  if (status === 'failed') return 'border-destructive/20 bg-destructive/10 text-destructive'
  if (status === 'paused') return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-border bg-muted/40 text-muted-foreground'
}

function toolStatusClass(status: string) {
  if (status === 'success') return 'text-emerald-600 dark:text-emerald-300'
  if (status === 'running' || status === 'pending') return 'text-sky-600 dark:text-sky-300'
  if (status === 'error' || status === 'blocked') return 'text-destructive'
  return 'text-muted-foreground'
}

function scopeTitle(id: AgentPanelId) {
  switch (id) {
    case 'overview': return '全局概览'
    case 'live': return '实时运行'
    case 'failures': return '失败聚合'
    case 'knowledge': return '知识库健康'
    case 'review': return '结果审查'
    case 'run': return '运行状态'
    case 'context': return '上下文拼接'
    case 'tree': return '执行树'
    case 'runtime': return '运行时审计'
    default: return id
  }
}

function StatCell({
  label,
  value,
  icon,
}: {
  label: string
  value: string | number
  icon: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function JsonBlock({
  title,
  value,
  initiallyOpen = false,
}: {
  title: string
  value?: string | null
  initiallyOpen?: boolean
}) {
  if (!value) return null
  return (
    <details className="rounded-md border bg-muted/15" open={initiallyOpen}>
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-muted-foreground">{title}</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 pb-2 font-mono text-[11px] leading-5 text-muted-foreground">
        {prettyJson(value)}
      </pre>
    </details>
  )
}

function MetaCell({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/30 px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-foreground/85">{value || '-'}</div>
    </div>
  )
}

function EmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <div className="text-muted-foreground/60">{icon}</div>
      <div>{label}</div>
    </div>
  )
}

function RunListItem({
  run,
  active,
  onSelect,
}: {
  run: AgentRunRecord
  active: boolean
  onSelect: () => void
}) {
  const metrics = getRunMetrics(run)
  const duration = formatDuration(getRunDuration(run))
  const toolSummary = typeof metrics.toolCalls === 'number'
    ? `${metrics.toolCalls} tools`
    : ''

  return (
    <button
      type="button"
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 border-b px-3 py-3 text-left transition-colors hover:bg-muted/40',
        active && 'bg-muted/60',
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{compactText(run.userGoal, 72) || 'Agent run'}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{formatDateTime(run.startedAt)}</span>
            {duration ? <span className="shrink-0">· {duration}</span> : null}
          </div>
        </div>
        <Badge variant="outline" className={cn('shrink-0 px-1.5 py-0 text-[10px]', statusClass(run.status))}>
          {statusLabel(run.status)}
        </Badge>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate rounded bg-muted/60 px-1.5 py-0.5">{run.route}</span>
        {toolSummary ? <span className="truncate">{toolSummary}</span> : null}
        {run.model ? <span className="truncate">{run.model}</span> : null}
      </div>
    </button>
  )
}

function RunsSidebar({
  runs,
  selectedRunId,
  loading,
  onSelect,
  onToggleCollapse,
}: {
  runs: AgentRunRecord[]
  selectedRunId: string | null
  loading: boolean
  onSelect: (runId: string) => void
  onToggleCollapse: () => void
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'running' | 'failed'>('all')

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase()
    return runs.filter((run) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      if (!lower) return true
      return (
        run.userGoal.toLowerCase().includes(lower) ||
        run.id.toLowerCase().includes(lower) ||
        (run.model || '').toLowerCase().includes(lower) ||
        run.route.toLowerCase().includes(lower)
      )
    })
  }, [runs, query, statusFilter])

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r bg-muted/10">
      <div className="flex h-11 shrink-0 items-center justify-between gap-1 whitespace-nowrap border-b px-3">
        <div className="flex min-w-0 shrink items-center gap-2 whitespace-nowrap text-sm font-medium">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">运行历史</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onToggleCollapse}
            title="折叠侧栏"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-b px-3 py-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索目标 / 路由 / 模型"
          className="h-8 w-full shrink-0 whitespace-nowrap rounded-md border bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex flex-nowrap items-center gap-1 overflow-x-auto">
          {(['all', 'completed', 'running', 'failed'] as const).map((s) => {
            const labels: Record<typeof s, string> = {
              all: '全部',
              completed: '完成',
              running: '运行',
              failed: '失败',
            }
            const active = statusFilter === s
            return (
              <button
                key={s}
                type="button"
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60',
                )}
                onClick={() => setStatusFilter(s)}
              >
                {labels[s]}
              </button>
            )
          })}
        </div>
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        {runs.length === 0 && !loading ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无 Agent 运行记录</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">无匹配的运行记录</div>
        ) : (
          filtered.map(run => (
            <RunListItem
              key={run.id}
              run={run}
              active={selectedRunId === run.id}
              onSelect={() => onSelect(run.id)}
            />
          ))
        )}
      </ScrollArea>
    </aside>
  )
}

function PanelTabs({
  activePanel,
  setActivePanel,
}: {
  activePanel: AgentPanelId
  setActivePanel: (panel: AgentPanelId) => void
}) {
  return (
    <div className="shrink-0 border-b bg-background">
      <div className="flex min-w-0 overflow-x-auto" role="tablist">
        {AGENT_PANELS.map(panel => {
          const Icon = panel.icon
          const active = activePanel === panel.id
          return (
            <button
              key={panel.id}
              type="button"
              role="tab"
              className={cn(
                'flex h-11 shrink-0 items-center gap-2 px-4 text-sm transition-colors hover:bg-muted/50',
                active ? 'bg-muted/70 text-foreground' : 'text-muted-foreground',
              )}
              aria-selected={active}
              onClick={() => setActivePanel(panel.id)}
            >
              <Icon className="size-4" />
              {panel.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WorkspaceHeader({
  detail,
  activePanel,
}: {
  detail: AgentRunDetail
  activePanel: AgentPanelId
}) {
  const { run } = detail
  return (
    <header className="shrink-0 border-b bg-muted/10 px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', statusClass(run.status))}>
              {statusLabel(run.status)}
            </Badge>
            <span className="truncate font-mono text-xs text-muted-foreground">{run.id}</span>
          </div>
          <div className="mt-2 truncate text-sm font-semibold">{compactText(run.userGoal, 140) || 'Agent run'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDateTime(run.startedAt)}</span>
            <span>route={run.route}</span>
            {run.model ? <span>{run.model}</span> : null}
            <span>{scopeTitle(activePanel)}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

function ReviewPanel({
  detail,
}: {
  detail: AgentRunDetail
}) {
  const [scope, setScope] = useState<'artifacts' | 'approvals'>('artifacts')
  const failedTools = detail.toolCalls.filter(call => call.success === 0 || call.status === 'error' || call.status === 'blocked')
  const finalText = detail.run.finalAnswer || detail.run.error || ''

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b">
        {[
          ['artifacts', '产物'],
          ['approvals', '审批'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={cn(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50',
              scope === key ? 'bg-muted/70 text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => setScope(key as typeof scope)}
          >
            {label}
          </button>
        ))}
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        {scope === 'artifacts' ? (
          <div className="space-y-3 p-4">
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileDiff className="size-4 text-muted-foreground" />
                结果摘要
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                {compactText(finalText, 900) || '暂无最终输出'}
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <StatCell label="产物" value={detail.artifacts.length} icon={<FileText className="size-3.5" />} />
              <StatCell label="失败工具" value={failedTools.length} icon={<AlertCircle className="size-3.5" />} />
            </div>
            {detail.artifacts.length === 0 ? (
              <EmptyState icon={<FileText className="size-5" />} label="暂无产物" />
            ) : (
              <div className="divide-y rounded-md border bg-background">
                {detail.artifacts.map(artifact => (
                  <ArtifactRow key={artifact.id} artifact={artifact} />
                ))}
              </div>
            )}
          </div>
        ) : null}
        {scope === 'approvals' ? (
          <div className="space-y-3 p-4">
            {failedTools.length > 0 ? (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="size-4" />
                  失败与阻塞
                </div>
                <div className="mt-2 space-y-2">
                  {failedTools.map(call => (
                    <ToolCallMiniRow key={call.id} call={call} />
                  ))}
                </div>
              </div>
            ) : null}
            {detail.approvals.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="size-5" />} label="暂无审批记录" />
            ) : (
              <div className="space-y-2">
                {detail.approvals.map(approval => (
                  <ApprovalCard key={approval.id} approval={approval} />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </ScrollArea>
    </section>
  )
}

function RunPanel({ detail }: { detail: AgentRunDetail }) {
  const { run } = detail
  const metrics = getRunMetrics(run)
  const failedTools = detail.toolCalls.filter(call => call.success === 0 || call.status === 'error' || call.status === 'blocked').length
  const contextTokens = metrics.contextTokenEstimate
    ?? estimateTokensFromChars([
      run.userGoal,
      run.finalAnswer,
      ...detail.steps.map(step => `${step.thought || ''} ${step.observationSummary || ''}`),
    ].join('\n').length)

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="space-y-3 p-4">
        <div className={cn(
          'rounded-md border p-3',
          run.status === 'running'
            ? 'border-sky-500/25 bg-sky-500/[0.06]'
            : run.status === 'failed'
              ? 'border-destructive/25 bg-destructive/[0.06]'
              : 'bg-background',
        )}>
          <div className="flex items-center gap-3">
            <div className={cn('flex size-10 items-center justify-center rounded-md bg-muted', run.status === 'running' && 'bg-sky-500/15')}>
              <Activity className={cn('size-5', run.status === 'running' ? 'animate-pulse text-sky-600' : 'text-muted-foreground')} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{statusLabel(run.status)}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {run.model ? <span className="font-mono">{run.model}</span> : null}
                <span>{formatDuration(getRunDuration(run)) || '0ms'}</span>
                {run.conversationId ? <span>conversation={run.conversationId}</span> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <StatCell label="耗时" value={formatDuration(getRunDuration(run)) || '-'} icon={<Clock3 className="size-3.5" />} />
          <StatCell label="步骤" value={detail.steps.length} icon={<ListChecks className="size-3.5" />} />
          <StatCell label="工具" value={metrics.toolCalls ?? detail.toolCalls.length} icon={<Wrench className="size-3.5" />} />
          <StatCell label="失败" value={metrics.failedToolCalls ?? failedTools} icon={<AlertCircle className="size-3.5" />} />
          <StatCell label="上下文" value={`${formatTokenCount(contextTokens)} tok`} icon={<Database className="size-3.5" />} />
        </div>
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="size-4 text-muted-foreground" />
              步骤回放
            </div>
            <span className="text-xs text-muted-foreground">{detail.steps.length} 步</span>
          </div>
          {detail.steps.length === 0 ? (
            <EmptyState icon={<ListChecks className="size-5" />} label="暂无步骤记录" />
          ) : (
            <div className="divide-y">
              {detail.steps.map(step => (
                <StepReplayRow key={step.id} step={step} />
              ))}
            </div>
          )}
        </section>
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Wrench className="size-4 text-muted-foreground" />
              工具时间线
            </div>
            <span className="text-xs text-muted-foreground">{detail.toolCalls.length} calls</span>
          </div>
          {detail.toolCalls.length === 0 ? (
            <EmptyState icon={<Wrench className="size-5" />} label="暂无工具调用" />
          ) : (
            <div className="divide-y">
              {detail.toolCalls.map(call => (
                <ToolCallRow key={call.id} call={call} />
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function StepReplayRow({ step }: { step: AgentStepRecord }) {
  const [open, setOpen] = useState(false)
  const duration = step.endedAt && step.startedAt ? step.endedAt - step.startedAt : null
  return (
    <div>
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
        onClick={() => setOpen(v => !v)}
      >
        {open
          ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <Badge variant="secondary" className="mt-0.5 shrink-0 px-1.5 py-0 text-[10px]">#{step.stepIndex}</Badge>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{step.title || `Step ${step.stepIndex}`}</span>
            {step.status ? (
              <Badge variant="outline" className={cn('shrink-0 px-1.5 py-0 text-[10px]', statusClass(step.status))}>{statusLabel(step.status)}</Badge>
            ) : null}
          </div>
          {step.thought ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.thought}</p>
          ) : null}
        </div>
        {duration != null ? (
          <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(duration)}</span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t bg-muted/20 px-3 py-2 text-xs leading-5">
          {step.thought ? (
            <div>
              <div className="font-medium text-muted-foreground">思考</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-foreground/80">{step.thought}</div>
            </div>
          ) : null}
          {step.observationSummary ? (
            <div>
              <div className="font-medium text-muted-foreground">观察</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-foreground/80">{step.observationSummary}</div>
            </div>
          ) : null}
          {!step.thought && !step.observationSummary ? (
            <div className="text-muted-foreground">该步骤无详细记录</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ContextPanel({ detail }: { detail: AgentRunDetail }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const segments = useMemo(() => buildContextSegments(detail), [detail])
  const estimatedChars = segments.reduce((sum, segment) => sum + segment.chars, 0)
  const estimatedTokens = estimateTokensFromChars(estimatedChars)
  const metrics = getRunMetrics(detail.run)
  const contextWindow = Math.max(1000000, metrics.contextTokenEstimate ? metrics.contextTokenEstimate * 20 : 1000000)
  const contextPct = Math.min(100, (estimatedTokens / contextWindow) * 100)
  const maxChars = Math.max(1, ...segments.map(segment => segment.chars))

  const toggle = (index: number) => {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b bg-background p-4">
        <div className="grid gap-2 md:grid-cols-2">
          <StatCell label="消息条数" value={segments.length} icon={<MessageSquare className="size-3.5" />} />
          <StatCell label="约 Token" value={`${formatTokenCount(estimatedTokens)} tok`} icon={<Database className="size-3.5" />} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>占模型窗口</span>
            <span className="tabular-nums">{formatTokenCount(estimatedTokens)} / {formatTokenCount(contextWindow)} ({contextPct.toFixed(1)}%)</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', contextPct > 85 ? 'bg-amber-500' : 'bg-sky-500')}
              style={{ width: `${contextPct}%` }}
            />
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          下列片段按本次 Agent 运行的上下文顺序拼接；条块宽度表示相对体积，默认只显示摘要。
        </p>
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="space-y-2 p-3">
          {segments.map(segment => {
            const open = expanded.has(segment.index)
            const widthPct = Math.max(8, (segment.chars / maxChars) * 100)
            const meta = segmentRoleMeta(segment.role)
            return (
              <div key={segment.index} className="overflow-hidden rounded-md border bg-background">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => toggle(segment.index)}
                >
                  {open ? <ChevronDown className="mt-0.5 size-4 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className={cn('px-1.5 py-0 text-[10px]', meta.badge)}>
                        {meta.label} · {segment.label}
                      </Badge>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        #{segment.index + 1} · {segment.chars.toLocaleString()} 字 · ~{formatTokenCount(estimateTokensFromChars(segment.chars))} tok
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${widthPct}%` }} />
                    </div>
                    {!open ? (
                      <p className="mt-2 line-clamp-2 font-mono text-xs leading-5 text-muted-foreground">
                        {segment.preview}
                      </p>
                    ) : null}
                  </div>
                </button>
                {open ? (
                  <pre className="max-h-56 overflow-auto border-t bg-muted/20 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                    {segment.preview || '(空)'}
                  </pre>
                ) : null}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </section>
  )
}

function TreePanel({ detail }: { detail: AgentRunDetail }) {
  const nodes = useMemo(() => buildExecutionTree(detail), [detail])
  const snapshot = useMemo(() => parseAgentRunSnapshot(detail), [detail])
  const sessionTree = snapshot?.sessionTree

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col text-sm">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium">
            <GitBranch className="size-4 text-muted-foreground" />
            会话执行树
          </div>
          <span className="text-xs text-muted-foreground">{nodes.length} nodes</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          以运行记录为根节点，向下展开步骤、工具调用与关键事件，模拟 pi-app 的 Tree 面板。
        </p>
        {sessionTree ? (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <MetaCell label="Root" value={sessionTree.rootRunId} />
            <MetaCell label="Branch" value={sessionTree.branchId} />
            <MetaCell label="Entries" value={sessionTree.entryCount} />
            <MetaCell label="Compactions" value={sessionTree.compactionRefs.length} />
          </div>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="p-3">
          <ul className="space-y-1" role="tree">
            {nodes.map(node => (
              <li key={node.id} role="treeitem" aria-level={node.depth + 1} aria-selected={node.current === true}>
                <div
                  className={cn(
                    'flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40',
                    node.current && 'bg-primary/5',
                  )}
                  style={{ paddingLeft: `${8 + node.depth * 18}px` }}
                >
                  <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{node.title}</span>
                      {node.badge ? <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">{node.badge}</Badge> : null}
                    </div>
                    {node.meta ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{node.meta}</div> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </ScrollArea>
    </section>
  )
}

function RuntimePanel({ detail }: { detail: AgentRunDetail }) {
  const snapshot = useMemo(() => parseAgentRunSnapshot(detail), [detail])
  const runtimeSnapshot = useMemo(() => getRuntimeSnapshot(detail), [detail])
  const thinking = useMemo(() => getModelThinkingSnapshot(detail), [detail])
  const envelopeRows = useMemo(() => getEnvelopeAuditRows(detail), [detail])
  const skills = useMemo(() => getRuntimeSkills(detail), [detail])
  const selectedSkills = skills.filter(skill => skill.selected)
  const visibleTools = runtimeSnapshot?.visibleToolNames || []
  const blockedTools = runtimeSnapshot?.tools.blocked || []
  const compactionRefs = snapshot?.sessionTree?.compactionRefs || []

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="space-y-3 p-4" data-agent-runtime-console="rich">
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Zap className="size-4 text-muted-foreground" />
              Think Mode
            </div>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {thinking.thinkingSupported === false ? 'provider-default' : thinking.thinkingLevel || 'unknown'}
            </Badge>
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-4">
            <MetaCell label="Model" value={thinking.model || '-'} />
            <MetaCell label="Level" value={thinking.thinkingLevel || '-'} />
            <MetaCell label="Request" value={thinking.thinkingRequestMode || thinking.mode || '-'} />
            <MetaCell label="Input" value={thinking.inputTokens ? `${formatTokenCount(thinking.inputTokens)} tok` : '-'} />
          </div>
        </section>

        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="size-4 text-muted-foreground" />
              Session Binding
            </div>
            <span className="text-xs text-muted-foreground">{snapshot?.sessionTree?.entryCount ?? 0} entries</span>
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-3">
            <MetaCell label="Root run" value={snapshot?.rootRunId || snapshot?.runId || detail.run.id} />
            <MetaCell label="Parent run" value={snapshot?.parentRunId || '-'} />
            <MetaCell label="Branch" value={snapshot?.branchId || '-'} />
            <MetaCell label="Conversation" value={snapshot?.chat?.conversationId ?? detail.run.conversationId ?? '-'} />
            <MetaCell label="Assistant chat" value={snapshot?.chat?.assistantChatId ?? '-'} />
            <MetaCell label="Last event" value={snapshot?.sessionTree?.lastEventSequence ?? '-'} />
          </div>
          {compactionRefs.length > 0 ? (
            <div className="border-t px-3 py-2">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Compaction refs</div>
              <div className="space-y-1">
                {compactionRefs.slice(-5).map(ref => (
                  <div key={ref.uri} className="truncate rounded bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground" title={ref.uri}>
                    {formatRef(ref)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radio className="size-4 text-muted-foreground" />
              SSE / Event Envelope
            </div>
            <span className="text-xs text-muted-foreground">{detail.events.length} events</span>
          </div>
          {envelopeRows.length === 0 ? (
            <EmptyState icon={<Radio className="size-5" />} label="暂无事件信封" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="border-b bg-muted/20 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Channel</th>
                    <th className="px-3 py-2 text-left font-medium">Phase</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {envelopeRows.map(row => (
                    <tr key={row.key}>
                      <td className="max-w-[220px] truncate px-3 py-2 font-mono">{row.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.lastSource || '-'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.lastChannel || '-'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.lastPhase || '-'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.lastStatus || '-'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Skills Governance
            </div>
            <span className="text-xs text-muted-foreground">{selectedSkills.length} selected · {visibleTools.length} tools</span>
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-4">
            <StatCell label="选中 Skills" value={selectedSkills.length} icon={<Layers className="size-3.5" />} />
            <StatCell label="Lazy Load" value={skills.filter(skill => skill.lazyLoad).length} icon={<Clock3 className="size-3.5" />} />
            <StatCell label="可见工具" value={visibleTools.length} icon={<Wrench className="size-3.5" />} />
            <StatCell label="阻塞工具" value={blockedTools.length} icon={<AlertTriangle className="size-3.5" />} />
          </div>
          {skills.length === 0 ? (
            <div className="border-t px-3 py-4 text-sm text-muted-foreground">暂无 Skill 运行时信息</div>
          ) : (
            <div className="overflow-x-auto border-t">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="border-b bg-muted/20 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Skill</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Load</th>
                    <th className="px-3 py-2 text-left font-medium">Permissions</th>
                    <th className="px-3 py-2 text-left font-medium">Artifacts</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {skills.slice(0, 24).map(skill => (
                    <tr key={skill.id} className={skill.selected ? 'bg-primary/[0.025]' : undefined}>
                      <td className="max-w-[220px] px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">{skill.name}</span>
                          {skill.selected ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">selected</Badge> : null}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{skill.id}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{skill.source}</td>
                      <td className="px-3 py-2 text-muted-foreground">{skill.lazyLoad ? 'lazy' : 'eager'}</td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground" title={safeStringify(skill.permissionManifest)}>
                        {formatSkillPermission(skill)}
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground" title={safeStringify(skill.artifactSchema)}>
                        {formatSkillArtifacts(skill)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function ArtifactRow({ artifact }: { artifact: AgentArtifactRecord }) {
  return (
    <div className="flex min-w-0 items-start gap-3 px-3 py-2.5">
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{artifact.path}</span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{artifact.kind}</Badge>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{artifact.uri}</div>
        {artifact.summary ? <div className="mt-1 text-xs text-muted-foreground">{artifact.summary}</div> : null}
      </div>
    </div>
  )
}

function ApprovalCard({ approval }: { approval: AgentApprovalRecord }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{approval.toolName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {approval.risk ? <span>risk={approval.risk}</span> : null}
            {approval.approvalScope ? <span>scope={approval.approvalScope}</span> : null}
            <span>{formatDateTime(approval.decidedAt || approval.createdAt)}</span>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">{approval.status}</Badge>
      </div>
      {approval.reason ? <div className="mt-2 text-xs text-muted-foreground">{approval.reason}</div> : null}
      <JsonBlock title="参数" value={approval.paramsJson} />
    </div>
  )
}

function ToolCallMiniRow({ call }: { call: AgentToolCallRecord }) {
  return (
    <div className="rounded-md bg-background px-2 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Wrench className={cn('size-3.5 shrink-0', toolStatusClass(call.status))} />
        <span className="truncate font-medium">{call.toolName}</span>
        <span className={cn('shrink-0', toolStatusClass(call.status))}>{call.status}</span>
      </div>
      {call.error || call.message ? (
        <div className="mt-1 break-words text-muted-foreground">{compactText(call.error || call.message, 220)}</div>
      ) : null}
    </div>
  )
}

function ToolCallRow({ call }: { call: AgentToolCallRecord }) {
  return (
    <div className="grid min-w-0 gap-3 px-3 py-3 xl:grid-cols-[200px_1fr]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className={cn('size-4 shrink-0', toolStatusClass(call.status))} />
          <span className="truncate text-sm font-medium">{call.toolName}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span className={toolStatusClass(call.status)}>{call.status}</span>
          {call.durationMs ? <span>{formatDuration(call.durationMs)}</span> : null}
          {call.iteration ? <span>iter {call.iteration}</span> : null}
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        {call.message || call.error ? (
          <div className={cn('rounded-md px-2 py-1.5 text-xs leading-5', call.error ? 'bg-destructive/10 text-destructive' : 'bg-muted/40 text-muted-foreground')}>
            {compactText(call.error || call.message, 320)}
          </div>
        ) : null}
        <JsonBlock title="参数" value={call.paramsJson} />
        <JsonBlock title="结果" value={call.resultJson} />
      </div>
    </div>
  )
}

function segmentRoleMeta(role: ContextSegment['role']) {
  const meta: Record<ContextSegment['role'], { label: string; badge: string; bar: string }> = {
    user: { label: '用户', badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', bar: 'bg-sky-500/70' },
    assistant: { label: '助手', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500/70' },
    toolResult: { label: '工具结果', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', bar: 'bg-amber-500/70' },
    event: { label: '事件', badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', bar: 'bg-violet-500/70' },
    artifact: { label: '产物', badge: 'bg-muted text-muted-foreground', bar: 'bg-muted-foreground/50' },
  }
  return meta[role]
}

function addContextSegment(
  segments: ContextSegment[],
  role: ContextSegment['role'],
  label: string,
  preview?: string | null,
) {
  const text = preview || ''
  if (!text.trim()) return
  segments.push({
    index: segments.length,
    role,
    label,
    chars: text.length,
    preview: text,
  })
}

function buildContextSegments(detail: AgentRunDetail): ContextSegment[] {
  const segments: ContextSegment[] = []
  addContextSegment(segments, 'user', '任务', detail.run.userGoal)
  addContextSegment(segments, 'assistant', '最终回答', detail.run.finalAnswer || detail.run.error)
  for (const step of detail.steps) {
    addContextSegment(segments, 'assistant', `Step ${step.stepIndex} thought`, step.thought)
    addContextSegment(segments, 'assistant', `Step ${step.stepIndex} observation`, step.observationSummary)
  }
  for (const call of detail.toolCalls.slice(0, 80)) {
    addContextSegment(segments, 'toolResult', `${call.toolName} params`, call.paramsJson ? prettyJson(call.paramsJson) : '')
    addContextSegment(segments, 'toolResult', `${call.toolName} result`, call.resultJson ? compactText(prettyJson(call.resultJson), 3000) : call.message || call.error || '')
  }
  for (const artifact of detail.artifacts) {
    addContextSegment(segments, 'artifact', artifact.kind, [artifact.path, artifact.summary].filter(Boolean).join('\n'))
  }
  for (const event of detail.events.slice(-20)) {
    addContextSegment(segments, 'event', event.type, event.payloadJson ? compactText(prettyJson(event.payloadJson), 1600) : '')
  }
  return segments
}

type ExecutionTreeNode = {
  id: string
  depth: number
  title: string
  meta?: string
  badge?: string
  current?: boolean
}

function createExecutionTreeNodePusher(nodes: ExecutionTreeNode[]) {
  const seenIds = new Map<string, number>()

  return (node: ExecutionTreeNode) => {
    const baseId = node.id
    const seenCount = seenIds.get(baseId) || 0
    seenIds.set(baseId, seenCount + 1)
    nodes.push({
      ...node,
      id: seenCount === 0 ? baseId : `${baseId}#${seenCount + 1}`,
    })
  }
}

function buildExecutionTree(detail: AgentRunDetail) {
  const nodes: ExecutionTreeNode[] = []
  const pushNode = createExecutionTreeNodePusher(nodes)

  pushNode({
    id: `run:${detail.run.id}`,
    depth: 0,
    title: compactText(detail.run.userGoal, 100) || 'Agent run',
    meta: `${statusLabel(detail.run.status)} · ${formatDateTime(detail.run.startedAt)}`,
    badge: detail.run.route,
    current: true,
  })
  for (const step of detail.steps) {
    pushNode({
      id: `step:${step.id}`,
      depth: 1,
      title: step.title || `Step ${step.stepIndex}`,
      meta: [formatDateTime(step.startedAt), formatDuration(step.endedAt && step.startedAt ? step.endedAt - step.startedAt : undefined)].filter(Boolean).join(' · '),
      badge: step.status,
    })
    for (const call of detail.toolCalls.filter(item => item.iteration === step.stepIndex)) {
      pushNode({
        id: `step-tool:${step.stepIndex}:${call.id}`,
        depth: 2,
        title: call.toolName,
        meta: compactText(call.error || call.message || call.dataRef || '', 120),
        badge: call.status,
      })
    }
  }
  const stepIterations = new Set(detail.steps.map(step => step.stepIndex))
  for (const call of detail.toolCalls.filter(item => !item.iteration || !stepIterations.has(item.iteration))) {
    pushNode({
      id: `tool:${call.id}`,
      depth: 1,
      title: call.toolName,
      meta: compactText(call.error || call.message || call.dataRef || '', 120),
      badge: call.status,
    })
  }
  detail.events.slice(-40).forEach((event, index) => {
    pushNode({
      id: `event:${event.id || event.seq || event.createdAt || index}`,
      depth: 1,
      title: event.type,
      meta: [event.seq !== null && event.seq !== undefined ? `seq ${event.seq}` : '', event.iteration ? `iter ${event.iteration}` : '', formatDateTime(event.createdAt)].filter(Boolean).join(' · '),
      badge: event.level || 'event',
    })
  })
  return nodes.slice(0, 180)
}

/* ===================== 全局面板：Overview / Live / Failures ===================== */

function aggregateRunStats(runs: AgentRunRecord[]) {
  const total = runs.length
  let completed = 0
  let failed = 0
  let running = 0
  let paused = 0
  let inputTokens = 0
  let outputTokens = 0
  let modelRequests = 0
  let toolCalls = 0
  let successfulToolCalls = 0
  let failedToolCalls = 0
  let cachedToolCalls = 0
  let blockedToolCalls = 0
  let totalDurationMs = 0
  let durationCount = 0
  const modelCounts = new Map<string, number>()
  const routeCounts = new Map<string, number>()
  const durations: number[] = []

  for (const run of runs) {
    if (run.status === 'completed') completed += 1
    else if (run.status === 'failed') failed += 1
    else if (run.status === 'running') running += 1
    else if (run.status === 'paused') paused += 1

    const metrics = parseJson<AgentRunMetricsView>(run.metricsJson) || {}
    inputTokens += metrics.modelInputTokens || 0
    outputTokens += metrics.modelOutputTokens || 0
    modelRequests += metrics.modelRequests || 0
    toolCalls += metrics.toolCalls || 0
    successfulToolCalls += metrics.successfulToolCalls || 0
    failedToolCalls += metrics.failedToolCalls || 0
    cachedToolCalls += metrics.cachedToolCalls || 0
    blockedToolCalls += metrics.blockedToolCalls || 0

    const dur = getRunDuration(run)
    if (dur > 0) {
      totalDurationMs += dur
      durationCount += 1
      durations.push(dur)
    }

    if (run.model) modelCounts.set(run.model, (modelCounts.get(run.model) || 0) + 1)
    routeCounts.set(run.route, (routeCounts.get(run.route) || 0) + 1)
  }

  const successRate = total > 0 ? completed / total : 0
  const avgDurationMs = durationCount > 0 ? totalDurationMs / durationCount : 0
  const sortedDurations = durations.sort((a, b) => a - b)
  const medianDurationMs = sortedDurations.length > 0
    ? sortedDurations[Math.floor(sortedDurations.length / 2)]
    : 0
  const finished = completed + failed
  const toolSuccessRate = toolCalls > 0 ? successfulToolCalls / toolCalls : 0

  return {
    total, completed, failed, running, paused,
    inputTokens, outputTokens, modelRequests,
    toolCalls, successfulToolCalls, failedToolCalls, cachedToolCalls, blockedToolCalls,
    successRate, avgDurationMs, medianDurationMs,
    finished, toolSuccessRate,
    modelCounts, routeCounts,
  }
}

function OverviewPanel({ runs }: { runs: AgentRunRecord[] }) {
  const stats = useMemo(() => aggregateRunStats(runs), [runs])
  const toolFailureRate = stats.toolCalls > 0 ? 1 - stats.toolSuccessRate : 0
  const modelEntries = useMemo(
    () => [...stats.modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    [stats.modelCounts],
  )
  const routeEntries = useMemo(
    () => [...stats.routeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    [stats.routeCounts],
  )

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCell label="总运行数" value={stats.total} icon={<Activity className="size-3.5" />} />
          <StatCell label="成功率" value={`${(stats.successRate * 100).toFixed(0)}%`} icon={<BarChart3 className="size-3.5" />} />
          <StatCell label="平均耗时" value={formatDuration(stats.avgDurationMs) || '-'} icon={<Clock3 className="size-3.5" />} />
          <StatCell label="中位耗时" value={formatDuration(stats.medianDurationMs) || '-'} icon={<Clock3 className="size-3.5" />} />
        </div>

        <section className="rounded-md border bg-background">
          <div className="border-b px-3 py-2 text-sm font-medium">运行状态分布</div>
          <div className="space-y-2 p-3">
            <DistributionBar label="完成" value={stats.completed} total={stats.total} className="bg-emerald-500/70" />
            <DistributionBar label="失败" value={stats.failed} total={stats.total} className="bg-destructive/70" />
            <DistributionBar label="运行中" value={stats.running} total={stats.total} className="bg-sky-500/70" />
            <DistributionBar label="暂停" value={stats.paused} total={stats.total} className="bg-amber-500/70" />
          </div>
        </section>

        <div className="grid gap-2 lg:grid-cols-2">
          <section className="rounded-md border bg-background">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
              <Zap className="size-4 text-muted-foreground" />
              Token 与请求
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 text-xs">
              <StatCell label="输入 Token" value={formatTokenCount(stats.inputTokens)} icon={<Database className="size-3.5" />} />
              <StatCell label="输出 Token" value={formatTokenCount(stats.outputTokens)} icon={<Database className="size-3.5" />} />
              <StatCell label="模型请求" value={formatTokenCount(stats.modelRequests)} icon={<MessageSquare className="size-3.5" />} />
              <StatCell label="总 Token" value={formatTokenCount(stats.inputTokens + stats.outputTokens)} icon={<Database className="size-3.5" />} />
            </div>
          </section>
          <section className="rounded-md border bg-background">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
              <Wrench className="size-4 text-muted-foreground" />
              工具调用
            </div>
            <div className="space-y-2 p-3">
              <DistributionBar label="成功" value={stats.successfulToolCalls} total={stats.toolCalls} className="bg-emerald-500/70" />
              <DistributionBar label="失败" value={stats.failedToolCalls} total={stats.toolCalls} className="bg-destructive/70" />
              <DistributionBar label="缓存命中" value={stats.cachedToolCalls} total={stats.toolCalls} className="bg-violet-500/70" />
              <DistributionBar label="被阻塞" value={stats.blockedToolCalls} total={stats.toolCalls} className="bg-amber-500/70" />
              <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                <span>工具成功率</span>
                <span className="tabular-nums">{(stats.toolSuccessRate * 100).toFixed(0)}%（失败率 {(toolFailureRate * 100).toFixed(1)}%）</span>
              </div>
            </div>
          </section>
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <section className="rounded-md border bg-background">
            <div className="border-b px-3 py-2 text-sm font-medium">模型分布</div>
            <div className="space-y-2 p-3">
              {modelEntries.length === 0 ? (
                <div className="text-xs text-muted-foreground">暂无数据</div>
              ) : modelEntries.map(([model, count]) => (
                <DistributionBar key={model} label={model} value={count} total={stats.total} className="bg-primary/60" compact />
              ))}
            </div>
          </section>
          <section className="rounded-md border bg-background">
            <div className="border-b px-3 py-2 text-sm font-medium">路由分布</div>
            <div className="space-y-2 p-3">
              {routeEntries.length === 0 ? (
                <div className="text-xs text-muted-foreground">暂无数据</div>
              ) : routeEntries.map(([route, count]) => (
                <DistributionBar key={route} label={route} value={count} total={stats.total} className="bg-sky-500/60" compact />
              ))}
            </div>
          </section>
        </div>
      </div>
    </ScrollArea>
  )
}

function DistributionBar({
  label,
  value,
  total,
  className,
  compact = false,
}: {
  label: string
  value: number
  total: number
  className: string
  compact?: boolean
}) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className={compact ? 'flex items-center gap-2' : ''}>
      <div className="flex items-center justify-between text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 tabular-nums">{value}（{pct.toFixed(0)}%）</span>
      </div>
      <div className={cn('mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted', compact && 'ml-3 mt-0 flex-1')}>
        <div className={cn('h-full rounded-full transition-all', className)} style={{ width: `${Math.max(pct > 0 ? 4 : 0, pct)}%` }} />
      </div>
    </div>
  )
}

function LivePanel({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  runs: AgentRunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}) {
  const agentState = useChatStore((s) => s.agentState)
  const [tick, setTick] = useState(0)

  // 轻量轮询：面板激活时每 4s 刷新运行列表状态
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 4000)
    return () => clearInterval(timer)
  }, [])
  // tick 仅用于触发 elapsed 重算
  void tick

  const dbRunning = runs.filter((r) => r.status === 'running')
  const isActive = agentState.isRunning
  const iterationPct = agentState.maxIterations > 0
    ? Math.min(100, (agentState.currentIteration / agentState.maxIterations) * 100)
    : 0
  const stepElapsed = agentState.currentStepStartTime ? Date.now() - agentState.currentStepStartTime : null
  const recentTools = useMemo(
    () => [...agentState.toolCalls].slice(-6).reverse(),
    [agentState.toolCalls],
  )
  const recentEvents = useMemo(
    () => [...agentState.agentEvents].slice(-8).reverse(),
    [agentState.agentEvents],
  )

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="space-y-4 p-4">
        {/* 活跃 Agent 实时状态 */}
        <section className={cn(
          'rounded-md border p-3',
          isActive ? 'border-sky-500/25 bg-sky-500/[0.05]' : 'bg-background',
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className={cn('flex size-8 items-center justify-center rounded-md', isActive ? 'bg-sky-500/15' : 'bg-muted')}>
                {isActive
                  ? <Loader2 className="size-4 animate-spin text-sky-600" />
                  : <Radio className="size-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{isActive ? 'Agent 运行中' : '当前无活跃运行'}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {agentState.agentRunId || (isActive ? '运行中' : '空闲')}
                </div>
              </div>
            </div>
            {isActive && agentState.currentStepStartTime ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">已运行 {formatDuration(stepElapsed)}</span>
            ) : null}
          </div>

          {isActive ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>迭代进度</span>
                  <span className="tabular-nums">{agentState.currentIteration} / {agentState.maxIterations}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${iterationPct}%` }} />
                </div>
              </div>

              {agentState.currentThought ? (
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">当前思考</div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5">{agentState.currentThought}</p>
                </div>
              ) : null}

              {agentState.pendingConfirmation ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span className="truncate">等待确认：{agentState.pendingConfirmation.toolName.replace(/_/g, ' ')}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* 实时工具调用 */}
        {isActive && recentTools.length > 0 ? (
          <section className="rounded-md border bg-background">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2"><Wrench className="size-4 text-muted-foreground" />实时工具</span>
              <span className="text-xs text-muted-foreground">最近 {recentTools.length}</span>
            </div>
            <div className="divide-y">
              {recentTools.map((tc) => (
                <div key={tc.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                  <Wrench className={cn('size-3.5 shrink-0', toolStatusClass(tc.status))} />
                  <span className="truncate text-sm">{tc.toolName.replace(/_/g, ' ')}</span>
                  <span className={cn('shrink-0 text-xs', toolStatusClass(tc.status))}>{tc.status}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 实时事件流 */}
        {isActive && recentEvents.length > 0 ? (
          <section className="rounded-md border bg-background">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2"><Radio className="size-4 text-muted-foreground" />事件流</span>
            </div>
            <div className="divide-y">
              {recentEvents.map((ev, i) => (
                <div key={`${ev.type}-${i}`} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{ev.type}</span>
                  <span className="truncate text-muted-foreground">{compactText(typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload ?? ''), 120)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* DB 中处于 running 状态的记录（活跃探测 / 僵尸检测） */}
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
            <span>数据库中的运行中记录</span>
            <span className="text-xs text-muted-foreground">{dbRunning.length}</span>
          </div>
          {dbRunning.length === 0 ? (
            <EmptyState icon={<Activity className="size-5" />} label="暂无运行中的记录" />
          ) : (
            <div className="divide-y">
              {dbRunning.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-muted/40',
                    selectedRunId === run.id && 'bg-muted/60',
                  )}
                  onClick={() => onSelectRun(run.id)}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{compactText(run.userGoal, 80) || 'Agent run'}</span>
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600" />
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{formatDateTime(run.startedAt)}</span>
                    <span className="shrink-0">已运行 {formatDuration(Date.now() - run.startedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function FailuresPanel({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  runs: AgentRunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}) {
  const [failedToolCalls, setFailedToolCalls] = useState<AgentFailedToolCallRow[]>([])
  const [loading, setLoading] = useState(false)

  const loadFailures = useCallback(async () => {
    setLoading(true)
    try {
      const { listRecentFailedToolCalls } = await import('@/db/agent')
      const rows = await listRecentFailedToolCalls(200)
      setFailedToolCalls(rows)
    } catch (err) {
      console.error('[FailuresPanel] load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFailures()
  }, [loadFailures, runs])

  const failedRuns = useMemo(() => runs.filter((r) => r.status === 'failed'), [runs])

  const toolFailureStats = useMemo(() => {
    const byTool = new Map<string, { error: number; blocked: number; recent?: AgentFailedToolCallRow }>()
    for (const row of failedToolCalls) {
      const entry = byTool.get(row.toolName) || { error: 0, blocked: 0 }
      if (row.status === 'blocked') entry.blocked += 1
      else entry.error += 1
      if (!entry.recent) entry.recent = row
      byTool.set(row.toolName, entry)
    }
    return [...byTool.entries()]
      .map(([tool, stat]) => ({ tool, total: stat.error + stat.blocked, ...stat }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [failedToolCalls])

  const errorSamples = useMemo(() => {
    const byMessage = new Map<string, { count: number; sample: AgentFailedToolCallRow }>()
    for (const row of failedToolCalls) {
      const msg = (row.error || row.message || '').trim()
      if (!msg) continue
      // 取首行作为归类键，避免超长堆栈分散
      const key = msg.split('\n')[0].slice(0, 120)
      const entry = byMessage.get(key) || { count: 0, sample: row }
      entry.count += 1
      byMessage.set(key, entry)
    }
    return [...byMessage.entries()]
      .map(([msg, stat]) => ({ msg, ...stat }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [failedToolCalls])

  const maxToolTotal = toolFailureStats[0]?.total || 1

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <StatCell label="失败运行" value={failedRuns.length} icon={<AlertTriangle className="size-3.5" />} />
          <StatCell label="失败工具调用" value={failedToolCalls.filter((r) => r.status === 'error').length} icon={<AlertCircle className="size-3.5" />} />
          <StatCell label="被阻塞调用" value={failedToolCalls.filter((r) => r.status === 'blocked').length} icon={<ShieldCheck className="size-3.5" />} />
        </div>

        {/* 失败的运行 */}
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-muted-foreground" />失败的运行</span>
            <span className="text-xs text-muted-foreground">{failedRuns.length}</span>
          </div>
          {failedRuns.length === 0 ? (
            <EmptyState icon={<AlertTriangle className="size-5" />} label="暂无失败的运行" />
          ) : (
            <div className="divide-y">
              {failedRuns.slice(0, 20).map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
                    selectedRunId === run.id && 'bg-muted/60',
                  )}
                  onClick={() => onSelectRun(run.id)}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{compactText(run.userGoal, 80) || 'Agent run'}</span>
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-destructive">失败</Badge>
                  </div>
                  {run.error ? (
                    <div className="truncate rounded bg-destructive/5 px-2 py-1 text-xs text-destructive/80">{compactText(run.error, 160)}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">{formatDateTime(run.startedAt)}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 按工具聚合的高频失败 */}
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
            <span className="flex items-center gap-2"><Wrench className="size-4 text-muted-foreground" />高频失败工具</span>
            {loading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
          {toolFailureStats.length === 0 ? (
            <EmptyState icon={<Wrench className="size-5" />} label="暂无失败的工具调用" />
          ) : (
            <div className="space-y-2 p-3">
              {toolFailureStats.map((stat) => (
                <div key={stat.tool}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate font-medium">{stat.tool.replace(/_/g, ' ')}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{stat.total} 次</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-destructive/60 transition-all" style={{ width: `${(stat.total / maxToolTotal) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {stat.error > 0 ? <span className="text-destructive/80">error {stat.error}</span> : null}
                    {stat.blocked > 0 ? <span className="text-amber-600">blocked {stat.blocked}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 常见错误信息 */}
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
            <span className="flex items-center gap-2"><AlertCircle className="size-4 text-muted-foreground" />常见错误</span>
            <span className="text-xs text-muted-foreground">按首行归类</span>
          </div>
          {errorSamples.length === 0 ? (
            <EmptyState icon={<AlertCircle className="size-5" />} label="暂无错误信息" />
          ) : (
            <div className="divide-y">
              {errorSamples.map((e) => (
                <div key={e.msg} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-words text-xs leading-5 text-foreground/80">{e.msg}</span>
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">{e.count}</Badge>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">
                    {e.sample.toolName.replace(/_/g, ' ')} · {formatDateTime(e.sample.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function knowledgeHealthLabel(status?: KnowledgeIndexHealth['healthStatus']) {
  switch (status) {
    case 'healthy': return '健康'
    case 'attention': return '需刷新'
    case 'critical': return '需清理'
    default: return '未检查'
  }
}

function knowledgeHealthClass(status?: KnowledgeIndexHealth['healthStatus']) {
  if (status === 'healthy') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'attention') return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (status === 'critical') return 'border-destructive/20 bg-destructive/10 text-destructive'
  return 'border-border bg-muted/40 text-muted-foreground'
}

function knowledgeIssueLabel(reason: KnowledgeIndexHealthIssue['reason']) {
  switch (reason) {
    case 'missing-file': return '文件缺失'
    case 'missing-registry': return '未注册'
    case 'hash-mismatch': return '内容变更'
    case 'missing-vector-index': return '未向量化'
    default: return reason
  }
}

function ReindexResultSummary({ result }: { result: ReindexResult | null }) {
  if (!result) return null
  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <ListChecks className="size-4 text-muted-foreground" />
        刷新结果
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-5">
        <StatCell label="扫描" value={result.scanned} icon={<Database className="size-3.5" />} />
        <StatCell label="更新" value={result.indexed} icon={<RefreshCw className="size-3.5" />} />
        <StatCell label="跳过" value={result.skipped} icon={<ShieldCheck className="size-3.5" />} />
        <StatCell label="清理" value={result.pruned} icon={<AlertTriangle className="size-3.5" />} />
        <StatCell label="错误" value={result.errors.length} icon={<AlertCircle className="size-3.5" />} />
      </div>
      {result.errors.length > 0 ? (
        <div className="divide-y border-t">
          {result.errors.slice(0, 5).map((err, index) => (
            <div key={`${err.path}-${index}`} className="px-3 py-2 text-xs">
              <div className="break-words font-medium text-destructive">{err.path || 'workspace'}</div>
              <div className="mt-0.5 break-words text-muted-foreground">{err.message}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function KnowledgeIssueList({
  title,
  icon,
  issues,
  emptyLabel,
}: {
  title: string
  icon: ReactNode
  issues: KnowledgeIndexHealthIssue[]
  emptyLabel: string
}) {
  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-medium">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">{issues.length}</Badge>
      </div>
      {issues.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} label={emptyLabel} />
      ) : (
        <div className="divide-y">
          {issues.slice(0, 50).map((issue) => (
            <div key={`${issue.reason}-${issue.path}`} className="px-3 py-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{issue.title || issue.path}</span>
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                  {knowledgeIssueLabel(issue.reason)}
                </Badge>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{issue.path}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                {issue.status ? <span>状态 {issue.status}</span> : null}
                {issue.updatedAt ? <span>更新 {formatDateTime(issue.updatedAt)}</span> : null}
                {issue.vectorIndexedAt ? <span>索引 {formatDateTime(issue.vectorIndexedAt)}</span> : null}
              </div>
            </div>
          ))}
          {issues.length > 50 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">还有 {issues.length - 50} 项未显示</div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function KnowledgeHealthPanel() {
  const [health, setHealth] = useState<KnowledgeIndexHealth | null>(null)
  const [action, setAction] = useState<'health' | 'refresh' | 'prune' | null>(null)
  const [progress, setProgress] = useState<ReindexProgress | null>(null)
  const [lastResult, setLastResult] = useState<ReindexResult | null>(null)
  const [lastPruned, setLastPruned] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadHealth = useCallback(async (showBusy = false) => {
    if (showBusy) setAction('health')
    setError(null)
    try {
      const { getKnowledgeIndexHealth } = await import('@/lib/knowledge/reindex')
      setHealth(await getKnowledgeIndexHealth())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (showBusy) setAction(null)
    }
  }, [])

  useEffect(() => {
    void loadHealth(true)
  }, [loadHealth])

  const refreshIndex = useCallback(async () => {
    setAction('refresh')
    setError(null)
    setProgress(null)
    setLastResult(null)
    setLastPruned(null)
    try {
      const { incrementalReindex } = await import('@/lib/knowledge/reindex')
      const result = await incrementalReindex({
        force: true,
        onProgress: setProgress,
      })
      setLastResult(result)
      await loadHealth(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAction(null)
      setProgress(null)
    }
  }, [loadHealth])

  const pruneOrphans = useCallback(async () => {
    setAction('prune')
    setError(null)
    setLastResult(null)
    setLastPruned(null)
    try {
      const { pruneOrphanNoteIndexes } = await import('@/lib/knowledge/reindex')
      const count = await pruneOrphanNoteIndexes()
      setLastPruned(count)
      await loadHealth(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAction(null)
    }
  }, [loadHealth])

  const busy = action !== null
  const issueCount = (health?.orphanNotes.length ?? 0) + (health?.staleNotes.length ?? 0)

  if (!health && action === 'health') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在检查知识库...
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="space-y-4 p-4">
        <section className="rounded-md border bg-background p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Database className="size-4 text-muted-foreground" />
                <h2 className="truncate text-sm font-semibold">知识库健康检查</h2>
                <Badge variant="outline" className={cn('shrink-0 px-1.5 py-0 text-[10px]', knowledgeHealthClass(health?.healthStatus))}>
                  {knowledgeHealthLabel(health?.healthStatus)}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {health ? `检查时间 ${formatDateTime(health.checkedAt)}` : '尚未完成检查'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy}
                onClick={() => void loadHealth(true)}
              >
                {action === 'health' ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                健康检查
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={busy}
                onClick={() => void refreshIndex()}
              >
                {action === 'refresh' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                刷新索引
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy || !health || health.orphanNotes.length === 0}
                onClick={() => void pruneOrphans()}
              >
                {action === 'prune' ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
                残留清理
              </Button>
            </div>
          </div>

          {action === 'refresh' && progress ? (
            <div className="mt-3 rounded-md bg-muted/35 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">正在刷新 {progress.currentPath}</span>
                <span className="shrink-0 tabular-nums">{progress.current} / {progress.total}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress.total > 0 ? Math.max(4, (progress.current / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          ) : null}

          {lastPruned !== null ? (
            <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              已清理 {lastPruned} 条残留索引
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </section>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <StatCell label="Markdown 文件" value={health?.totalFiles ?? '-'} icon={<FileText className="size-3.5" />} />
          <StatCell label="注册对象" value={health?.registryNotes ?? '-'} icon={<Database className="size-3.5" />} />
          <StatCell label="已索引" value={health?.indexedNotes ?? '-'} icon={<ShieldCheck className="size-3.5" />} />
          <StatCell label="待刷新" value={health?.staleNotes.length ?? '-'} icon={<RefreshCw className="size-3.5" />} />
          <StatCell label="残留索引" value={health?.orphanNotes.length ?? '-'} icon={<AlertTriangle className="size-3.5" />} />
        </div>

        {health ? (
          <section className="rounded-md border bg-background">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2"><BarChart3 className="size-4 text-muted-foreground" />索引覆盖</span>
              <span className="text-xs text-muted-foreground">{issueCount} 项待处理</span>
            </div>
            <div className="space-y-2 p-3">
              <DistributionBar label="已索引" value={health.indexedNotes} total={Math.max(health.totalFiles, 1)} className="bg-emerald-500/70" />
              <DistributionBar label="待刷新" value={health.staleNotes.length} total={Math.max(health.totalFiles, 1)} className="bg-amber-500/70" />
              <DistributionBar label="残留索引" value={health.orphanNotes.length} total={Math.max(health.activeRegistryNotes, 1)} className="bg-destructive/70" />
              <div className="pt-1 text-xs text-muted-foreground">
                活跃对象 {health.activeRegistryNotes}，已删除对象 {health.deletedRegistryNotes}
              </div>
            </div>
          </section>
        ) : null}

        <ReindexResultSummary result={lastResult} />

        {health?.warnings.length ? (
          <section className="rounded-md border border-amber-500/20 bg-amber-500/[0.04]">
            <div className="flex items-center gap-2 border-b border-amber-500/20 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4" />
              检查告警
            </div>
            <div className="divide-y divide-amber-500/15">
              {health.warnings.map((warning, index) => (
                <div key={`${warning}-${index}`} className="break-words px-3 py-2 text-xs text-muted-foreground">{warning}</div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-2 xl:grid-cols-2">
          <KnowledgeIssueList
            title="待刷新对象"
            icon={<RefreshCw className="size-4 text-muted-foreground" />}
            issues={health?.staleNotes ?? []}
            emptyLabel="暂无待刷新对象"
          />
          <KnowledgeIssueList
            title="残留索引"
            icon={<AlertTriangle className="size-4 text-muted-foreground" />}
            issues={health?.orphanNotes ?? []}
            emptyLabel="暂无残留索引"
          />
        </div>
      </div>
    </ScrollArea>
  )
}

function AgentPanelHost({
  detail,
  loading,
  activePanel,
  runs,
  selectedRunId,
  onSelectRun,
}: {
  detail: AgentRunDetail | null
  loading: boolean
  activePanel: AgentPanelId
  runs: AgentRunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}) {
  // 全局面板：无需选中运行记录，直接渲染
  if (activePanel === 'overview') return <OverviewPanel runs={runs} />
  if (activePanel === 'live') {
    return <LivePanel runs={runs} selectedRunId={selectedRunId} onSelectRun={onSelectRun} />
  }
  if (activePanel === 'failures') {
    return <FailuresPanel runs={runs} selectedRunId={selectedRunId} onSelectRun={onSelectRun} />
  }
  if (activePanel === 'knowledge') return <KnowledgeHealthPanel />

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载运行详情...
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <Bot className="size-8 opacity-40" />
        <span>从左侧选择一条运行记录以查看详情</span>
      </div>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceHeader detail={detail} activePanel={activePanel} />
      {activePanel === 'review' ? <ReviewPanel detail={detail} /> : null}
      {activePanel === 'run' ? <RunPanel detail={detail} /> : null}
      {activePanel === 'context' ? <ContextPanel detail={detail} /> : null}
      {activePanel === 'tree' ? <TreePanel detail={detail} /> : null}
      {activePanel === 'runtime' ? <RuntimePanel detail={detail} /> : null}
    </section>
  )
}

export function AgentWorkspace() {
  const {
    runs,
    selectedRunId,
    selectedRunDetail,
    loadingRuns,
    loadingDetail,
    error,
    loadRuns,
    selectRun,
    refreshSelectedRun,
  } = useAgentRunsStore()
  const [activePanel, setActivePanel] = useState<AgentPanelId>('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // 折叠状态持久化
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const Store = (await import('@tauri-apps/plugin-store')).Store
        const store = await Store.load('store.json')
        const saved = await store.get<boolean>('agentCenterSidebarCollapsed')
        if (!cancelled && saved) setSidebarCollapsed(true)
      } catch {
        // 非 Tauri 环境忽略
      }
    })()
    return () => { cancelled = true }
  }, [])

  const toggleSidebar = useCallback(() => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    void (async () => {
      try {
        const Store = (await import('@tauri-apps/plugin-store')).Store
        const store = await Store.load('store.json')
        await store.set('agentCenterSidebarCollapsed', next)
        await store.save()
      } catch {
        // 非 Tauri 环境忽略
      }
    })()
  }, [sidebarCollapsed])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const overview = useMemo(() => {
    const running = runs.filter(run => run.status === 'running').length
    const failed = runs.filter(run => run.status === 'failed').length
    const completed = runs.filter(run => run.status === 'completed').length
    return { running, failed, completed }
  }, [runs])

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="size-4 text-muted-foreground" />
          <div className="truncate text-sm font-medium">Agent 调度</div>
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <span>完成 {overview.completed}</span>
            <span>运行 {overview.running}</span>
            <span>失败 {overview.failed}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => void refreshSelectedRun()}
          disabled={loadingRuns || loadingDetail}
        >
          {loadingRuns || loadingDetail ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          刷新
        </Button>
      </div>
      {error ? (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {sidebarCollapsed ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* 折叠态：窄竖条，点击展开 */}
          <button
            type="button"
            className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r bg-muted/10 pt-3 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            onClick={toggleSidebar}
            title="展开运行历史"
          >
            <PanelLeftOpen className="size-4" />
            <Bot className="size-4 opacity-60" />
          </button>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <PanelTabs activePanel={activePanel} setActivePanel={setActivePanel} />
            <AgentPanelHost
              detail={selectedRunDetail}
              loading={loadingDetail}
              activePanel={activePanel}
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={(runId) => void selectRun(runId)}
            />
          </div>
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
          <ResizablePanel
            id="agent-runs-sidebar"
            order={1}
            defaultSize={24}
            minSize={16}
            maxSize={38}
            className="!min-w-[230px]"
          >
            <RunsSidebar
              runs={runs}
              selectedRunId={selectedRunId}
              loading={loadingRuns}
              onSelect={(runId) => void selectRun(runId)}
              onToggleCollapse={toggleSidebar}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="agent-runs-content" order={2} className="min-w-0">
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
              <PanelTabs activePanel={activePanel} setActivePanel={setActivePanel} />
              <AgentPanelHost
                detail={selectedRunDetail}
                loading={loadingDetail}
                activePanel={activePanel}
                runs={runs}
                selectedRunId={selectedRunId}
                onSelectRun={(runId) => void selectRun(runId)}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}

export default AgentWorkspace
