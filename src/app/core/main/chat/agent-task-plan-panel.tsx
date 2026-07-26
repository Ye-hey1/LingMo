"use client"

import { Circle, ListChecks, Loader2 } from "lucide-react"
import type { AgentState } from "@/lib/agent"

/**
 * 任务规划进度面板。
 *
 * 这套 UI 原本实现在 components/ui/agent-plan.tsx 的 renderTaskPlan 里，
 * 但它唯一的宿主 agent-panel-with-rag.tsx 从未被引用，所以从来没显示过。
 * 这里把它抽成独立组件，接入实际生效的 live 渲染链路
 * （AgentExecutionStatus → AgentLiveStream → AgentRunSummary）。
 */
export function AgentTaskPlanPanel({ taskPlan }: { taskPlan?: AgentState["taskPlan"] }) {
  if (!taskPlan || !taskPlan.isComplex || taskPlan.steps.length === 0) {
    return null
  }

  const { steps, summary, completedStepIndex } = taskPlan
  const totalSteps = steps.length
  const doneCount = Math.max(0, completedStepIndex + 1)
  const progressPct = Math.round((doneCount / totalSteps) * 100)
  const allDone = completedStepIndex >= totalSteps - 1

  return (
    <div className="mb-1.5 rounded-md border border-border/20 bg-muted/8 px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ListChecks className="size-3.5 text-muted-foreground/55 shrink-0" />
        <span className="text-[11px] font-medium text-foreground/80 truncate">
          {summary || `任务规划 (${totalSteps} 步)`}
        </span>
        <span className="ml-auto shrink-0 text-[10px] leading-none font-medium text-muted-foreground/70">
          {allDone ? "✓" : `${doneCount}/${totalSteps}`}
        </span>
      </div>

      <div className="h-1 w-full rounded-full bg-muted overflow-hidden mb-1.5">
        <div
          className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-muted-foreground/35" : "bg-muted-foreground/30"}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ol className="space-y-1">
        {steps.map((step, index) => {
          const isCompleted = index <= completedStepIndex
          const isRunning = index === completedStepIndex + 1 && !allDone

          return (
            <li key={index} className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">
                {isCompleted ? (
                  <span className="block size-2 rounded-full bg-muted-foreground/30" />
                ) : isRunning ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground/45" />
                ) : (
                  <Circle className="size-3.5 text-muted-foreground/40" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs leading-relaxed ${
                    isCompleted
                      ? "text-muted-foreground line-through decoration-muted-foreground/30"
                      : isRunning
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/60"
                  }`}
                >
                  <span className="text-muted-foreground/50 mr-1">{index + 1}.</span>
                  {step.description}
                </div>
                {step.tools.length > 0 && !isCompleted && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {step.tools.map((tool, ti) => (
                      <span key={ti} className="rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground/50">
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
