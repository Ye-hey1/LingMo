import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { useTranslations } from 'next-intl'
import { toast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CheckSquare } from "lucide-react"
import { useState, useCallback, useEffect } from "react"
import emitter, { type TodoDraftPayload } from "@/lib/emitter"
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { TodoForm, type TodoFormData, type Subtask } from "./todo-form"

const emptyTodoForm: TodoFormData = {
  title: '',
  description: '',
  priority: 'medium',
  dueDate: undefined,
  subtasks: undefined,
  reminderEnabled: false,
  reminderAt: undefined,
}

function parseReminderAt(value?: string) {
  if (!value) return undefined
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function normalizeDraftSubtasks(subtasks?: TodoDraftPayload['subtasks']): Subtask[] | undefined {
  if (!Array.isArray(subtasks)) return undefined

  const normalized = subtasks
    .map((item, index) => ({
      id: `draft-${Date.now()}-${index}`,
      title: typeof item.title === 'string' ? item.title.trim() : '',
      completed: item.completed === true,
    }))
    .filter((item) => item.title)

  return normalized.length > 0 ? normalized : undefined
}

function getDraftFormData(draft?: TodoDraftPayload): TodoFormData {
  if (!draft) return { ...emptyTodoForm }

  const reminderAt = typeof draft.reminderAt === 'string' ? draft.reminderAt : undefined
  const reminderEnabled = draft.reminderEnabled ?? Boolean(reminderAt)

  return {
    title: typeof draft.title === 'string' ? draft.title.trim() : '',
    description: typeof draft.description === 'string' ? draft.description.trim() : '',
    priority: draft.priority || 'medium',
    dueDate: typeof draft.dueDate === 'string' ? draft.dueDate : undefined,
    subtasks: normalizeDraftSubtasks(draft.subtasks),
    reminderEnabled,
    reminderAt,
  }
}

export function ControlTodo() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<TodoFormData>(emptyTodoForm)
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { currentTagId, fetchTags, getCurrentTag, tags } = useTagStore()
  const { fetchMarks } = useMarkStore()
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)
  const reminderTimestamp = formData.reminderEnabled ? parseReminderAt(formData.reminderAt) : undefined
  const canSubmit = Boolean(formData.title.trim())
    && (!formData.reminderEnabled || Boolean(reminderTimestamp && reminderTimestamp > Date.now()))

  async function handleSuccess() {
    if (!formData.title.trim()) {
      return
    }

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

    const todoData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority,
      completed: false,
      dueDate: formData.dueDate || undefined,
      subtasks: formData.subtasks || undefined,
      reminderAt: reminderTimestamp,
      reminderId,
    }

    await insertMark({
      tagId: selectedTagId,
      type: 'todo',
      desc: formData.title.trim(),
      content: JSON.stringify(todoData),
      url: ''
    })

    await fetchMarks()
    await fetchTags()
    getCurrentTag()

    handleRecordComplete(router)

    setFormData({ ...emptyTodoForm })
    setOpen(false)
  }

  const handleOpen = useCallback((draft?: TodoDraftPayload) => {
    setFormData(getDraftFormData(draft))
    setSelectedTagId(draft?.tagId ?? currentTagId)
    setOpen(true)
  }, [currentTagId])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && !open) {
      setFormData({ ...emptyTodoForm })
      setSelectedTagId(currentTagId)
    }
    setOpen(nextOpen)
  }, [currentTagId, open])

  useEffect(() => {
    emitter.on('toolbar-shortcut-todo', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-todo', handleOpen)
    }
  }, [handleOpen])

  const formContent = (
    <TodoForm
      mode="create"
      data={formData}
      onChange={setFormData}
      selectedTagId={selectedTagId}
      onTagChange={setSelectedTagId}
      tags={tags}
      showTagSelector={true}
      showReminderOption={true}
    />
  )

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>
            <TooltipButton icon={<CheckSquare />} tooltipText={t('record.mark.type.todo')} />
          </DrawerTrigger>
          <DrawerContent className="max-h-[88vh]">
            <DrawerHeader className="px-4 py-2.5 text-left">
              <DrawerTitle className="text-sm">{t('record.mark.todo.createTitle')}</DrawerTitle>
              <DrawerDescription className="text-xs">
                {t('record.mark.todo.createDescription')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-2.5">
              {formContent}
            </div>
            <DrawerFooter className="border-t border-border/70 px-4 py-2.5">
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="h-9 w-full shadow-none"
              >
                {t('record.mark.todo.save')}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton icon={<CheckSquare />} tooltipText={t('record.mark.type.todo')} />
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-[560px] gap-0 overflow-hidden p-0">
            <DialogHeader className="border-b border-border/70 px-3.5 py-2.5">
              <DialogTitle className="text-sm">{t('record.mark.todo.createTitle')}</DialogTitle>
              <DialogDescription className="text-xs">
                {t('record.mark.todo.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[calc(100vh-9.5rem)] overflow-y-auto px-3.5 py-3">
              {formContent}
            </div>
            <DialogFooter className="border-t border-border/70 bg-muted/10 px-3.5 py-2">
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="h-8 px-3 text-xs shadow-none"
              >
                {t('record.mark.todo.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
