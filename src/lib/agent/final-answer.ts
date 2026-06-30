import { isInternalToolReport } from './parse-action-input'

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
  /导出|保存|写入|输出到|输出为|存成|存为|绘制|画一|画个|画出|可视化|图表|思维导图|导图|流程图|架构图|白板|文件|笔记|文档|演示文稿|pptx|pdf|docx|xlsx|drawio|excalidraw|diagram|mind\s*map|mindmap|flowchart|visuali[sz]e|export|save|write|file|note|document|presentation/i

const CONCRETE_ARTIFACT_DIRECTIVE_PATTERN =
  /(?:生成|创建|制作|新建|导出|保存|写入|整理成|存成|存为|绘制|画一|画个|画出|可视化|输出到|输出为).{0,30}(?:图表|思维导图|导图|流程图|架构图|白板|文件|笔记|文档|演示文稿|pptx|pdf|docx|xlsx|drawio|excalidraw)|(?:图表|思维导图|导图|流程图|架构图|白板|文件|笔记|文档|演示文稿|pptx|pdf|docx|xlsx|drawio|excalidraw).{0,30}(?:生成|创建|制作|新建|导出|保存|写入|绘制|存成|存为|输出到|输出为)|(?:规划|设计|制定|重新规划|生成|整理).{0,36}(?:攻略|方案|行程|路线|计划).{0,24}(?:保存|写入|存成|存为|导出|笔记|文档|文件|输出到|输出为)|(?:输出到|输出为|保存|写入|整理|存成|存为|导出).{0,16}(?:到|为|成|进)?\s*(?:笔记|文档|文件)|\b(?:create|generate|export|save|write|produce|visuali[sz]e).{0,40}(?:diagram|mind\s*map|mindmap|flowchart|file|note|document|presentation|pptx|pdf|docx|xlsx)\b|\b(?:itinerary|plan|guide|proposal|report).{0,40}(?:save|write|export|file|note|document)\b/i

const INFORMATION_QUERY_PATTERN =
  /查看|查询|获取|检索|搜索|总结|汇总|梳理|分析|解读|列出|最新|热点|新闻|资讯|趋势|信息|内容|数据|find|search|fetch|get|retrieve|summari[sz]e|analy[sz]e|latest|news|trending|information/i

const DIAGRAM_ARTIFACT_REQUEST_PATTERN =
  /绘制|画一|画个|画出|可视化|图表|思维导图|导图|流程图|架构图|白板|drawio|excalidraw|diagram|mind\s*map|mindmap|flowchart|visuali[sz]e/i

const NOTE_OUTPUT_REQUEST_PATTERN =
  /(?:输出到|输出为|保存|写入|整理|生成|创建|新建|存成|存为|导出).{0,18}(?:到|为|成|进)?\s*(?:笔记|文档|文件)|(?:笔记|文档|文件).{0,18}(?:输出到|输出为|保存|写入|整理|生成|创建|新建|存成|存为|导出)/i

const PLAN_ARTIFACT_REQUEST_PATTERN =
  /(?:规划|设计|制定|重新规划|生成|整理).{0,36}(?:攻略|方案|行程|路线|计划).{0,24}(?:保存|写入|存成|存为|导出|笔记|文档|文件|输出到|输出为)|(?:攻略|方案|行程|路线|计划).{0,36}(?:保存|写入|存成|存为|导出|笔记|文档|文件|输出到|输出为)/i

const SOCIAL_CONTENT_PLAN_PATTERN =
  /(?:小红书|rednote|xhs|图文|发布文案|页面结构|图像提示词|图片提示词|风格判断|选题判断|逐页|6\s*页|六\s*页)/i

const EXPLICIT_ARTIFACT_OUTPUT_PATTERN =
  /导出|保存|写入|输出到|输出为|存成|存为|文件|笔记|文档|pptx|pdf|docx|xlsx|drawio|excalidraw|diagram|mind\s*map|mindmap|flowchart|export|save|write|file|note|document|presentation/i

const PROGRESS_ONLY_FINAL_PATTERN =
  /^(?:好(?:的)?|收到|明白|可以|没问题|了解|充分理解|我明白|我知道了)[。！!，,\s]*(?:我(?:现在|会|将|来|马上|准备|先|接下来)|这就|下面|接下来|先|正在|开始|准备|马上)?|^(?:我(?:现在|会|将|来|马上|准备|先|接下来)|这就|下面|接下来|先|正在|开始|准备|马上)/i

