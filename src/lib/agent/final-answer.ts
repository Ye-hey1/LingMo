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

const CONCRETE_ARTIFACT_REQUEST_PATTERN =
  /生成|创建|制作|新建|导出|保存|绘制|画一|画个|画出|可视化|图表|思维导图|导图|流程图|架构图|白板|文件|演示文稿|pptx|pdf|docx|xlsx|drawio|excalidraw|diagram|mind\s*map|mindmap|flowchart|visuali[sz]e|create|generate|export|save|file|presentation/i

const CONCRETE_ARTIFACT_DIRECTIVE_PATTERN =
  /(?:生成|创建|制作|新建|导出|保存|绘制|画一|画个|画出|可视化).{0,30}(?:图表|思维导图|导图|流程图|架构图|白板|文件|演示文稿|pptx|pdf|docx|xlsx|drawio|excalidraw)|(?:图表|思维导图|导图|流程图|架构图|白板|文件|演示文稿|pptx|pdf|docx|xlsx|drawio|excalidraw).{0,30}(?:生成|创建|制作|新建|导出|保存|绘制)|\b(?:create|generate|export|save|visuali[sz]e).{0,40}(?:diagram|mind\s*map|mindmap|flowchart|file|presentation|pptx|pdf|docx|xlsx)\b/i

const INFORMATION_QUERY_PATTERN =
  /查看|查询|获取|检索|搜索|总结|汇总|梳理|分析|解读|列出|最新|热点|新闻|资讯|趋势|信息|内容|数据|find|search|fetch|get|retrieve|summari[sz]e|analy[sz]e|latest|news|trending|information/i

const DIAGRAM_ARTIFACT_REQUEST_PATTERN =
  /绘制|画一|画个|画出|可视化|图表|思维导图|导图|流程图|架构图|白板|drawio|excalidraw|diagram|mind\s*map|mindmap|flowchart|visuali[sz]e/i

function getConcreteToolHint(userInput: string): string {
  if (DIAGRAM_ARTIFACT_REQUEST_PATTERN.test(userInput)) {
    return '对于图表/思维导图/Excalidraw 任务，请继续输出 JSON Action，优先使用 create_diagram_from_outline；需要空白或自定义画布时使用 create_diagram_file。'
  }

  return '请继续输出 JSON Action，调用 create_file、replace_editor_content、create_diagram_from_outline 或其他实际工具完成任务。'
}

export function shouldRecoverWithAutoFinalAnswer(thought: string): boolean {
  const normalized = thought.trim()
  return CONTINUATION_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isConcreteArtifactRequest(userInput: string, actionLikeRequest: boolean): boolean {
  if (INFORMATION_QUERY_PATTERN.test(userInput) && !CONCRETE_ARTIFACT_DIRECTIVE_PATTERN.test(userInput)) {
    return false
  }

  return CONCRETE_ARTIFACT_DIRECTIVE_PATTERN.test(userInput) ||
    (actionLikeRequest && CONCRETE_ARTIFACT_REQUEST_PATTERN.test(userInput))
}

export function getConcreteToolCompletionBlockReason(input: {
  userInput: string
  actionLikeRequest: boolean
  hasConcreteSuccessfulAction: boolean
  hasOnlySupportProgress: boolean
}): string | null {
  if (!isConcreteArtifactRequest(input.userInput, input.actionLikeRequest)) {
    return null
  }

  if (input.hasConcreteSuccessfulAction) {
    return null
  }

  const toolHint = getConcreteToolHint(input.userInput)
  return input.hasOnlySupportProgress
    ? `仅完成了 Skill 选择或说明读取，尚未真正执行创建/编辑/图表工具。不能把说明文字当作最终完成结果。${toolHint}`
    : `尚未获得创建/编辑/图表/导出类工具成功结果，不能把文件、图表、导出或可视化任务判定为已完成。${toolHint}`
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
// ============================================================================
// Final Answer Format — 统一 Final Answer 格式模块
// ============================================================================
//
// 改进点：
// 1. 统一要求 JSON 格式输出
// 2. 移除自然语言 Final Answer 检测
// 3. 简化正则匹配
// 4. 更清晰的格式指导

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinalAnswerResult {
  isFinalAnswer: boolean
  content: string
  format: 'json' | 'none'
}

export interface FinalAnswerValidation {
  ok: boolean
  reason?: string
}

// ---------------------------------------------------------------------------
// Final Answer detection (JSON only)
// ---------------------------------------------------------------------------

/**
 * 检测并提取 Final Answer
 * 
 * 只支持 JSON 格式：
 * - {"final_answer": "..."}
 * - {"thought": "...", "final_answer": "..."}
 */
export function detectFinalAnswer(content: string): FinalAnswerResult {
  if (!content || !content.trim()) {
    return { isFinalAnswer: false, content: '', format: 'none' }
  }

  const trimmed = content.trim()

  // 1. 尝试直接解析 JSON
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed.final_answer === 'string' && parsed.final_answer.trim()) {
      return {
        isFinalAnswer: true,
        content: parsed.final_answer.trim(),
        format: 'json',
      }
    }
  } catch {
    // 不是完整 JSON，继续
  }

  // 2. 尝试从文本中提取 JSON
  const jsonMatch = trimmed.match(/\{[\s\S]*?"final_answer"\s*:\s*"([\s\S]*?)"[\s\S]*\}/)
  if (jsonMatch && jsonMatch[1]) {
    try {
      // 尝试解析完整的 JSON
      const jsonStr = trimmed.match(/\{[\s\S]*\}/)?.[0]
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr)
        if (typeof parsed.final_answer === 'string' && parsed.final_answer.trim()) {
          return {
            isFinalAnswer: true,
            content: parsed.final_answer.trim(),
            format: 'json',
          }
        }
      }
    } catch {
      // JSON 解析失败，使用正则匹配的结果
      return {
        isFinalAnswer: true,
        content: jsonMatch[1].trim(),
        format: 'json',
      }
    }
  }

  return { isFinalAnswer: false, content: '', format: 'none' }
}

