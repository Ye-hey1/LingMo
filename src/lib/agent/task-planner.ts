export interface TaskPlan {
  isComplex: boolean
  steps: Array<{
    description: string
    tools: string[]
  }>
  summary: string
}

const COMPLEXITY_INDICATORS = [
  /然后|接着|之后|并且|同时|还有|再|also|then|after|and then|next/i,
  /\d+[、.．](?:\s*\S+)/,  // Numbered lists like "1. xxx 2. xxx"
  /创建.*并.*搜索|搜索.*并.*整理|读取.*并.*修改|整理.*并.*创建/i,
  /批量|所有|全部|每个|batch|all|every|each|multiple/i,
  /先.*再|first.*then/i,
  /总结.*笔记|分析.*内容|整理.*知识/i,
]

const SIMPLE_PATTERNS = [
  /^(什么是|what is|how|为什么|why|tell me|explain|介绍|describe|聊聊)\b/i,
  /^.{1,15}$/,  // Very short inputs
]

export function isTaskLikelyComplex(userInput: string): boolean {
  if (!userInput || userInput.trim().length < 10) return false

  // 斜杠命令生成的 prompt 已经有明确指令，不需要额外规划
  if (/^请(将|基于|分析|为).*工具/.test(userInput) || /请调用.*工具/.test(userInput)) return false
  // Agent 工具调用指令（已经明确指定了工具名）
  if (/create_diagram_from_outline|generate_flashcards|get_connected_notes|safe_grep/.test(userInput)) return false

  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(userInput.trim())) return false
  }

  for (const pattern of COMPLEXITY_INDICATORS) {
    if (pattern.test(userInput)) return true
  }

  return false
}

const PLANNING_SYSTEM_PROMPT = `You are a task complexity analyzer. Given a user request and available tools, determine if this task is complex enough to warrant a step-by-step plan.

Respond with ONLY a JSON object, no markdown fences:
{"isComplex": true/false, "steps": [{"description": "brief step description", "tools": ["tool_name"]}], "summary": "one-line plan summary"}

Rules:
- Simple questions, single-tool tasks, or tasks answerable directly → {"isComplex": false, "steps": [], "summary": ""}
- Multi-step tasks requiring 3+ tool calls → {"isComplex": true, "steps": [...], "summary": "..."}
- Maximum 5 planning steps
- Keep descriptions brief (one sentence each)
- Only include tool names from the available tools list`

export async function generateTaskPlan(
  userInput: string,
  availableTools: string[],
  abortSignal?: AbortSignal
): Promise<TaskPlan> {
  try {
    if (abortSignal?.aborted) {
      return { isComplex: false, steps: [], summary: '' }
    }

    const toolList = availableTools.slice(0, 30).join(', ')
    const userMessage = `Available tools: ${toolList}\n\nUser request: ${userInput}`

    const { fetchAiStream } = await import('@/lib/ai')

    let response = ''
    await fetchAiStream('', (content) => {
      response = content
    }, abortSignal, undefined, undefined, undefined, undefined, undefined, [
      { role: 'system', content: PLANNING_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ])

    if (abortSignal?.aborted) {
      return { isComplex: false, steps: [], summary: '' }
    }

    // Parse the JSON response
    const jsonStr = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const plan = JSON.parse(jsonStr) as TaskPlan

    if (typeof plan.isComplex !== 'boolean') {
      return { isComplex: false, steps: [], summary: '' }
    }

    // Validate steps
    if (plan.isComplex && Array.isArray(plan.steps)) {
      plan.steps = plan.steps.slice(0, 5).map(step => ({
        description: String(step.description || '').slice(0, 200),
        tools: Array.isArray(step.tools) ? step.tools.slice(0, 5).map(String) : [],
      }))
    }

    return plan
  } catch (error) {
    // Planning failure is non-critical, degrade gracefully
    console.warn('[TaskPlanner] Planning failed, proceeding without plan:', error)
    return { isComplex: false, steps: [], summary: '' }
  }
}

export function formatTaskPlanForPrompt(plan: TaskPlan): string {
  if (!plan.isComplex || plan.steps.length === 0) return ''

  const steps = plan.steps
    .map((step, i) => `${i + 1}. ${step.description}${step.tools.length > 0 ? ` (tools: ${step.tools.join(', ')})` : ''}`)
    .join('\n')

  return `## Execution Plan
${plan.summary ? `**Goal**: ${plan.summary}\n` : ''}Follow these steps:
${steps}

Complete each step, then give Final Answer. You may adjust the plan based on actual results.`
}
