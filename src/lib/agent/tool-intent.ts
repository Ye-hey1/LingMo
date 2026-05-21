const TOOL_WORKFLOW_HINTS = [
  /(?:\b|^)(?:调用|使用|执行|先调用|再调用|按顺序|依次|一步|步骤|workflow|tool(?:s)?|action_input|tool_call)(?:\b|$)/i,
  /执行步骤[:：]/i,
  /先.*调用/i,
  /再.*调用/i,
  /调用.*工具/i,
  /use .*tool/i,
  /call .*tool/i,
]

export function isExplicitToolExecutionRequest(userInput: string): boolean {
  const input = userInput.trim()
  if (!input) return false

  return TOOL_WORKFLOW_HINTS.some(pattern => pattern.test(input))
}

export function buildToolExecutionPrompt(userInput: string): string {
  if (!isExplicitToolExecutionRequest(userInput)) {
    return ''
  }

  return `## Tool Execution Mode

This request is an explicit workflow or command, not a concept question.

- Do not start with a general explanation, tutorial, or conceptual introduction.
- Call the required tools directly, in the order requested.
- If the user named a tool or step, treat it as mandatory unless it is impossible.
- If a required parameter is missing, ask only for that missing parameter.
- After tool results, continue with the next tool or give a concise Final Answer.
`
}
