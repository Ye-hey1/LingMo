/**
 * 工具意图识别模块
 *
 * 识别用户输入中的工具调用意图，为 Agent 提供执行指导。
 * 优化：增加时效性问题识别，确保"最近"、"热门"类问题触发 web_search。
 */

import { decideAutoWebSearch } from '@/lib/ai/auto-web-search'

// 明确的工具执行关键词
const TOOL_WORKFLOW_HINTS = [
  /(?:\b|^)(?:调用|使用|执行|先调用|再调用|按顺序|依次|一步|步骤|workflow|tool(?:s)?|action_input|tool_call)(?:\b|$)/i,
  /执行步骤[:：]/i,
  /先.*调用/i,
  /再.*调用/i,
  /调用.*工具/i,
  /use .*tool/i,
  /call .*tool/i,
]

const REMINDER_HINTS = [
  /提醒我|提醒一下|到点提醒|稍后提醒|定时提醒|桌面提醒|通知我|稍后通知|闹钟|计时器|倒计时|待会儿叫我|待会叫我/,
  /(分钟|小时|天|周|月|半小时|一会儿|一会|稍后|之后|以后).{0,12}(提醒|通知|叫我)/,
  /\b(remind me|reminder|notify me|timer|countdown|alarm)\b/i,
]

/**
 * 判断用户输入是否是明确的工具执行请求
 */
export function isExplicitToolExecutionRequest(userInput: string): boolean {
  const input = userInput.trim()
  if (!input) return false

  return TOOL_WORKFLOW_HINTS.some(pattern => pattern.test(input))
}

/**
 * 判断用户输入是否需要时效性信息（需要联网搜索）
 */
export function isTimeSensitiveRequest(userInput: string): boolean {
  return decideAutoWebSearch({
    userInput,
    hasSearchProvider: true,
  }).shouldSearch
}

export function isReminderRequest(userInput: string): boolean {
  const input = userInput.trim()
  if (!input) return false

  return REMINDER_HINTS.some(pattern => pattern.test(input))
}

/**
 * 构建工具执行提示
 *
 * 当用户明确要求执行工具时，提供执行指导。
 * 当问题需要时效性信息时，提示优先使用 web_search。
 */
export function buildToolExecutionPrompt(userInput: string): string {
  const isExplicit = isExplicitToolExecutionRequest(userInput)
  const isTimeSensitive = isTimeSensitiveRequest(userInput)
  const isReminder = isReminderRequest(userInput)

  if (!isExplicit && !isTimeSensitive && !isReminder) {
    return ''
  }

  const sections: string[] = ['## Tool Execution Mode']

  if (isExplicit) {
    sections.push(
      'This request is an explicit workflow or command, not a concept question.',
      '',
      '- Do not start with a general explanation, tutorial, or conceptual introduction.',
      '- Call the required tools directly, in the order requested.',
      '- If the user named a tool or step, treat it as mandatory unless it is impossible.',
      '- If a required parameter is missing, ask only for that missing parameter.',
      '- After tool results, continue with the next tool or give a concise Final Answer.',
    )
  }

  if (isTimeSensitive) {
    sections.push(
      '',
      '### Time-Sensitive Query Detected',
      '',
      '- The user is asking about recent, current, latest, or trending information.',
      '- Your training data may be outdated. You MUST use web_search to get up-to-date results BEFORE answering.',
      '- Do NOT guess or fabricate recent information from training data alone.',
      '- Call web_search with a specific, relevant query and a date window such as days=7/30/365 or startDate/endDate, then synthesize the results into your answer.',
      '- Use only dated in-window results for strict latest/recent/current claims. If results are old or undated, say that recent dated evidence was not found.',
      '- For every cited source, include a clickable Markdown link using the URL from web_search, for example [Source Title](https://example.com).',
      '- Write the summary like a human briefing: direct, concrete, useful, and light on formal academic language.',
    )
  }

  if (isReminder) {
    sections.push(
      '',
      '### Reminder Request Detected',
      '',
      '- The user wants LingMo to remind or notify them later.',
      '- Use create_reminder instead of merely saying you will remind them.',
      '- For relative times such as "30 分钟后" or "in 2 hours", pass delayMinutes.',
      '- For natural time phrases such as "半小时后", "明天上午九点", or "tomorrow at 3pm", pass timeText if delayMinutes or dueAt is not obvious.',
      '- For absolute times, pass dueAt using the current date/time in runtime context.',
      '- After create_reminder succeeds, give a concise Final Answer confirming the scheduled time.',
    )
  }

  return sections.join('\n')
}
