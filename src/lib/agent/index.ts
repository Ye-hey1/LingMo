/**
 * Agent 模块统一入口
 *
 * 外部代码应从 '@/lib/agent' 导入，而非直接引用内部文件。
 * 内部模块之间的互相引用仍使用相对路径。
 *
 * 目录结构：
 *   agent-handler.ts    — Agent 入口调度器
 *   types.ts            — 统一类型定义
 *   prompt-assembler.ts — 系统提示词构建
 *   task-planner.ts     — 任务规划
 *   parse-action-input.ts — Action 输入解析
 *   metrics-collector.ts  — 执行指标收集
 *   event-bus.ts        — 事件总线
 *   working-memory.ts   — 工作记忆
 *   context-compression.ts — 上下文压缩
 *   message-trimmer.ts  — 上下文裁剪
 *   token-budget.ts     — Token 预算管理
 *   tool-utils.ts       — 工具执行超时 + 结果压缩
 *   tool-cache.ts       — 工具结果缓存
 *   tool-policy.ts      — 工具策略（只读/读写分类）
 *   tool-intent.ts      — 工具意图识别
 *   dynamic-tool-filter.ts — 动态工具过滤
 *   confirmation-manager.ts — 确认管理器
 *   tool-confirmation-display.ts — 确认预览格式化
 *   session-approval.ts — 会话级审批
 *   persistent-approval.ts — 持久化审批
 *   loop-detection.ts   — 循环检测
 *   safety-guards.ts    — 安全保护
 *   friendly-errors.ts  — 用户友好的错误消息
 *   final-answer.ts     — Final Answer 检测 + 自动恢复
 *   enhanced-resume.ts  — 增强 Resume（快照管理）
 *   resume.ts           — Agent 恢复 + 运行摘要持久化
 *   context/            — (预留) 上下文管理子目录
 *   safety/             — (预留) 安全子目录
 *   resume/             — (预留) 恢复子目录
 *   tools/              — 工具实现（note-tools, mark-tools, ...）
 */

// ---- 核心类 ----
export { AgentHandler } from './agent-handler'

// ---- 类型 ----
export type {
  Tool,
  ToolParameter,
  ToolParameterType,
  ToolResult,
  ToolCall,
  ToolExecutionContext,
  AgentEvent,
  AgentEventType,
  AgentState,
  AgentActivity,
  AgentActivityPhase,
  AgentTurnTelemetry,
  AgentContextSnapshot,
  AgentApprovalScope,
  ConfirmationRecord,
  ReActStep,
} from './types'

// ---- 工具访问 ----
export { getToolByName, getAllToolsSync, reloadMcpTools } from './tools'

// ---- 审批 ----
export {
  getPersistentApprovalOptions,
  findMatchingPersistentAgentApproval,
  matchesPersistentAgentApproval,
  rememberPersistentAgentApproval,
  recordPersistentApprovalHistory,
} from './persistent-approval'

export {
  getSessionApprovalScope,
  matchesSessionApproval,
} from './session-approval'

// ---- 确认预览 ----
export { formatConfirmationPreview } from './tool-confirmation-display'

// ---- 事件总线 ----
export { createAgentEventBus, replayAgentEvents } from './event-bus'
export type { AgentEventBus, AgentReplayState } from './event-bus'

// ---- 工作记忆 ----
export { loadWorkingMemory, formatWorkingMemoryForPrompt } from './working-memory'

// ---- 运行时快照 ----
export {
  buildAgentRuntimeSnapshot,
  buildSkillRuntimeSnapshot,
  buildToolExposureSnapshot,
  createInitialAgentRuntimeSnapshot,
  createRuntimeWarning,
  mergeRuntimeWarnings,
} from './runtime-snapshot'
export type {
  AgentRuntimeSnapshot,
  McpRuntimeServerSnapshot,
  McpRuntimeSnapshot,
  McpRuntimeStatus,
  RuntimePermissionSnapshot,
  RuntimeWarning,
  SkillRuntimeEntry,
  SkillRuntimeSnapshot,
  ToolExposureEntry,
  ToolExposureSnapshot,
} from './runtime-snapshot'

// ---- React Diff Helpers ----
export { replaceLinesInRange } from './tools/react-diff-helpers'

// ---- 工具输入验证 ----
export { validateToolInput, formatValidationErrors } from './tool-input-validator'

// ---- 工具结果预算 ----
export { applyToolResultBudget, estimateTokenCount, calculateAvailableBudget } from './tool-result-budget'

// ---- 并行工具执行 ----
export { executeToolsBatched, partitionToolCalls, type ParallelToolCall, type ParallelToolResult } from './parallel-tool-executor'
