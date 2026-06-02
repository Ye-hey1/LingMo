/**
 * 任务计划同步模块
 *
 * 改进点：
 * 1. 自动检测步骤完成状态
 * 2. 基于 Observation 内容判断步骤是否完成
 * 3. 自动推进任务计划
 * 4. 提供步骤完成建议
 */

import type { ReActStep } from './types'
import type { TaskPlan } from './task-planner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepCompletionResult {
  isCompleted: boolean
  confidence: number // 0-1
  reason: string
  shouldAdvance: boolean
}

export interface PlanSyncResult {
  plan: TaskPlan
  advanced: boolean
  previousStep?: number
  currentStep?: number
  completionResult?: StepCompletionResult
}

// ---------------------------------------------------------------------------
// Completion detection patterns
// ---------------------------------------------------------------------------

// 成功指标
const SUCCESS_PATTERNS = [
  /成功|完成|已创建|已保存|已更新|已删除|已移动|已重命名/i,
  /success|created|saved|updated|deleted|moved|renamed/i,
  /successfully|completed|finished|done/i,
  /找到了|发现|获取到|读取到/i,
  /found|discovered|retrieved|read/i,
]

// 失败指标
const FAILURE_PATTERNS = [
  /失败|错误|无法|不能|找不到|不存在/i,
  /failed|error|cannot|unable|not found|does not exist/i,
  /permission denied|access denied|timeout/i,
]

// 文件操作完成指标
const FILE_OPERATION_PATTERNS = [
  /文件.*已创建|已创建.*文件/i,
  /file.*created|created.*file/i,
  /内容.*已写入|已写入.*内容/i,
  /content.*written|written.*content/i,
]

// 搜索完成指标
const SEARCH_COMPLETION_PATTERNS = [
  /找到.*个结果|发现.*条匹配/i,
  /found.*results|discovered.*matches/i,
  /搜索完成|查询完成/i,
  /search completed|query completed/i,
]

// ---------------------------------------------------------------------------
// Completion detection
// ---------------------------------------------------------------------------

/**
 * 检测步骤是否完成
 */
export function detectStepCompletion(
  step: ReActStep,
  _plan: TaskPlan,
  _currentStepIndex: number
): StepCompletionResult {
  const observation = step.observation || ''
  const thought = step.thought || ''

  // 没有观察结果，未完成
  if (!observation) {
    return {
      isCompleted: false,
      confidence: 0,
      reason: '没有执行结果',
      shouldAdvance: false,
    }
  }

  // 检查失败模式
  const isFailed = FAILURE_PATTERNS.some(pattern => pattern.test(observation))
  if (isFailed) {
    return {
      isCompleted: true, // 失败也算完成（需要推进到下一步或重试）
      confidence: 0.9,
      reason: '执行失败',
      shouldAdvance: false, // 失败时不自动推进
    }
  }

  // 检查成功模式
  const isSuccess = SUCCESS_PATTERNS.some(pattern => pattern.test(observation))
  if (isSuccess) {
    // 额外检查文件操作
    const isFileOp = FILE_OPERATION_PATTERNS.some(pattern => pattern.test(observation))
    const isSearchOp = SEARCH_COMPLETION_PATTERNS.some(pattern => pattern.test(observation))

    let confidence = 0.8
    if (isFileOp) confidence = 0.95
    if (isSearchOp) confidence = 0.9

    return {
      isCompleted: true,
      confidence,
      reason: isFileOp ? '文件操作完成' : isSearchOp ? '搜索完成' : '操作成功',
      shouldAdvance: true,
    }
  }

  // 检查思考内容中是否有完成意图
  const thoughtIndicatesCompletion = /完成|结束|done|finish|complete/i.test(thought)
  if (thoughtIndicatesCompletion && isSuccess) {
    return {
      isCompleted: true,
      confidence: 0.85,
      reason: '思考内容表明任务完成',
      shouldAdvance: true,
    }
  }

  // 默认：有观察结果但不确定是否完成
  return {
    isCompleted: false,
    confidence: 0.3,
    reason: '执行结果不明确',
    shouldAdvance: false,
  }
}

// ---------------------------------------------------------------------------
// Plan synchronization
// ---------------------------------------------------------------------------

/**
 * 同步任务计划状态
 */
