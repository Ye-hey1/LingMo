import type { Tool } from '@/lib/agent/types'
import type { AgentRuntimeSnapshot } from '@/lib/agent/runtime-snapshot'
import type { AgentRoute, ContextPack, VfsRef } from './types'
import { stableStringify } from '@/lib/stable-stringify'
import {
  appendAgentSessionEntry,
  createAgentSessionLog,
  type AgentSessionEntryAppendData,
  type AgentSessionLogAppendInput,
  type AgentSessionLog,
} from './session-log'

export type AgentHarnessPhase =
  | 'idle'
  | 'preparing'
  | 'turn'
  | 'tool'
  | 'save_point'
  | 'finalizing'
  | 'settled'
  | 'failed'

export interface AgentTurnState {
  runId: string
  iteration: number
  route: AgentRoute
  userGoal: string
  systemPrompt: string
  visibleToolNames: string[]
  contextPackRef?: VfsRef
  runtimeSnapshot?: AgentRuntimeSnapshot
  createdAt: number
  checksum: string
}

export interface AgentTurnSnapshotInput {
  runId: string
  iteration: number
  route: AgentRoute
  userGoal: string
  systemPrompt: string
  tools: Tool[]
  contextPack?: ContextPack
  contextPackRef?: VfsRef
  runtimeSnapshot?: AgentRuntimeSnapshot
}

export interface AgentLifecycleControllerSnapshot {
  runId: string
  phase: AgentHarnessPhase
  activeTurn?: AgentTurnState
  savePointCount: number
  pendingEntryCount: number
  sessionLog: AgentSessionLog
}

type PendingAgentSessionEntry = AgentSessionLogAppendInput['entry']

export type AgentLifecyclePendingEntry = AgentSessionEntryAppendData


export function createAgentTurnState(input: AgentTurnSnapshotInput): AgentTurnState {
  const visibleToolNames = input.tools.map(tool => tool.name)
  const checksum = stableStringify({
    iteration: input.iteration,
    systemPrompt: input.systemPrompt,
    visibleToolNames,
    contextPack: input.contextPack?.checksum,
    runtimeCreatedAt: input.runtimeSnapshot?.createdAt,
  })

  return {
    runId: input.runId,
    iteration: input.iteration,
    route: input.route,
    userGoal: input.userGoal,
    systemPrompt: input.systemPrompt,
    visibleToolNames,
    contextPackRef: input.contextPackRef,
    runtimeSnapshot: input.runtimeSnapshot,
    createdAt: Date.now(),
    checksum,
  }
}

export class AgentLifecycleController {
  private phase: AgentHarnessPhase = 'idle'
  private activeTurn: AgentTurnState | undefined
  private sessionLog: AgentSessionLog
  private pendingEntries: PendingAgentSessionEntry[] = []
  private savePointCount = 0
  private lastSavedTurnIteration: number | undefined

  constructor(private readonly runId: string) {
    this.sessionLog = createAgentSessionLog(runId)
  }

  getPhase(): AgentHarnessPhase {
    return this.phase
  }

  getActiveTurn(): AgentTurnState | undefined {
    return this.activeTurn
  }

  getSessionLog(): AgentSessionLog {
    return this.sessionLog
  }

  getSnapshot(): AgentLifecycleControllerSnapshot {
    return {
      runId: this.runId,
      phase: this.phase,
      activeTurn: this.activeTurn,
      savePointCount: this.savePointCount,
      pendingEntryCount: this.pendingEntries.length,
      sessionLog: this.sessionLog,
    }
  }

  startRun(input: { route: AgentRoute; userGoal: string }) {
    if (this.phase !== 'idle') {
      throw new Error(`Cannot start run while lifecycle is ${this.phase}`)
    }
    this.phase = 'preparing'
    this.sessionLog = appendAgentSessionEntry(this.sessionLog, {
      entry: {
        type: 'run_started',
        route: input.route,
        userGoal: input.userGoal,
      },
    })
  }

  createTurn(input: AgentTurnSnapshotInput): AgentTurnState {
    if (!['preparing', 'turn', 'tool', 'save_point'].includes(this.phase)) {
      throw new Error(`Cannot create turn while lifecycle is ${this.phase}`)
    }
    const turn = createAgentTurnState(input)
    this.activeTurn = turn
    this.lastSavedTurnIteration = undefined
    this.phase = 'turn'
    this.sessionLog = appendAgentSessionEntry(this.sessionLog, {
      entry: {
        type: 'turn_started',
        iteration: turn.iteration,
        visibleToolNames: turn.visibleToolNames,
        contextPackRef: turn.contextPackRef,
      },
    })
    if (turn.runtimeSnapshot) {
      this.enqueueEntry({
        type: 'runtime_snapshot',
        iteration: turn.iteration,
        snapshot: turn.runtimeSnapshot,
      })
    }
    return turn
  }

  enterToolPhase() {
    if (this.phase === 'turn' || this.phase === 'save_point') {
      this.phase = 'tool'
    }
  }

  enqueueEntry(entry: PendingAgentSessionEntry) {
    this.pendingEntries.push(entry)
  }

  savePoint(input: { finishReason?: string | null; toolCallCount?: number } = {}) {
    if (!this.activeTurn) return
    this.phase = 'save_point'
    for (const pending of this.pendingEntries.splice(0)) {
      this.sessionLog = appendAgentSessionEntry(this.sessionLog, { entry: pending })
    }
    if (this.lastSavedTurnIteration !== this.activeTurn.iteration) {
      this.sessionLog = appendAgentSessionEntry(this.sessionLog, {
        entry: {
          type: 'turn_finished',
          iteration: this.activeTurn.iteration,
          finishReason: input.finishReason,
          toolCallCount: input.toolCallCount || 0,
        },
      })
      this.savePointCount += 1
      this.lastSavedTurnIteration = this.activeTurn.iteration
    }
  }

  finish(input: { status: 'completed' | 'failed' | 'paused'; finalAnswer?: string; error?: string }) {
    if (this.activeTurn && this.phase !== 'save_point') {
      this.savePoint({ toolCallCount: 0 })
    }
    this.phase = input.status === 'completed' ? 'settled' : 'failed'
    this.sessionLog = appendAgentSessionEntry(this.sessionLog, {
      entry: {
        type: 'run_finished',
        status: input.status,
        finalAnswer: input.finalAnswer,
        error: input.error,
      },
    })
  }
}
