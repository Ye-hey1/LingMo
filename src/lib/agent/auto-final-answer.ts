export interface AutoFinalAnswerDescriptor {
  key: string
  values: Record<string, string>
  fallback: string
}

interface AutoFinalAnswerInput {
  toolName: string
  params: Record<string, any>
  observation: string
}

const CONTINUATION_FAILURE_PATTERNS = [
  /^$/,
  /^请求失败:/,
  /^error:/i,
  /AI 服务暂时不可用/,
  /Unable to complete task/i,
]

export function shouldRecoverWithAutoFinalAnswer(thought: string): boolean {
  const normalized = thought.trim()
  return CONTINUATION_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function getAutoFinalAnswerDescriptor(
  input: AutoFinalAnswerInput
): AutoFinalAnswerDescriptor | null {
  const { toolName, params, observation } = input

  if (toolName === 'create_visual_report' && observation.startsWith('Created visual report:')) {
    const rawFileName = typeof params.fileName === 'string' && params.fileName.trim()
      ? params.fileName.trim().split('/').pop() || params.fileName.trim()
      : typeof params.title === 'string' && params.title.trim()
        ? `${params.title.trim()}.html`
        : 'visual-report.html'

    return {
      key: 'record.chat.input.agent.autoFinal.createFile',
      values: {
        name: /\.html?$/i.test(rawFileName) ? rawFileName : `${rawFileName}.html`,
      },
      fallback: `Created visual report "${rawFileName}".`,
    }
  }

  if (toolName !== 'create_file' || !observation.startsWith('成功创建文件:')) {
    return null
  }

  const rawFileName = typeof params.fileName === 'string' && params.fileName.trim()
    ? params.fileName.trim().split('/').pop() || params.fileName.trim()
    : 'untitled'
  const isMarkdown = /\.md$/i.test(rawFileName)

  if (isMarkdown) {
    return {
      key: 'record.chat.input.agent.autoFinal.createNote',
      values: {
        name: rawFileName,
      },
      fallback: `Created note "${rawFileName}".`,
    }
  }

  return {
    key: 'record.chat.input.agent.autoFinal.createFile',
    values: {
      name: rawFileName,
    },
    fallback: `Created file "${rawFileName}".`,
  }
}
