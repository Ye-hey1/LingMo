import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import dayjs from "dayjs"
import relativeTime from 'dayjs/plugin/relativeTime'
import { updateMark } from "@/db/marks"
import { useState, useMemo, useCallback } from "react"
import { CheckSquare, Square, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"
import { getMarkTypeListBadgeClasses } from "./mark-type-meta"
import { parseTodoMarkContent } from "./mark-list-item-content"
import { TodoEditTrigger } from "./todo-edit-button"
import { Priority, Subtask } from "./todo-form"

dayjs.extend(relativeTime)

interface TodoData {
  title: string
  description: string
  completed: boolean
  priority: Priority
  dueDate?: string
  subtasks?: Subtask[]
}

function isOverdue(todo: TodoData): boolean {
  if (!todo.dueDate || todo.completed) return false
  const due = new Date(todo.dueDate + 'T23:59:59')
  return due.getTime() < Date.now()
}

function isDueToday(dueDate: string): boolean {
  const today = dayjs().format('YYYY-MM-DD')
  return dueDate === today
}

export function TodoItemContent({ mark }: { mark: Mark }) {
  const t = useTranslations()
  const { fetchMarks } = useMarkStore()
  const { recordTextSize } = useSettingStore()

  const [todoData, setTodoData] = useState<TodoData>(() => {
    return parseTodoMarkContent(mark)
  })
  const [showSubtasks, setShowSubtasks] = useState(false)

  const getLineHeight = (textSize: string) => {
    const heightMap = {
      'xs': 'leading-3',
      'sm': 'leading-4',
      'md': 'leading-5',
      'lg': 'leading-6',
      'xl': 'leading-7'
    }
    return heightMap[textSize as keyof typeof heightMap] || 'leading-4'
  }

  const lineHeight = getLineHeight(recordTextSize)

  const getPriorityColor = (priority: Priority) => {
    const colors = {
      low: 'bg-green-500',
      medium: 'bg-orange-500',
      high: 'bg-red-500'
    }
    return colors[priority]
  }

  const overdue = isOverdue(todoData)
  const dueToday = todoData.dueDate ? isDueToday(todoData.dueDate) : false

  const subtaskProgress = useMemo(() => {
    if (!todoData.subtasks || todoData.subtasks.length === 0) return 0
    const completed = todoData.subtasks.filter(s => s.completed).length
    return Math.round((completed / todoData.subtasks.length) * 100)
  }, [todoData.subtasks])

  const completedSubtaskCount = useMemo(() => {
    return todoData.subtasks?.filter(s => s.completed).length || 0
  }, [todoData.subtasks])

  const handleToggleComplete = useCallback(async () => {
    const newData = { ...todoData, completed: !todoData.completed }
    setTodoData(newData)
    await updateMark({ ...mark, content: JSON.stringify(newData) })
    await fetchMarks()
  }, [todoData, mark, fetchMarks])

  const toggleSubtask = useCallback(async (subtaskId: string) => {
    if (!todoData.subtasks) return
    const newSubtasks = todoData.subtasks.map(st =>
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    )
    const newData = { ...todoData, subtasks: newSubtasks }
    setTodoData(newData)
    await updateMark({ ...mark, content: JSON.stringify(newData) })
    await fetchMarks()
  }, [todoData, mark, fetchMarks])

  const priorityDotColor = getPriorityColor(todoData.priority)

  const formatDate = (dateStr: string) => {
    return dayjs(dateStr).format('MM/DD')
  }

  return (
    <>
      <div className="flex-1 pr-10 md:pr-0 group">
        <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
          <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
            {t('record.mark.type.todo')}
          </span>
          <span className={cn("w-2 h-2 rounded-full", priorityDotColor)} />
          <span className="ml-auto">{dayjs(mark.createdAt).fromNow()}</span>
        </div>

        <div className="mt-2">
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleComplete}
              className="flex-shrink-0 hover:scale-110 transition-transform"
            >
              {todoData.completed ? (
                <CheckSquare className="w-5 h-5 text-green-600" />
              ) : (
                <Square className="w-5 h-5 text-zinc-400" />
              )}
            </button>

            <TodoEditTrigger mark={mark} className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <p className={cn(
                  `font-medium text-${recordTextSize} truncate`,
                  todoData.completed && "line-through text-zinc-500"
                )}>
                  {todoData.title}
                </p>
                {todoData.dueDate && !todoData.completed && (
                  <span className={cn(
                    "shrink-0 text-[11px] px-1.5 py-0.5 rounded",
                    overdue ? "bg-red-500/10 text-red-600 dark:text-red-400 font-medium" :
                    dueToday ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                    "text-muted-foreground"
                  )}>
                    {overdue && <AlertTriangle className="size-3 inline mr-0.5" />}
                    {overdue ? t('record.mark.todo.overdue') : dueToday ? t('record.mark.todo.dueToday') : formatDate(todoData.dueDate)}
                  </span>
                )}
              </div>
              {todoData.description && (
                <div className={cn("mt-1", todoData.completed && "opacity-50")}>
                  <p className={cn(
                    `text-${recordTextSize} text-muted-foreground line-clamp-2 ${lineHeight}`,
                    todoData.completed && "line-through"
                  )}>
                    {todoData.description}
                  </p>
                </div>
              )}
            </TodoEditTrigger>
          </div>

          {/* 子任务进度 */}
          {todoData.subtasks && todoData.subtasks.length > 0 && (
            <div className="mt-1.5 ml-8">
              <button
                type="button"
                className="flex items-center gap-2 w-full text-left"
                onClick={() => setShowSubtasks(!showSubtasks)}
              >
                {showSubtasks ? (
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${subtaskProgress}%` }}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {completedSubtaskCount}/{todoData.subtasks.length}
                </span>
              </button>

              {/* 子任务列表 */}
              {showSubtasks && (
                <div className="mt-1 space-y-0.5 pl-5">
                  {todoData.subtasks.map((st) => (
                    <div key={st.id} className="flex items-center gap-2 py-0.5">
                      <button
                        type="button"
                        onClick={() => toggleSubtask(st.id)}
                        className="flex-shrink-0 hover:scale-110 transition-transform"
                      >
                        {st.completed ? (
                          <CheckSquare className="size-3.5 text-green-600" />
                        ) : (
                          <Square className="size-3.5 text-zinc-400" />
                        )}
                      </button>
                      <span className={cn(
                        "text-xs",
                        st.completed && "line-through text-muted-foreground"
                      )}>
                        {st.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
