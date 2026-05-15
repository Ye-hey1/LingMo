import { fetchAiDescByImage } from './ai/description'
import ocr from './ocr'

export type ImageRecognitionMethod = 'ocr' | 'vlm'

export interface ImageRecognitionResult {
  content: string
  desc: string
}

interface RecognizeStructuredImageParams {
  path: string
  base64?: string
  method: ImageRecognitionMethod
  sourceLabel?: string
}

const MAX_TITLE_LENGTH = 28
const MAX_HIGHLIGHTS = 5
const MAX_EXCERPTS = 8

function compactText(value?: string) {
  return (value || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trim()}...`
}

function dedupeLines(lines: string[]) {
  const unique: string[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const normalized = line.toLowerCase()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(line)
  }

  return unique
}

function extractLines(rawText: string) {
  return dedupeLines(
    rawText
      .split('\n')
      .map((line) => compactText(line))
      .filter(Boolean),
  )
}

function extractTitle(lines: string[], sourceLabel: string) {
  const candidate =
    lines.find((line) => line.length >= 4 && line.length <= 40) ||
    lines.find((line) => line.length > 0) ||
    `${sourceLabel}识别结果`

  return truncate(candidate.replace(/^[-*#\d.\s]+/, ''), MAX_TITLE_LENGTH)
}

function buildStructuredMarkdown(title: string, highlights: string[], excerpts: string[]) {
  const sections: string[] = ['# 主题', title]

  if (highlights.length > 0) {
    sections.push('', '## 关键信息', ...highlights.map((line) => `- ${line}`))
  }

  if (excerpts.length > 0) {
    sections.push('', '## 文本摘录', ...excerpts.map((line) => `- ${line}`))
  }

  return sections.join('\n')
}

function buildEmptyRecognitionResult(sourceLabel: string): ImageRecognitionResult {
  return {
    desc: `${sourceLabel}未识别到文本`,
    content: [
      '# 主题',
      '未识别到明确文本',
      '',
      '## 关键信息',
      '- 当前内容没有提取到稳定文本，可能是截图区域过小、画面以图形元素为主，或分辨率过高导致。',
    ].join('\n'),
  }
}

export function buildStructuredRecognitionFromText(rawText: string, sourceLabel = '截图'): ImageRecognitionResult {
  const lines = extractLines(rawText)
  if (lines.length === 0) {
    return buildEmptyRecognitionResult(sourceLabel)
  }

  const title = extractTitle(lines, sourceLabel)
  const highlights = lines.slice(0, MAX_HIGHLIGHTS).map((line) => truncate(line, 48))
  const excerpts = lines.slice(0, MAX_EXCERPTS).map((line) => truncate(line, 80))

  return {
    desc: title,
    content: buildStructuredMarkdown(title, highlights, excerpts),
  }
}

function extractTitleFromMarkdown(markdown: string, sourceLabel: string) {
  const lines = markdown
    .split('\n')
    .map((line) => compactText(line))
    .filter(Boolean)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => !['主题', '关键信息', '文本摘录', '可操作区域'].includes(line))

  return extractTitle(lines, sourceLabel)
}

function ensureStructuredMarkdown(markdown: string, sourceLabel: string): ImageRecognitionResult {
  const text = compactText(markdown)
  if (!text) {
    return buildEmptyRecognitionResult(sourceLabel)
  }

  if (markdown.includes('# 主题') || markdown.includes('## 关键信息')) {
    return {
      desc: extractTitleFromMarkdown(markdown, sourceLabel),
      content: markdown.trim(),
    }
  }

  return buildStructuredRecognitionFromText(markdown, sourceLabel)
}

export async function recognizeStructuredImage({
  path,
  base64,
  method,
  sourceLabel = '截图',
}: RecognizeStructuredImageParams): Promise<ImageRecognitionResult> {
  if (method === 'vlm') {
    if (!base64) {
      return buildEmptyRecognitionResult(sourceLabel)
    }
    const markdown = await fetchAiDescByImage(base64, { mode: 'structured', sourceLabel })
    return ensureStructuredMarkdown(markdown || '', sourceLabel)
  }

  const rawText = await ocr(path)
  return buildStructuredRecognitionFromText(rawText, sourceLabel)
}
