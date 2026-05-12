import React from 'react'
import useChatStore from '@/stores/chat'
import { Check, Loader2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TaskPlanProgress() {
  const { agentState } = useChatStore()
  const { taskPlan, isRunning } = agentState

  if (!taskPlan || !taskPlan.isComplex || taskPlan.steps.length === 0) {
    return null
  }

  // Hide after agent completes and all steps are done
  if (!isRunning && taskPlan.completedStepIndex >= taskPlan.steps.length - 1) {
    return null
  }

  return (
    <div className="px-2 py-1.5 border-b border-border/50">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {isRunning ? (
          <Loader2 className="size-3 animate-spin text-primary" />
        ) : (
          <Check className="size-3 text-green-500" />
        )}
        <span className="font-medium text-foreground/80">{taskPlan.summary || '执行计划'}</span>
      </div>
      <div className="flex flex-col gap-0.5 pl-1">
        {taskPlan.steps.map((step, index) => {
          const isCompleted = index <= taskPlan.completedStepIndex
          const isCurrent = !isCompleted && index === taskPlan.completedStepIndex + 1 && isRunning
          const isPending = !isCompleted && !isCurrent

          return (
            <div
              key={index}
              className={cn(
                'flex items-center gap-2 text-[11px] leading-5 transition-colors',
                isCompleted && 'text-muted-foreground line-through opacity-60',
                isCurrent && 'text-foreground font-medium',
                isPending && 'text-muted-foreground/60',
              )}
            >
              {isCompleted ? (
                <Check className="size-3 shrink-0 text-green-500" />
              ) : isCurrent ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
              ) : (
                <Circle className="size-3 shrink-0" />
              )}
              <span className="truncate">{step.description}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
