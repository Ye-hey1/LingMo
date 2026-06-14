import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"
import { useState, useEffect } from "react"
import { updateMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"

import { TodoForm, TodoFormData, Subtask, Priority as PriorityType } from "./todo-form"

type Priority = PriorityType

interface TodoData {
  title: string
  description: string
  completed: boolean
  priority: Priority
  dueDate?: string
  subtasks?: Subtask[]
  reminderAt?: number
  reminderId?: string
}

interface TodoEditDialogProps {
  mark: Mark
  open: boolean
  onOpenChange: (open: boolean) => void
}

function parseTodoData(mark: Mark): TodoData {
  try {
    return JSON.parse(mark.content || '{}')
  } catch {
    return {
      title: mark.desc || '',
      description: '',
      completed: false,
      priority: 'medium',
    }
  }
}

function parseReminderAt(value?: string) {
  if (!value) return undefined
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function formatDateTimeLocal(timestamp?: number) {
  if (!timestamp) return undefined
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return undefined

  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TodoEditDialog({ mark, open, onOpenChange }: TodoEditDialogProps) {
  const t = useTranslations()
  const { fetchMarks } = useMarkStore()
  const { fetchTags, getCurrentTag } = useTagStore()

  const [formData, setFormData] = useState<TodoFormData>({
    title: '',
    description: '',
    priority: 'medium',
  })
  const reminderTimestamp = formData.reminderEnabled ? parseReminderAt(formData.reminderAt) : undefined
  const canSubmit = Boolean(formData.title.trim())
    && (!formData.reminderEnabled || Boolean(reminderTimestamp && reminderTimestamp > Date.now()))

  useEffect(() => {
    if (open && mark) {
      const todoData = parseTodoData(mark)
      setFormData({
        title: todoData.title || '',
        description: todoData.description || '',
        priority: todoData.priority || 'medium',
        dueDate: todoData.dueDate || undefined,
        subtasks: todoData.subtasks || undefined,
        reminderEnabled: Boolean(todoData.reminderAt && todoData.reminderAt > Date.now()),
        reminderAt: formatDateTimeLocal(todoData.reminderAt),
      })
    }
  }, [open, mark])

  async function handleSave() {
    if (!formData.title.trim()) {
      return
    }

    const original = parseTodoData(mark)
    if (formData.reminderEnabled && (!reminderTimestamp || reminderTimestamp <= Date.now())) {
      toast({
        title: t('record.mark.todo.invalidReminderTime'),
        variant: 'destructive',
      })
      return
    }

    let reminderId: string | undefined
    if (formData.reminderEnabled && reminderTimestamp) {
      try {
        const { reminderScheduler } = await import('@/lib/reminders/scheduler')
        const reminder = await reminderScheduler.create({
          title: formData.title.trim(),
          message: formData.description.trim() || undefined,
          dueAt: reminderTimestamp,
          source: {
            type: 'note',
            label: t('record.mark.todo.title'),
          },
        })
        reminderId = reminder.id
      } catch (error) {
        toast({
          title: t('record.mark.todo.reminderCreateFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
        return
      }
    }

    if (original.reminderId) {
      try {
        const { reminderScheduler } = await import('@/lib/reminders/scheduler')
        await reminderScheduler.cancel(original.reminderId)
      } catch {
        // Existing reminders are best-effort cleanup; saving the task should still proceed.
      }
    }

    const todoData: TodoData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority,
      completed: original.completed ?? false,
      dueDate: formData.dueDate || undefined,
      subtasks: formData.subtasks || undefined,
      reminderAt: reminderTimestamp,
      reminderId,
    }

    await updateMark({
      ...mark,
      desc: formData.title.trim(),
      content: JSON.stringify(todoData)
    })

    await fetchMarks()
    await fetchTags()
    getCurrentTag()

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[560px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-3.5 py-2.5">
          <DialogTitle className="text-sm">{t('record.mark.todo.edit')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('record.mark.todo.editDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(100vh-9.5rem)] overflow-y-auto px-3.5 py-3">
          <TodoForm
            mode="edit"
            data={formData}
            onChange={setFormData}
            showReminderOption={true}
          />
        </div>
        <DialogFooter className="border-t border-border/70 bg-muted/10 px-3.5 py-2">
          <Button variant="outline" className="h-8 px-3 text-xs shadow-none" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="h-8 px-3 text-xs shadow-none" onClick={handleSave} disabled={!canSubmit}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
