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
import emitter from "@/lib/emitter"
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { TodoForm, TodoFormData } from "./todo-form"

function parseReminderAt(value?: string) {
  if (!value) return undefined
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

export function ControlTodo() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<TodoFormData>({
    title: '',
    description: '',
    priority: 'medium'
  })
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

    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      dueDate: undefined,
      subtasks: undefined,
      reminderEnabled: false,
      reminderAt: undefined,
    })
    setOpen(false)
  }

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open)
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-todo', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-todo', handleOpen)
    }
  }, [handleOpen])

  // Sync selectedTagId with currentTagId when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedTagId(currentTagId)
    }
  }, [open, currentTagId])

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
          <DrawerContent className="max-h-[92vh]">
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.todo.createTitle')}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.todo.createDescription')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-2">
              {formContent}
            </div>
            <DrawerFooter>
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
                className="w-full"
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
          <DialogContent className="w-[calc(100vw-2rem)] max-w-[920px] gap-0 p-0">
            <DialogHeader className="border-b border-border/70 px-5 py-4">
              <DialogTitle>{t('record.mark.todo.createTitle')}</DialogTitle>
              <DialogDescription>
                {t('record.mark.todo.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[calc(100vh-13rem)] overflow-y-auto px-5 py-4">
              {formContent}
            </div>
            <DialogFooter className="border-t border-border/70 px-5 py-3">
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!canSubmit}
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
