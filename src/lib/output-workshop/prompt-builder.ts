/**
 * 输出工坊 Prompt 构建器
 * 为 AI 生成提供结构化的提示词
 */

import type { OutputTemplate } from './templates'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildOutputPromptOptions {
  template: OutputTemplate
  title: string
  sourceContent: string
  sourceLabel?: string
  customInstructions?: string
}

// ---------------------------------------------------------------------------
// Prompt 构建
// ---------------------------------------------------------------------------

/**
 * 构建输出工坊的 AI 生成提示词
 */
export function buildOutputPrompt(options: BuildOutputPromptOptions): string {
  const { template, title, sourceContent, sourceLabel, customInstructions } = options

  const sections: string[] = []

  // 1. 角色设定
  sections.push(`你是资深视觉设计师和前端工程师。目标是把用户材料转成可交付的自包含 HTML，而不是普通 Markdown 总结。

## 硬性规则
- 使用用户提供的真实信息，不编造数据
- 输出应完整覆盖用户材料的主要章节、要点、数据组和行动项
- 如果内容较长，宁可增加 section、card 或 slide，也不要压缩到几段
- 最终输出必须是完整的、可直接在浏览器中打开的 HTML 文件
- 所有 CSS 必须内联，不依赖外部资源（除了 Google Fonts CDN）
- 使用现代 CSS（Grid、Flexbox、CSS Variables），不使用 JavaScript 框架
- 先用布局和排版建立层级：正文 1rem 以上，长文 1.55-1.75 行高，标题 text-wrap: balance，段落 text-wrap: pretty
- 避免横向溢出：长标题、表格、代码块、固定比例卡片和移动端视口都必须可读
- 动效只表达状态或内容关系，150-250ms 为主，使用自然 ease-out 曲线，并写入 prefers-reduced-motion 降级
- 不要使用渐变文字、装饰性玻璃拟态、24px 以上大圆角卡片、无意义的大阴影或每个区块都一样的入场动画`)

  // 2. 模板信息
  sections.push(`## 输出模板
- 模板 ID: ${template.id}
- 模板名称: ${template.name}
- 输出模式: ${template.mode}
- 使用场景: ${template.scenario}
- 最佳用途: ${template.bestFor}`)

  // 3. 设计约束
  sections.push(template.designConstraints)

  // 4. 输出提示
  sections.push(`## 输出要求
${template.outputHint}`)

  // 5. 自定义指令
  if (customInstructions) {
    sections.push(`## 用户额外要求
${customInstructions}`)
  }

  // 6. 音视频转录特异性排版指令
  const isVideoTranscript = sourceContent.includes('video-transcript') || (sourceLabel && sourceLabel.includes('视频转写'))
  if (isVideoTranscript) {
    sections.push(`## 音视频转录特异性排版指令（重要）
1. **智能过滤口语噪点**：输入材料为音视频语音识别（STT）转录搞，可能包含语气词、重复唠叨或口语化的废话。请在排版输出时进行“高保真脱水”，只提取最具干货价值的论点、概念和论据。
2. **时间戳优雅渲染**：原材料中可能含有类似 \`- 01:23\` 的时间轴线索。请不要直接照搬为单调文本，请在最终 HTML 中利用 CSS 样式，将其优雅地渲染为“具有进度感的时间轴（Timeline）”、“步骤引导标签”或“精美的时间微章”，提升视觉层级。
3. **章节金句提炼**：如果是生成小红书或海报卡片，请将最能概括该视频核心价值观或最震撼的“金句”用超大号艺术字体、醒目渐变色放置在卡片最上方；如果是思维导图，请将视频章节（带时间段的讨论）作为大纲的一级分支进行有序树状发散。`)
  }

  // 7. 输入材料
  sections.push(`## 输入材料
来源: ${sourceLabel || '用户输入'}
标题: ${title}

---
${sourceContent}
---`)

  // 7. 输出格式要求
  sections.push(`## 输出格式要求

请直接输出完整的 HTML 代码，包含：
1. \`<!DOCTYPE html>\` 声明
2. \`<html>\`、\`<head>\`、\`<body>\` 标签
3. 所有 CSS 内联在 \`<style>\` 标签中
4. 必要的 meta 标签（charset、viewport）
5. Google Fonts CDN 链接（如果需要特殊字体）

不要输出任何解释文字，只输出 HTML 代码。
不要使用 markdown 代码块包裹，直接输出 HTML。`)

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// 输入摘要
// ---------------------------------------------------------------------------

export interface InputSummary {
  format: string
  charCount: number
  wordCount: number
  lineCount: number
  preview: string
}

/**
 * 分析输入内容的格式和摘要
 */
export function analyzeInput(content: string): InputSummary {
  const trimmed = content.trim()
  const charCount = trimmed.length
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length
  const lineCount = trimmed.split('\n').length

  // 检测格式
  let format = 'text'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      format = 'json'
    } catch { /* not json */ }
  } else if (trimmed.includes(',') && trimmed.split('\n')[0]?.split(',').length > 2) {
    format = 'csv'
  } else if (trimmed.startsWith('#') || trimmed.includes('\n# ')) {
    format = 'markdown'
  } else if (trimmed.startsWith('<') && trimmed.includes('>')) {
    format = 'html'
  } else if (trimmed.includes('---') && trimmed.includes(':')) {
    format = 'yaml'
  }

  // 预览（前 200 字符）
  const preview = charCount > 200 ? trimmed.slice(0, 200) + '...' : trimmed

  return { format, charCount, wordCount, lineCount, preview }
}

// ---------------------------------------------------------------------------
// 验证
// ---------------------------------------------------------------------------

/**
 * 验证输入是否有效
 */
export function validateInput(content: string): { valid: boolean; error?: string } {
  const trimmed = content.trim()

  if (!trimmed) {
    return { valid: false, error: '请输入内容或选择笔记文件' }
  }

  if (trimmed.length < 10) {
    return { valid: false, error: '内容太短，请提供更多材料' }
  }

  if (trimmed.length > 500000) {
    return { valid: false, error: '内容过长，请精简后重试' }
  }

  return { valid: true }
}
