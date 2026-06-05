import * as React from "react"
import { CheckCircle, CheckCircle2, ChevronDown, ChevronUp, Clock, XCircle } from "lucide-react"
import useChatStore from "@/stores/chat"
import { Button } from "@/components/ui/button"
import { DiffViewer } from "@/components/ui/diff-viewer"
import { AgentLiveStream } from "./agent-live-stream"
import type { AgentApprovalScope } from "@/lib/agent"
import {
  formatConfirmationPreview,
  recordPersistentApprovalHistory,
  rememberPersistentAgentApproval,
} from "@/lib/agent"
import { cn } from "@/lib/utils"

function formatToolLabel(toolName: string) {
  return toolName
    .replace(/^mcp__/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function formatFieldValue(value: unknown) {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AgentExecutionStatus() {
  const {
    agentState,
    setAgentState,
    currentConversationId,
    setAgentAutoApproveConversationId,
    setAgentAutoApproveRuntimeSkillId,
  } = useChatStore()
  const [showDiff, setShowDiff] = React.useState(true)

  const pendingConfirmation = agentState.pendingConfirmation
  const confirmationPreview = React.useMemo(() => {
    if (!pendingConfirmation) return null
    return formatConfirmationPreview(
      pendingConfirmation.toolName,
      pendingConfirmation.previewParams ?? pendingConfirmation.params ?? {},
    )
  }, [pendingConfirmation])

  const handleConfirm = async (scope: AgentApprovalScope = "once") => {
    if (!pendingConfirmation) return

    const confirmationRecord = {
      toolName: pendingConfirmation.toolName,
      params: pendingConfirmation.params,
      status: "confirmed" as const,
      timestamp: Date.now(),
      scope,
      sessionApprovalType: pendingConfirmation.sessionApprovalType,
      sessionApprovalSkillId: pendingConfirmation.sessionApprovalSkillId,
    }

    if (scope === "conversation" && currentConversationId !== null) {
      setAgentAutoApproveConversationId(currentConversationId)
      setAgentAutoApproveRuntimeSkillId(
        pendingConfirmation.sessionApprovalType === "runtime-script-skill"
          ? pendingConfirmation.sessionApprovalSkillId || null
          : null,
      )
    }

    try {
      if (scope === "always-tool" || scope === "always-folder" || scope === "always-readonly") {
        await rememberPersistentAgentApproval(
          scope,
          pendingConfirmation.toolName,
          pendingConfirmation.params,
        )
      }

      await recordPersistentApprovalHistory(confirmationRecord, currentConversationId)
    } catch (error) {
      console.error("[Agent Approval] Failed to persist approval decision:", error)
    }

    setAgentState({
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: true,
    })
  }

  const handleCancel = async () => {
    if (!pendingConfirmation) return

    const confirmationRecord = {
      toolName: pendingConfirmation.toolName,
      params: pendingConfirmation.params,
      status: "cancelled" as const,
      timestamp: Date.now(),
    }

    try {
      await recordPersistentApprovalHistory(confirmationRecord, currentConversationId)
    } catch (error) {
      console.error("[Agent Approval] Failed to persist cancelled approval:", error)
    }

    setAgentState({
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: false,
    })
  }

  if (!pendingConfirmation) {
    return (
      <AgentLiveStream
        isRunning={agentState.isRunning}
        isThinking={agentState.isThinking}
        currentThought={agentState.currentThought}
        currentAction={agentState.currentAction}
        currentObservation={agentState.currentObservation}
        toolCalls={agentState.toolCalls}
        agentEvents={agentState.agentEvents}
        activity={agentState.activity}
        telemetry={agentState.telemetry}
        currentStepStartTime={agentState.currentStepStartTime}
        taskPlan={agentState.taskPlan}
      />
    )
  }

  const title = confirmationPreview?.titleKey || formatToolLabel(pendingConfirmation.toolName)
  const description = confirmationPreview?.descriptionKey || "Review this action before continuing"
  const hasDiff = Boolean(pendingConfirmation.originalContent && pendingConfirmation.modifiedContent)

  return (
    <div className="w-full overflow-hidden rounded-md border border-border/30 bg-background/70">
      <div className="flex min-w-0 items-start justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <Clock className="mt-0.5 size-3.5 shrink-0 animate-pulse text-muted-foreground/60" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground/85">
              {title}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground/55">
              {description}
            </div>
            {pendingConfirmation.filePath && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground/45">
                {pendingConfirmation.filePath}
              </div>
            )}
          </div>
        </div>

        {hasDiff && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => setShowDiff(!showDiff)}
          >
            {showDiff ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            <span className="ml-1">Diff</span>
          </Button>
        )}
      </div>

      {hasDiff && showDiff && (
        <div className="border-t border-border/30">
          <DiffViewer
            original={pendingConfirmation.originalContent || ""}
            modified={pendingConfirmation.modifiedContent || ""}
            mode="lines"
            showLineNumbers={true}
            maxHeight={220}
            className="rounded-none border-0"
          />
        </div>
      )}

      {!hasDiff && confirmationPreview?.fields?.length ? (
        <div className="space-y-2 border-t border-border/30 px-3 py-2">
          {confirmationPreview.fields.map((field) => (
            <div key={field.name} className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground/65">
                {field.name}
              </div>
              <pre className={cn(
                "max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/25 px-2 py-1 text-[11px]",
                "font-mono text-foreground/80",
              )}>
                {formatFieldValue(field.value)}
              </pre>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border/30 px-3 py-2">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleCancel}>
          <XCircle className="size-4 text-red-500" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleConfirm("once")}>
          <CheckCircle className="size-4 text-green-500" />
          <span className="ml-1">允许这次</span>
        </Button>
        {pendingConfirmation.canApproveForSession && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleConfirm("conversation")}>
            <CheckCircle2 className="size-4 text-green-600" />
            <span className="ml-1">本会话允许</span>
          </Button>
        )}
        {pendingConfirmation.persistentApprovalOptions?.includes("always-tool") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleConfirm("always-tool")}>
            <CheckCircle2 className="size-4 text-green-700" />
            <span className="ml-1">总是允许此工具</span>
          </Button>
        )}
        {pendingConfirmation.persistentApprovalOptions?.includes("always-folder") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleConfirm("always-folder")}>
            <CheckCircle2 className="size-4 text-green-700" />
            <span className="ml-1">总是允许此路径</span>
          </Button>
        )}
        {pendingConfirmation.persistentApprovalOptions?.includes("always-readonly") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleConfirm("always-readonly")}>
            <CheckCircle2 className="size-4 text-green-700" />
            <span className="ml-1">总是允许只读</span>
          </Button>
        )}
      </div>
    </div>
  )
}
