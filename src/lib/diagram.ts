export const DIAGRAM_FILE_SUFFIXES = [
  '.drawio',
  '.drawio.xml',
  '.excalidraw.json',
  '.diagram.json',
] as const

export type DiagramKind = 'drawio' | 'mindmap' | 'excalidraw'
export type DiagramOutlineLayout = 'mindmap' | 'flowchart'

interface DiagramOutlineNode {
  id: string
  label: string
  children: DiagramOutlineNode[]
}

interface PositionedDiagramNode {
  node: DiagramOutlineNode
  depth: number
  x: number
  y: number
  width: number
  height: number
}

interface PositionedDiagramEdge {
  id: string
  source: string
  target: string
}

interface DiagramLayoutResult {
  nodes: PositionedDiagramNode[]
  edges: PositionedDiagramEdge[]
}

interface ParsedOutlineItem {
  level: number
  text: string
}

interface OutlineContentOptions {
  title?: string
  layout?: DiagramOutlineLayout
}

export function isDiagramPath(path: string): boolean {
  const normalized = path.toLowerCase()
  return DIAGRAM_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function isDrawioPath(path: string): boolean {
  const normalized = path.toLowerCase()
  return normalized.endsWith('.drawio') || normalized.endsWith('.drawio.xml')
}

export function isExcalidrawPath(path: string): boolean {
  const normalized = path.toLowerCase()
  return normalized.endsWith('.excalidraw.json') || normalized.endsWith('.diagram.json')
}

export function normalizeDiagramKind(kind: unknown): DiagramKind {
  if (kind === 'mindmap' || kind === 'excalidraw' || kind === 'drawio') {
    return kind
  }

  return 'drawio'
}

export function createEmptyExcalidrawContent(): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'lingmo',
      elements: [],
      appState: {},
      files: {},
    },
    null,
    2,
  )
}

