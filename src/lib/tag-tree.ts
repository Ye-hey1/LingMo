import type { Tag } from '@/db/tags'

// 层级标签分隔符
export const TAG_SEPARATOR = '/'

export interface TagTreeNode {
  id: number
  name: string
  displayName: string
  fullPath: string
  children: TagTreeNode[]
  isLocked?: boolean
  isPin?: boolean
  sortOrder?: number
  total?: number
  parentId?: number | null
  isGroup?: boolean // 中间层级虚拟节点
}

/**
 * 将扁平标签列表构建为树形结构
 * 支持两种模式：
 * 1. 通过 parentId 字段构建层级
 * 2. 通过名称中的 / 分隔符构建层级（兼容旧数据）
 */
export function buildTagTree(tags: Tag[]): TagTreeNode[] {
  const rootNodes: TagTreeNode[] = []
  const nodeMap = new Map<string, TagTreeNode>()

  // 首先处理有 parentId 的标签
  const tagById = new Map(tags.map(t => [t.id, t]))

  // 第一遍：创建所有节点
  for (const tag of tags) {
    const parts = tag.name.split(TAG_SEPARATOR)
    const displayName = parts[parts.length - 1]

    const node: TagTreeNode = {
      id: tag.id,
      name: tag.name,
      displayName,
      fullPath: tag.name,
      children: [],
      isLocked: tag.isLocked,
      isPin: tag.isPin,
      sortOrder: tag.sortOrder,
      total: tag.total,
      parentId: tag.parentId,
    }
    nodeMap.set(tag.name, node)
  }

  // 第二遍：构建树
  for (const tag of tags) {
    const parts = tag.name.split(TAG_SEPARATOR)

    if (parts.length === 1) {
      // 顶层标签
      const node = nodeMap.get(tag.name)!
      // 如果有 parentId，先尝试通过 parentId 嵌套
      if (tag.parentId && tagById.has(tag.parentId)) {
        const parentTag = tagById.get(tag.parentId)!
        const parentNode = nodeMap.get(parentTag.name)
        if (parentNode) {
          parentNode.children.push(node)
          continue
        }
      }
      rootNodes.push(node)
    } else {
      // 包含分隔符的标签，按层级构建虚拟节点
      let currentPath = ''
      let currentChildren = rootNodes

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        currentPath = currentPath ? `${currentPath}${TAG_SEPARATOR}${part}` : part

        if (i === parts.length - 1) {
          // 最后一个部分是实际标签
          const node = nodeMap.get(tag.name)!
          currentChildren.push(node)
        } else {
          // 中间层级，创建虚拟分组节点（如果不存在）
          let groupNode = currentChildren.find(n => n.fullPath === currentPath && n.isGroup)
          if (!groupNode) {
            groupNode = {
              id: -1, // 虚拟节点
              name: part,
              displayName: part,
              fullPath: currentPath,
              children: [],
              isGroup: true,
            }
            currentChildren.push(groupNode)
          }
          currentChildren = groupNode.children
        }
      }
    }
  }

  // 排序：置顶标签在前，虚拟分组在前
  const sortNodes = (nodes: TagTreeNode[]): TagTreeNode[] => {
    return nodes.sort((a, b) => {
      // 虚拟分组排在前面
      if (a.isGroup && !b.isGroup) return -1
      if (!a.isGroup && b.isGroup) return 1
      // 置顶排前面
      if (a.isPin && !b.isPin) return -1
      if (!a.isPin && b.isPin) return 1
      // 按 sortOrder 排序
      return (a.sortOrder || 0) - (b.sortOrder || 0)
    }).map(node => {
      if (node.children.length > 0) {
        node.children = sortNodes(node.children)
      }
      return node
    })
  }

  return sortNodes(rootNodes)
}

/**
 * 展平树节点用于渲染（带缩进层级信息）
 */
export function flattenTagTree(
  nodes: TagTreeNode[],
  expandedPaths: Set<string>,
  depth = 0
): Array<{ node: TagTreeNode; depth: number }> {
  const result: Array<{ node: TagTreeNode; depth: number }> = []

  for (const node of nodes) {
    result.push({ node, depth })
    if (node.children.length > 0 && expandedPaths.has(node.fullPath)) {
      result.push(...flattenTagTree(node.children, expandedPaths, depth + 1))
    }
  }

  return result
}
