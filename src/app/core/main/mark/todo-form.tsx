import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  ListChecks,
  Minus,
  Plus,
  Sparkles,
  X,
} from "lucide-react"
import { useState, type KeyboardEvent } from "react"

export type Priority = 'low' | 'medium' | 'high'

export interface Subtask {
  id: string
  title: string
  completed: boolean
}

export interface TodoFormData {
  title: string
  description: string
  priority: Priority
  dueDate?: string
  subtasks?: Subtask[]
  reminderEnabled?: boolean
  reminderAt?: string
}

interface TodoFormProps {
  mode: 'create' | 'edit'
  data: TodoFormData
  onChange: (data: TodoFormData) => void
  selectedTagId?: number
  onTagChange?: (tagId: number) => void
  tags?: Array<{ id: number; name: string }>
  showTagSelector?: boolean
  showReminderOption?: boolean
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function formatDateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-')
}

function formatDateTimeLocal(date: Date) {
  return `${formatDateInput(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getNextWeekday(date: Date) {
  const day = date.getDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  return addDays(date, daysUntilMonday)
}

export function getDefaultReminderAt(dueDate?: string): string {
  if (dueDate) {
    return `${dueDate}T09:00`
  }

  const next = new Date(Date.now() + 30 * 60 * 1000)
  next.setSeconds(0, 0)
  return formatDateTimeLocal(next)
}

function getReminderPreset(minutes: number) {
  const next = new Date(Date.now() + minutes * 60 * 1000)
  next.setSeconds(0, 0)
  return formatDateTimeLocal(next)
}

function getTomorrowMorning() {
  const next = addDays(new Date(), 1)
  next.setHours(9, 0, 0, 0)
  return formatDateTimeLocal(next)
}

export function TodoForm({
  mode,
  data,
  onChange,
  selectedTagId,
  onTagChange,
  tags = [],
  showTagSelector = false,
  showReminderOption = false,
}: TodoFormProps) {
  const t = useTranslations()
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [batchText, setBatchText] = useState('')
  const [showBatchAdd, setShowBatchAdd] = useState(false)

  const subtasks = data.subtasks || []
  const completedSubtasks = subtasks.filter((item) => item.completed).length
  const subtaskProgress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0
  const selectedTagName = selectedTagId ? tags.find((tag) => tag.id === selectedTagId)?.name : undefined

  const priorityMeta = {
    low: {
      icon: ArrowDown,
      label: t('record.mark.todo.priorityLow'),
      hint: t('record.mark.todo.priorityLowHint'),
      tone: 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
    medium: {
      icon: Minus,
      label: t('record.mark.todo.priorityMedium'),
      hint: t('record.mark.todo.priorityMediumHint'),
      tone: 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    },
    high: {
      icon: ArrowUp,
      label: t('record.mark.todo.priorityHigh'),
      hint: t('record.mark.todo.priorityHighHint'),
      tone: 'border-rose-500/45 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    },
  } satisfies Record<Priority, {
    icon: typeof ArrowDown
    label: string
    hint: string
    tone: string
  }>
  const currentPriority = priorityMeta[data.priority]
  const SummaryIcon = currentPriority.icon

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
    }
  }

  const addSubtask = () => {
    const title = subtaskTitle.trim()
    if (!title) return

    onChange({
      ...data,
      subtasks: [...subtasks, { id: generateId(), title, completed: false }],
    })
    setSubtaskTitle('')
  }

  const addBatchSubtasks = () => {
    const lines = batchText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.length > 160 ? `${line.slice(0, 157)}...` : line)

    if (lines.length === 0) return

    onChange({
      ...data,
      subtasks: [
        ...subtasks,
        ...lines.map((title) => ({ id: generateId(), title, completed: false })),
      ],
    })
    setBatchText('')
    setShowBatchAdd(false)
  }

  const removeSubtask = (index: number) => {
    const nextSubtasks = [...subtasks]
    nextSubtasks.splice(index, 1)
    onChange({ ...data, subtasks: nextSubtasks })
  }

  const updateSubtaskTitle = (index: number, title: string) => {
    const nextSubtasks = [...subtasks]
    nextSubtasks[index] = { ...nextSubtasks[index], title }
    onChange({ ...data, subtasks: nextSubtasks })
  }

  const toggleSubtask = (index: number, completed: boolean) => {
    const nextSubtasks = [...subtasks]
    nextSubtasks[index] = { ...nextSubtasks[index], completed }
    onChange({ ...data, subtasks: nextSubtasks })
  }

  const setDueDate = (dueDate?: string) => {
    onChange({
      ...data,
      dueDate,
      reminderAt: data.reminderEnabled && !data.reminderAt ? getDefaultReminderAt(dueDate) : data.reminderAt,
    })
  }

  const duePresets = [
    { label: t('record.mark.todo.today'), value: formatDateInput(new Date()) },
    { label: t('record.mark.todo.tomorrow'), value: formatDateInput(addDays(new Date(), 1)) },
    { label: t('record.mark.todo.nextWeek'), value: formatDateInput(getNextWeekday(new Date())) },
  ]

  const reminderPresets = [
    { label: t('record.mark.todo.in30Minutes'), value: getReminderPreset(30) },
    { label: t('record.mark.todo.in1Hour'), value: getReminderPreset(60) },
    { label: t('record.mark.todo.tomorrowMorning'), value: getTomorrowMorning() },
    ...(data.dueDate ? [{ label: t('record.mark.todo.dueMorning'), value: getDefaultReminderAt(data.dueDate) }] : []),
  ]

  const summaryItems = [
    {
      icon: SummaryIcon,
      label: t('record.mark.todo.priority'),
      value: currentPriority.label,
      className: currentPriority.tone,
    },
    {
      icon: CalendarDays,
      label: t('record.mark.todo.dueDate'),
      value: data.dueDate || t('record.mark.todo.noDueDate'),
      className: data.dueDate
        ? 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        : 'border-border/70 bg-muted/30 text-muted-foreground',
    },
    {
      icon: ListChecks,
      label: t('record.mark.todo.subtasks'),
      value: subtasks.length > 0 ? `${completedSubtasks}/${subtasks.length}` : t('record.mark.todo.none'),
      className: subtasks.length > 0
        ? 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        : 'border-border/70 bg-muted/30 text-muted-foreground',
    },
  ]
  const showReminderActive = showReminderOption && data.reminderEnabled && data.reminderAt

  return (
    <div className="grid gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", currentPriority.tone)}>
            <SummaryIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('record.mark.todo.summaryTitle')}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {selectedTagName || t('record.mark.todo.summaryFallback')}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-border/60 bg-background/70 px-3 py-2.5">
          <div className="line-clamp-2 text-sm font-medium">
            {data.title.trim() || t('record.mark.todo.emptyTitle')}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {data.description.trim() || t('record.mark.todo.emptyNotes')}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{t('record.mark.todo.subtaskProgress')}</span>
            <span className="tabular-nums">{subtaskProgress}%</span>
          </div>
          <Progress value={subtaskProgress} className="h-1.5 bg-muted" />
        </div>

        <div className="mt-3 grid gap-2">
          {summaryItems.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.label} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-2", item.className)}>
                <Icon className="size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] opacity-75">{item.label}</div>
                  <div className="truncate text-xs font-medium">{item.value}</div>
                </div>
              </div>
            )
          })}
          {showReminderOption ? (
            <div className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-2",
              showReminderActive
                ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : "border-border/70 bg-muted/30 text-muted-foreground"
            )}>
              <Bell className="size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] opacity-75">{t('record.mark.todo.reminder')}</div>
                <div className="truncate text-xs font-medium">
                  {showReminderActive ? data.reminderAt : t('record.mark.todo.reminderOff')}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-dashed border-border/70 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('record.mark.todo.lingmoHint')}</span>
        </div>
      </aside>

      <div className="space-y-4">
        <section className="rounded-md border border-border/70 bg-background p-3">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="size-4 text-muted-foreground" />
            <div className="text-sm font-semibold">{t('record.mark.todo.taskSection')}</div>
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`todo-title-${mode}`} className="text-[11px] font-medium text-muted-foreground">
                {t('record.mark.todo.titleLabel')} *
              </Label>
              <Input
                id={`todo-title-${mode}`}
                value={data.title}
                onChange={(e) => onChange({ ...data, title: e.target.value })}
                placeholder={t('record.mark.todo.titlePlaceholder')}
                onKeyDown={handleKeyDown}
                autoFocus
                className="mt-1.5 h-10 text-sm"
              />
            </div>

            <div className={cn(
              "grid gap-3",
              showTagSelector ? "md:grid-cols-[minmax(0,1fr)_160px]" : "md:grid-cols-[160px]"
            )}>
              {showTagSelector && onTagChange ? (
                <div>
                  <Label htmlFor="todo-tag" className="text-[11px] font-medium text-muted-foreground">
                    {t('record.mark.todo.selectTag')}
                  </Label>
                  <Select value={String(selectedTagId)} onValueChange={(value) => onTagChange(Number(value))}>
                    <SelectTrigger id="todo-tag" className="mt-1.5 h-9">
                      <SelectValue placeholder={t('record.mark.todo.selectTag')} />
                    </SelectTrigger>
                    <SelectContent>
                      {tags.map((tag) => (
                        <SelectItem key={tag.id} value={String(tag.id)}>
                          <span className="truncate">{tag.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div>
                <Label htmlFor={`todo-due-date-${mode}`} className="text-[11px] font-medium text-muted-foreground">
                  {t('record.mark.todo.dueDate')}
                </Label>
                <Input
                  id={`todo-due-date-${mode}`}
                  type="date"
                  value={data.dueDate || ''}
                  onChange={(e) => setDueDate(e.target.value || undefined)}
                  className="mt-1.5 h-9"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {duePresets.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant={data.dueDate === preset.value ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => setDueDate(preset.value)}
                >
                  <CalendarDays className="size-3" />
                  {preset.label}
                </Button>
              ))}
              {data.dueDate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setDueDate(undefined)}
                >
                  {t('record.mark.todo.clearDate')}
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-md border border-border/70 bg-background p-3">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            <div className="text-sm font-semibold">{t('record.mark.todo.prioritySection')}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(priorityMeta) as Priority[]).map((priority) => {
              const item = priorityMeta[priority]
              const Icon = item.icon
              const active = data.priority === priority
              return (
                <button
                  key={priority}
                  type="button"
                  className={cn(
                    "flex min-h-14 items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                    active ? item.tone : "border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/40"
                  )}
                  onClick={() => onChange({ ...data, priority })}
                >
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", active ? "bg-background/70" : "bg-background")}>
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] opacity-75">{item.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-md border border-border/70 bg-background p-3">
          <Label htmlFor={`todo-description-${mode}`} className="text-[11px] font-medium text-muted-foreground">
            {t('record.mark.todo.notes')}
          </Label>
          <Textarea
            id={`todo-description-${mode}`}
            rows={4}
            value={data.description}
            onChange={(e) => onChange({ ...data, description: e.target.value })}
            placeholder={t('record.mark.todo.descriptionPlaceholder')}
            className="mt-1.5 resize-none text-sm"
          />
        </section>

        {showReminderOption ? (
          <section className="rounded-md border border-border/70 bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  <Bell className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{t('record.mark.todo.reminder')}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{t('record.mark.todo.reminderHint')}</div>
                </div>
              </div>
              <Switch
                checked={data.reminderEnabled === true}
                onCheckedChange={(checked) => onChange({
                  ...data,
                  reminderEnabled: checked,
                  reminderAt: checked ? data.reminderAt || getDefaultReminderAt(data.dueDate) : undefined,
                })}
              />
            </div>
            {data.reminderEnabled ? (
              <div className="mt-3 space-y-2.5">
                <div>
                  <Label htmlFor={`todo-reminder-${mode}`} className="text-[11px] font-medium text-muted-foreground">
                    {t('record.mark.todo.reminderTime')}
                  </Label>
                  <Input
                    id={`todo-reminder-${mode}`}
                    type="datetime-local"
                    value={data.reminderAt || ''}
                    min={formatDateTimeLocal(new Date())}
                    onChange={(e) => onChange({ ...data, reminderAt: e.target.value || undefined })}
                    className="mt-1.5 h-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {reminderPresets.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant={data.reminderAt === preset.value ? "default" : "outline"}
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-[11px]"
                      onClick={() => onChange({ ...data, reminderAt: preset.value })}
                    >
                      <Clock3 className="size-3" />
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-md border border-border/70 bg-background p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" />
              <div className="text-sm font-semibold">{t('record.mark.todo.subtasks')}</div>
              {subtasks.length > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {completedSubtasks}/{subtasks.length}
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={() => setShowBatchAdd((value) => !value)}
            >
              {showBatchAdd ? t('common.cancel') : t('record.mark.todo.batchAdd')}
            </Button>
          </div>

          {subtasks.length > 0 ? (
            <div className="mb-3">
              <Progress value={subtaskProgress} className="h-1.5 bg-muted" />
            </div>
          ) : null}

          <div className="space-y-1.5">
            {subtasks.map((st, idx) => (
              <div
                key={st.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-2 py-1.5 transition-colors",
                  st.completed && "bg-emerald-500/5"
                )}
              >
                <Checkbox
                  checked={st.completed}
                  onCheckedChange={(checked) => toggleSubtask(idx, checked === true)}
                  className="size-4"
                />
                <Input
                  value={st.title}
                  onChange={(e) => updateSubtaskTitle(idx, e.target.value)}
                  className={cn(
                    "h-8 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1",
                    st.completed && "text-muted-foreground line-through"
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeSubtask(idx)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}

            <div className="flex items-center gap-1.5">
              <Input
                value={subtaskTitle}
                onChange={(e) => setSubtaskTitle(e.target.value)}
                placeholder={t('record.mark.todo.subtaskPlaceholder')}
                className="h-9 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSubtask()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
                onClick={addSubtask}
                disabled={!subtaskTitle.trim()}
                title={t('record.mark.todo.addSubtask')}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>

            {showBatchAdd ? (
              <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-2">
                <Textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={t('record.mark.todo.batchPlaceholder')}
                  className="min-h-24 resize-none text-xs"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={!batchText.trim()}
                    onClick={addBatchSubtasks}
                  >
                    <Check className="size-3.5" />
                    {t('record.mark.todo.addBatch')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