const PROGRESS_VERB_PATTERN =
  /(?:正在|准备|马上|接下来|下一步|先确认|先梳理|先整理|我会|我将|我现在|我来|这就|开始处理|继续处理|继续完成|稍后|待会|将会|会继续)/i

function estimateChineseAwareLength(value: string) {
  return Array.from(value.trim()).length
}

function countContentSignals(answer: string) {
  let signals = 0
  if (/^#{1,4}\s+\S/m.test(answer)) signals += 1
  if (/(^|\n)\s*(?:[-*]|\d+[.、．])\s+\S/.test(answer)) signals += 1
  if (/[\n\r].+[\n\r].+/.test(answer)) signals += 1
  if (/[:：]\s*\S{8,}/.test(answer)) signals += 1
  if (/[。.!?！？]\s*\S{12,}[。.!?！？]/.test(answer)) signals += 1
  return signals
}

export function isProgressOnlyFinalAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, ' ').trim()
  if (!normalized) return true

  const length = estimateChineseAwareLength(normalized)
  const contentSignals = countContentSignals(answer)
  if (length <= 36 && PROGRESS_ONLY_FINAL_PATTERN.test(normalized)) {
    return true
  }

  if (length <= 220 && PROGRESS_ONLY_FINAL_PATTERN.test(normalized) && /(?:我(?:现在|会|将|来|马上|准备|先|接下来)|这就|下面|接下来|先|正在|开始|准备|马上).{0,80}(?:然后|再|最终|给你|输出|写入|整理出|生成|完成)/.test(normalized) && contentSignals === 0) {
    return true
  }

  if (length <= 180 && PROGRESS_ONLY_FINAL_PATTERN.test(normalized) && PROGRESS_VERB_PATTERN.test(normalized) && contentSignals === 0) {
    return true
  }

  if (length <= 260 && PROGRESS_VERB_PATTERN.test(normalized) && /(?:完成后|然后|再|最终|给你|输出|写入|整理出)/.test(normalized) && contentSignals === 0) {
    return true
  }

  return false
}

function getConcreteToolHint(userInput: string): string {
  if (DIAGRAM_ARTIFACT_REQUEST_PATTERN.test(userInput)) {
    return '对于图表/思维导图/Excalidraw 任务，请继续输出 JSON Action，优先使用 create_diagram_from_outline；需要空白或自定义画布时使用 create_diagram_file。'
  }

  if (NOTE_OUTPUT_REQUEST_PATTERN.test(userInput)) {
    return '对于输出到笔记/文档/文件的任务，请继续输出 JSON Action，优先使用 create_file；需要写入当前编辑器时使用 replace_editor_content。'
  }

  return '请继续输出 JSON Action，调用 create_file、replace_editor_content、create_diagram_from_outline 或其他实际工具完成任务。'
}

export function shouldRecoverWithAutoFinalAnswer(thought: string): boolean {
  const normalized = thought.trim()
  return CONTINUATION_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isConcreteArtifactRequest(userInput: string, actionLikeRequest: boolean): boolean {
  const artifactProbe = userInput.replace(/\brednote\b/ig, '')
  if (SOCIAL_CONTENT_PLAN_PATTERN.test(userInput) && !EXPLICIT_ARTIFACT_OUTPUT_PATTERN.test(artifactProbe)) {
    return false
  }

  if (NOTE_OUTPUT_REQUEST_PATTERN.test(userInput) || PLAN_ARTIFACT_REQUEST_PATTERN.test(userInput)) {
    return true
  }

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

  if (isInternalToolReport(answer)) {
    return { ok: false, reason: 'Final Answer 包含内部工具日志或诊断信息，请改写为面向用户的正式回答' }
  }

  const normalizedAnswer = answer.toLowerCase().trim()
  const normalizedInput = userInput.toLowerCase().trim()

  if (isProgressOnlyFinalAnswer(answer)) {
    return { ok: false, reason: '这只是进度说明，不是完整最终答案，请继续完成用户任务后再收尾' }
  }

  // 检查是否只是重复用户问题
  if (normalizedAnswer === normalizedInput) {
    return { ok: false, reason: 'Final Answer 不能只是重复用户的问题' }
  }

  // 检查是否声称执行了落盘、导出、外部工具等操作但没有实际执行。
  // 普通聊天里“已生成方案正文”不应被强行推回工具循环。
  const claimsExecution = /已创建(?:文件|笔记|文档|图表|报告)?|已保存|已写入|已导出|成功创建|成功保存|成功写入|成功导出|created (?:file|note|document|diagram|report)|saved|exported/i.test(answer)
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
