import type { ArtifactInputFormat, ArtifactInputSummary } from './types'

const MAX_RAW_FOR_AGENT = 40_000

export function detectArtifactInputFormat(input: string): ArtifactInputFormat {
  const text = input.trim()
  if (!text) return 'text'

  if (/^<!DOCTYPE\s+html/i.test(text) || /^<html[\s>]/i.test(text)) return 'html'

  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      // Keep checking other formats.
    }
  }

  if (/^\s*(select|insert|update|delete|create|drop|alter|with)\s+/i.test(text)) {
    return 'sql'
  }

  if (/^---\s*$/m.test(text.split('\n')[0]) || /^[a-zA-Z_][\w-]*\s*:\s*\S/m.test(text)) {
    const firstLines = text.split('\n').slice(0, 5).join('\n')
    if (!/^#{1,6}\s/m.test(text) && /^[a-zA-Z_][\w-]*\s*:/m.test(firstLines)) {
      return 'yaml'
    }
  }

  if (/^#{1,6}\s+\S/m.test(text)) return 'markdown'
  if (/```[\s\S]*?```/.test(text)) return 'markdown'
  if (/!\[[^\]]*\]\([^)]+\)/.test(text)) return 'markdown'
  if (/^[*-]\s+\S/m.test(text) && /^[*-]\s+\S/m.test(text.split('\n').slice(1).join('\n'))) {
    return 'markdown'
  }

  const lines = text.split(/\r?\n/).slice(0, 10)
  if (lines.length >= 2) {
    const tabCount = (lines[0].match(/\t/g) || []).length
    if (tabCount >= 1 && tabCount === ((lines[1].match(/\t/g) || []).length)) {
      return 'tsv'
    }

    const commaCount = (lines[0].match(/,/g) || []).length
    if (commaCount >= 1) {
      const allMatch = lines.slice(1, 5).every((line) => {
        const count = (line.match(/,/g) || []).length
        return Math.abs(count - commaCount) <= 1
      })
      if (allMatch) return 'csv'
    }
  }

  return 'text'
}

export function summarizeArtifactInput(input: string): ArtifactInputSummary {
  const format = detectArtifactInputFormat(input)
  const raw = input.length > MAX_RAW_FOR_AGENT
    ? `${input.slice(0, MAX_RAW_FOR_AGENT)}\n\n[...内容过长，已截断 ${input.length - MAX_RAW_FOR_AGENT} 字符]`
    : input

  if (format === 'json') {
    try {
      const parsed = JSON.parse(input)
      const pretty = JSON.stringify(parsed, null, 2)
      return {
        format,
        raw,
        structured: parsed,
        preview: pretty.length > 4000
          ? `[JSON] 截断预览，完整 ${pretty.length} 字符:\n${pretty.slice(0, 4000)}\n...`
          : `[JSON]\n${pretty}`,
      }
    } catch {
      return { format, raw, preview: `[JSON 解析失败]\n${input.slice(0, 1000)}` }
    }
  }

  if (format === 'csv' || format === 'tsv') {
    const delimiter = format === 'tsv' ? '\t' : ','
    const rows = input.trim().split(/\r?\n/).filter(Boolean)
    const fields = rows[0]?.split(delimiter).map((field) => field.trim()) ?? []
    const sampleRows = rows.slice(1, 11).map((row) => row.split(delimiter).map((cell) => cell.trim()))

    return {
      format,
      raw,
      structured: { fields, sampleRows },
      preview: [
        `[${format.toUpperCase()}] ${Math.max(rows.length - 1, 0)} 行 x ${fields.length} 列`,
        `字段: ${fields.join(', ') || '未识别'}`,
        `前 ${sampleRows.length} 行:`,
        sampleRows.map((row) => row.join(' | ')).join('\n'),
      ].join('\n'),
    }
  }

  const labels: Record<ArtifactInputFormat, string> = {
    markdown: 'Markdown 文档',
    html: 'HTML 文档',
    json: 'JSON 数据',
    csv: 'CSV 数据',
    tsv: 'TSV 数据',
    sql: 'SQL 查询或脚本',
    yaml: 'YAML 配置',
    text: '纯文本',
  }

  return {
    format,
    raw,
    preview: `[${labels[format]}, ${input.length} 字符]`,
  }
}

