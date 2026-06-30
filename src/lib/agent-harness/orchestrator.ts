import { createAgentRunId } from './run-id'
import { approvalRequestFromEvent, reduceApprovalHistory } from './approval-service'
import { buildContextPack } from './context-engine'
import { AgentMiddlewareRuntime, createSkillMcpMiddleware } from './middleware'
import { saveRunSnapshot } from './run-snapshot-store'
import { executeHarnessTool } from './tool-runtime'
import { writeAgentVfsText } from './vfs'
import { reduceAgentSessionLogFromEvents, type AgentSessionLog } from './session-log'
import { createInitialAgentPartSnapshot, reduceAgentPartSnapshot } from '@/lib/agent/part-reducer'
import type { AgentEvent } from '@/lib/agent/types'
import type { AgentHarnessMiddleware, AgentRoute, AgentRunControl, AgentRunMetrics, AgentRunSnapshot, AgentSessionTreeBinding, ContextPack, ToolExposureRecord, VfsRef } from './types'
import { persistAgentRuntimeEvent } from '@/db/agent'

export interface AgentOrchestratorInput {
  userInput: string
  route: AgentRoute
  runId?: string
  parentRunId?: string
  rootRunId?: string
  branchId?: string
  conversationId?: number | null
  userChatId?: number | null
  assistantChatId?: number | null
  forcedSkillIds?: string[]
  webSearchEnabled?: boolean
  middlewares?: AgentHarnessMiddleware[]
  agentExecutor?: (control: AgentRunControl) => Promise<string>
  writerExecutor?: (control: AgentRunControl) => Promise<string>
}

