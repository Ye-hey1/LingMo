import type { DirTree } from "@/stores/article"
import { computedParentPath } from "@/lib/path"

export type FileBrowserFilter = "all" | "markdown" | "pdf" | "drawio" | "json" | "folder" | "recent-created" | "generated"

const MARKDOWN_FILE_PATTERN = /\.md$/i
const PDF_FILE_PATTERN = /\.pdf$/i
const DRAWIO_FILE_PATTERN = /\.(drawio|drawio\.xml)$/i
const EXCALIDRAW_FILE_PATTERN = /\.(excalidraw|excalidraw\.json)$/i
const JSON_FILE_PATTERN = /\.json$/i
const RECENT_CREATED_DAYS = 7
const GENERATED_PATH_PATTERNS = [
  /^research\//i,
  /^memory-notes\//i,
  /^screenshot\//i,
  /^screenshots\//i,
  /^generated\//i,
  /^diagrams?\//i,
]
const GENERATED_NAME_PATTERNS = [
  DRAWIO_FILE_PATTERN,
  EXCALIDRAW_FILE_PATTERN,
  /^\d{4}-\d{2}-\d{2}[-_].+\.(md|markdown|pdf|html)$/i,
  /research|deep[-_\s]?research|report|summary|diagram|mind[-_\s]?map|generated/i,
]

export interface FileBrowserStats {
  files: number
  folders: number
}

function isRecentlyCreated(item: DirTree, days = RECENT_CREATED_DAYS) {
  if (!item.createdAt) {
    return false
  }

  const createdAt = new Date(item.createdAt).getTime()
  if (Number.isNaN(createdAt)) {
    return false
  }

  return Date.now() - createdAt <= days * 24 * 60 * 60 * 1000
}

export function isGeneratedFile(item: DirTree) {
  if (!item.isFile) {
    return false
  }

  const path = computedParentPath(item).replace(/\\/g, "/")
  return GENERATED_PATH_PATTERNS.some(pattern => pattern.test(path))
    || GENERATED_NAME_PATTERNS.some(pattern => pattern.test(item.name))
}

export function filterTreeByCloudVisibility(tree: DirTree[], showCloudFiles: boolean): DirTree[] {
  if (showCloudFiles) {
    return tree
  }

  return tree
    .filter((item) => item.isLocale)
    .map((item) => ({
      ...item,
      children: item.children ? filterTreeByCloudVisibility(item.children, showCloudFiles) : undefined,
    }))
}

function matchesFilter(item: DirTree, filter: FileBrowserFilter) {
  if (filter === "all") {
    return true
  }

  if (filter === "folder") {
    return item.isDirectory
  }

  if (!item.isFile) {
    return false
  }

  if (filter === "markdown") {
    return MARKDOWN_FILE_PATTERN.test(item.name)
  }

  if (filter === "pdf") {
    return PDF_FILE_PATTERN.test(item.name)
  }

  if (filter === "drawio") {
    return DRAWIO_FILE_PATTERN.test(item.name)
  }

  if (filter === "json") {
    return JSON_FILE_PATTERN.test(item.name)
  }

  if (filter === "recent-created") {
    return isRecentlyCreated(item)
  }

  if (filter === "generated") {
    return isGeneratedFile(item)
  }

  return true
}

export function applyFileBrowserFilters(
  tree: DirTree[],
  searchQuery: string,
  filter: FileBrowserFilter,
): DirTree[] {
  const normalizedQuery = searchQuery.trim().toLowerCase()

  const visit = (items: DirTree[]): DirTree[] => {
    return items.reduce<DirTree[]>((acc, item) => {
      const nameMatches = !normalizedQuery || item.name.toLowerCase().includes(normalizedQuery)
      const children = item.children ? visit(item.children) : undefined
      const hasVisibleChildren = Boolean(children && children.length > 0)

      if (item.isDirectory) {
        const includeDirectory =
          filter === "folder"
            ? nameMatches || hasVisibleChildren
            : filter === "all"
              ? nameMatches || hasVisibleChildren
              : hasVisibleChildren

        if (includeDirectory) {
          acc.push({
            ...item,
            children,
          })
        }
        return acc
      }

      if (matchesFilter(item, filter) && nameMatches) {
        acc.push(item)
      }

      return acc
    }, [])
  }

  return visit(tree)
}

export function collectFileBrowserStats(tree: DirTree[]): FileBrowserStats {
  return tree.reduce<FileBrowserStats>(
    (stats, item) => {
      if (item.isDirectory) {
        stats.folders += 1
      } else {
        stats.files += 1
      }

      if (item.children?.length) {
        const childStats = collectFileBrowserStats(item.children)
        stats.files += childStats.files
        stats.folders += childStats.folders
      }

      return stats
    },
    { files: 0, folders: 0 },
  )
}
