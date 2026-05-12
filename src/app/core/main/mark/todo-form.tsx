import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"

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
}

interface TodoFormProps {
  mode: 'create' | 'edit'
  data: TodoFormData
  onChange: (data: TodoFormData) => void
  selectedTagId?: number
  onTagChange?: (tagId: number) => void
  tags?: Array<{ id: number; name: string }>
  showTagSelector?: boolean
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

export function TodoForm({
  mode,
  data,
  onChange,
  selectedTagId,
  onTagChange,
  tags = [],
  showTagSelector = false,
}: TodoFormProps) {
  const t = useTranslations()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
    } else if (e.key === 'Escape') {
      // 父组件处理关闭
    }
  }

  const addSubtask = (title: string) => {
    const subtasks = [...(data.subtasks || []), { id: generateId(), title, completed: false }]
    onChange({ ...data, subtasks })
  }

  const removeSubtask = (index: number) => {
    const subtasks = [...(data.subtasks || [])]
    subtasks.splice(index, 1)
    onChange({ ...data, subtasks })
  }

  const updateSubtaskTitle = (index: number, title: string) => {
    const subtasks = [...(data.subtasks || [])]
    subtasks[index] = { ...subtasks[index], title }
    onChange({ ...data, subtasks })
  }

  return (
    <div className="space-y-3.5">
      {/* Row 1: 标签 + 标题 */}
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        {showTagSelector && onTagChange ? (
          <div>
            <Label htmlFor="todo-tag" className="text-[11px] text-muted-foreground">{t('record.mark.todo.selectTag')}</Label>
            <Select value={String(selectedTagId)} onValueChange={(value) => onTagChange(Number(value))}>
              <SelectTrigger className="mt-1 h-9">
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
        <div className={!showTagSelector ? 'col-span-full' : ''}>
          <Label htmlFor={`todo-title-${mode}`} className="text-[11px] text-muted-foreground">{t('record.mark.todo.title')} *</Label>
          <Input
            id={`todo-title-${mode}`}
            value={data.title}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
            placeholder={t('record.mark.todo.titlePlaceholder')}
            onKeyDown={handleKeyDown}
            autoFocus
            className="mt-1 h-9"
          />
        </div>
      </div>

      {/* Row 2: 描述 */}
      <div>
        <Label htmlFor={`todo-description-${mode}`} className="text-[11px] text-muted-foreground">{t('record.mark.todo.description')}</Label>
        <Textarea
          id={`todo-description-${mode}`}
          rows={2}
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
          placeholder={t('record.mark.todo.descriptionPlaceholder')}
          className="mt-1 resize-none text-sm"
        />
      </div>

      {/* Row 3: 优先级 + 截止日期 */}
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div>
          <Label htmlFor={`todo-priority-${mode}`} className="text-[11px] text-muted-foreground">{t('record.mark.todo.priority')}</Label>
          <Tabs value={data.priority} onValueChange={(value) => onChange({ ...data, priority: value as Priority })} className="mt-1">
            <TabsList className="grid h-9 w-full grid-cols-3">
              <TabsTrigger value="low" className="gap-1.5 text-xs data-[state=active]:bg-accent">
                <span className="size-1.5 rounded-full bg-green-500" />
                {t('record.mark.todo.priorityLow')}
              </TabsTrigger>
              <TabsTrigger value="medium" className="gap-1.5 text-xs data-[state=active]:bg-accent">
                <span className="size-1.5 rounded-full bg-orange-500" />
                {t('record.mark.todo.priorityMedium')}
              </TabsTrigger>
              <TabsTrigger value="high" className="gap-1.5 text-xs data-[state=active]:bg-accent">
                <span className="size-1.5 rounded-full bg-red-500" />
                {t('record.mark.todo.priorityHigh')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div>
          <Label htmlFor={`todo-due-date-${mode}`} className="text-[11px] text-muted-foreground">{t('record.mark.todo.dueDate')}</Label>
          <Input
            id={`todo-due-date-${mode}`}
            type="date"
            value={data.dueDate || ''}
            onChange={(e) => onChange({ ...data, dueDate: e.target.value || undefined })}
            className="mt-1 h-9"
          />
        </div>
      </div>

      {/* Row 4: 子任务 */}
      <div>
        <Label className="text-[11px] text-muted-foreground">{t('record.mark.todo.subtasks')}</Label>
        <div className="mt-1 space-y-1">
          {data.subtasks?.map((st, idx) => (
            <div key={st.id} className="flex items-center gap-1.5">
              <Input
                value={st.title}
                onChange={(e) => updateSubtaskTitle(idx, e.target.value)}
                className="h-7 text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeSubtask(idx)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
          <Input
            placeholder={t('record.mark.todo.subtaskPlaceholder')}
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                addSubtask(e.currentTarget.value.trim())
                e.currentTarget.value = ''
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}
