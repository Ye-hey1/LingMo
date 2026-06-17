/**
 * Agent 状态批处理（micro-batch）
 *
 * 目的：流式响应（思考逐字、Final Answer 逐字）期间，单个 token 就会产生一个
 * AgentEvent，若每次都立即 setAgentState 会触发高频 React 重渲染。这里把可延迟
 * 的流式事件 patch 攒到 ~16ms（60fps）窗口末尾一次性提交，把渲染次数从「每 token
 * 一次」降到「每帧一次」。
 *
 * 安全设计：
 * - enqueue(patch, immediate) 中 immediate=true 会立刻 flush 之前攒的 pending 再
 *   提交当前 patch，因此确认/错误/工具执行等需要即时反馈的事件绝不会被延迟。
 * - 调用方负责保证 patch 之间的累积正确性（后一个 patch 的累积字段应包含前一个）。
 */

import type { AgentState } from './types'

export type AgentStatePatch = Partial<AgentState>

export interface AgentStateBatcher {
  /** 提交一个状态补丁；immediate=true 时立即 flush（含之前积压的）。 */
  enqueue: (patch: AgentStatePatch, immediate: boolean) => void
  /** 立即 flush 所有积压的 patch。 */
  flush: () => void
}

export function createAgentStateBatcher(
  apply: (patch: AgentStatePatch) => void,
  flushMs = 16,
): AgentStateBatcher {
  let pending: AgentStatePatch | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flushNow() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const patch = pending
    pending = null
    if (patch) {
      apply(patch)
    }
  }

  function enqueue(patch: AgentStatePatch, immediate: boolean) {
    pending = pending ? { ...pending, ...patch } : { ...patch }
    if (immediate) {
      // 立即事件：先冲掉积压（含本次），保证交互响应不被延迟
      flushNow()
      return
    }
    // 可延迟事件：安排一帧后 flush；窗口内多次 enqueue 会合并到同一个 timer
    if (!timer) {
      timer = setTimeout(flushNow, flushMs)
    }
  }

  return { enqueue, flush: flushNow }
}
