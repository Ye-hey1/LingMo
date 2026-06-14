import { createAgentRunId } from './run-id'
import { buildContextPack } from './context-engine'
import { AgentMiddlewareRuntime, createSkillMcpMiddleware } from './middleware'
import { saveRunSnapshot } from './run-snapshot-store'
import { executeHarnessTool } from './tool-runtime'
import { writeAgentVfsText } from './vfs'
import type { AgentEvent } from '@/lib/agent/types'
import type { AgentHarnessMiddleware, AgentRoute, AgentRunControl, AgentRunSnapshot, ContextPack, VfsRef } from './types'

export interface AgentOrchestratorInput {
  userInput: string
  route: AgentRoute
  runId?: string
  forcedSkillIds?: string[]
  webSearchEnabled?: boolean
  middlewares?: AgentHarnessMiddleware[]
  agentExecutor?: (control: AgentRunControl) => Promise<string>
  writerExecutor?: (control: AgentRunControl) => Promise<string>
}

export class AgentOrchestrator {
  async run(input: AgentOrchestratorInput): Promise<{ runId: string; result: string; snapshot: AgentRunSnapshot }> {
    const runId = input.runId || createAgentRunId()
    let snapshot: AgentRunSnapshot = {
      runId,
      status: 'running',
      userGoal: input.userInput,
      route: input.route,
      draftRefs: [],
      observationRefs: [],
      approvalHistory: [],
      updatedAt: Date.now(),
    }

    await saveRunSnapshot(snapshot)
    let eventWriteQueue: Promise<void> = Promise.resolve()
    const middlewareRuntime = new AgentMiddlewareRuntime(input.middlewares || [
      createSkillMcpMiddleware(),
    ])

    const updateSnapshot = async (patch: Partial<AgentRunSnapshot>) => {
      snapshot = {
        ...snapshot,
        ...patch,
        updatedAt: Date.now(),
      }
      await saveRunSnapshot(snapshot)
    }

    const recordEvent = (event: AgentEvent) => {
      eventWriteQueue = eventWriteQueue
        .then(() => this.recordEvent(runId, event, () => snapshot, (patch) => updateSnapshot(patch)))
        .catch((error) => {
          console.warn('[AgentHarness] Failed to record event:', error)
      })
    }

    await middlewareRuntime.beforeRun({
      runId,
      route: input.route,
      userInput: input.userInput,
      forcedSkillIds: input.forcedSkillIds,
      webSearchEnabled: input.webSearchEnabled,
    })

    const control: AgentRunControl = {
      runId,
      route: input.route,
      recordEvent,
      executeTool: async ({ tool, params, context }) => {
        const execution = await executeHarnessTool(tool, params, {
          ...context,
          runId,
        })

        const dataRef = execution.observation.dataRef
        if (dataRef) {
          await updateSnapshot({
            observationRefs: [
              ...snapshot.observationRefs,
              vfsRefFromUri(runId, dataRef, 'observation', execution.observation.summary),
            ],
          })
        }

        return await control.afterTool({
          tool,
          params,
          context,
          execution,
          selectedSkillIds: middlewareRuntime.getState().skills?.selectedSkillIds,
          activeSkillIds: middlewareRuntime.getState().skills?.activeSkillIds,
        })
      },
      setContextPack: async ({ tokenBudget, items, deferred }): Promise<ContextPack> => {
        const pack = buildContextPack({
          runId,
          tokenBudget,
          items,
          deferred,
        })
        const contextPackRef = await writeAgentVfsText(
          runId,
          'context',
          'context-pack.json',
          JSON.stringify(pack, null, 2),
          `${pack.included.length} context items, ${pack.deferred.length} deferred refs`,
        )
        await updateSnapshot({ contextPackRef })
        return pack
      },
      writeDraft: async (path, content, summary) => {
        const ref = await writeAgentVfsText(runId, 'draft', path, content, summary)
        await updateSnapshot({ draftRefs: [...snapshot.draftRefs, ref] })
        return ref
      },
      getSnapshot: () => snapshot,
      getMiddlewareState: () => middlewareRuntime.getState(),
      setMiddlewareState: (patch) => middlewareRuntime.setState(patch),
      prepareModel: async (prepareInput) => {
        return middlewareRuntime.beforeModel({
          runId,
          route: input.route,
          userInput: input.userInput,
          iteration: prepareInput.iteration,
          tools: prepareInput.tools,
          steps: prepareInput.steps,
          selectedSkillIds: prepareInput.selectedSkillIds || middlewareRuntime.getState().skills?.selectedSkillIds || [],
          activeSkillIds: prepareInput.activeSkillIds || middlewareRuntime.getState().skills?.activeSkillIds || [],
          state: middlewareRuntime.getState(),
          intentPolicy: prepareInput.intentPolicy,
          webSearchEnabled: prepareInput.webSearchEnabled,
        })
      },
      authorizeTool: async (authorizeInput) => {
        return middlewareRuntime.beforeTool({
          runId,
          route: input.route,
          userInput: input.userInput,
          tool: authorizeInput.tool,
          params: authorizeInput.params,
          context: authorizeInput.context,
          selectedSkillIds: authorizeInput.selectedSkillIds || middlewareRuntime.getState().skills?.selectedSkillIds || [],
          activeSkillIds: authorizeInput.activeSkillIds || middlewareRuntime.getState().skills?.activeSkillIds || [],
          state: middlewareRuntime.getState(),
          intentPolicy: authorizeInput.intentPolicy,
          webSearchEnabled: authorizeInput.webSearchEnabled,
        })
      },
      afterTool: async (afterToolInput) => {
        return middlewareRuntime.afterTool({
          runId,
          route: input.route,
          userInput: input.userInput,
          tool: afterToolInput.tool,
          params: afterToolInput.params,
          context: afterToolInput.context,
          execution: afterToolInput.execution,
          selectedSkillIds: afterToolInput.selectedSkillIds || middlewareRuntime.getState().skills?.selectedSkillIds || [],
          activeSkillIds: afterToolInput.activeSkillIds || middlewareRuntime.getState().skills?.activeSkillIds || [],
          state: middlewareRuntime.getState(),
        })
      },
    }

    try {
      const result = input.route === 'writer' || input.route === 'advisor'
        ? await input.writerExecutor?.(control) || ''
        : await input.agentExecutor?.(control) || ''

      await eventWriteQueue
      await updateSnapshot({
        status: 'completed',
        finalAnswer: result,
      })
      await this.runAfterRunMiddleware(middlewareRuntime, {
        runId,
        route: input.route,
        userInput: input.userInput,
        result,
        snapshot,
        state: middlewareRuntime.getState(),
      })

      return {
        runId,
        result,
        snapshot,
      }
    } catch (error) {
      await eventWriteQueue
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'USER_STOPPED') {
        await updateSnapshot({ status: 'paused' })
      } else {
        await updateSnapshot({
          status: 'failed',
          finalAnswer: message,
        })
      }
      await this.runAfterRunMiddleware(middlewareRuntime, {
        runId,
        route: input.route,
        userInput: input.userInput,
        result: message === 'USER_STOPPED' ? '' : message,
        snapshot,
        state: middlewareRuntime.getState(),
      })
      throw error
    }
  }

  private async runAfterRunMiddleware(
    middlewareRuntime: AgentMiddlewareRuntime,
    input: Parameters<AgentMiddlewareRuntime['afterRun']>[0],
  ) {
    try {
      await middlewareRuntime.afterRun(input)
    } catch (error) {
      console.warn('[AgentHarness] afterRun middleware failed:', error)
    }
  }

  private async recordEvent(
    runId: string,
    event: AgentEvent,
    current: () => AgentRunSnapshot,
    save: (patch: Partial<AgentRunSnapshot>) => Promise<void>,
  ) {
    if (event.type === 'observation.created') {
      const content = typeof event.payload?.observation === 'string'
        ? event.payload.observation
        : ''
      const hidden = event.payload?.internal === true || event.payload?.visibility === 'hidden'
      if (!content || hidden) return

      const ref = await writeAgentVfsText(
        runId,
        'observation',
        `${String(event.sequence || Date.now()).padStart(4, '0')}.txt`,
        content,
        content.replace(/\s+/g, ' ').slice(0, 240),
      )
      await save({ observationRefs: [...current().observationRefs, ref] })
      return
    }

    if (event.type === 'agent.planning' && event.payload?.plan) {
      const plan = event.payload.plan as {
        summary?: string
        steps?: Array<{ description?: string; tools?: string[] }>
      }
      const ref = await writeAgentVfsText(
        runId,
        'context',
        'plan.json',
        JSON.stringify(plan, null, 2),
        typeof plan.summary === 'string' ? plan.summary : 'Agent plan',
      )
      const todos = Array.isArray(plan.steps)
        ? plan.steps.map((step, index) => ({
            id: `todo-${index + 1}`,
            content: step.description || `Step ${index + 1}`,
            status: 'pending',
            tools: step.tools || [],
          }))
        : []
      const todoRef = await writeAgentVfsText(
        runId,
        'context',
        'todos.json',
        JSON.stringify(todos, null, 2),
        `${todos.length} planned todos`,
      )
      await save({ planRef: ref, todoRef })
      return
    }

    if (event.type === 'approval' || event.type === 'confirmation.waiting' || event.type === 'confirmation.resolved') {
      const toolName = typeof event.payload?.toolName === 'string' ? event.payload.toolName : undefined
      if (!toolName) return

      const params = typeof event.payload?.params === 'object' && event.payload.params
        ? event.payload.params as Record<string, unknown>
        : {}
      const status = event.payload?.status === 'confirmed'
        ? 'approved'
        : event.payload?.status === 'rejected'
          ? 'rejected'
          : 'requested'

      await save({
        approvalHistory: [...current().approvalHistory, {
          id: event.id || `approval-${event.timestamp}`,
          runId,
          stepId: String(event.iteration || event.sequence || 'pending'),
          toolName,
          risk: status === 'requested' ? 'medium' : 'medium',
          status,
          reason: typeof event.payload?.reason === 'string' ? event.payload.reason : status,
          params,
          approvalScope: 'once',
        }],
      })
    }
  }
}

function vfsRefFromUri(
  runId: string,
  uri: string,
  kind: VfsRef['kind'],
  summary?: string,
): VfsRef {
  const marker = `agent://${runId}/`
  const path = uri.startsWith(marker)
    ? uri.slice(marker.length)
    : `${kind}/${uri.split('/').pop() || 'observation.txt'}`
  return {
    uri: uri as VfsRef['uri'],
    runId,
    path,
    kind,
    summary,
  }
}
