import { create } from 'zustand'
import { extractWikiLinksWithContext, normalizeWikiLinkTarget } from '@/lib/wikilink-extension'
import type { DirTree } from '@/stores/article'
import { computedParentPath } from '@/lib/path'
import { readWorkspaceTextFile } from '@/lib/file-binary'

export interface Backlink {
  sourcePath: string
  sourceName: string
  context: string
  line: number
}

export interface UnlinkedMention {
  sourcePath: string
  sourceName: string
  context: string
  line: number
}

interface NoteIndexStore {
  // path → 反向链接列表
  backlinks: Map<string, Backlink[]>
  // path → 未链接提及列表
  unlinkedMentions: Map<string, UnlinkedMention[]>
  // 是否已构建索引
  isIndexed: boolean
  // 是否正在构建
  isBuilding: boolean

  buildIndex: (fileTree: DirTree[]) => Promise<void>
  updateFileIndex: (path: string, content: string) => void
  getBacklinks: (path: string) => Backlink[]
  getUnlinkedMentions: (path: string) => UnlinkedMention[]
}

// 从文件树中收集所有 .md 文件路径
function collectMdPaths(tree: DirTree[], parent?: DirTree): Array<{ path: string; node: DirTree }> {
  const results: Array<{ path: string; node: DirTree }> = []
  for (const item of tree) {
    const path = computedParentPath({ ...item, parent })
    if (item.isFile && item.name.endsWith('.md')) {
      results.push({ path, node: item })
    }
    if (item.children) {
      for (const child of item.children) {
        child.parent = item
      }
      results.push(...collectMdPaths(item.children, item))
    }
  }
  return results
}

// 从路径中提取文件名（不含 .md 后缀）
function pathToBaseName(path: string): string {
  const name = path.split('/').pop() || path
  return name.replace(/\.md$/, '')
}

export const useNoteIndexStore = create<NoteIndexStore>((set, get) => ({
  backlinks: new Map(),
  unlinkedMentions: new Map(),
  isIndexed: false,
  isBuilding: false,

  buildIndex: async (fileTree: DirTree[]) => {
    if (get().isBuilding) return
    set({ isBuilding: true })

    try {
      const mdFiles = collectMdPaths(fileTree)

      // 存储每个文件的出站链接和内容
      const outgoingMap = new Map<string, Array<{ target: string; context: string; line: number }>>()
      const contentMap = new Map<string, string>()

      for (const { path } of mdFiles) {
        try {
          const content = await readWorkspaceTextFile(path)
          contentMap.set(path, content)
          const links = extractWikiLinksWithContext(content)
          outgoingMap.set(path, links)
        } catch {
          // 文件可能不存在或无法读取，跳过
        }
      }

      // 构建反向链接映射
      const backlinksMap = new Map<string, Backlink[]>()

      for (const [sourcePath, links] of outgoingMap) {
        const sourceName = pathToBaseName(sourcePath)
        for (const link of links) {
          // 标准化目标名（去掉 .md 后缀，小写比较）
          const normalizedTarget = normalizeWikiLinkTarget(link.target)

          // 查找目标路径：可能通过文件名匹配
          let targetPath = ''
          for (const { path } of mdFiles) {
            if (pathToBaseName(path).toLowerCase() === normalizedTarget) {
              targetPath = path
              break
            }
          }
          if (!targetPath) {
            // 如果找不到精确匹配，目标路径就是链接名本身
            targetPath = link.target.endsWith('.md') ? link.target : `${link.target}.md`
          }

          if (!backlinksMap.has(targetPath)) {
            backlinksMap.set(targetPath, [])
          }
          backlinksMap.get(targetPath)!.push({
            sourcePath,
            sourceName,
            context: link.context,
            line: link.line,
          })
        }
      }

      // 构建未链接提及映射
      // 对每个笔记，在其他笔记中搜索其文件名的纯文本出现（不在 [[...]] 中）
      const unlinkedMap = new Map<string, UnlinkedMention[]>()

      // 构建文件名到路径的映射（大小写不敏感）
      const nameToPath = new Map<string, string>()
      for (const { path } of mdFiles) {
        const name = pathToBaseName(path)
        if (name.length >= 2) { // 忽略过短的文件名避免误匹配
          nameToPath.set(name.toLowerCase(), path)
        }
      }

      for (const [sourcePath, content] of contentMap) {
        const sourceName = pathToBaseName(sourcePath)
        const lines = content.split('\n')

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex]

          // 移除 [[...]] 链接部分，只在纯文本中搜索
          const lineWithoutLinks = line.replace(/\[\[[^\]]*\]\]/g, '')

          for (const [targetName, targetPath] of nameToPath) {
            if (targetPath === sourcePath) continue // 跳过自身
            if (sourceName.toLowerCase() === targetName) continue // 跳过同名

            // 使用单词边界匹配，避免部分匹配
            const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(`(?:^|[\\s(（【「『"'])?${escapedName}(?:$|[\\s)）】」』"'.,;:!?、。，；！？])`, 'gi')
            const lowerLine = lineWithoutLinks.toLowerCase()

            if (regex.test(lowerLine)) {
              if (!unlinkedMap.has(targetPath)) {
                unlinkedMap.set(targetPath, [])
              }
              unlinkedMap.get(targetPath)!.push({
                sourcePath,
                sourceName,
                context: line.trim(),
                line: lineIndex + 1,
              })
            }
          }
        }
      }

      set({ backlinks: backlinksMap, unlinkedMentions: unlinkedMap, isIndexed: true })
    } finally {
      set({ isBuilding: false })
    }
  },

  updateFileIndex: (path: string, content: string) => {
    const backlinks = new Map(get().backlinks)
    const unlinkedMentions = new Map(get().unlinkedMentions)
    const sourceName = pathToBaseName(path)

    // 1. 移除该文件之前贡献的所有反向链接
    for (const [targetPath, bls] of backlinks) {
      backlinks.set(
        targetPath,
        bls.filter(bl => bl.sourcePath !== path)
      )
    }

    // 2. 移除该文件之前贡献的所有未链接提及
    for (const [targetPath, mentions] of unlinkedMentions) {
      unlinkedMentions.set(
        targetPath,
        mentions.filter(m => m.sourcePath !== path)
      )
    }

    // 3. 从新内容中提取链接并添加反向引用
    const links = extractWikiLinksWithContext(content)
    for (const link of links) {
      const normalizedTarget = normalizeWikiLinkTarget(link.target)
      let targetPath = link.target.endsWith('.md') ? link.target : `${link.target}.md`

      if (!backlinks.has(targetPath)) {
        backlinks.set(targetPath, [])
      }
      backlinks.get(targetPath)!.push({
        sourcePath: path,
        sourceName,
        context: link.context,
        line: link.line,
      })
    }

    set({ backlinks, unlinkedMentions })
  },

  getBacklinks: (path: string) => {
    return get().backlinks.get(path) || []
  },

  getUnlinkedMentions: (path: string) => {
    return get().unlinkedMentions.get(path) || []
  },
}))
