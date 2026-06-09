import { createAgentRunId } from './run-id'
import type { AgentRoute, AgentRunSnapshot } from './types'

export interface AgentOrchestratorInput {
  userInput: string
  route: AgentRoute
  legacyAgentExecutor?: () => Promise<string>
  writerExecutor?: () => Promise<string>
}

export class AgentOrchestrator {
  async run(input: AgentOrchestratorInput): Promise<{ runId: string; result: string; snapshot: AgentRunSnapshot }> {
    const runId = createAgentRunId()
    const started: AgentRunSnapshot = {
      runId,
      status: 'running',
      userGoal: input.userInput,
      route: input.route,
      draftRefs: [],
      observationRefs: [],
      approvalHistory: [],
      updatedAt: Date.now(),
    }

    const result = input.route === 'writer' || input.route === 'advisor'
      ? await input.writerExecutor?.() || ''
      : await input.legacyAgentExecutor?.() || ''

    return {
      runId,
      result,
      snapshot: {
        ...started,
        status: 'completed',
        finalAnswer: result,
        updatedAt: Date.now(),
      },
    }
  }
}
