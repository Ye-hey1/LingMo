/**
 * AI 补全多级上下文构建器
 * 从 ProseMirror 文档中提取结构化上下文，为补全请求提供更精准的信息
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface CompletionContext {
  /** 当前位置上方的标题层级路径（最多 3 级） */
  headingPath: string[]
  /** 光标前的文本（扩展到 500 字符） */
  textBefore: string
  /** 光标后的文本（最多 200 字符） */
  textAfter: string
  /** 当前节点的类型 */
  nodeType: string
  /** 光标位置分类 */
  cursorPosition: 'empty-line' | 'mid-sentence' | 'end-of-line'
  /** 检测到的主要语言 */
  language: 'zh' | 'en' | 'mixed' | 'unknown'
}

/**
 * 从 ProseMirror 文档中构建补全上下文
 */
export function buildCompletionContext(
  doc: ProseMirrorNode,
  cursorPos: number
): CompletionContext {
  const $pos = doc.resolve(cursorPos)

  // 1. 提取标题路径
  const headingPath = extractHeadingPath(doc, cursorPos)

  // 2. 提取光标前的文本（扩展到 500 字符）
  const textBeforeStart = Math.max(0, cursorPos - 500)
  const textBefore = doc.textBetween(textBeforeStart, cursorPos, '\n')

  // 3. 提取光标后的文本（最多 200 字符）
  let textAfter = ''
  try {
    const textAfterEnd = Math.min(doc.content.size, cursorPos + 200)
    if (textAfterEnd > cursorPos) {
      textAfter = doc.textBetween(cursorPos, textAfterEnd, '\n')
    }
  } catch {
    textAfter = ''
  }

  // 4. 当前节点类型
  const nodeType = $pos.parent.type.name

  // 5. 光标位置分类
  const cursorPosition = classifyCursorPosition($pos)

  // 6. 语言检测
  const language = detectLanguage(textBefore)

  return {
    headingPath,
    textBefore,
    textAfter,
    nodeType,
    cursorPosition,
    language,
  }
}

/**
 * 提取从文档根到当前位置的标题路径
 * 参考 outline.tsx 的 extractHeadings 实现
 */
function extractHeadingPath(doc: ProseMirrorNode, cursorPos: number): string[] {
  const headings: string[] = []

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && pos < cursorPos) {
      const level = node.attrs.level as number
      const text = node.textContent.trim()
      if (text) {
        headings.push(`${'#'.repeat(level)} ${text}`)
      }
    }
    // 只遍历到光标位置之前
    return pos + node.nodeSize < cursorPos
  })

  // 只保留最近的 3 个标题
  return headings.slice(-3)
}

/**
 * 根据光标在段落中的位置分类
 */
function classifyCursorPosition(
  $pos: ReturnType<ProseMirrorNode['resolve']>
): 'empty-line' | 'mid-sentence' | 'end-of-line' {
  const parentText = $pos.parent.textContent.trim()

  // 空段落
  if (!parentText) return 'empty-line'

  // 计算光标在父节点内的偏移
  const textOffset = $pos.parentOffset
  const parentContentLength = $pos.parent.content.size

  // 光标在行末或接近行末（容差 2 个字符）
  if (textOffset >= parentContentLength - 2) return 'end-of-line'

  return 'mid-sentence'
}

/**
 * 检测文本的主要语言
 */
function detectLanguage(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  const zhChars = (text.match(/[一-鿿]/g) || []).length
  const enChars = (text.match(/[a-zA-Z]/g) || []).length
  const total = zhChars + enChars

  if (total === 0) return 'unknown'
  if (zhChars / total > 0.6) return 'zh'
  if (enChars / total > 0.6) return 'en'
  return 'mixed'
}

/**
 * 根据补全上下文构建差异化的 prompt
 */
export function buildPromptFromContext(
  richContext: CompletionContext,
  rawContext: string
): string {
  const langInstruction =
    richContext.language === 'zh' ? '中文'
    : richContext.language === 'en' ? 'English'
    : '与上下文相同的语言'

  // 空行：基于标题上下文建议下一段内容
  if (richContext.cursorPosition === 'empty-line') {
    const headingContext = richContext.headingPath.length > 0
      ? `\n上方的标题层级：\n${richContext.headingPath.join('\n')}\n`
      : ''

    return `基于上下文，建议接下来应该写什么内容。用${langInstruction}输出。只输出建议内容，不要解释。

${headingContext}
前文：
${rawContext.slice(-200)}

建议（1-2 句话）：`
  }

  // 句中：自然补全当前句子
  if (richContext.cursorPosition === 'mid-sentence') {
    return `自然地补全当前句子。用${langInstruction}输出。只输出续写内容，不要解释。

${rawContext}

续写：`
  }

  // 行尾（默认）：自然续写下文
  return `自然地续写下文。用${langInstruction}输出。只输出续写内容，不要解释。

${rawContext}

续写：`
}
