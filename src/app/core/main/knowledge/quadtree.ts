/**
 * Barnes-Hut 四叉树优化
 * 将 O(n²) 的排斥力计算降低到 O(n log n)
 */

export interface QuadTreeNode {
  x: number
  y: number
  mass: number // 节点数量（质量）
  cx: number  // 质心 X
  cy: number  // 质心 Y
  children: [QuadTreeNode | null, QuadTreeNode | null, QuadTreeNode | null, QuadTreeNode | null] | null
  body: { x: number; y: number; index: number } | null
}

export interface QuadTreeBounds {
  x: number  // 左上角 X
  y: number  // 左上角 Y
  width: number
  height: number
}

/**
 * 创建空的四叉树节点
 */
function createNode(): QuadTreeNode {
  return {
    x: 0,
    y: 0,
    mass: 0,
    cx: 0,
    cy: 0,
    children: null,
    body: null,
  }
}

/**
 * 确定点在哪个象限 (0=NW, 1=NE, 2=SW, 3=SE)
 */
function getQuadrant(px: number, py: number, cx: number, cy: number): number {
  if (px < cx) {
    return py < cy ? 0 : 2
  }
  return py < cy ? 1 : 3
}

/**
 * 向四叉树中插入一个点
 */
function insert(
  node: QuadTreeNode,
  body: { x: number; y: number; index: number },
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number
): void {
  // 防止无限递归（极端情况下两个点完全重合）
  if (depth > 40) return

  const halfW = width / 2
  const halfH = height / 2
  const cx = x + halfW
  const cy = y + halfH

  if (node.mass === 0 && node.body === null) {
    // 空节点，直接放入
    node.body = body
    node.mass = 1
    node.cx = body.x
    node.cy = body.y
    return
  }

  if (node.body !== null) {
    // 叶子节点，需要分裂
    const existingBody = node.body
    node.body = null
    node.children = [null, null, null, null]

    // 重新插入已有的点
    const eq = getQuadrant(existingBody.x, existingBody.y, cx, cy)
    if (!node.children[eq]) node.children[eq] = createNode()
    const [childX, childY] = getChildBounds(eq, x, y, halfW, halfH)
    insert(node.children[eq]!, existingBody, childX, childY, halfW, halfH, depth + 1)

    // 插入新点
    const nq = getQuadrant(body.x, body.y, cx, cy)
    if (!node.children[nq]) node.children[nq] = createNode()
    const [newChildX, newChildY] = getChildBounds(nq, x, y, halfW, halfH)
    insert(node.children[nq]!, body, newChildX, newChildY, halfW, halfH, depth + 1)
  } else if (node.children) {
    // 内部节点，递归插入
    const q = getQuadrant(body.x, body.y, cx, cy)
    if (!node.children[q]) node.children[q] = createNode()
    const [childX, childY] = getChildBounds(q, x, y, halfW, halfH)
    insert(node.children[q]!, body, childX, childY, halfW, halfH, depth + 1)
  }

  // 更新质心
  const totalMass = node.mass + 1
  node.cx = (node.cx * node.mass + body.x) / totalMass
  node.cy = (node.cy * node.mass + body.y) / totalMass
  node.mass = totalMass
}

function getChildBounds(quadrant: number, x: number, y: number, halfW: number, halfH: number): [number, number] {
  switch (quadrant) {
    case 0: return [x, y]           // NW
    case 1: return [x + halfW, y]   // NE
    case 2: return [x, y + halfH]   // SW
    case 3: return [x + halfW, y + halfH] // SE
    default: return [x, y]
  }
}

/**
 * 构建四叉树
 */
export function buildQuadTree(
  positions: Array<{ x: number; y: number }>,
  bounds: QuadTreeBounds
): QuadTreeNode {
  const root = createNode()

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]
    insert(root, { x: pos.x, y: pos.y, index: i }, bounds.x, bounds.y, bounds.width, bounds.height, 0)
  }

  return root
}

/**
 * Barnes-Hut 排斥力计算
 * theta: 精度参数（0.5-1.0，越小越精确但越慢）
 */
export function computeBarnesHutForce(
  node: QuadTreeNode,
  px: number,
  py: number,
  width: number,
  theta: number,
  repulsionStrength: number,
  minDist: number
): { fx: number; fy: number } {
  let fx = 0
  let fy = 0

  if (node.mass === 0) return { fx, fy }

  const dx = px - node.cx
  const dy = py - node.cy
  const distSq = dx * dx + dy * dy
  const dist = Math.sqrt(distSq)

  // 如果是叶子节点或者足够远（width/dist < theta），当作一个整体
  if (node.body !== null || (width / dist < theta && dist > 0)) {
    if (dist < minDist) {
      // 太近了，使用最小距离防止力爆炸
      const safeDist = minDist
      const force = repulsionStrength * node.mass / (safeDist * safeDist)
      // 随机方向避免完全重合时力为零
      const angle = Math.random() * Math.PI * 2
      fx = Math.cos(angle) * force
      fy = Math.sin(angle) * force
    } else {
      const force = repulsionStrength * node.mass / distSq
      fx = (dx / dist) * force
      fy = (dy / dist) * force
    }
    return { fx, fy }
  }

  // 递归计算子节点的力
  if (node.children) {
    const childWidth = width / 2
    for (const child of node.children) {
      if (child && child.mass > 0) {
        const childForce = computeBarnesHutForce(child, px, py, childWidth, theta, repulsionStrength, minDist)
        fx += childForce.fx
        fy += childForce.fy
      }
    }
  }

  return { fx, fy }
}

/**
 * 计算所有节点的边界
 */
export function computeBounds(positions: Array<{ x: number; y: number }>): QuadTreeBounds {
  if (positions.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const pos of positions) {
    if (pos.x < minX) minX = pos.x
    if (pos.y < minY) minY = pos.y
    if (pos.x > maxX) maxX = pos.x
    if (pos.y > maxY) maxY = pos.y
  }

  // 添加边距
  const padding = 50
  const width = Math.max(maxX - minX + padding * 2, 100)
  const height = Math.max(maxY - minY + padding * 2, 100)

  // 使用正方形边界（四叉树要求）
  const size = Math.max(width, height)

  return {
    x: minX - padding,
    y: minY - padding,
    width: size,
    height: size,
  }
}
