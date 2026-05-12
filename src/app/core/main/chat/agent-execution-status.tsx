import * as React from "react"
import useChatStore from "@/stores/chat"
import { AgentPanelWithRag } from "./agent-panel-with-rag"
import type { AgentApprovalScope } from "@/lib/agent/types"
import {
  recordPersistentApprovalHistory,
  rememberPersistentAgentApproval,
} from "@/lib/agent/persistent-approval"

/**
 * Agent execution status component - displays real-time agent execution state
 * This component uses AgentPanelWithRag to show both RAG sources and Agent steps together
 */
export function AgentExecutionStatus() {
  const {
    agentState,
    setAgentState,
    currentConversationId,
    setAgentAutoApproveConversationId,
    setAgentAutoApproveRuntimeSkillId,
  } = useChatStore()

  // Handle confirmation
  const handleConfirm = async (scope: AgentApprovalScope = 'once') => {
    if (!agentState.pendingConfirmation) return

    const confirmationRecord = {
      toolName: agentState.pendingConfirmation.toolName,
      params: agentState.pendingConfirmation.params,
      status: 'confirmed' as const,
      timestamp: Date.now(),
      scope,
      sessionApprovalType: agentState.pendingConfirmation.sessionApprovalType,
      sessionApprovalSkillId: agentState.pendingConfirmation.sessionApprovalSkillId,
    }

    if (scope === 'conversation' && currentConversationId !== null) {
      setAgentAutoApproveConversationId(currentConversationId)
      setAgentAutoApproveRuntimeSkillId(
        agentState.pendingConfirmation.sessionApprovalType === 'runtime-script-skill'
          ? agentState.pendingConfirmation.sessionApprovalSkillId || null
          : null
      )
    }

    try {
      if (scope === 'always-tool' || scope === 'always-folder' || scope === 'always-readonly') {
        await rememberPersistentAgentApproval(
          scope,
          agentState.pendingConfirmation.toolName,
          agentState.pendingConfirmation.params
        )
      }

      await recordPersistentApprovalHistory(confirmationRecord, currentConversationId)
    } catch (error) {
      console.error('[Agent Approval] Failed to persist approval decision:', error)
    }

    // Confirm while keeping isRunning: true, only clear pendingConfirmation
    setAgentState({
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: true  // Explicitly keep running state
    })
  }

  const handleCancel = async () => {
    if (!agentState.pendingConfirmation) return

    const confirmationRecord = {
      toolName: agentState.pendingConfirmation.toolName,
      params: agentState.pendingConfirmation.params,
      status: 'cancelled' as const,
      timestamp: Date.now()
    }

    try {
      await recordPersistentApprovalHistory(confirmationRecord, currentConversationId)
    } catch (error) {
      console.error('[Agent Approval] Failed to persist cancelled approval:', error)
    }

    // Cancel and stop agent execution
    setAgentState({
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: false
    })
  }

  return (
    <AgentPanelWithRag
      ragSources={agentState.ragSources || []}
      ragSourceDetails={agentState.ragSourceDetails || []}
      isRunning={agentState.isRunning}
      isThinking={agentState.isThinking}
      currentThought={agentState.currentThought}
      thoughtHistory={agentState.thoughtHistory}
      completedSteps={agentState.completedSteps}
      currentAction={agentState.currentAction}
      currentObservation={agentState.currentObservation}
      toolCalls={agentState.toolCalls}
      pendingConfirmation={agentState.pendingConfirmation}
      confirmationHistory={agentState.confirmationHistory}
      currentStepStartTime={agentState.currentStepStartTime}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