export function createEmptyDrawioContent(): string {
  return [
    '<mxfile host="Lingmo" agent="Lingmo" version="1.0">',
    '  <diagram name="Page 1" id="lingmo-default-page">',
    '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">',
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n')
}

export function createMindMapDrawioContent(): string {
  return [
    '<mxfile host="Lingmo" agent="Lingmo" version="1.0">',
    '  <diagram name="Mind Map" id="lingmo-mindmap-page">',
    '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">',
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    '        <mxCell id="root" value="Central Topic" style="ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=16;" vertex="1" parent="1">',
    '          <mxGeometry x="320" y="240" width="160" height="72" as="geometry" />',
    '        </mxCell>',
    '        <mxCell id="topic-1" value="Branch Topic" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=14;" vertex="1" parent="1">',
    '          <mxGeometry x="560" y="150" width="140" height="52" as="geometry" />',
    '        </mxCell>',
    '        <mxCell id="topic-2" value="Branch Topic" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=14;" vertex="1" parent="1">',
    '          <mxGeometry x="560" y="350" width="140" height="52" as="geometry" />',
    '        </mxCell>',
    '        <mxCell id="edge-1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=none;strokeWidth=2;strokeColor=#6c8ebf;" edge="1" parent="1" source="root" target="topic-1">',
    '          <mxGeometry relative="1" as="geometry" />',
    '        </mxCell>',
    '        <mxCell id="edge-2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=none;strokeWidth=2;strokeColor=#6c8ebf;" edge="1" parent="1" source="root" target="topic-2">',
    '          <mxGeometry relative="1" as="geometry" />',
    '        </mxCell>',
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n')
}

export function createDiagramContent(kind: DiagramKind): string {
  if (kind === 'excalidraw') {
    return createEmptyExcalidrawContent()
  }

  if (kind === 'mindmap') {
    return createMindMapDrawioContent()
  }

  return createEmptyDrawioContent()
}

function normalizeOutlineLine(line: string): ParsedOutlineItem | null {
  const normalized = line.replace(/\t/g, '  ').trimEnd()
  if (!normalized.trim()) {
    return null
  }

  const headingMatch = normalized.match(/^(#{1,6})\s+(.+)$/)
  if (headingMatch) {
    return {
      level: headingMatch[1].length - 1,
      text: cleanOutlineText(headingMatch[2]),
    }
  }

  const listMatch = normalized.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/)
  if (listMatch) {
    return {
      level: Math.floor(listMatch[1].length / 2),
      text: cleanOutlineText(listMatch[2]),
    }
  }

  return {
    level: 0,
    text: cleanOutlineText(normalized.trim()),
  }
}

function cleanOutlineText(text: string): string {
  return text
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeXmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createOutlineTree(outline: string, title?: string): DiagramOutlineNode {
  const items = outline
    .split(/\r?\n/)
    .map(normalizeOutlineLine)
    .filter((item): item is ParsedOutlineItem => !!item && !!item.text)

  const fallbackTitle = title?.trim() || items[0]?.text || 'Diagram'
  const root: DiagramOutlineNode = {
    id: 'node-0',
    label: fallbackTitle,
    children: [],
  }
  let nextId = 1

  if (items.length === 0) {
    return root
  }

  const hasExplicitTitle = !!title?.trim()
  const startIndex = hasExplicitTitle ? 0 : 1
  const rootLevel = hasExplicitTitle ? -1 : items[0].level
  const stack: DiagramOutlineNode[] = [root]

  // 如果有显式 title，检查 outline 第一行是否和 title 重复（AI 常犯的错误）
  let actualStartIndex = startIndex
  if (hasExplicitTitle && items.length > 0) {
    const firstItemText = items[0].text.toLowerCase().replace(/[（()）\s]/g, '')
    const titleText = (title || '').toLowerCase().replace(/[（()）\s]/g, '')
    // 如果第一行和 title 相似度很高（包含关系或相同），跳过第一行
    if (firstItemText === titleText || titleText.includes(firstItemText) || firstItemText.includes(titleText)) {
      actualStartIndex = 1
    }
  }

  for (const item of items.slice(actualStartIndex)) {
    const depth = Math.max(1, item.level - rootLevel)
    const parent = stack[depth - 1] || root
    const node: DiagramOutlineNode = {
      id: `node-${nextId}`,
      label: item.text,
      children: [],
    }
    nextId += 1

    parent.children.push(node)
    stack[depth] = node
    stack.length = depth + 1
  }

  return root
}

function estimateNodeSize(label: string, depth = 0): { width: number; height: number } {
  // CJK 字符约 2 倍宽度，逐字符计算更准确
  const charConfigs = [
    { latin: 9, cjk: 17 },   // 根节点
    { latin: 8, cjk: 15 },   // 一级
    { latin: 7.5, cjk: 14 }, // 二级
    { latin: 7, cjk: 13 },   // 三级+
  ]
  const charConfig = charConfigs[Math.min(depth, charConfigs.length - 1)]
  const padding = 40
  const maxWidth = depth === 0 ? 280 : depth === 1 ? 320 : depth === 2 ? 300 : 280
  const minWidth = depth === 0 ? 160 : depth === 1 ? 120 : depth === 2 ? 100 : 90

  let effectiveWidth = 0
  for (const char of label) {
    const isCJK = /[一-鿿぀-ゟ゠-ヿ가-힯　-〿＀-￯]/.test(char)
    effectiveWidth += isCJK ? charConfig.cjk : charConfig.latin
  }

  const textWidth = effectiveWidth + padding
  const width = Math.min(maxWidth, Math.max(minWidth, textWidth))

  // 如果文字超出宽度，需要换行，增加高度
  const lines = Math.ceil(textWidth / maxWidth)
  const lineHeight = depth === 0 ? 24 : 20
  const basePadding = depth === 0 ? 32 : 24
  const height = Math.max(depth === 0 ? 64 : 44, lines * lineHeight + basePadding)

  return { width, height }
}

function layoutOutlineTree(root: DiagramOutlineNode, layout: DiagramOutlineLayout): DiagramLayoutResult {
  if (layout === 'flowchart') {
    const nodes: PositionedDiagramNode[] = []
    const edges: PositionedDiagramEdge[] = []
    return layoutFlowchart(root, nodes, edges)
  }

  // 分支 ≥ 4 时使用双向平衡布局，否则右向布局
  if (root.children.length >= 4) {
    return layoutMindmapBalanced(root)
  }

  return layoutMindmapRightward(root)
}

/**
 * 标准右向思维导图布局
 * 算法：先递归计算每个子树的高度，再自顶向下分配 Y 坐标
 */
function layoutMindmapRightward(root: DiagramOutlineNode): DiagramLayoutResult {
  const nodes: PositionedDiagramNode[] = []
  const edges: PositionedDiagramEdge[] = []
  let edgeIndex = 0

  // 层级间水平间距
  const hGaps = [260, 220, 190, 170, 150]
  // 同级节点间垂直间距
  const vGaps = [80, 60, 48, 40, 36]

  function getHGap(depth: number): number {
    return hGaps[Math.min(depth, hGaps.length - 1)]
  }

  function getVGap(depth: number): number {
    return vGaps[Math.min(depth, vGaps.length - 1)]
  }

  // 第一遍：计算每个节点子树的总高度
  function computeSubtreeHeight(node: DiagramOutlineNode, depth: number): number {
    const { height } = estimateNodeSize(node.label, depth)

    if (node.children.length === 0) {
      return height
    }

    const childDepth = depth + 1
    const childGap = getVGap(childDepth)
    let totalChildrenHeight = 0

    for (let i = 0; i < node.children.length; i++) {
      totalChildrenHeight += computeSubtreeHeight(node.children[i], childDepth)
      if (i < node.children.length - 1) {
        totalChildrenHeight += childGap
      }
    }

    return Math.max(height, totalChildrenHeight)
  }

  // 第二遍：分配坐标
  function placeNode(
    node: DiagramOutlineNode,
    depth: number,
    x: number,
    yCenter: number
  ): void {
    const { width, height } = estimateNodeSize(node.label, depth)

    nodes.push({
      node,
      depth,
      x,
      y: yCenter - height / 2,
      width,
      height,
    })

    if (node.children.length === 0) return

    const childDepth = depth + 1
    const childX = x + width + getHGap(depth)
    const childGap = getVGap(childDepth)

    // 计算所有子节点的子树高度
    const childHeights = node.children.map(child => computeSubtreeHeight(child, childDepth))
    const totalChildrenHeight = childHeights.reduce((sum, h) => sum + h, 0) + (node.children.length - 1) * childGap

    // 子节点组的起始 Y（居中对齐到父节点）
    let childY = yCenter - totalChildrenHeight / 2

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      const childSubtreeHeight = childHeights[i]
      const childCenter = childY + childSubtreeHeight / 2

      // 添加连接线
      edges.push({ id: `edge-${edgeIndex++}`, source: node.id, target: child.id })

      // 递归放置子节点
      placeNode(child, childDepth, childX, childCenter)

      childY += childSubtreeHeight + childGap
    }
  }

  // 计算整棵树的高度，确定根节点的 Y 中心
  const totalHeight = computeSubtreeHeight(root, 0)
  const rootCenterY = Math.max(400, totalHeight / 2 + 80)

  placeNode(root, 0, 80, rootCenterY)

  return {
    nodes: nodes.sort((a, b) => a.depth - b.depth || a.y - b.y),
    edges,
  }
}

/**
 * 双向平衡布局：根节点居中，分支左右分布
 * 适用于分支 ≥ 4 的情况，画面更紧凑美观
 */
function layoutMindmapBalanced(root: DiagramOutlineNode): DiagramLayoutResult {
  const nodes: PositionedDiagramNode[] = []
  const edges: PositionedDiagramEdge[] = []
  let edgeIndex = 0

  const hGaps = [260, 220, 190, 170, 150]
  const vGaps = [80, 60, 48, 40, 36]

  function getHGap(depth: number): number {
    return hGaps[Math.min(depth, hGaps.length - 1)]
  }

  function getVGap(depth: number): number {
    return vGaps[Math.min(depth, vGaps.length - 1)]
  }

  function computeSubtreeHeight(node: DiagramOutlineNode, depth: number): number {
    const { height } = estimateNodeSize(node.label, depth)
    if (node.children.length === 0) return height

    const childDepth = depth + 1
    const childGap = getVGap(childDepth)
    let totalChildrenHeight = 0
    for (let i = 0; i < node.children.length; i++) {
      totalChildrenHeight += computeSubtreeHeight(node.children[i], childDepth)
      if (i < node.children.length - 1) totalChildrenHeight += childGap
    }
    return Math.max(height, totalChildrenHeight)
  }

  // 向右放置子树
  function placeRightward(
    node: DiagramOutlineNode,
    depth: number,
    x: number,
    yCenter: number
  ): void {
    const { width, height } = estimateNodeSize(node.label, depth)
    nodes.push({ node, depth, x, y: yCenter - height / 2, width, height })

    if (node.children.length === 0) return
    const childDepth = depth + 1
    const childX = x + width + getHGap(depth)
    const childGap = getVGap(childDepth)
    const childHeights = node.children.map(c => computeSubtreeHeight(c, childDepth))
    const totalHeight = childHeights.reduce((s, h) => s + h, 0) + (node.children.length - 1) * childGap

    let childY = yCenter - totalHeight / 2
    for (let i = 0; i < node.children.length; i++) {
      edges.push({ id: `edge-${edgeIndex++}`, source: node.id, target: node.children[i].id })
      placeRightward(node.children[i], childDepth, childX, childY + childHeights[i] / 2)
      childY += childHeights[i] + childGap
    }
  }

  // 向左放置子树
  function placeLeftward(
    node: DiagramOutlineNode,
    depth: number,
    xRight: number,
    yCenter: number
  ): void {
    const { width, height } = estimateNodeSize(node.label, depth)
    const x = xRight - width
    nodes.push({ node, depth, x, y: yCenter - height / 2, width, height })

    if (node.children.length === 0) return
    const childDepth = depth + 1
    const childXRight = x - getHGap(depth)
    const childGap = getVGap(childDepth)
    const childHeights = node.children.map(c => computeSubtreeHeight(c, childDepth))
    const totalHeight = childHeights.reduce((s, h) => s + h, 0) + (node.children.length - 1) * childGap

    let childY = yCenter - totalHeight / 2
    for (let i = 0; i < node.children.length; i++) {
      edges.push({ id: `edge-${edgeIndex++}`, source: node.id, target: node.children[i].id })
      placeLeftward(node.children[i], childDepth, childXRight, childY + childHeights[i] / 2)
      childY += childHeights[i] + childGap
    }
  }

  // 分割分支：前半右，后半左
  const children = root.children
  const midPoint = Math.ceil(children.length / 2)
  const rightChildren = children.slice(0, midPoint)
  const leftChildren = children.slice(midPoint)

  // 计算总高度
  const rightHeights = rightChildren.map(c => computeSubtreeHeight(c, 1))
  const leftHeights = leftChildren.map(c => computeSubtreeHeight(c, 1))
  const rightTotal = rightHeights.reduce((s, h) => s + h, 0) + Math.max(0, rightChildren.length - 1) * getVGap(1)
  const leftTotal = leftHeights.reduce((s, h) => s + h, 0) + Math.max(0, leftChildren.length - 1) * getVGap(1)
  const maxSideHeight = Math.max(rightTotal, leftTotal)

  const rootSize = estimateNodeSize(root.label, 0)
  const rootCenterY = Math.max(400, maxSideHeight / 2 + 80)
  const rootCenterX = 500 // 根节点居中

  // 放置根节点
  nodes.push({
    node: root, depth: 0,
    x: rootCenterX - rootSize.width / 2,
    y: rootCenterY - rootSize.height / 2,
    width: rootSize.width, height: rootSize.height,
  })

  // 右侧分支
  const rightStartX = rootCenterX + rootSize.width / 2 + getHGap(0)
  let rightY = rootCenterY - rightTotal / 2
  for (let i = 0; i < rightChildren.length; i++) {
    edges.push({ id: `edge-${edgeIndex++}`, source: root.id, target: rightChildren[i].id })
    placeRightward(rightChildren[i], 1, rightStartX, rightY + rightHeights[i] / 2)
    rightY += rightHeights[i] + getVGap(1)
  }

  // 左侧分支
  const leftEndX = rootCenterX - rootSize.width / 2 - getHGap(0)
  let leftY = rootCenterY - leftTotal / 2
  for (let i = 0; i < leftChildren.length; i++) {
    edges.push({ id: `edge-${edgeIndex++}`, source: root.id, target: leftChildren[i].id })
    placeLeftward(leftChildren[i], 1, leftEndX, leftY + leftHeights[i] / 2)
    leftY += leftHeights[i] + getVGap(1)
  }

  return {
    nodes: nodes.sort((a, b) => a.depth - b.depth || a.y - b.y),
    edges,
  }
}

function layoutFlowchart(
  root: DiagramOutlineNode,
  nodes: PositionedDiagramNode[],
  edges: PositionedDiagramEdge[]
): DiagramLayoutResult {
  let leafIndex = 0
  let edgeIndex = 0
  const horizontalGap = 220
  const verticalGap = 88
  const originX = 100
  const originY = 100

  function place(node: DiagramOutlineNode, depth: number): number {
    const childYs = node.children.map((child) => {
      edges.push({ id: `edge-${edgeIndex}`, source: node.id, target: child.id })
      edgeIndex += 1
      return place(child, depth + 1)
    })

    const y = childYs.length > 0
      ? childYs.reduce((sum, childY) => sum + childY, 0) / childYs.length
      : originY + leafIndex++ * verticalGap
    const { width, height } = estimateNodeSize(node.label, depth)

    nodes.push({ node, depth, x: originX + depth * horizontalGap, y, width, height })
    return y
  }

  place(root, 0)
  return {
    nodes: nodes.sort((a, b) => a.depth - b.depth || a.y - b.y),
    edges,
  }
}

function getDrawioNodeStyle(depth: number, layout: DiagramOutlineLayout, branchIndex = 0): string {
  if (depth === 0) {
    // 根节点：大椭圆，深蓝色填充，白色文字，阴影
    return 'ellipse;whiteSpace=wrap;html=1;fillColor=#1A73E8;strokeColor=#1557B0;fontColor=#FFFFFF;fontStyle=1;fontSize=16;shadow=1;arcSize=50;'
  }

  if (depth === 1) {
    // 一级分支：圆角矩形，每个分支不同颜色
    const branchColors = [
      { fill: '#E8F0FE', stroke: '#1A73E8', font: '#1A73E8' },  // 蓝
      { fill: '#E6F4EA', stroke: '#1E8E3E', font: '#1E8E3E' },  // 绿
      { fill: '#FEF7E0', stroke: '#E37400', font: '#E37400' },  // 橙
      { fill: '#FCE8E6', stroke: '#D93025', font: '#D93025' },  // 红
      { fill: '#F3E8FD', stroke: '#7627BB', font: '#7627BB' },  // 紫
      { fill: '#E8F5E9', stroke: '#2E7D32', font: '#2E7D32' },  // 深绿
      { fill: '#FFF3E0', stroke: '#E65100', font: '#E65100' },  // 深橙
    ]
    const color = branchColors[branchIndex % branchColors.length]
    return `rounded=1;whiteSpace=wrap;html=1;arcSize=20;fillColor=${color.fill};strokeColor=${color.stroke};fontColor=${color.font};fontStyle=1;fontSize=14;strokeWidth=2;`
  }

  if (depth === 2) {
    // 二级分支：白底，浅灰边框
    return 'rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#FFFFFF;strokeColor=#DADCE0;fontColor=#3C4043;fontSize=13;strokeWidth=1.5;'
  }

  // 三级及更深：更小更淡
  return 'rounded=1;whiteSpace=wrap;html=1;arcSize=8;fillColor=#F8F9FA;strokeColor=#E8EAED;fontColor=#5F6368;fontSize=12;strokeWidth=1;'
}

function createDrawioContentFromTree(root: DiagramOutlineNode, layout: DiagramOutlineLayout): string {
  const positioned = layoutOutlineTree(root, layout)
  const nodeDepthMap = new Map(positioned.nodes.map(n => [n.node.id, n.depth]))

  // 构建一级分支索引映射（用于颜色分配）
  const level1Nodes = positioned.nodes.filter(n => n.depth === 1)
  const level1IndexMap = new Map(level1Nodes.map((n, i) => [n.node.id, i]))

  // 根据连接的层级和方向使用不同的线条样式
  function getEdgeStyle(sourceId: string, targetId: string): string {
    const sourceDepth = nodeDepthMap.get(sourceId) || 0

    if (layout === 'flowchart') {
      return 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=2;strokeColor=#546E7A;'
    }

    // 判断连线方向：检查 source 和 target 的 x 坐标
    const sourceNode = positioned.nodes.find(n => n.node.id === sourceId)
    const targetNode = positioned.nodes.find(n => n.node.id === targetId)
    const isLeftward = sourceNode && targetNode && targetNode.x < sourceNode.x

    // 思维导图：平滑曲线，层级越深越细越浅
    const baseStyles = [
      // 根→一级：粗线，主题色
      { width: 2.5, color: '#1A73E8' },
      // 一级→二级：中等线
      { width: 2, color: '#5F6368' },
      // 二级→三级：细线
      { width: 1.5, color: '#9AA0A6' },
      // 更深层级
      { width: 1, color: '#DADCE0' },
    ]
    const styleConfig = baseStyles[Math.min(sourceDepth, baseStyles.length - 1)]

    // 向左的连线：exit 从左侧，entry 从右侧
    if (isLeftward) {
      return `edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=none;strokeWidth=${styleConfig.width};strokeColor=${styleConfig.color};exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;`
    }

    return `edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=none;strokeWidth=${styleConfig.width};strokeColor=${styleConfig.color};exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;`
  }

  const cells = [
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    ...positioned.nodes.map(({ node, depth, x, y, width, height }) => {
      const branchIndex = depth === 1 ? (level1IndexMap.get(node.id) || 0) : 0
      const style = getDrawioNodeStyle(depth, layout, branchIndex)
      // 一级分支支持折叠（draw.io 的 collapsible 特性）
      const collapsible = depth === 1 && node.children.length > 0 ? ' collapsible="1"' : ''
      return [
        `        <mxCell id="${node.id}" value="${escapeXmlValue(node.label)}" style="${style}" vertex="1"${collapsible} parent="1">`,
        `          <mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${width}" height="${height}" as="geometry" />`,
        '        </mxCell>',
      ].join('\n')
    }),
    ...positioned.edges.map((edge) => [
      `        <mxCell id="${edge.id}" style="${getEdgeStyle(edge.source, edge.target)}" edge="1" parent="1" source="${edge.source}" target="${edge.target}">`,
      '          <mxGeometry relative="1" as="geometry" />',
      '        </mxCell>',
    ].join('\n')),
  ]

  // 计算画布大小
  const maxX = Math.max(...positioned.nodes.map(n => n.x + n.width)) + 100
  const maxY = Math.max(...positioned.nodes.map(n => n.y + n.height)) + 100
  const minY = Math.min(...positioned.nodes.map(n => n.y)) - 100
  const canvasWidth = Math.max(1400, maxX + 200)
  const canvasHeight = Math.max(900, maxY - minY + 200)

  return [
    '<mxfile host="Lingmo" agent="Lingmo" version="1.0">',
    `  <diagram name="${escapeXmlValue(root.label || 'Mind Map')}" id="lingmo-mindmap-page">`,
    `    <mxGraphModel dx="${Math.round(canvasWidth)}" dy="${Math.round(canvasHeight)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${Math.round(canvasWidth)}" pageHeight="${Math.round(canvasHeight)}" math="0" shadow="0">`,
    '      <root>',
    ...cells,
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n')
}

function createExcalidrawElementBase(id: string, x: number, y: number, width: number, height: number, seed: number) {
  return {
    id,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed,
    version: 1,
    versionNonce: seed + 1000,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  }
}

function createExcalidrawContentFromTree(root: DiagramOutlineNode, layout: DiagramOutlineLayout): string {
  const positioned = layoutOutlineTree(root, layout)
  const nodeById = new Map(positioned.nodes.map((node) => [node.node.id, node]))
  const elements: any[] = []
  let seed = 100

  for (const edge of positioned.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) {
      continue
    }

    const startX = source.x + source.width
    const startY = source.y + source.height / 2
    const endX = target.x
    const endY = target.y + target.height / 2
    elements.push({
      ...createExcalidrawElementBase(edge.id, startX, startY, endX - startX, endY - startY, seed++),
      type: 'arrow',
      roundness: { type: 2 },
      points: [[0, 0], [endX - startX, endY - startY]],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
    })
  }

  for (const positionedNode of positioned.nodes) {
    const { node, depth, x, y, width, height } = positionedNode
    const backgroundColor = depth === 0 ? '#dbeafe' : '#f8fafc'
    elements.push({
      ...createExcalidrawElementBase(`${node.id}-box`, x, y, width, height, seed++),
      type: depth === 0 && layout === 'mindmap' ? 'ellipse' : 'rectangle',
      backgroundColor,
    })
    elements.push({
      ...createExcalidrawElementBase(`${node.id}-text`, x + 12, y + 12, width - 24, height - 24, seed++),
      type: 'text',
      roundness: null,
      strokeWidth: 1,
      backgroundColor: 'transparent',
      text: node.label,
      rawText: node.label,
      fontSize: depth === 0 ? 18 : 15,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      baseline: 18,
      containerId: null,
      originalText: node.label,
      lineHeight: 1.25,
    })
  }

  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'lingmo',
      elements,
      appState: {
        viewBackgroundColor: '#ffffff',
      },
      files: {},
    },
    null,
    2,
  )
}

export function createDiagramContentFromOutline(
  kind: DiagramKind,
  outline: string,
  options: OutlineContentOptions = {},
): string {
  const normalizedKind = normalizeDiagramKind(kind)
  const layout = options.layout === 'flowchart' ? 'flowchart' : 'mindmap'
  const tree = createOutlineTree(outline, options.title)

  if (normalizedKind === 'excalidraw') {
    return createExcalidrawContentFromTree(tree, layout)
  }

  return createDrawioContentFromTree(tree, normalizedKind === 'mindmap' ? 'mindmap' : layout)
}

export function createEmptyDiagramContent(path = ''): string {
  return isDrawioPath(path) ? createEmptyDrawioContent() : createEmptyExcalidrawContent()
}

export function ensureDiagramFileName(name: string, kind: DiagramKind = 'drawio'): string {
  const normalized = name.trim().replace(/\s+/g, '_')
  if (!normalized) {
    return getDefaultDiagramBaseName(kind)
  }

  if (isDiagramPath(normalized)) {
    return normalized
  }

  return kind === 'excalidraw' ? `${normalized}.excalidraw.json` : `${normalized}.drawio`
}

export function getDefaultDiagramBaseName(kind: DiagramKind): string {
  if (kind === 'mindmap') {
    return 'Untitled_Mind_Map.drawio'
  }

  if (kind === 'excalidraw') {
    return 'Untitled_Whiteboard.excalidraw.json'
  }

  return 'Untitled_Diagram.drawio'
}