export class AgentOrchestrator {
  async run(input: AgentOrchestratorInput): Promise<{ runId: string; result: string; snapshot: AgentRunSnapshot }> {
    const runId = input.runId || createAgentRunId()
    const rootRunId = input.rootRunId || input.parentRunId || runId
    const branchId = input.branchId || `${rootRunId}:branch:${input.parentRunId ? runId : 'root'}`
    let snapshot: AgentRunSnapshot = {
      runId,
      rootRunId,
      parentRunId: input.parentRunId,
      branchId,
      chat: {
        conversationId: input.conversationId ?? null,
        userChatId: input.userChatId ?? null,
        assistantChatId: input.assistantChatId ?? null,
      },
      status: 'running',
      userGoal: input.userInput,
      route: input.route,
      draftRefs: [],
      observationRefs: [],
      approvalHistory: [],
      metrics: createInitialRunMetrics(Date.now()),
      partSnapshot: createInitialAgentPartSnapshot(runId),
      sessionTree: {
        rootRunId,
        parentRunId: input.parentRunId,
        branchId,
        leafEntryId: null,
        entryCount: 0,
        lastEventSequence: null,
        compactionRefs: [],
      },
      updatedAt: Date.now(),
    }

    await saveRunSnapshot(snapshot, { conversationId: input.conversationId })
    let eventWriteQueue: Promise<void> = Promise.resolve()
    const recordedEvents: AgentEvent[] = []
    let latestSessionLog: AgentSessionLog | undefined
    const middlewareRuntime = new AgentMiddlewareRuntime(input.middlewares || [
      createSkillMcpMiddleware(),
    ])

    const updateSnapshot = async (patch: Partial<AgentRunSnapshot>) => {
      snapshot = {
        ...snapshot,
        ...patch,
        chat: patch.chat ? { ...(snapshot.chat || {}), ...patch.chat } : snapshot.chat,
        sessionTree: patch.sessionTree ? { ...getSnapshotSessionTree(snapshot), ...patch.sessionTree } : snapshot.sessionTree,
        updatedAt: Date.now(),
      }
      await saveRunSnapshot(snapshot, { conversationId: input.conversationId })
    }

    const recordEvent = (event: AgentEvent) => {
      recordedEvents.push(event)
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
        await updateSnapshot({
          contextPackRef,
          metrics: updateRunMetrics(snapshot.metrics, {
            contextTokenEstimate: pack.included.reduce((sum, item) => sum + item.tokenEstimate, 0),
          }),
        })
        return pack
      },
      writeDraft: async (path, content, summary) => {
        const ref = await writeAgentVfsText(runId, 'draft', path, content, summary)
        await updateSnapshot({ draftRefs: [...snapshot.draftRefs, ref] })
        return ref
      },
      setSessionLog: (log) => {
        latestSessionLog = log
        void updateSnapshot({
          sessionTree: buildSessionTreeBinding({
            snapshot,
            sessionLog: log,
            lastEventSequence: recordedEvents[recordedEvents.length - 1]?.sequence ?? null,
          }),
        }).catch(error => {
          console.warn('[AgentHarness] Failed to update session tree snapshot:', error)
        })
      },
      getSnapshot: () => snapshot,
      getMiddlewareState: () => middlewareRuntime.getState(),
      setMiddlewareState: (patch) => middlewareRuntime.setState(patch),
      prepareModel: async (prepareInput) => {
        const prepared = await middlewareRuntime.beforeModel({
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
        const exposure = middlewareRuntime.getState().toolExposureReasons
        if (exposure) {
          const record: ToolExposureRecord = {
            iteration: exposure.iteration,
            visibleToolNames: Object.keys(exposure.visible),
            visibleReasons: exposure.visible,
            hiddenReasons: exposure.hidden,
            maxVisibleTools: exposure.maxVisibleTools,
            createdAt: Date.now(),
          }
          await updateSnapshot({
            toolExposureHistory: [
              ...(snapshot.toolExposureHistory || []),
              record,
            ].slice(-30),
          })
        }
        const runtimeSnapshot = middlewareRuntime.getState().runtime?.snapshot
        if (runtimeSnapshot) {
          await updateSnapshot({
            partSnapshot: {
              ...(snapshot.partSnapshot || createInitialAgentPartSnapshot(runId)),
              runtimeSnapshot,
            },
          })
        }
        return prepared
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
      const sessionLogRef = await this.persistSessionLog({
        runId,
        route: input.route,
        userGoal: input.userInput,
        events: recordedEvents,
        sessionLog: latestSessionLog,
      })
      await updateSnapshot({
        status: 'completed',
        finalAnswer: result,
        sessionLogRef,
        sessionTree: buildSessionTreeBinding({
          snapshot,
          sessionLog: latestSessionLog || reduceAgentSessionLogFromEvents({
            runId,
            route: input.route,
            userGoal: input.userInput,
            events: recordedEvents,
          }),
          lastEventSequence: recordedEvents[recordedEvents.length - 1]?.sequence ?? null,
        }),
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
        const sessionLogRef = await this.persistSessionLog({
          runId,
          route: input.route,
          userGoal: input.userInput,
          events: recordedEvents,
          sessionLog: latestSessionLog,
        })
        await updateSnapshot({
          status: 'paused',
          sessionLogRef,
          sessionTree: buildSessionTreeBinding({
            snapshot,
            sessionLog: latestSessionLog || reduceAgentSessionLogFromEvents({
              runId,
              route: input.route,
              userGoal: input.userInput,
              events: recordedEvents,
            }),
            lastEventSequence: recordedEvents[recordedEvents.length - 1]?.sequence ?? null,
          }),
        })
      } else {
        const sessionLogRef = await this.persistSessionLog({
          runId,
          route: input.route,
          userGoal: input.userInput,
          events: recordedEvents,
          sessionLog: latestSessionLog,
        })
        await updateSnapshot({
          status: 'failed',
          finalAnswer: message,
          sessionLogRef,
          sessionTree: buildSessionTreeBinding({
            snapshot,
            sessionLog: latestSessionLog || reduceAgentSessionLogFromEvents({
              runId,
              route: input.route,
              userGoal: input.userInput,
              events: recordedEvents,
            }),
            lastEventSequence: recordedEvents[recordedEvents.length - 1]?.sequence ?? null,
          }),
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

  private async persistSessionLog(input: {
    runId: string
    route: AgentRoute
    userGoal: string
    events: AgentEvent[]
    sessionLog?: AgentSessionLog
  }): Promise<VfsRef> {
    const sessionLog = input.sessionLog || reduceAgentSessionLogFromEvents(input)
    return writeAgentVfsText(
      input.runId,
      'context',
      'session-log.json',
      JSON.stringify(sessionLog, null, 2),
      `${sessionLog.entries.length} durable agent session entries`,
    )
  }

  private async recordEvent(
    runId: string,
    event: AgentEvent,
    current: () => AgentRunSnapshot,
    save: (patch: Partial<AgentRunSnapshot>) => Promise<void>,
  ) {
    const currentSnapshot = current()
    await save({
      metrics: reduceRunMetrics(currentSnapshot.metrics, event),
      partSnapshot: reduceAgentPartSnapshot(
        currentSnapshot.partSnapshot || createInitialAgentPartSnapshot(runId),
        event,
      ),
      sessionTree: {
        ...getSnapshotSessionTree(currentSnapshot),
        lastEventSequence: event.sequence ?? currentSnapshot.sessionTree?.lastEventSequence ?? null,
      },
    })
    try {
      await persistAgentRuntimeEvent(runId, event)
    } catch (error) {
      console.warn('[AgentHarness] Failed to persist runtime event:', error)
    }

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

    if (event.type === 'agent.context.compacted') {
      const latest = current()
      const tree = getSnapshotSessionTree(latest)
      const compacted = await writeAgentVfsText(
        runId,
        'context',
        `compaction-${String(event.sequence || Date.now()).padStart(4, '0')}.json`,
        JSON.stringify(event.payload?.snapshot || event.payload || {}, null, 2),
        'Agent context compaction snapshot',
      )
      await save({
        observationRefs: [...latest.observationRefs, compacted],
        sessionTree: {
          ...tree,
          compactionRefs: [
            ...tree.compactionRefs,
            compacted,
          ].slice(-20),
          lastEventSequence: event.sequence ?? tree.lastEventSequence ?? null,
        },
      })
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
      const request = approvalRequestFromEvent(runId, event)
      if (!request) return
      const approvalState = reduceApprovalHistory(current().approvalHistory, request)
      await save({
        approvalHistory: approvalState.history,
        pendingApproval: approvalState.pendingApproval,
      })
    }
  }
}

function createInitialRunMetrics(startedAt: number): AgentRunMetrics {
  return {
    startedAt,
    updatedAt: startedAt,
    durationMs: 0,
    modelRequests: 0,
    modelDurationMs: 0,
    modelInputTokens: 0,
    modelOutputTokens: 0,
    toolCalls: 0,
    successfulToolCalls: 0,
    failedToolCalls: 0,
    cachedToolCalls: 0,
    blockedToolCalls: 0,
    adjustedToolCalls: 0,
    skippedToolCalls: 0,
    toolDurationMs: 0,
    contextTokenEstimate: 0,
    policyAdjustments: 0,
    finalAnswerRetries: 0,
  }
}

function updateRunMetrics(
  metrics: AgentRunMetrics | undefined,
  patch: Partial<AgentRunMetrics>,
): AgentRunMetrics {
  const base = metrics || createInitialRunMetrics(Date.now())
  const next = {
    ...base,
    ...patch,
    updatedAt: patch.updatedAt || Date.now(),
  }
  return {
    ...next,
    durationMs: Math.max(0, next.updatedAt - next.startedAt),
  }
}

function reduceRunMetrics(metrics: AgentRunMetrics | undefined, event: AgentEvent): AgentRunMetrics {
  const payload = event.payload || {}
  const next = updateRunMetrics(metrics, { updatedAt: event.timestamp })

  if (event.type === 'model.request.started') {
    next.modelRequests += 1
    if (typeof payload.inputTokens === 'number') {
      next.modelInputTokens += payload.inputTokens
    }
  }

  if (event.type === 'model.response.received') {
    if (typeof payload.outputTokens === 'number') {
      next.modelOutputTokens += payload.outputTokens
    }
    if (typeof payload.durationMs === 'number') {
      next.modelDurationMs += payload.durationMs
    }
  }

  if (event.type === 'tool.execution.finished') {
    const status = String(payload.status || '')
    next.toolCalls += 1
    if (typeof payload.durationMs === 'number') {
      next.toolDurationMs += payload.durationMs
    }
    if (status === 'success' || payload.success === true) next.successfulToolCalls += 1
    if (status === 'error' || payload.success === false) next.failedToolCalls += 1
    if (status === 'cached' || payload.cached === true) next.cachedToolCalls += 1
    if (status === 'blocked') next.blockedToolCalls += 1
    if (status === 'adjusted') {
      next.adjustedToolCalls += 1
      next.policyAdjustments += 1
    }
    if (status === 'skipped') next.skippedToolCalls += 1
  }

  if (event.type === 'final.answer.rejected') {
    next.finalAnswerRetries += 1
  }

  next.durationMs = Math.max(0, next.updatedAt - next.startedAt)
  return next
}

function getSnapshotSessionTree(snapshot: AgentRunSnapshot): AgentSessionTreeBinding {
  const rootRunId = snapshot.rootRunId || snapshot.parentRunId || snapshot.runId
  return {
    rootRunId,
    parentRunId: snapshot.parentRunId,
    branchId: snapshot.branchId || `${rootRunId}:branch:${snapshot.parentRunId ? snapshot.runId : 'root'}`,
    leafEntryId: snapshot.sessionTree?.leafEntryId ?? null,
    entryCount: snapshot.sessionTree?.entryCount || 0,
    lastEventSequence: snapshot.sessionTree?.lastEventSequence ?? null,
    compactionRefs: snapshot.sessionTree?.compactionRefs || [],
  }
}

function buildSessionTreeBinding(input: {
  snapshot: AgentRunSnapshot
  sessionLog: AgentSessionLog
  lastEventSequence?: number | null
}): AgentSessionTreeBinding {
  const base = getSnapshotSessionTree(input.snapshot)
  return {
    ...base,
    leafEntryId: input.sessionLog.leafId,
    entryCount: input.sessionLog.entries.length,
    lastEventSequence: input.lastEventSequence ?? base.lastEventSequence ?? null,
    compactionRefs: base.compactionRefs,
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
