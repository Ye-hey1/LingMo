/**
 * diagram-sync - 把图表文件（drawio / excalidraw / mermaid）保存事件同步到 KnowledgeObject 注册表
 *
 * 触发点：diagram-tools.ts 在 create / createFromOutline / update 成功后调用。
 * 职责：
 *   1. 不解析正文（drawio/excalidraw 二进制性强，mermaid 是纯文本）—— 标题/标签从
 *      文件路径和图表类型派生
 *   2. 计算 contentHash，用于增量重索引
 *   3. upsert 到 knowledge_objects，sourceType='diagram'，sourceId 用相对路径
 *
 * 不阻塞主流程，错误只记录。
 */

import { objectRegistry, type RegisterObjectInput } from './object-registry'
import { isDrawioPath, isExcalidrawPath, isMermaidPath } from '@/lib/diagram'

async function computeContentHash(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(content)
      const digest = await crypto.subtle.digest('SHA-256', data)
      const bytes = Array.from(new Uint8Array(digest))
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // fall through
    }
  }
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0
  }
  return `fnv_${(hash >>> 0).toString(16)}`
}

function deriveDiagramKind(path: string): 'drawio' | 'excalidraw' | 'mermaid' {
  if (isMermaidPath(path)) return 'mermaid'
  if (isExcalidrawPath(path)) return 'excalidraw'
  return 'drawio'
}

function deriveTitleFromPath(path: string): string {
  const fileName = path.split('/').pop() || path
  const stem = fileName.replace(/\.(drawio|drawio\.xml|excalidraw|excalidraw\.json|diagram\.json|mmd|mermaid)$/i, '')
  // 把下划线/连字符转空格，简单美化
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || fileName
}

export interface RegisterDiagramOptions {
  sourceRunId?: string
  origin?: RegisterObjectInput['origin']
  layout?: 'mindmap' | 'flowchart'
}

/**
 * 把图表保存事件注册为 KnowledgeObject。
 * @param filePath 相对工作区路径
 * @param content 图表全文
 */
export async function registerDiagramFromSave(
  filePath: string,
  content: string,
  options: RegisterDiagramOptions = {},
): Promise<void> {
  const kind = deriveDiagramKind(filePath)
  const title = deriveTitleFromPath(filePath)
  const contentHash = await computeContentHash(content)

  const tags = new Set<string>()
  tags.add(`kind:${kind}`)
  if (options.layout) tags.add(`layout:${options.layout}`)

  await objectRegistry.register({
    sourceType: 'diagram',
    sourceId: filePath,
    path: filePath,
    title,
    tags: Array.from(tags),
    origin: options.origin ?? 'agent_generated',
    status: 'active',
    contentHash,
    vectorIndexedAt: null,
    sourceRunId: options.sourceRunId,
    metadata: {
      kind,
      layout: options.layout ?? null,
      length: content.length,
    },
  })
}
