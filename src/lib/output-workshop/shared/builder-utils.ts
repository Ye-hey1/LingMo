/**
 * 智能排版 HTML 构建器共享层
 * 类型 + 各风格构建器共用的辅助函数，从 html-builders.ts 提取。
 */
import { escapeHtml } from "./escape"
import type { ExtractedSection } from "./types"
import type { MindmapBranch, MindmapChild } from "../extraction"
// 本地绑定供下方 helper(renderMarkdown 等)使用，同时 re-export 给各 styles
export { escapeHtml }
// ExtractedSection 已统一下沉到 ./types.ts，这里 re-export 供各 styles 构建器沿用旧路径
export type { ExtractedSection }
export type { MindmapBranch, MindmapChild }

export interface BuildHtmlOptions {
  title: string
  subtitle?: string
  sections: ExtractedSection[]
  sourceLabel?: string
  generatedAt?: string
  /** 思维导图策略专用的结构化树（learning-mindmap 优先使用，无则回退 sections） */
  mindmap?: MindmapBranch[]
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 极简 Markdown → HTML 渲染（供本地样式模板的 styles/* 构建器使用）。
 *
 * 设计取舍：这里是「自包含、零依赖、输出即最终 HTML 片段」的轻量渲染，刻意不引入
 * markdown-it，因为 styles 构建器需要精确控制 section.body/bullets 的内联结构
 * （如直接嵌入 <li> 而非包裹额外容器）。微信图文那条管线
 * （wechat-markdown-renderer.ts）走的是 markdown-it 全 token 渲染 + 内联样式注入，
 * 两者服务不同场景，不应强行合并——合并会破坏 styles 构建器的输出契约。
 */
export function renderMarkdown(text: string): string {
  if (!text) return ''

  // 1. 转义安全字符
  let html = escapeHtml(text)

  // 2. 解析简易 Markdown 表格 (由 | 和 - 组成)
  const lines = html.split('\n')
  let inTable = false
  let tableHtml = ''
  let headerCols: string[] = []
  const renderedLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      const isDivider = cols.every(c => /^[:-]+$/.test(c))

      if (isDivider) {
        continue
      }

      if (!inTable) {
        inTable = true
        tableHtml = '<div style="width: 100%; overflow-x: auto; margin: 16px 0; border-radius: 8px; border: 1px solid rgba(0,0,0,0.08);"><table style="width: 100%; border-collapse: collapse; font-size: 0.85em; text-align: left;"><thead><tr style="background: rgba(0,0,0,0.02);">'
        tableHtml += cols.map(c => `<th style="padding: 10px 14px; font-weight: 600; border-bottom: 2px solid rgba(0,0,0,0.08);">${c}</th>`).join('')
        tableHtml += '</tr></thead><tbody>'
        headerCols = cols
      } else {
        tableHtml += '<tr>'
        for (let j = 0; j < headerCols.length; j++) {
          tableHtml += `<td style="padding: 10px 14px; border-bottom: 1px solid rgba(0,0,0,0.05);">${cols[j] || ''}</td>`
        }
        tableHtml += '</tr>'
      }
    } else {
      if (inTable) {
        inTable = false
        tableHtml += '</tbody></table></div>'
        renderedLines.push(tableHtml)
        tableHtml = ''
      }
      renderedLines.push(lines[i])
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table></div>'
    renderedLines.push(tableHtml)
  }

  html = renderedLines.join('\n')

  // 3. 粗体 (支持 ** 和 __)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>')

  // 4. 斜体 (支持 * 和 _)
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.*?)_/g, '<em>$1</em>')

  // 5. 行内代码 (支持 `code`)
  html = html.replace(/`(.*?)`/g, '<code style="font-family: monospace; background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">$1</code>')

  // 6. 链接 (支持 [text](url))
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: inherit; text-decoration: underline; font-weight: 600;">$1</a>')

  // 7. 换行
  html = html.replace(/\n/g, '<br>')

  return html
}

export function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function normalizeLabel(value?: string): string {
  return (value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getContentBrand(options: Pick<BuildHtmlOptions, 'title' | 'sourceLabel' | 'sections'>, fallback = 'LingMo'): string {
  const source = normalizeLabel(options.sourceLabel)
  if (source) return source.slice(0, 28)

  const title = normalizeLabel(options.title)
  if (title) return title.slice(0, 28)

  const sectionTitle = normalizeLabel(options.sections[0]?.title)
  return sectionTitle ? sectionTitle.slice(0, 28) : fallback
}

export function getContentInitials(label: string): string {
  const cleaned = normalizeLabel(label)
  if (!cleaned) return 'LM'

  const asciiWords = cleaned.match(/[A-Za-z0-9]+/g)
  if (asciiWords?.length) {
    return asciiWords
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return Array.from(cleaned).slice(0, 2).join('')
}

export function getContentCategory(options: Pick<BuildHtmlOptions, 'title' | 'subtitle' | 'sections'>, fallback = '知识手账'): string {
  const haystack = [options.title, options.subtitle, ...options.sections.flatMap((section) => [section.title, section.body || ''])]
    .join(' ')
    .toLowerCase()

  if (/ai|模型|算法|代码|技术|开发|系统|工程|api/.test(haystack)) return '技术笔记'
  if (/产品|商业|增长|用户|市场|运营|策略/.test(haystack)) return '产品洞察'
  if (/学习|课程|知识|复习|考试|方法/.test(haystack)) return '学习卡片'
  if (/研究|报告|数据|分析|趋势|历史/.test(haystack)) return '研究摘要'
  return fallback
}