/**
 * 从流式内容中检测 Final Answer（用于实时渲染）
 */
export function detectFinalAnswerStreaming(content: string): {
  hasFinalAnswer: boolean
  partialContent?: string
} {
  if (!content) return { hasFinalAnswer: false }

  // 检查是否包含 final_answer 字段
  const faMatch = content.match(/"final_answer"\s*:\s*"([\s\S]*?)"/)
  if (faMatch) {
    return {
      hasFinalAnswer: true,
      partialContent: faMatch[1],
    }
  }

  // 检查是否有未闭合的 final_answer（流式接收中）
  const partialMatch = content.match(/"final_answer"\s*:\s*"([\s\S]*)/)
  if (partialMatch && !content.includes('"}')) {
    return {
      hasFinalAnswer: true,
      partialContent: partialMatch[1],
    }
  }

  return { hasFinalAnswer: false }
}

// ---------------------------------------------------------------------------
// Final Answer validation
// ---------------------------------------------------------------------------

/**
 * 验证 Final Answer 是否有效
 * 
 * 规则：
 * 1. 内容不能为空
 * 2. 不能只是重复用户的问题
 * 3. 不能包含未执行的工具调用声明
 */
export function validateFinalAnswer(
  answer: string,
  userInput: string,
  hasSuccessfulToolExecution: boolean
): FinalAnswerValidation {
  if (!answer || !answer.trim()) {
    return { ok: false, reason: 'Final Answer 内容不能为空' }
  }

  const normalizedAnswer = answer.toLowerCase().trim()
  const normalizedInput = userInput.toLowerCase().trim()

  // 检查是否只是重复用户问题
  if (normalizedAnswer === normalizedInput) {
    return { ok: false, reason: 'Final Answer 不能只是重复用户的问题' }
  }

  // 检查是否声称执行了操作但没有实际执行
  const claimsExecution = /已生成|已创建|已保存|已完成|已导出|已验证|成功使用|generated|created|saved|exported|verified|completed/i.test(answer)
  if (claimsExecution && !hasSuccessfulToolExecution) {
    return {
      ok: false,
      reason: '声称执行了操作但没有成功的工具执行记录，请继续执行实际工具',
    }
  }

  // 检查是否声称修改了文件但没有实际修改
  const claimsModification = /已修改|已更新|已改为|已删除|已移动|已重命名|updated|changed|modified|deleted|moved|renamed/i.test(answer)
  if (claimsModification && !hasSuccessfulToolExecution) {
    return {
      ok: false,
      reason: '声称修改了文件但没有成功的工具执行记录，请继续执行实际工具',
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Format guidance
// ---------------------------------------------------------------------------

/**
 * 生成 Final Answer 格式指导（用于 System Prompt）
 */
export function getFinalAnswerFormatGuidance(): string {
  return `## Output Format

When you have completed the task or can answer the user's question directly, respond with a JSON object:

\`\`\`json
{"final_answer": "Your complete answer here (supports Markdown formatting)"}
\`\`\`

**Rules**:
- The \`final_answer\` field is REQUIRED for task completion
- Use Markdown formatting for rich text (headers, lists, code blocks, etc.)
- Do NOT include source citations or boilerplate text - the UI handles that
- Do NOT claim actions were performed if no tools were successfully executed
- If you need to use tools, use the standard action format instead

**Examples**:

Simple answer:
\`\`\`json
{"final_answer": "The capital of France is Paris."}
\`\`\`

Formatted answer:
\`\`\`json
{"final_answer": "## Summary\\n\\nHere are the key points:\\n\\n1. **Point 1**: Description\\n2. **Point 2**: Description\\n\\n### Code Example\\n\\n\\\`\\\`\\\`javascript\\nconsole.log('hello');\\n\\\`\\\`\\\`"}
\`\`\`
`
}

/**
 * 生成简化的格式指导（用于错误恢复）
 */
export function getSimpleFormatGuidance(): string {
  return `Please respond with: {"final_answer": "your answer"}`
}
