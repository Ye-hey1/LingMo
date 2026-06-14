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

interface CompletionContextOptions {
  beforeChars?: number
  afterChars?: number
}

/**
 * 从 ProseMirror 文档中构建补全上下文
 */
export function buildCompletionContext(
  doc: ProseMirrorNode,
  cursorPos: number,
  options: CompletionContextOptions = {}
): CompletionContext {
  const $pos = doc.resolve(cursorPos)
  const beforeChars = options.beforeChars ?? 500
  const afterChars = options.afterChars ?? 200

  // 1. 提取标题路径
  const headingPath = extractHeadingPath(doc, cursorPos)

  // 2. 提取光标前的文本（扩展到 500 字符）
  const textBeforeStart = Math.max(0, cursorPos - beforeChars)
  const textBefore = doc.textBetween(textBeforeStart, cursorPos, '\n')

  // 3. 提取光标后的文本（最多 200 字符）
  let textAfter = ''
  try {
    const textAfterEnd = Math.min(doc.content.size, cursorPos + afterChars)
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

  const suffixSection = richContext.textAfter.trim()
    ? `\n后文（光标之后，不能重复）：\n${richContext.textAfter}\n`
    : ''

  const insertionRule = `你正在为编辑器光标处生成 Fill-in-the-Middle 补全。只输出应该插入到光标处的文本；不要解释，不要复述前文，不要重复后文。`

  // 空行：基于标题上下文建议下一段内容
  if (richContext.cursorPosition === 'empty-line') {
    const headingContext = richContext.headingPath.length > 0
      ? `\n上方的标题层级：\n${richContext.headingPath.join('\n')}\n`
      : ''

    return `${insertionRule}
基于上下文，建议接下来应该写什么内容。用${langInstruction}输出。

${headingContext}
前文：
${rawContext.slice(-200)}
${suffixSection}

光标处应插入（1-2 句话）：`
  }

  // 句中：自然补全当前句子
  if (richContext.cursorPosition === 'mid-sentence') {
    return `${insertionRule}
自然地补全当前句子。用${langInstruction}输出。

前文：
${rawContext}
${suffixSection}

光标处应插入：`
  }

  // 行尾（默认）：自然续写下文
  return `${insertionRule}
自然地续写下文。用${langInstruction}输出。

前文：
${rawContext}
${suffixSection}

光标处应插入：`
}

/**
 * 为用户显式触发的 AI续写构建写作型 prompt。
 * 与灰字预测不同，这里生成完整续写段落，避免短 token 补全截断成半句话。
 */
export function buildWritingContinuationPrompt(
  richContext: CompletionContext,
  rawContext: string
): string {
  const langInstruction =
    richContext.language === 'zh' ? '中文'
    : richContext.language === 'en' ? 'English'
    : '与上下文相同的语言'

  const headingContext = richContext.headingPath.length > 0
    ? `\n标题层级（用于判断当前位置主题）：\n${richContext.headingPath.join('\n')}\n`
    : ''

  const suffixSection = richContext.textAfter.trim()
    ? `\n光标后的已有内容（仅用于衔接，禁止重复）：\n${richContext.textAfter}\n`
    : ''

  const lengthRule = richContext.language === 'zh'
    ? '续写 1 个完整自然段，约 120-260 个中文字符；如果正在句中，先自然补完当前句子。'
    : 'Write one complete paragraph, about 80-160 words; if the cursor is mid-sentence, finish the current sentence first.'

  return `你正在为写作编辑器中的光标位置执行 AI续写。请根据上下文生成可直接插入光标处的正文。

规则：
- 只输出要插入的续写正文，不要解释、标题、标签或 Markdown 代码块。
- 使用${langInstruction}，保持原文的语气、体裁、术语密度和结构节奏。
- ${lengthRule}
- 续写必须以完整句子结束，不能停在半句话、半个词或未闭合的列表项。
- 不要复述前文，不要重复光标后的已有内容。
- 如果后文是新标题，请把续写写成当前段落的自然收束，方便过渡到后文标题。

${headingContext}
光标前的上下文：
${rawContext}
${suffixSection}

光标处应插入的续写：`
}
