"use client"

import * as React from "react"
import type { AgentActivity, AgentEvent, AgentState, AgentTurnTelemetry, ToolCall, AgentPartSnapshot } from "@/lib/agent"
import { isSupportOnlyToolName } from "@/lib/agent/support-tools"
import { AgentRunSummary } from "./agent-run-summary"
import { AgentTaskPlanPanel } from "./agent-task-plan-panel"

type AgentLiveStreamProps = {
  isRunning: boolean
  isThinking: boolean
  currentThought?: string
  currentAction?: string
  currentObservation?: string
  visibleOutput?: string
  steps?: AgentState["completedSteps"]
  toolCalls?: ToolCall[]
  agentEvents?: AgentEvent[]
  activity?: AgentActivity
  telemetry?: AgentTurnTelemetry
  currentStepStartTime?: number
  taskPlan?: AgentState["taskPlan"]
  partSnapshot?: AgentPartSnapshot
}

function useLiveElapsedMs(input: {
  isRunning: boolean
  telemetry?: AgentTurnTelemetry
  currentStepStartTime?: number
  activity?: AgentActivity
}) {
  const getElapsed = React.useCallback(() => {
    const startedAt = input.telemetry?.startedAt || input.currentStepStartTime || input.activity?.startedAt
    if (!startedAt) return input.telemetry?.elapsedMs
    if (!input.isRunning) return input.telemetry?.elapsedMs ?? Math.max(0, Date.now() - startedAt)
    return Math.max(0, Date.now() - startedAt)
  }, [input.activity?.startedAt, input.currentStepStartTime, input.isRunning, input.telemetry?.elapsedMs, input.telemetry?.startedAt])

  const [elapsedMs, setElapsedMs] = React.useState<number | undefined>(() => getElapsed())

  React.useEffect(() => {
    setElapsedMs(getElapsed())
    if (!input.isRunning) return
    const timer = window.setInterval(() => {
      setElapsedMs(getElapsed())
    }, 250)
    return () => window.clearInterval(timer)
  }, [getElapsed, input.isRunning])

  return elapsedMs
}

export function AgentLiveStream({
  isRunning,
  currentThought,
  currentAction,
  currentObservation,
  visibleOutput,
  steps = [],
  toolCalls = [],
  agentEvents = [],
  activity,
  telemetry,
  currentStepStartTime,
  taskPlan,
  partSnapshot,
}: AgentLiveStreamProps) {
  const visibleToolCalls = React.useMemo(
    () => toolCalls.filter(call => !isSupportOnlyToolName(call.toolName)),
    [toolCalls],
  )
  const elapsedMs = useLiveElapsedMs({ isRunning, telemetry, currentStepStartTime, activity })

  if (!isRunning) return null

  return (
    <>
      <AgentTaskPlanPanel taskPlan={taskPlan} />
      <AgentRunSummary
        elapsedMs={elapsedMs}
        telemetry={telemetry}
        visibleOutput={visibleOutput}
        steps={steps}
        toolCalls={visibleToolCalls}
        events={agentEvents}
        activity={activity}
        currentThought={currentThought}
        currentAction={currentAction}
        currentObservation={currentObservation}
        partSnapshot={partSnapshot}
        live
      />
    </>
  )
}
