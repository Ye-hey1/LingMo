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
  Check,
  ChevronDown,
  Clock3,
  ListChecks,
  Minus,
  Plus,
  X,
} from "lucide-react"
import { useEffect, useState, type KeyboardEvent } from "react"

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
  const subtasks = data.subtasks || []
  const [detailsOpen, setDetailsOpen] = useState(
    () => mode === 'edit' || Boolean(data.description.trim()) || subtasks.length > 0,
  )
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [batchText, setBatchText] = useState('')
  const [showBatchAdd, setShowBatchAdd] = useState(false)

  const completedSubtasks = subtasks.filter((item) => item.completed).length
  const subtaskProgress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0

  useEffect(() => {
    if (mode === 'edit' || data.description.trim() || subtasks.length > 0) {
      setDetailsOpen(true)
    }
  }, [data.description, mode, subtasks.length])

  const priorityMeta = {
    low: {
      icon: ArrowDown,
      label: t('record.mark.todo.priorityLow'),
      dot: 'bg-emerald-500',
    },
    medium: {
      icon: Minus,
      label: t('record.mark.todo.priorityMedium'),
      dot: 'bg-amber-500',
    },
    high: {
      icon: ArrowUp,
      label: t('record.mark.todo.priorityHigh'),
      dot: 'bg-rose-500',
    },
  } satisfies Record<Priority, {
    icon: typeof ArrowDown
    label: string
    dot: string
  }>

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

  const detailSummary = [
    data.description.trim() ? t('record.mark.todo.notes') : null,
    subtasks.length > 0 ? `${completedSubtasks}/${subtasks.length} ${t('record.mark.todo.subtasks')}` : null,
  ].filter(Boolean).join(' / ')

  return (
    <div className="space-y-3">
      <section className="space-y-2.5">
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
            className="mt-1 h-9 bg-background text-sm shadow-none"
          />
        </div>

        <div className={cn("grid gap-2", showTagSelector ? "sm:grid-cols-[minmax(0,1fr)_9.5rem]" : "sm:grid-cols-[9.5rem]")}>
          {showTagSelector && onTagChange ? (
            <div>
              <Label htmlFor="todo-tag" className="text-[11px] font-medium text-muted-foreground">
                {t('record.mark.todo.selectTag')}
              </Label>
              <Select
                value={selectedTagId ? String(selectedTagId) : undefined}
                onValueChange={(value) => onTagChange(Number(value))}
              >
                <SelectTrigger id="todo-tag" className="mt-1 h-8 bg-background text-xs shadow-none">
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
              className="mt-1 h-8 bg-background text-xs shadow-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {duePresets.map((preset) => {
            const active = data.dueDate === preset.value
            return (
              <Button
                key={preset.label}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-7 px-2 text-[11px] shadow-none",
                  !active && "border-border/70 bg-background text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setDueDate(preset.value)}
              >
                {preset.label}
              </Button>
            )
          })}
          {data.dueDate ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setDueDate(undefined)}
            >
              {t('record.mark.todo.clearDate')}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="space-y-1.5">
        <Label className="text-[11px] font-medium text-muted-foreground">
          {t('record.mark.todo.priority')}
        </Label>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border/70">
          {(Object.keys(priorityMeta) as Priority[]).map((priority) => {
            const item = priorityMeta[priority]
            const Icon = item.icon
            const active = data.priority === priority
            return (
              <button
                key={priority}
                type="button"
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 border-r border-border/70 px-2 text-xs transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active ? "bg-muted text-foreground" : "bg-background text-muted-foreground hover:bg-muted/55 hover:text-foreground",
                )}
                onClick={() => onChange({ ...data, priority })}
              >
                <span className={cn("size-1.5 rounded-full", item.dot)} />
                <Icon className="size-3.5" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {showReminderOption ? (
        <section className="rounded-md border border-border/70 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Bell className={cn("size-3.5 shrink-0", data.reminderEnabled ? "text-foreground" : "text-muted-foreground")} />
              <div className="min-w-0">
                <div className="text-xs font-medium">{t('record.mark.todo.reminder')}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {data.reminderEnabled && data.reminderAt ? data.reminderAt : t('record.mark.todo.reminderOff')}
                </div>
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
            <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
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
                  className="mt-1 h-8 bg-background text-xs shadow-none"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {reminderPresets.map((preset) => {
                  const active = data.reminderAt === preset.value
                  return (
                    <Button
                      key={preset.label}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "h-7 gap-1 px-2 text-[11px] shadow-none",
                        !active && "border-border/70 bg-background text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => onChange({ ...data, reminderAt: preset.value })}
                    >
                      <Clock3 className="size-3" />
                      {preset.label}
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="border-t border-border/70 pt-2">
        <button
          type="button"
          className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setDetailsOpen((value) => !value)}
        >
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{t('record.mark.todo.notes')} / {t('record.mark.todo.subtasks')}</span>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            {detailSummary ? <span className="hidden max-w-[12rem] truncate sm:inline">{detailSummary}</span> : null}
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", detailsOpen && "rotate-180")} />
          </span>
        </button>

        {detailsOpen ? (
          <div className="mt-2 space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`todo-description-${mode}`} className="text-[11px] font-medium text-muted-foreground">
                {t('record.mark.todo.notes')}
              </Label>
              <Textarea
                id={`todo-description-${mode}`}
                rows={3}
                value={data.description}
                onChange={(e) => onChange({ ...data, description: e.target.value })}
                placeholder={t('record.mark.todo.descriptionPlaceholder')}
                className="min-h-[4rem] resize-none bg-background text-xs shadow-none"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span>{t('record.mark.todo.subtasks')}</span>
                  {subtasks.length > 0 ? (
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {completedSubtasks}/{subtasks.length}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setShowBatchAdd((value) => !value)}
                >
                  {showBatchAdd ? t('common.cancel') : t('record.mark.todo.batchAdd')}
                </Button>
              </div>

              {subtasks.length > 0 ? (
                <Progress value={subtaskProgress} className="h-1 bg-muted" />
              ) : null}

              <div className="space-y-1.5">
                {subtasks.map((st, idx) => (
                  <div
                    key={st.id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 transition-colors hover:bg-muted/25",
                      st.completed && "text-muted-foreground",
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
                        "h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1",
                        st.completed && "text-muted-foreground line-through",
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
                    className="h-8 bg-background text-xs shadow-none"
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
                    className="size-8 shrink-0 shadow-none"
                    onClick={addSubtask}
                    disabled={!subtaskTitle.trim()}
                    title={t('record.mark.todo.addSubtask')}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>

                {showBatchAdd ? (
                  <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-2">
                    <Textarea
                      value={batchText}
                      onChange={(e) => setBatchText(e.target.value)}
                      placeholder={t('record.mark.todo.batchPlaceholder')}
                      className="min-h-[4rem] resize-none bg-background text-xs shadow-none"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1.5 px-3 text-xs shadow-none"
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
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
