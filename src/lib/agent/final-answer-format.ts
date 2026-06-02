/**
 * 统一 Final Answer 格式模块
 *
 * 改进点：
 * 1. 统一要求 JSON 格式输出
 * 2. 移除自然语言 Final Answer 检测
 * 3. 简化正则匹配
 * 4. 更清晰的格式指导
 */

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
