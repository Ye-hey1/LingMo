import type { AgentContextSnapshot, AgentEvent, ReActStep, ToolCall } from './types'

export interface AgentContextCompressionInput {
  userGoal: string
  steps: ReActStep[]
  toolCalls: ToolCall[]
  events: AgentEvent[]
  maxToolResults?: number
}

const READ_FILE_TOOLS = new Set([
  'read_markdown_file',
  'read_markdown_files_batch',
  'get_editor_content',
  'read_diagram_file',
  'safe_read_file',
])

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}...`
}

function extractPathCandidates(params: Record<string, any>): string[] {
  const paths = [
    params.filePath,
    params.folderPath,
    params.path,
    params.targetFolderPath,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (Array.isArray(params.filePaths)) {
    for (const filePath of params.filePaths) {
      if (typeof filePath === 'string' && filePath.trim()) {
        paths.push(filePath.trim())
      }
    }
  }

  return Array.from(new Set(paths.map(path => path.replace(/\\/g, '/'))))
}

function summarizeObservation(observation: string): string {
  const compacted = observation
    .replace(/\s+/g, ' ')
    .trim()

  return truncate(compacted, 360)
}

function inferTodoStatus(text: string): 'pending' | 'done' | 'blocked' {
  const normalized = text.toLowerCase()
  if (/blocked|failed|error|cannot|unable/.test(normalized)) {
    return 'blocked'
  }
  if (/done|completed|success|created|updated|saved/.test(normalized)) {
    return 'done'
  }
  return 'pending'
}

function extractTodos(steps: ReActStep[]): AgentContextSnapshot['todos'] {
  const todos: AgentContextSnapshot['todos'] = []

  for (const step of steps) {
    const chunks = [step.thought, step.observation].filter(Boolean) as string[]
    for (const chunk of chunks) {
      const lines = chunk
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)

      for (const line of lines) {
        if (!/(todo|next step|remaining|must|need to|failed|error|blocked)/i.test(line)) {
          continue
        }

        todos.push({
          title: truncate(line.replace(/^[-*]\s*/, ''), 160),
          status: inferTodoStatus(line),
        })

        if (todos.length >= 8) {
          return todos
        }
      }
    }
  }

  return todos
}

export function buildAgentContextSnapshot(input: AgentContextCompressionInput): AgentContextSnapshot {
  const readFilesByPath = new Map<string, AgentContextSnapshot['readFiles'][number]>()
  const toolResults: AgentContextSnapshot['toolResults'] = []
  const maxToolResults = input.maxToolResults || 12

  for (const step of input.steps) {
    const toolName = step.action?.tool
    const params = step.action?.params || {}

    if (toolName && READ_FILE_TOOLS.has(toolName)) {
      for (const path of extractPathCandidates(params)) {
        readFilesByPath.set(path, {
          path,
          source: toolName,
          lastReadAt: Date.now(),
        })
      }
    }

    if (toolName && step.observation) {
      toolResults.push({
        toolName,
        status: 'observed',
        summary: summarizeObservation(step.observation),
      })
    }
  }

  for (const toolCall of input.toolCalls) {
    if (READ_FILE_TOOLS.has(toolCall.toolName)) {
      for (const path of extractPathCandidates(toolCall.params)) {
        readFilesByPath.set(path, {
          path,
          source: toolCall.toolName,
          lastReadAt: toolCall.timestamp,
        })
      }
    }

    const resultText = toolCall.result?.message || toolCall.result?.error || ''
    if (resultText) {
      toolResults.push({
        toolName: toolCall.toolName,
        status: toolCall.status,
        summary: summarizeObservation(resultText),
        timestamp: toolCall.timestamp,
      })
    }
  }

  return {
    userGoal: truncate(asString(input.userGoal), 500),
    readFiles: Array.from(readFilesByPath.values()).slice(-20),
    toolResults: toolResults.slice(-maxToolResults),
    todos: extractTodos(input.steps),
    compactedAt: Date.now(),
    sourceEventCount: input.events.length,
    sourceStepCount: input.steps.length,
  }
}

export function shouldCompactAgentContext(steps: ReActStep[], events: AgentEvent[]): boolean {
  if (steps.length >= 4 || events.length >= 40) {
    return true
  }

  const charCount = steps.reduce((sum, step) => (
    sum + step.thought.length + (step.observation?.length || 0)
  ), 0)

  return charCount > 5000
}

export function formatAgentContextSnapshot(snapshot: AgentContextSnapshot): string {
  const readFiles = snapshot.readFiles.length > 0
    ? snapshot.readFiles.map(file => `- ${file.path} (${file.source})`).join('\n')
    : '- none'

  const toolResults = snapshot.toolResults.length > 0
    ? snapshot.toolResults.map(result => `- ${result.toolName} [${result.status}]: ${result.summary}`).join('\n')
    : '- none'

  const todos = snapshot.todos.length > 0
    ? snapshot.todos.map(todo => `- [${todo.status}] ${todo.title}`).join('\n')
    : '- none'

  return `## Agent Context Snapshot

User goal:
${snapshot.userGoal || 'unknown'}

Files already read:
${readFiles}

Recent tool results:
${toolResults}

Pending / resolved todo state:
${todos}`
}

export function buildAgentHistoryContext(input: AgentContextCompressionInput): {
  text: string
  snapshot?: AgentContextSnapshot
} {
  const fullHistory = input.steps.map((step, i) =>
    `Iteration ${i + 1}:
Thought: ${step.thought}
Action: ${step.action?.tool}
Action Input: ${JSON.stringify(step.action?.params)}
Observation: ${step.observation}
`
  ).join('\n')

  if (!shouldCompactAgentContext(input.steps, input.events)) {
    return { text: fullHistory }
  }

  const snapshot = buildAgentContextSnapshot(input)
  const recentHistory = input.steps.slice(-2).map((step, i) =>
    `Recent Iteration ${input.steps.length - 1 + i}:
Thought: ${truncate(step.thought, 800)}
Action: ${step.action?.tool}
Action Input: ${JSON.stringify(step.action?.params)}
Observation: ${truncate(step.observation || '', 1000)}
`
  ).join('\n')

  return {
    snapshot,
    text: `${formatAgentContextSnapshot(snapshot)}

## Recent Detailed Steps
${recentHistory}`,
  }
}