export function syncTaskPlan(
  plan: TaskPlan | null,
  steps: ReActStep[],
  _currentIteration: number
): PlanSyncResult | null {
  if (!plan || !plan.isComplex || plan.steps.length === 0) {
    return null
  }

  const currentStepIndex = plan.currentStepIndex ?? 0
  const lastStep = steps[steps.length - 1]

  if (!lastStep) {
    return null
  }

  // 检测当前步骤是否完成
  const completionResult = detectStepCompletion(lastStep, plan, currentStepIndex)

  // 如果步骤完成且应该推进
  if (completionResult.isCompleted && completionResult.shouldAdvance) {
    const nextStepIndex = Math.min(currentStepIndex + 1, plan.steps.length - 1)

    // 更新步骤状态
    const stepsStatus = [...(plan.stepsStatus || plan.steps.map(() => 'pending' as const))]
    stepsStatus[currentStepIndex] = 'completed'

    // 如果有下一步，标记为运行中
    if (nextStepIndex > currentStepIndex) {
      stepsStatus[nextStepIndex] = 'running'
    }

    // 更新反思信息
    const stepReflections = [...(plan.stepReflections || plan.steps.map(() => ''))]
    if (lastStep.observation) {
      const reflection = lastStep.observation.length > 100
        ? lastStep.observation.slice(0, 100) + '...'
        : lastStep.observation
      stepReflections[currentStepIndex] = reflection
    }

    return {
      plan: {
        ...plan,
        currentStepIndex: nextStepIndex,
        stepsStatus,
        stepReflections,
      },
      advanced: true,
      previousStep: currentStepIndex,
      currentStep: nextStepIndex,
      completionResult,
    }
  }

  // 步骤未完成，返回原计划
  return {
    plan,
    advanced: false,
    completionResult,
  }
}

// ---------------------------------------------------------------------------
// Step progress tracking
// ---------------------------------------------------------------------------

/**
 * 获取步骤进度摘要
 */
export function getStepProgressSummary(plan: TaskPlan): {
  totalSteps: number
  completedSteps: number
  currentStep: number
  progress: number
  statusText: string
} {
  const totalSteps = plan.steps.length
  const completedSteps = (plan.stepsStatus || []).filter(s => s === 'completed').length
  const currentStep = plan.currentStepIndex ?? 0
  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0

  let statusText = ''
  if (completedSteps === totalSteps) {
    statusText = '所有步骤已完成'
  } else if (completedSteps === 0) {
    statusText = '尚未开始'
  } else {
    statusText = `已完成 ${completedSteps}/${totalSteps} 步`
  }

  return {
    totalSteps,
    completedSteps,
    currentStep,
    progress,
    statusText,
  }
}

/**
 * 格式化步骤进度为用户友好的文本
 */
export function formatStepProgress(plan: TaskPlan): string {
  const { totalSteps, currentStep, statusText } = getStepProgressSummary(plan)

  if (!plan.isComplex || totalSteps === 0) {
    return ''
  }

  const lines = [`## 任务进度: ${statusText}`]

  plan.steps.forEach((step, index) => {
    const status = plan.stepsStatus?.[index] || 'pending'
    const isCurrent = index === currentStep

    let prefix = '○'
    if (status === 'completed') prefix = '✓'
    else if (status === 'running' || isCurrent) prefix = '►'
    else if (status === 'failed') prefix = '✗'

    const reflection = plan.stepReflections?.[index]
    const reflectionText = reflection ? ` (${reflection})` : ''

    lines.push(`${prefix} 步骤 ${index + 1}: ${step.description}${reflectionText}`)
  })

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Auto-advance detection
// ---------------------------------------------------------------------------

/**
 * 检测是否应该自动推进步骤
 * 用于防止 Agent 忘记输出步骤完成标记
 */
export function shouldAutoAdvance(
  plan: TaskPlan,
  steps: ReActStep[],
  maxStalledIterations = 3
): boolean {
  if (!plan || !plan.isComplex) return false

  const currentStepIndex = plan.currentStepIndex ?? 0
  const stepsStatus = plan.stepsStatus || plan.steps.map(() => 'pending' as const)

  // 如果当前步骤已完成，应该推进
  if (stepsStatus[currentStepIndex] === 'completed') return true

  // 检查是否有停滞
  const recentSteps = steps.slice(-maxStalledIterations)
  const sameToolCount = recentSteps.filter(s =>
    s.action?.tool === recentSteps[0]?.action?.tool
  ).length

  // 如果最近 N 步都使用同一工具，可能停滞
  if (sameToolCount >= maxStalledIterations && recentSteps.length >= maxStalledIterations) {
    return true
  }

  return false
}

/**
 * 生成步骤推进提示
 */
export function generateAdvancePrompt(plan: TaskPlan): string {
  const currentStepIndex = plan.currentStepIndex ?? 0
  const currentStep = plan.steps[currentStepIndex]

  if (!currentStep) return ''

  return `当前步骤 "${currentStep.description}" 似乎已完成。请继续执行下一步，或如果所有步骤都已完成，请给出最终答案。`
}
