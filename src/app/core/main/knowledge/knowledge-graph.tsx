'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GitBranch,
  FileText,
  Link,
  LocateFixed,
  Palette,
  Pause,
  Play,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import useArticleStore from '@/stores/article'
import { useNoteIndexStore, type Backlink } from '@/stores/note-index'
import { useKnowledgeGraphTagsStore, type GraphTagGroup } from '@/stores/knowledge-graph-tags'
import { DetailPanel } from './detail-panel'
import {
  appendUniqueGraphTagQuery,
  getGraphTagNameFromPath,
  getGraphTagTokens,
  parseGraphTagDrop,
} from '@/lib/knowledge-graph-tags'
import type { DirTree } from '@/stores/article'

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const len = Math.min(vecA.length, vecB.length)
  if (len === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Build semantic edges from vector embeddings (averaged per file)
function buildSemanticEdges(
  fileIds: string[],
  embeddingsByFile: Map<string, number[]>,
  threshold: number,
): GraphEdge[] {
  const edges: GraphEdge[] = []
  const files = fileIds.filter(f => embeddingsByFile.has(f))

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const embA = embeddingsByFile.get(files[i])!
      const embB = embeddingsByFile.get(files[j])!
      const sim = cosineSimilarity(embA, embB)
      if (sim >= threshold) {
        edges.push({
          source: files[i],
          target: files[j],
          type: 'semantic',
          weight: sim,
        })
      }
    }
  }
  return edges
}

type NodeKind = 'current' | 'hub' | 'linked' | 'note'
type SettingsPanel = 'filter' | 'color' | 'appearance' | 'force'

interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  connections: number
  kind: NodeKind
  radius: number
  createdAt?: string
  modifiedAt?: string
}

interface GraphEdge {
  source: string
  target: string
  type: 'wikilink' | 'keyword' | 'semantic' | 'llm'
  weight: number
  relationType?: string // extends, references, contradicts, etc.
  evidence?: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeIndex: Map<string, GraphNode>
}

interface GraphPalette {
  accent: string
  current: string
  hub: string
  linked: string
  note: string
  tag: string
}

interface GraphSettings {
  showIsolated: boolean
  focusLinkedOnly: boolean
  minConnections: number
  activeTagGroupId: string
  colors: GraphPalette
  showLabels: boolean
  showTags: boolean
  labelSize: number
  nodeScale: number
  edgeOpacity: number
  showArrows: boolean
  repulsion: number
  attraction: number
  centerGravity: number
  springLength: number
  showSemanticEdges: boolean
  semanticThreshold: number
  showKeywordEdges: boolean
  showLLMEdges: boolean
}

interface KnowledgeGraphProps {
  focusPath?: string
}

const REPLAY_TICK_MS = 56
const MIN_ZOOM = 0.18
const MAX_ZOOM = 4.5
const ALL_TAG_GROUP_ID = 'all'
const LAYOUT_CACHE_KEY = 'knowledge-graph-layout-cache-v5'

// Collision is a HARD constraint — never adjustable.
// This is the minimum center-to-center gap between any two nodes.
// It accounts for: node radius + label text width + breathing room.
// The collision resolver enforces this regardless of force settings.
const BASE_COLLISION_RADIUS = 18 // minimum distance for a zero-connection node
const COLLISION_PADDING = 72 // extra gap for label + spacing

// Approximate character width in graph units at labelSize 12
const CHAR_WIDTH_APPROX = 8

// Simulation physics constants
const SIMULATION_VELOCITY_DECAY = 0.38 // per-frame velocity retention
const MAX_VELOCITY = 8 // clamp node speed to prevent runaway
const NODE_COLLISION_GAP = 18 // circle gap beyond node radii
const LABEL_COLLISION_PADDING = 18 // label-to-label breathing room
const SIMULATION_ALPHA_DECAY = 0.02 // simulation settles smoothly
const MIN_REPULSION_DIST = 32 // prevent force explosion when nodes overlap

function toPhysicsRepulsion(value: number) {
  return value * 8
}

function toPhysicsAttraction(value: number) {
  return value * 0.006
}

function toPhysicsCenterGravity(value: number) {
  return value * 0.018
}

const DEFAULT_COLORS: GraphPalette = {
  accent: '#d97706',
  current: '#d97706',
  hub: '#1f2937',
  linked: '#64748b',
  note: '#a8a29e',
  tag: '#92400e',
}

const DEFAULT_SETTINGS: GraphSettings = {
  showIsolated: true,
  focusLinkedOnly: false,
  minConnections: 0,
  activeTagGroupId: ALL_TAG_GROUP_ID,
  colors: DEFAULT_COLORS,
  showLabels: true,
  showTags: true,
  labelSize: 12,
  nodeScale: 1,
  edgeOpacity: 0.2,
  showArrows: false,
  repulsion: 10,
  attraction: 0.8,
  centerGravity: 0.6,
  springLength: 65,
  showSemanticEdges: false,
  semanticThreshold: 0.78,
  showKeywordEdges: false,
  showLLMEdges: false,
}

const NODE_KIND_LABELS: Record<NodeKind, string> = {
  current: '当前',
  hub: '核心',
  linked: '关联',
  note: '笔记',
}

const SETTINGS_PANELS: Array<{ key: SettingsPanel; label: string; icon: typeof SlidersHorizontal }> = [
  { key: 'filter', label: '筛选', icon: SlidersHorizontal },
  { key: 'color', label: '颜色', icon: Palette },
  { key: 'appearance', label: '外观', icon: GitBranch },
  { key: 'force', label: '力度', icon: SlidersHorizontal },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function hexToRgb(hex: string) {
  const cleanHex = hex.replace('#', '')
  const value = Number.parseInt(cleanHex.length === 3 ? cleanHex.split('').map(char => char + char).join('') : cleanHex, 16)
  if (Number.isNaN(value)) return { r: 217, g: 119, b: 6 }
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function hexToRgba(hex: string, alpha: number) {
  const rgb = hexToRgb(hex)
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function hashString(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index++) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function seededPosition(id: string, index: number, total: number) {
  // Golden-angle spiral for uniform spread
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
  const hash = hashString(id)
  const angle = index * GOLDEN_ANGLE + ((hash % 100) / 100) * 0.3
  const maxRadius = Math.max(90, 45 + total * 9)
  const radius = Math.sqrt((index + 1) / Math.max(total, 1)) * maxRadius
  return {
    x: 400 + Math.cos(angle) * radius + ((hash % 41) - 20),
    y: 300 + Math.sin(angle) * radius + (((hash >> 3) % 41) - 20),
  }
}

function collectMarkdownFiles(items: DirTree[], prefix = '') {
  const files: Array<{ path: string; name: string; createdAt?: string; modifiedAt?: string }> = []
  // 支持的文件类型：Markdown + 图表文件
  const supportedExtensions = /\.(md|markdown|txt|drawio|drawio\.xml|excalidraw\.json|diagram\.json)$/i

  for (const item of items) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isFile && supportedExtensions.test(item.name)) {
      files.push({ path: itemPath, name: item.name, createdAt: item.createdAt, modifiedAt: item.modifiedAt })
    }
    if (item.children) {
      files.push(...collectMarkdownFiles(item.children, itemPath))
    }
  }
  return files
}

function buildGraphData(fileTree: DirTree[], backlinks: Map<string, Backlink[]>, focusPath?: string, semanticEdges: GraphEdge[] = []): GraphData {
  const files = collectMarkdownFiles(fileTree)
  const nodeMap = new Map<string, GraphNode>()
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []

  files.forEach((file, index) => {
    const position = seededPosition(file.path, index, files.length)
    nodeMap.set(file.path, {
      id: file.path,
      label: file.name.replace(/\.md$/, ''),
      x: position.x,
      y: position.y,
      vx: 0,
      vy: 0,
      connections: 0,
      kind: file.path === focusPath ? 'current' : 'note',
      radius: 5.2,
      createdAt: file.createdAt,
      modifiedAt: file.modifiedAt,
    })
  })

  // Count reference frequency per (source, target) pair for edge weight
  const refCountMap = new Map<string, number>()
  for (const [targetPath, refs] of backlinks) {
    for (const ref of refs) {
      const sourceNode = nodeMap.get(ref.sourcePath)
      const targetNode = nodeMap.get(targetPath)
      if (!sourceNode || !targetNode) continue

      const edgeKey = `wl:${ref.sourcePath}->${targetPath}`
      refCountMap.set(edgeKey, (refCountMap.get(edgeKey) || 0) + 1)
    }
  }

  // Check bidirectional links for bonus weight
  const hasReverseEdge = (src: string, tgt: string) => refCountMap.has(`wl:${tgt}->${src}`)

  for (const [targetPath, refs] of backlinks) {
    for (const ref of refs) {
      const sourceNode = nodeMap.get(ref.sourcePath)
      const targetNode = nodeMap.get(targetPath)
      if (!sourceNode || !targetNode) continue

      const edgeKey = `wl:${ref.sourcePath}->${targetPath}`
      if (edgeSet.has(edgeKey)) continue

      edgeSet.add(edgeKey)
      const count = refCountMap.get(edgeKey) || 1
      let weight = Math.min(count, 5) // cap at 5
      // Bidirectional bonus
      if (hasReverseEdge(ref.sourcePath, targetPath)) weight += 2
      // Heading proximity bonus (context starts with #)
      if (ref.context?.startsWith('#')) weight += 0.5

      edges.push({ source: ref.sourcePath, target: targetPath, type: 'wikilink', weight })
      sourceNode.connections += 1
      targetNode.connections += 1
    }
  }

  // Add semantic edges (only between existing nodes)
  for (const edge of semanticEdges) {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (!sourceNode || !targetNode) continue

    const edgeKey = `sem:${edge.source}->${edge.target}`
    if (edgeSet.has(edgeKey)) continue

    edgeSet.add(edgeKey)
    edges.push(edge)
    sourceNode.connections += 1
    targetNode.connections += 1
  }

  // 自动关联：图表文件与同名笔记建立链接
  // 例如 "AI产品经理发展史-思维导图.drawio" 自动关联到 "AI产品经理发展史.md"
  const diagramExtensions = /\.(drawio|drawio\.xml|excalidraw\.json|diagram\.json)$/i
  const diagramNodes = Array.from(nodeMap.values()).filter(n => diagramExtensions.test(n.id))

  for (const diagramNode of diagramNodes) {
    // 提取图表文件的基础名（去掉扩展名和常见后缀）
    const baseName = diagramNode.id
      .split('/').pop()!
      .replace(diagramExtensions, '')
      .replace(/[-_](思维导图|mindmap|diagram|流程图|flowchart|架构图)$/i, '')
      .toLowerCase()

    // 查找匹配的笔记文件
    for (const [nodePath, node] of nodeMap) {
      if (nodePath === diagramNode.id) continue
      if (!nodePath.endsWith('.md')) continue

      const noteBaseName = nodePath.split('/').pop()!.replace(/\.md$/, '').toLowerCase()
      // 笔记名包含图表基础名，或图表基础名包含笔记名
      if (baseName.includes(noteBaseName) || noteBaseName.includes(baseName)) {
        const edgeKey = `auto:${nodePath}->${diagramNode.id}`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push({ source: nodePath, target: diagramNode.id, type: 'wikilink', weight: 3 })
          node.connections += 1
          diagramNode.connections += 1
        }
      }
    }
  }

  for (const node of nodeMap.values()) {
    if (node.kind === 'current') continue
    if (node.connections >= 4) {
      node.kind = 'hub'
    } else if (node.connections > 0) {
      node.kind = 'linked'
    }
  }

  // Update node radius based on connections (hub nodes are larger)
  for (const node of nodeMap.values()) {
    node.radius = Math.max(3, Math.min(18, 4 + node.connections * 1.5))
    if (node.kind === 'current') node.radius = 10
  }

  const sortedNodes = Array.from(nodeMap.values()).sort((a, b) => b.connections - a.connections || a.label.localeCompare(b.label))
  return {
    nodes: sortedNodes,
    edges,
    nodeIndex: nodeMap,
  }
}

function cloneGraphData(data: GraphData): GraphData {
  const nodes = data.nodes.map(node => ({ ...node, vx: 0, vy: 0, radius: node.radius }))
  const nodeIndex = new Map<string, GraphNode>()
  for (const node of nodes) nodeIndex.set(node.id, node)
  return {
    nodes,
    edges: data.edges.map(edge => ({ ...edge })),
    nodeIndex,
  }
}

function getFocusedNeighborhood(data: GraphData, focusPath?: string) {
  if (!focusPath) return null
  if (!data.nodes.some(node => node.id === focusPath)) return null

  const ids = new Set<string>([focusPath])
  for (const edge of data.edges) {
    if (edge.source === focusPath) ids.add(edge.target)
    if (edge.target === focusPath) ids.add(edge.source)
  }
  return ids
}

function getTagGroupTokens(group: GraphTagGroup) {
  return getGraphTagTokens(group)
}

function saveLayoutCache(positions: Map<string, { x: number; y: number }>) {
  try {
    const data: Record<string, [number, number]> = {}
    for (const [id, pos] of positions) {
      data[id] = [Math.round(pos.x * 10) / 10, Math.round(pos.y * 10) / 10]
    }
    localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(data))
  } catch {
    // localStorage quota or SSR — silently ignore
  }
}

function loadLayoutCache(): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  try {
    const raw = localStorage.getItem(LAYOUT_CACHE_KEY)
    if (!raw) return result
    const data = JSON.parse(raw) as Record<string, [number, number]>
    for (const [id, [x, y]] of Object.entries(data)) {
      result.set(id, { x, y })
    }
  } catch {
    // corrupted cache — silently ignore
  }
  return result
}

function applyLayoutCache(data: GraphData, cache: Map<string, { x: number; y: number }>) {
  for (const node of data.nodes) {
    const cached = cache.get(node.id)
    if (cached) {
      node.x = cached.x
      node.y = cached.y
    }
  }
}

function nodeMatchesTagGroup(node: GraphNode, group?: GraphTagGroup) {
  if (!group) return true
  const tokens = getTagGroupTokens(group)
  if (tokens.length === 0) return true

  const haystack = `${node.id} ${node.label}`.toLowerCase()
  return tokens.some(token => haystack.includes(token))
}

function applyGraphFilters(data: GraphData, settings: GraphSettings, tagGroups: GraphTagGroup[], focusPath?: string): GraphData {
  const focusedIds = settings.focusLinkedOnly ? getFocusedNeighborhood(data, focusPath) : null
  const activeTagGroup = tagGroups.find(group => group.id === settings.activeTagGroupId)
  const nodeIds = new Set<string>()
  const nodes = data.nodes.filter(node => {
    if (focusedIds && !focusedIds.has(node.id)) return false
    if (activeTagGroup && !nodeMatchesTagGroup(node, activeTagGroup)) return false
    if (!settings.showIsolated && node.connections === 0 && node.kind !== 'current') return false
    if (node.connections < settings.minConnections && node.kind !== 'current') return false
    nodeIds.add(node.id)
    return true
  })

  const filteredEdges = data.edges.filter(edge => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false
    // 按类型过滤边
    if (edge.type === 'semantic' && !settings.showSemanticEdges) return false
    if (edge.type === 'keyword' && !settings.showKeywordEdges) return false
    if (edge.type === 'llm' && !settings.showLLMEdges) return false
    return true
  })
  const nodeIndex = new Map<string, GraphNode>()
  for (const node of nodes) nodeIndex.set(node.id, node)
  return {
    nodes,
    edges: filteredEdges,
    nodeIndex,
  }
}

function getLabelBounds(node: GraphNode, settings: GraphSettings) {
  const label = node.label.length > 20 ? `${node.label.slice(0, 19)}...` : node.label
  const width = Math.max(32, label.length * CHAR_WIDTH_APPROX * (settings.labelSize / 12))
  const height = settings.labelSize + 8
  const radius = node.radius * settings.nodeScale
  const centerY = node.y + radius + 12
  return {
    left: node.x - width / 2 - LABEL_COLLISION_PADDING,
    right: node.x + width / 2 + LABEL_COLLISION_PADDING,
    top: centerY - height / 2 - LABEL_COLLISION_PADDING / 2,
    bottom: centerY + height / 2 + LABEL_COLLISION_PADDING / 2,
  }
}

function boundsOverlap(a: ReturnType<typeof getLabelBounds>, b: ReturnType<typeof getLabelBounds>) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function simulateStep(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeIndex: Map<string, GraphNode>,
  width: number,
  height: number,
  settings: GraphSettings,
  alpha: number,
) {
  const centerX = width / 2
  const centerY = height / 2
  // Alpha scales all forces → simulation gradually settles
  const effectiveAlpha = Math.max(alpha, 0)
  const physicsRepulsion = toPhysicsRepulsion(settings.repulsion)
  const physicsAttraction = toPhysicsAttraction(settings.attraction)
  const physicsCenterGravity = toPhysicsCenterGravity(settings.centerGravity)

  // ── Phase 1: Accumulate forces → velocities ──

  // 1a. Repulsion using Barnes-Hut approximation (O(n log n) instead of O(n²))
  if (nodes.length > 60) {
    // 使用四叉树优化（节点多时）
    const { buildQuadTree, computeBarnesHutForce, computeBounds } = require('./quadtree') as typeof import('./quadtree')
    const positions = nodes.map(n => ({ x: n.x, y: n.y }))
    const bounds = computeBounds(positions)
    const tree = buildQuadTree(positions, bounds)
    const theta = 0.7 // 精度参数（0.5=精确, 1.0=快速）

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const { fx, fy } = computeBarnesHutForce(
        tree, node.x, node.y, bounds.width, theta,
        physicsRepulsion * effectiveAlpha, MIN_REPULSION_DIST
      )
      node.vx += fx
      node.vy += fy
    }
  } else {
    // 节点少时直接 O(n²)（开销更小因为没有树构建成本）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        if (dx === 0 && dy === 0) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2 }
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_REPULSION_DIST)

        const force = (physicsRepulsion / dist) * effectiveAlpha
        const nx = dx / dist
        const ny = dy / dist
        a.vx -= nx * force
        a.vy -= ny * force
        b.vx += nx * force
        b.vy += ny * force
      }
    }
  }

  // 1b. Attraction along edges (spring model)
  for (const edge of edges) {
    const source = nodeIndex.get(edge.source)
    const target = nodeIndex.get(edge.target)
    if (!source || !target) continue

    let dx = target.x - source.x
    let dy = target.y - source.y
    if (dx === 0 && dy === 0) continue
    const dist = Math.sqrt(dx * dx + dy * dy)

    const idealLen = source.radius + target.radius + settings.springLength
    // Apply attraction as a spring: proportional to displacement from ideal length
    const displacement = dist - idealLen
    const force = displacement * physicsAttraction * effectiveAlpha
    const nx = dx / dist
    const ny = dy / dist
    source.vx += nx * force
    source.vy += ny * force
    target.vx -= nx * force
    target.vy -= ny * force
  }

  // 1c. Center gravity — pulls everything toward canvas center
  // No cap: the farther a node is, the stronger it gets pulled back.
  for (const node of nodes) {
    const dx = centerX - node.x
    const dy = centerY - node.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    let force = dist * physicsCenterGravity * effectiveAlpha
    // Isolate nodes (0 connections) get extra gravity so they don't drift off
    if (node.connections === 0) force *= 2.2
    node.vx += (dx / dist) * force
    node.vy += (dy / dist) * force
  }

  // ── Phase 2: Apply velocities → positions ──

  for (const node of nodes) {
    // Apply velocity with damping
    node.vx *= SIMULATION_VELOCITY_DECAY
    node.vy *= SIMULATION_VELOCITY_DECAY
    // Clamp speed to prevent runaway
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy)
    if (speed > MAX_VELOCITY) {
      node.vx = (node.vx / speed) * MAX_VELOCITY
      node.vy = (node.vy / speed) * MAX_VELOCITY
    }
    node.x += node.vx
    node.y += node.vy
  }

  // ── Phase 3: Position-based collision resolution ──
  // Directly push overlapping nodes apart (not through forces) to prevent oscillation.

  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        if (dx === 0 && dy === 0) { dx = 0.5; dy = 0.5 }
        const dist = Math.sqrt(dx * dx + dy * dy)

        const minDist = a.radius * settings.nodeScale
          + b.radius * settings.nodeScale
          + NODE_COLLISION_GAP

        const labelA = settings.showLabels ? getLabelBounds(a, settings) : null
        const labelB = settings.showLabels ? getLabelBounds(b, settings) : null
        const labelOverlaps = labelA && labelB && boundsOverlap(labelA, labelB)
        if ((dist < minDist || labelOverlaps) && dist > 0) {
          const circleOverlap = Math.max(0, minDist - dist)
          let labelOverlap = 0
          if (labelOverlaps && labelA && labelB) {
            const overlapX = Math.min(labelA.right - labelB.left, labelB.right - labelA.left)
            const overlapY = Math.min(labelA.bottom - labelB.top, labelB.bottom - labelA.top)
            labelOverlap = Math.max(Math.max(overlapX, 0), Math.max(overlapY, 0)) + LABEL_COLLISION_PADDING
          }
          const overlap = Math.max(circleOverlap, labelOverlap)
          const nx = dx / dist
          const ny = dy / dist
          const pushX = nx * overlap * 0.38
          const pushY = ny * overlap * 0.38
          a.x -= pushX
          a.y -= pushY
          b.x += pushX
          b.y += pushY
          // Dampen velocity component pointing toward each other
          const relVn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
          if (relVn < 0) {
            a.vx += nx * relVn * 0.3
            a.vy += ny * relVn * 0.3
            b.vx -= nx * relVn * 0.3
            b.vy -= ny * relVn * 0.3
          }
        }
      }
    }
  }
}

function getNodeColors(kind: NodeKind, colors: GraphPalette, isDark: boolean) {
  if (kind === 'current') {
    return { fill: colors.current, stroke: colors.accent, label: colors.current, tag: colors.current }
  }
  if (kind === 'hub') {
    return { fill: colors.hub, stroke: isDark ? '#cbd5e1' : '#94a3b8', label: colors.hub, tag: colors.hub }
  }
  if (kind === 'linked') {
    return { fill: colors.linked, stroke: '#94a3b8', label: colors.linked, tag: colors.linked }
  }
  return { fill: colors.note, stroke: '#d6d3d1', label: colors.note, tag: colors.tag }
}

function getNodeTagLabel(node: GraphNode, activeTagGroup?: GraphTagGroup) {
  if (activeTagGroup) return activeTagGroup.name
  if (node.kind === 'note') return null
  return NODE_KIND_LABELS[node.kind]
}

function labelForRange(value: number, suffix = '') {
  if (Number.isInteger(value)) return `${value}${suffix}`
  if (Math.abs(value) < 0.01) return `${value.toFixed(4)}${suffix}`
  return `${value.toFixed(2)}${suffix}`
}

function SettingSection({ icon: Icon, title, children }: {
  icon: typeof SlidersHorizontal
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-stone-800 dark:text-zinc-100">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </section>
  )
}

function ToggleRow({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left text-[12px] text-stone-600 transition hover:bg-stone-100/80 active:scale-[0.99] dark:text-zinc-300 dark:hover:bg-zinc-800/80"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-stone-900 dark:bg-zinc-100' : 'bg-stone-200 dark:bg-zinc-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform dark:bg-zinc-950 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}

function RangeRow({ label, value, min, max, step, suffix, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block space-y-1.5 rounded-xl px-2 py-1.5 text-[12px] text-stone-600 dark:text-zinc-300">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-stone-400 dark:text-zinc-500">{labelForRange(value, suffix)}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-stone-900 dark:accent-zinc-100"
      />
    </label>
  )
}

function TextField({ label, value, placeholder, onChange }: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1.5 rounded-xl px-2 py-1.5 text-[12px] text-stone-600 dark:text-zinc-300">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="h-8 w-full rounded-lg border border-stone-200 bg-white/80 px-2 text-[12px] outline-none transition placeholder:text-stone-400 focus:border-stone-900 dark:border-white/10 dark:bg-zinc-950/60 dark:focus:border-zinc-100"
      />
    </label>
  )
}

function ColorField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-[12px] text-stone-600 transition hover:bg-stone-100/80 dark:text-zinc-300 dark:hover:bg-zinc-800/80">
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/70 shadow-sm" style={{ backgroundColor: value }} />
        <span>{label}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase text-stone-400 dark:text-zinc-500">{value}</span>
        <input
          type="color"
          value={value}
          onChange={event => onChange(event.target.value)}
          className="h-7 w-8 cursor-pointer rounded-lg border border-stone-200 bg-transparent p-0.5 dark:border-white/10"
          title={`${label}调色板`}
        />
      </span>
    </label>
  )
}

function PanelTab({ active, label, icon: Icon, onClick }: {
  active: boolean
  label: string
  icon: typeof SlidersHorizontal
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex h-9 items-center justify-center gap-1 rounded-xl text-[12px] transition active:scale-[0.97] ${active ? 'bg-stone-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  )
}

export function KnowledgeGraph({ focusPath }: KnowledgeGraphProps) {
  const t = useTranslations()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const graphRef = useRef<GraphData>({ nodes: [], edges: [], nodeIndex: new Map() })
  const visibleNodesRef = useRef(0)
  const visibleEdgesRef = useRef(0)
  const isDraggingRef = useRef(false)
  const dragMovedRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const needsSimulationRef = useRef(true)
  const alphaRef = useRef(1) // simulation "temperature": 1=hot, 0=cold
  const renderRef = useRef<() => void>(() => {})

  const { fileTree, setActiveFilePath } = useArticleStore()
  const { backlinks, buildIndex, isBuilding, isIndexed } = useNoteIndexStore()
  const { tagGroups, initTagGroups, addTagGroup: addStoredTagGroup, removeTagGroup: removeStoredTagGroup } = useKnowledgeGraphTagsStore()
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredNodePos, setHoveredNodePos] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>('filter')
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS)
  const [tagGroupName, setTagGroupName] = useState('')
  const [tagGroupQuery, setTagGroupQuery] = useState('')
  const [isTagDropActive, setIsTagDropActive] = useState(false)
  const [semanticEdges, setSemanticEdges] = useState<GraphEdge[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null)
  const [isReplaying, setIsReplaying] = useState(false)
  const [replayProgress, setReplayProgress] = useState(1)
  const [timeThreshold, setTimeThreshold] = useState<number | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [isComputingRelations, setIsComputingRelations] = useState(false)
  const clickTimerRef = useRef<number | null>(null)
  const lastClickedNodeRef = useRef<string | null>(null)

  // 加载语义关系边（从 note_relations 预计算数据 + 向量嵌入实时计算）
  useEffect(() => {
    const anySemanticEnabled = settings.showSemanticEdges || settings.showKeywordEdges || settings.showLLMEdges
    if (!anySemanticEnabled) {
      setSemanticEdges([])
      return
    }

    let cancelled = false
    const loadSemanticEdges = async () => {
      try {
        const edges: GraphEdge[] = []

        // 1. 从 note_relations 加载预计算关系
        try {
          const { getAllRelations } = await import('@/db/note-relations')
          const relations = await getAllRelations()

          for (const rel of relations) {
            if (rel.confidence < settings.semanticThreshold) continue

            let edgeType: GraphEdge['type']
            if (rel.source_method === 'keyword') {
              edgeType = 'keyword'
            } else if (rel.source_method === 'llm') {
              edgeType = 'llm'
            } else if (rel.source_method === 'cross_validated') {
              // 交叉验证的边根据最强信号决定类型
              if (rel.llm_confirmed) edgeType = 'llm'
              else if (rel.cosine_sim_score > rel.keyword_overlap_score) edgeType = 'semantic'
              else edgeType = 'keyword'
            } else {
              edgeType = 'semantic'
            }

            edges.push({
              source: rel.source_note,
              target: rel.target_note,
              type: edgeType,
              weight: rel.confidence,
              relationType: rel.relation_type,
              evidence: rel.evidence || undefined,
            })
          }
        } catch {
          // note_relations 表可能尚未初始化
        }

        // 2. 如果启用了语义边但没有预计算数据，退回到实时向量计算
        if (settings.showSemanticEdges && edges.filter(e => e.type === 'semantic').length === 0) {
          const { getFileEmbeddings } = await import('@/db/vector')
          const embeddingsByFile = await getFileEmbeddings()
          if (embeddingsByFile.size >= 2) {
            const vectorEdges = buildSemanticEdges(
              Array.from(embeddingsByFile.keys()),
              embeddingsByFile,
              settings.semanticThreshold,
            )
            edges.push(...vectorEdges)
          }
        }

        if (!cancelled) setSemanticEdges(edges)
      } catch {
        if (!cancelled) setSemanticEdges([])
      }
    }

    void loadSemanticEdges()
    return () => { cancelled = true }
  }, [settings.showSemanticEdges, settings.showKeywordEdges, settings.showLLMEdges, settings.semanticThreshold, fileTree])

  const baseGraphData = useMemo(() => buildGraphData(fileTree, backlinks, focusPath, semanticEdges), [backlinks, fileTree, focusPath, semanticEdges])
  const graphData = useMemo(
    () => applyGraphFilters(baseGraphData, settings, tagGroups, focusPath),
    [baseGraphData, focusPath, settings.activeTagGroupId, settings.focusLinkedOnly, settings.minConnections, settings.showIsolated, settings.showSemanticEdges, tagGroups],
  )

  // Timeline: 按 modifiedAt 时间排序（如果有的话），否则退回到文件索引顺序
  const timelineSortedNodes = useMemo(() => {
    const nodes = [...baseGraphData.nodes]
    // 尝试按 modifiedAt 排序
    const hasTime = nodes.some(n => n.modifiedAt)
    if (hasTime) {
      nodes.sort((a, b) => {
        const timeA = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
        const timeB = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
        return timeA - timeB
      })
    }
    return nodes
  }, [baseGraphData])

  const timeRange = useMemo(() => {
    if (timelineSortedNodes.length === 0) return null
    const min = 0
    const max = Math.max(timelineSortedNodes.length - 1, 1)
    return { min, max, span: max - min }
  }, [timelineSortedNodes])

  const activeTagGroup = useMemo(
    () => tagGroups.find(group => group.id === settings.activeTagGroupId),
    [settings.activeTagGroupId, tagGroups],
  )
  const hasGraphFilters =
    settings.activeTagGroupId !== ALL_TAG_GROUP_ID ||
    settings.focusLinkedOnly ||
    settings.minConnections > 0 ||
    !settings.showIsolated ||
    settings.showSemanticEdges
  const palette = settings.colors

  useEffect(() => {
    if (!isIndexed && !isBuilding && fileTree.length > 0) {
      void buildIndex(fileTree)
    }
  }, [buildIndex, fileTree, isBuilding, isIndexed])

  useEffect(() => {
    initTagGroups()
  }, [initTagGroups])

  // 监听"在图谱中定位"事件
  useEffect(() => {
    const handleLocateNode = (event: unknown) => {
      const { path } = event as { path: string }
      if (!path) return

      // 找到对应节点并居中显示
      const targetNode = graphRef.current.nodeIndex.get(path)
      if (targetNode && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setPan({
          x: rect.width / 2 - targetNode.x * zoom,
          y: rect.height / 2 - targetNode.y * zoom,
        })
        setSelectedNode(path)
        setDetailPanelOpen(true)
        setHighlightedNode(path)
        // 3 秒后取消高亮
        setTimeout(() => setHighlightedNode(null), 3000)
      }
    }

    const emitter = require('@/lib/emitter').default
    emitter.on('graph-locate-node', handleLocateNode)
    return () => {
      emitter.off('graph-locate-node', handleLocateNode)
    }
  }, [zoom])

  useEffect(() => {
    if (settings.activeTagGroupId !== ALL_TAG_GROUP_ID && !tagGroups.some(group => group.id === settings.activeTagGroupId)) {
      setSettings(current => ({ ...current, activeTagGroupId: ALL_TAG_GROUP_ID }))
    }
  }, [settings.activeTagGroupId, tagGroups])

  const wakeSimulation = useCallback(() => {
    alphaRef.current = 1
    if (!needsSimulationRef.current) {
      needsSimulationRef.current = true
      animationRef.current = requestAnimationFrame(renderRef.current)
    }
  }, [])

  const updateSettings = useCallback(<K extends keyof GraphSettings>(key: K, value: GraphSettings[K]) => {
    setSettings(current => ({ ...current, [key]: value }))
    // Wake simulation when force parameters change
    if (['repulsion', 'attraction', 'centerGravity', 'nodeScale'].includes(key)) {
      needsSimulationRef.current = true
      animationRef.current = requestAnimationFrame(renderRef.current)
    }
  }, [])

  const updateColor = useCallback((key: keyof GraphPalette, value: string) => {
    setSettings(current => ({
      ...current,
      colors: {
        ...current.colors,
        [key]: value,
      },
    }))
  }, [])

  const addTagGroup = useCallback(() => {
    const nextGroup = addStoredTagGroup(tagGroupName, tagGroupQuery)
    if (!nextGroup) return

    setSettings(current => ({ ...current, activeTagGroupId: nextGroup.id }))
    setTagGroupName('')
    setTagGroupQuery('')
  }, [addStoredTagGroup, tagGroupName, tagGroupQuery])

  const removeTagGroup = useCallback((id: string) => {
    removeStoredTagGroup(id)
    setSettings(current => current.activeTagGroupId === id
      ? { ...current, activeTagGroupId: ALL_TAG_GROUP_ID }
      : current)
  }, [removeStoredTagGroup])

  const addDroppedResourceToTagDraft = useCallback((resourcePath: string) => {
    const nextQuery = appendUniqueGraphTagQuery(tagGroupQuery, resourcePath)
    setTagGroupQuery(nextQuery)
    setTagGroupName(current => current.trim() ? current : getGraphTagNameFromPath(resourcePath))
  }, [tagGroupQuery])

  const handleTagDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsTagDropActive(false)

    const resource = parseGraphTagDrop(event.dataTransfer)
    if (!resource?.path) return
    addDroppedResourceToTagDraft(resource.path)
  }, [addDroppedResourceToTagDraft])

  const restartReplay = useCallback(() => {
    graphRef.current = cloneGraphData(graphData)
    visibleNodesRef.current = graphData.nodes.length
    visibleEdgesRef.current = graphData.edges.length
    setTimeThreshold(0)
    setReplayProgress(0)
    setIsReplaying(true)
    alphaRef.current = 1
    needsSimulationRef.current = true
  }, [graphData])

  useEffect(() => {
    const cloned = cloneGraphData(graphData)
    const layoutCache = loadLayoutCache()
    if (layoutCache.size > 0) {
      applyLayoutCache(cloned, layoutCache)
    }
    graphRef.current = cloned
    visibleNodesRef.current = graphData.nodes.length
    visibleEdgesRef.current = graphData.edges.length
    setReplayProgress(1)
    setIsReplaying(false)
    needsSimulationRef.current = true
    animationRef.current = requestAnimationFrame(renderRef.current)
  }, [graphData])

  useEffect(() => {
    if (!isReplaying || !timeRange) return

    const timer = window.setInterval(() => {
      setTimeThreshold(current => {
        const start = current ?? timeRange.min
        const step = Math.max(1, timeRange.span / 100) // ~100 ticks to show all nodes
        const next = start + step
        const progress = Math.min(1, (next - timeRange.min) / timeRange.span)
        setReplayProgress(progress)
        if (next >= timeRange.max) {
          window.setTimeout(() => setIsReplaying(false), 0)
          return timeRange.max
        }
        return next
      })
    }, REPLAY_TICK_MS)

    return () => window.clearInterval(timer)
  }, [isReplaying, timeRange])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
    renderRef.current = render
    const data = graphRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    if (!ctx || rect.width === 0 || rect.height === 0) return

    const ratio = window.devicePixelRatio || 1
    const targetWidth = Math.floor(rect.width * ratio)
    const targetHeight = Math.floor(rect.height * ratio)
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const isDark = document.documentElement.classList.contains('dark')
    const now = performance.now()
    // Timeline visibility: nodes appear in modifiedAt time order
    const isTimeFiltered = timeThreshold !== null || isReplaying
    let visibleNodeIds: Set<string>
    if (isTimeFiltered && timeRange) {
      const thresholdIndex = Math.floor(timeThreshold ?? timeRange.min)
      const visibleCount = Math.min(thresholdIndex + 1, timelineSortedNodes.length)
      // 使用按时间排序的节点列表
      visibleNodeIds = new Set(timelineSortedNodes.slice(0, visibleCount).map(n => n.id))
    } else {
      visibleNodeIds = new Set(data.nodes.map(n => n.id))
    }
    const visibleNodes = data.nodes.filter(node => visibleNodeIds.has(node.id))
    const visibleEdges = data.edges.filter(edge =>
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    )
    const labelZoomAlpha = settings.showLabels ? clamp((zoom - 0.45) / 0.45, 0, 1) : 0
    const tagZoomAlpha = settings.showTags ? clamp((zoom - 0.95) / 0.5, 0, 1) : 0

    // Only run simulation when alpha > 0 (has energy)
    if (needsSimulationRef.current && alphaRef.current > 0.001) {
      simulateStep(data.nodes, data.edges, data.nodeIndex, rect.width, rect.height, settings, alphaRef.current)
      // Decay alpha each frame — simulation gradually cools
      alphaRef.current *= (1 - SIMULATION_ALPHA_DECAY)
    } else if (needsSimulationRef.current && !isDraggingRef.current && !isReplaying) {
      needsSimulationRef.current = false
      alphaRef.current = 0
      // Persist stable positions to cache
      const positions = new Map<string, { x: number; y: number }>()
      for (const node of data.nodes) {
        positions.set(node.id, { x: node.x, y: node.y })
      }
      saveLayoutCache(positions)
    }

    ctx.save()
    ctx.translate(pan.x + rect.width / 2, pan.y + rect.height / 2)
    ctx.scale(zoom, zoom)
    ctx.translate(-rect.width / 2, -rect.height / 2)

    ctx.lineCap = 'round'
    for (const edge of visibleEdges) {
      const source = data.nodeIndex.get(edge.source)
      const target = data.nodeIndex.get(edge.target)
      if (!source || !target) continue

      const isHot = hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode)
      const isSemantic = edge.type === 'semantic'
      const isKeyword = edge.type === 'keyword'
      const isLLM = edge.type === 'llm'
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.sqrt(dx * dx + dy * dy) || 1
      const curve = Math.min(18, distance * 0.08)
      const midX = (source.x + target.x) / 2 - (dy / distance) * curve
      const midY = (source.y + target.y) / 2 + (dx / distance) * curve

      if (isLLM) {
        // LLM 确认的边: 紫色实线，较粗
        const llmOpacity = settings.edgeOpacity * (0.6 + edge.weight * 0.4)
        ctx.strokeStyle = isHot
          ? (isDark ? 'rgba(192, 132, 252, 0.9)' : 'rgba(168, 85, 247, 0.8)')
          : (isDark ? `rgba(192, 132, 252, ${llmOpacity})` : `rgba(168, 85, 247, ${llmOpacity})`)
        ctx.lineWidth = isHot ? 1.8 : 1.0
        ctx.setLineDash([])
      } else if (isKeyword) {
        // 关键词匹配边: 绿色点线
        const kwOpacity = settings.edgeOpacity * (0.5 + edge.weight * 0.5)
        ctx.strokeStyle = isHot
          ? (isDark ? 'rgba(74, 222, 128, 0.8)' : 'rgba(34, 197, 94, 0.7)')
          : (isDark ? `rgba(74, 222, 128, ${kwOpacity})` : `rgba(34, 197, 94, ${kwOpacity})`)
        ctx.lineWidth = isHot ? 1.2 : 0.6
        ctx.setLineDash([2, 4])
      } else if (isSemantic) {
        // 余弦相似度边: 蓝色虚线
        const semOpacity = settings.edgeOpacity * (0.5 + edge.weight * 0.5)
        ctx.strokeStyle = isHot
          ? (isDark ? 'rgba(129, 140, 248, 0.8)' : 'rgba(99, 102, 241, 0.7)')
          : (isDark ? `rgba(129, 140, 248, ${semOpacity})` : `rgba(99, 102, 241, ${semOpacity})`)
        ctx.lineWidth = isHot ? 1.3 : 0.65
        ctx.setLineDash([5, 4])
      } else {
        // Wikilink edges: solid lines
        ctx.strokeStyle = isHot
          ? (isDark ? `${palette.accent}bb` : `${palette.accent}88`)
          : (isDark ? `rgba(148, 163, 184, ${settings.edgeOpacity})` : `rgba(71, 85, 105, ${settings.edgeOpacity})`)
        const baseWeight = Math.min((edge.weight || 1) * 0.3, 1.8)
        ctx.lineWidth = isHot ? 1.55 + baseWeight : 0.82 + baseWeight
        ctx.setLineDash([])
      }

      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.quadraticCurveTo(midX, midY, target.x, target.y)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Pre-compute connected node set for hovered/highlighted node
    const activeFocusNode = hoveredNode || highlightedNode
    const focusedNeighbors = new Set<string>()
    if (activeFocusNode) {
      for (const edge of visibleEdges) {
        if (edge.source === activeFocusNode) focusedNeighbors.add(edge.target)
        if (edge.target === activeFocusNode) focusedNeighbors.add(edge.source)
      }
    }

    for (let index = 0; index < visibleNodes.length; index++) {
      const node = visibleNodes[index]
      const colors = getNodeColors(node.kind, settings.colors, isDark)
      const isHovered = hoveredNode === node.id
      const isHighlighted = highlightedNode === node.id
      const isConnected = activeFocusNode && focusedNeighbors.has(node.id)
      const muted = Boolean(activeFocusNode && !isHovered && !isHighlighted && !isConnected)
      const radius = node.radius * settings.nodeScale
      const alpha = muted ? 0.28 : 1

      // Glow effect for current / hovered nodes
      if (node.kind === 'current' || isHovered) {
        ctx.globalAlpha = muted ? 0.1 : 0.4
        ctx.beginPath()
        ctx.arc(node.x, node.y, radius + 12, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(palette.accent, 0.12)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(palette.accent, 0.1)
        ctx.fill()
      }

      // Hub glow (subtle)
      if (node.kind === 'hub' && !muted) {
        ctx.globalAlpha = 0.15
        ctx.beginPath()
        ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(colors.fill, 0.12)
        ctx.fill()
      }

      // Node circle
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = colors.fill
      ctx.fill()
      // Subtle border
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.55)'
      ctx.lineWidth = isHovered ? 1.6 : 0.6
      ctx.stroke()

      // Label
      if (labelZoomAlpha > 0.02) {
        const label = node.label.length > 20 ? `${node.label.slice(0, 19)}...` : node.label
        const labelY = node.y + radius + 12
        ctx.font = `${settings.labelSize + (isHovered ? 1 : 0)}px "Microsoft YaHei", system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.globalAlpha = alpha * labelZoomAlpha
        ctx.shadowColor = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.95)'
        ctx.shadowBlur = 3
        ctx.fillStyle = isDark ? 'rgba(200,200,210,0.9)' : colors.label
        ctx.fillText(label, node.x, labelY)
        ctx.shadowBlur = 0
      }

      ctx.globalAlpha = 1
    }

    ctx.restore()

    // Continue animation loop if simulation is active, replaying, or time filtering
    if (needsSimulationRef.current || isReplaying || timeThreshold !== null) {
      animationRef.current = requestAnimationFrame(render)
    }
  }, [activeTagGroup, hoveredNode, highlightedNode, isReplaying, palette.accent, pan, settings, timeThreshold, timeRange, zoom])

  useEffect(() => {
    animationRef.current = requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(animationRef.current)
  }, [render])

  const getGraphPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - pan.x - rect.width / 2) / zoom + rect.width / 2,
      y: (clientY - rect.top - pan.y - rect.height / 2) / zoom + rect.height / 2,
    }
  }, [pan, zoom])

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const graphPoint = getGraphPoint(event.clientX, event.clientY)
    if (!canvas || !graphPoint) return

    if (isDraggingRef.current) {
      const deltaX = event.clientX - lastMouseRef.current.x
      const deltaY = event.clientY - lastMouseRef.current.y
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) {
        dragMovedRef.current = true
      }
      setPan(current => ({
        x: current.x + deltaX,
        y: current.y + deltaY,
      }))
      lastMouseRef.current = { x: event.clientX, y: event.clientY }
      canvas.style.cursor = 'grabbing'
      return
    }

    let nextHovered: string | null = null
    let closestDistance = 24 / zoom
    const visibleNodes = graphRef.current.nodes.slice(0, Math.max(visibleNodesRef.current, graphRef.current.nodes.length))
    for (const node of visibleNodes) {
      const dx = node.x - graphPoint.x
      const dy = node.y - graphPoint.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < closestDistance) {
        closestDistance = distance
        nextHovered = node.id
      }
    }

    setHoveredNode(nextHovered)
    setHoveredNodePos(nextHovered ? { x: event.clientX, y: event.clientY } : null)
    canvas.style.cursor = nextHovered ? 'pointer' : 'grab'
  }, [getGraphPoint, zoom])


  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true
    dragMovedRef.current = false
    lastMouseRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const stopDragging = useCallback(() => {
    window.setTimeout(() => {
      dragMovedRef.current = false
    }, 0)
    isDraggingRef.current = false
  }, [])

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    const node = graphRef.current.nodeIndex.get(nodeId)
    if (!node || !canvasRef.current) return
    // Center the node in view
    const rect = canvasRef.current.getBoundingClientRect()
    const targetPan = {
      x: rect.width / 2 - node.x * zoom,
      y: rect.height / 2 - node.y * zoom,
    }
    setPan(targetPan)
    setSelectedNode(nodeId)
  }, [zoom])

  const handleClick = useCallback(() => {
    setContextMenu(null)
    if (!hoveredNode || dragMovedRef.current) return

    if (lastClickedNodeRef.current === hoveredNode && clickTimerRef.current !== null) {
      // Double click
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      lastClickedNodeRef.current = null
      handleNodeDoubleClick(hoveredNode)
    } else {
      // Single click (delayed to distinguish from double)
      lastClickedNodeRef.current = hoveredNode
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null
        lastClickedNodeRef.current = null
        setSelectedNode(hoveredNode)
        setDetailPanelOpen(true)
      }, 250)
    }
  }, [hoveredNode, handleNodeDoubleClick])

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const graphPoint = getGraphPoint(event.clientX, event.clientY)
    if (!graphPoint) return

    let targetNode: string | null = null
    let closestDistance = 24 / zoom
    for (const node of graphRef.current.nodes) {
      const dx = node.x - graphPoint.x
      const dy = node.y - graphPoint.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < closestDistance) {
        closestDistance = distance
        targetNode = node.id
      }
    }

    if (targetNode) {
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: targetNode })
    } else {
      setContextMenu(null)
    }
  }, [getGraphPoint, zoom])

  const handleCreateLinkFromGraph = useCallback(async (sourcePath: string, targetPath: string) => {
    try {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')
      const { path, baseDir } = await getFilePathOptions(sourcePath)
      const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path)
      const targetName = targetPath.split('/').pop()?.replace(/\.md$/, '') || targetPath
      // Append [[target]] at the end if not already linked
      if (!content.includes(`[[${targetName}]]`)) {
        const updated = content.trimEnd() + `\n[[${targetName}]]`
        if (baseDir) {
          await writeTextFile(path, updated, { baseDir })
        } else {
          await writeTextFile(path, updated)
        }
        // Refresh the index
        const noteIndexStore = useNoteIndexStore.getState()
        noteIndexStore.updateFileIndex(sourcePath, updated)
        // If the file is currently open in editor, update it too
        const articleStore = useArticleStore.getState()
        if (articleStore.activeFilePath === sourcePath) {
          articleStore.setCurrentArticle(updated)
        }
      }
    } catch (error) {
      console.error('[Graph] Failed to create link:', error)
    }
    setContextMenu(null)
  }, [])

  const handleOpenInEditor = useCallback((nodeId: string) => {
    setActiveFilePath(nodeId)
    setContextMenu(null)
    setHighlightedNode(null)
  }, [setActiveFilePath])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSettings(DEFAULT_SETTINGS)
    setTimeThreshold(null)
    setIsReplaying(false)
    try {
      localStorage.removeItem(LAYOUT_CACHE_KEY)
    } catch {
    }
    const resetData = applyGraphFilters(baseGraphData, DEFAULT_SETTINGS, tagGroups, focusPath)
    graphRef.current = cloneGraphData(resetData)
    visibleNodesRef.current = resetData.nodes.length
    visibleEdgesRef.current = resetData.edges.length
    alphaRef.current = 1
    needsSimulationRef.current = true
    window.cancelAnimationFrame(animationRef.current)
    animationRef.current = requestAnimationFrame(renderRef.current)
  }, [baseGraphData, focusPath, tagGroups])

  const resetGraphFilters = useCallback(() => {
    setSettings(current => ({
      ...current,
      showIsolated: true,
      focusLinkedOnly: false,
      minConnections: 0,
      activeTagGroupId: ALL_TAG_GROUP_ID,
    }))
  }, [])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.88 : 1.12), MIN_ZOOM, MAX_ZOOM)
    const graphX = (mouseX - pan.x - rect.width / 2) / zoom + rect.width / 2
    const graphY = (mouseY - pan.y - rect.height / 2) / zoom + rect.height / 2

    setZoom(nextZoom)
    setPan({
      x: mouseX - rect.width / 2 - (graphX - rect.width / 2) * nextZoom,
      y: mouseY - rect.height / 2 - (graphY - rect.height / 2) * nextZoom,
    })
  }, [pan, zoom])

  const handleReplayButton = useCallback(() => {
    if (isReplaying) {
      setIsReplaying(false)
      return
    }
    restartReplay()
  }, [isReplaying, restartReplay])

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-50 text-stone-900 dark:bg-zinc-950 dark:text-zinc-100" onClick={() => setContextMenu(null)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(217,119,6,0.07),transparent_24%),radial-gradient(circle_at_82%_20%,rgba(120,113,108,0.10),transparent_22%)]" />

      <div className="absolute left-3 top-3 z-[2] flex items-center gap-1 rounded-full border border-stone-200/70 bg-white/72 p-1 shadow-[0_14px_40px_-28px_rgba(28,25,23,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/72">
        <button
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-700 transition hover:bg-stone-100 active:scale-[0.96] dark:text-zinc-200 dark:hover:bg-zinc-800"
          title={isReplaying ? '暂停回放' : '时间回放'}
          onClick={handleReplayButton}
        >
          {isReplaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span
            className="absolute bottom-1 left-1/2 h-0.5 -translate-x-1/2 rounded-full transition-[width]"
            style={{ width: `${Math.max(8, replayProgress * 24)}px`, backgroundColor: palette.accent }}
          />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="重放"
          onClick={restartReplay}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-stone-200 dark:bg-white/10" />
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="缩小"
          onClick={() => setZoom(value => clamp(value / 1.18, MIN_ZOOM, MAX_ZOOM))}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="放大"
          onClick={() => setZoom(value => clamp(value * 1.18, MIN_ZOOM, MAX_ZOOM))}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="复位视图"
          onClick={resetView}
        >
          <LocateFixed className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-stone-200 dark:bg-white/10" />
        <button
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition active:scale-[0.96] ${settingsOpen ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`}
          title="图谱设置"
          onClick={() => setSettingsOpen(value => !value)}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      {settingsOpen && (
        <div className="absolute right-3 top-3 z-[3] w-[328px] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-stone-200/80 bg-white/90 shadow-[0_24px_70px_-42px_rgba(28,25,23,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/90">
          <div className="flex items-center justify-between border-b border-stone-200/70 px-3 py-2 dark:border-white/10">
            <div>
              <div className="text-[13px] font-semibold tracking-tight">图谱设置</div>
              <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                {graphData.nodes.length} 个节点 · {graphData.edges.filter(e => e.type === 'wikilink').length} 条链接
                {graphData.edges.some(e => e.type === 'semantic') && ` · ${graphData.edges.filter(e => e.type === 'semantic').length} 条语义关联`}
                {graphData.edges.some(e => e.type === 'keyword') && ` · ${graphData.edges.filter(e => e.type === 'keyword').length} 条关键词关联`}
                {graphData.edges.some(e => e.type === 'llm') && ` · ${graphData.edges.filter(e => e.type === 'llm').length} 条深度关联`}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="rounded-full p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                title="恢复默认"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded-full p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                title="关闭"
                onClick={() => setSettingsOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1 border-b border-stone-200/70 p-1.5 dark:border-white/10">
            {SETTINGS_PANELS.map(panel => (
              <PanelTab
                key={panel.key}
                active={activeSettingsPanel === panel.key}
                label={panel.label}
                icon={panel.icon}
                onClick={() => setActiveSettingsPanel(panel.key)}
              />
            ))}
          </div>

          <div className="max-h-[360px] overflow-y-auto p-3">
            {activeSettingsPanel === 'filter' && (
              <SettingSection icon={SlidersHorizontal} title="筛选">
                <ToggleRow label="显示孤立节点" checked={settings.showIsolated} onChange={value => updateSettings('showIsolated', value)} />
                <ToggleRow label="只看当前笔记邻域" checked={settings.focusLinkedOnly} onChange={value => updateSettings('focusLinkedOnly', value)} />
                <RangeRow label="最少关系数" value={settings.minConnections} min={0} max={6} step={1} onChange={value => updateSettings('minConnections', value)} />
                <ToggleRow label="显示语义关联" checked={settings.showSemanticEdges} onChange={value => updateSettings('showSemanticEdges', value)} />
                <ToggleRow label="显示关键词关联" checked={settings.showKeywordEdges} onChange={value => updateSettings('showKeywordEdges', value)} />
                <ToggleRow label="显示深度关联" checked={settings.showLLMEdges} onChange={value => updateSettings('showLLMEdges', value)} />
                {(settings.showSemanticEdges || settings.showKeywordEdges || settings.showLLMEdges) && (
                  <RangeRow label="关联置信度阈值" value={settings.semanticThreshold} min={0.3} max={0.95} step={0.01} onChange={value => updateSettings('semanticThreshold', value)} />
                )}
                {/* LLM 自动深度分析按钮 */}
                <div className="mt-2 rounded-xl border border-stone-200/70 bg-stone-50/50 p-2.5 dark:border-white/10 dark:bg-zinc-800/50">
                  <div className="mb-1.5 text-[11px] font-medium text-stone-700 dark:text-zinc-200">深度关系分析</div>
                  <div className="mb-2 text-[10px] text-stone-500 dark:text-zinc-400">使用 AI 分析笔记间的深层语义关系（消耗 API 额度）</div>
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-stone-700 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    disabled={isComputingRelations}
                    onClick={async () => {
                      setIsComputingRelations(true)
                      try {
                        const { buildAllRelations } = await import('@/lib/relation-engine')
                        await buildAllRelations(undefined, true, 30)
                        // 刷新图谱
                        alphaRef.current = 1
                        needsSimulationRef.current = true
                      } catch (error) {
                        console.error('[Graph] LLM analysis failed:', error)
                      } finally {
                        setIsComputingRelations(false)
                      }
                    }}
                  >
                    {isComputingRelations ? (
                      <><RefreshCw className="h-3 w-3 animate-spin" />分析中...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" />启动深度分析</>
                    )}
                  </button>
                </div>
                <div
                  className={`mt-2 rounded-2xl border p-2 transition ${isTagDropActive ? 'border-stone-900 bg-stone-100/80 dark:border-zinc-100 dark:bg-zinc-800/80' : 'border-stone-200/70 dark:border-white/10'}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsTagDropActive(true)
                  }}
                  onDragLeave={() => setIsTagDropActive(false)}
                  onDrop={handleTagDrop}
                >
                  <div className="mb-2 text-[12px] font-semibold text-stone-800 dark:text-zinc-100">文章标签</div>
                  <div className="grid grid-cols-2 gap-2">
                    <TextField label="标签名" value={tagGroupName} placeholder="例如 AI" onChange={setTagGroupName} />
                    <TextField label="关联文章" value={tagGroupQuery} placeholder="拖入文章或输入关键词" onChange={setTagGroupQuery} />
                  </div>
                  <div className="mt-1.5 rounded-lg bg-stone-100/70 px-2 py-1 text-[11px] text-stone-500 dark:bg-zinc-800/70 dark:text-zinc-400">
                    可从左侧文件列表拖入文章，自动识别为标签关联范围。
                  </div>
                  <button
                    type="button"
                    className="mt-2 h-8 w-full rounded-xl bg-stone-900 text-[12px] font-medium text-white transition hover:bg-stone-700 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    onClick={addTagGroup}
                  >
                    添加标签组
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${settings.activeTagGroupId === ALL_TAG_GROUP_ID ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300'}`}
                      onClick={() => updateSettings('activeTagGroupId', ALL_TAG_GROUP_ID)}
                    >
                      全部
                    </button>
                    {tagGroups.map(group => (
                      <span
                        key={group.id}
                        className={`inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-[11px] transition ${settings.activeTagGroupId === group.id ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-stone-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                      >
                        <button type="button" onClick={() => updateSettings('activeTagGroupId', group.id)}>
                          {group.name}
                        </button>
                        <button
                          type="button"
                          className="rounded-full p-0.5 opacity-70 hover:bg-white/20 hover:opacity-100"
                          title="删除标签组"
                          onClick={() => removeTagGroup(group.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </SettingSection>
            )}

            {activeSettingsPanel === 'color' && (
              <SettingSection icon={Palette} title="颜色调色板">
                <ColorField label="主题强调色" value={settings.colors.accent} onChange={value => updateColor('accent', value)} />
                <ColorField label="当前节点" value={settings.colors.current} onChange={value => updateColor('current', value)} />
                <ColorField label="核心节点" value={settings.colors.hub} onChange={value => updateColor('hub', value)} />
                <ColorField label="关联节点" value={settings.colors.linked} onChange={value => updateColor('linked', value)} />
                <ColorField label="普通节点" value={settings.colors.note} onChange={value => updateColor('note', value)} />
                <ColorField label="标签文字" value={settings.colors.tag} onChange={value => updateColor('tag', value)} />
              </SettingSection>
            )}

            {activeSettingsPanel === 'appearance' && (
              <SettingSection icon={GitBranch} title="外观">
                <ToggleRow label="显示节点名称" checked={settings.showLabels} onChange={value => updateSettings('showLabels', value)} />
                <ToggleRow label="显示节点标签" checked={settings.showTags} onChange={value => updateSettings('showTags', value)} />
                <RangeRow label="标签大小" value={settings.labelSize} min={9} max={16} step={1} suffix="px" onChange={value => updateSettings('labelSize', value)} />
                <RangeRow label="节点大小" value={settings.nodeScale} min={0.7} max={1.7} step={0.05} onChange={value => updateSettings('nodeScale', value)} />
                <RangeRow label="连线透明度" value={settings.edgeOpacity} min={0.06} max={0.42} step={0.02} onChange={value => updateSettings('edgeOpacity', value)} />
              </SettingSection>
            )}

            {activeSettingsPanel === 'force' && (
              <SettingSection icon={SlidersHorizontal} title="力度">
                <RangeRow label="节点间排斥力" value={settings.repulsion} min={5} max={20} step={0.5} onChange={value => { updateSettings('repulsion', value); wakeSimulation() }} />
                <RangeRow label="相连节点吸引力" value={settings.attraction} min={0.3} max={1.5} step={0.05} onChange={value => { updateSettings('attraction', value); wakeSimulation() }} />
                <RangeRow label="图谱向心力" value={settings.centerGravity} min={0.1} max={1} step={0.05} onChange={value => { updateSettings('centerGravity', value); wakeSimulation() }} />
                <RangeRow label="连线长度" value={settings.springLength} min={30} max={100} step={5} onChange={value => { updateSettings('springLength', value); wakeSimulation() }} />
                <div className="mt-1 rounded-lg bg-stone-100/70 px-2 py-1.5 text-[11px] leading-relaxed text-stone-500 dark:bg-zinc-800/70 dark:text-zinc-400">
                  调整后图谱会自动重新布局。排斥力越大节点越分散，吸引力越大相连节点越紧凑，向心力控制整体聚拢程度。
                </div>
              </SettingSection>
            )}
          </div>
        </div>
      )}

      {/* Timeline scrubber — 紧凑浮动条 */}
      {timeRange && (
        <div className="absolute bottom-3 left-1/2 z-[3] -translate-x-1/2 w-[calc(100%-2rem)] max-w-[640px]">
          <div className="flex items-center gap-2.5 rounded-full border border-stone-200/60 bg-white/88 px-4 py-2 shadow-sm backdrop-blur-xl dark:border-white/8 dark:bg-zinc-900/88">
            {/* 播放/暂停按钮 */}
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title={isReplaying ? '暂停' : '播放'}
              onClick={handleReplayButton}
            >
              {isReplaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>

            {/* 当前进度文字 */}
            <span className="shrink-0 min-w-[3rem] text-[11px] tabular-nums text-stone-500 dark:text-zinc-400">
              {timeThreshold !== null
                ? `${Math.min(Math.floor(timeThreshold) + 1, timelineSortedNodes.length)}`
                : `${timelineSortedNodes.length}`}
              <span className="text-stone-300 dark:text-zinc-600">/{timelineSortedNodes.length}</span>
            </span>

            {/* 滑块轨道 */}
            <div className="relative flex-1 flex items-center h-5">
              {/* 背景轨道 */}
              <div className="absolute inset-x-0 h-[3px] rounded-full bg-stone-200/80 dark:bg-zinc-700/60" />
              {/* 已填充部分 */}
              <div
                className="absolute left-0 h-[3px] rounded-full transition-[width] duration-75"
                style={{
                  width: `${((timeThreshold ?? timeRange.max) / Math.max(timeRange.max, 1)) * 100}%`,
                  background: palette.accent,
                }}
              />
              {/* 原生滑块 */}
              <input
                type="range"
                className="timeline-slider absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
                min={0}
                max={Math.max(timeRange.max, 1)}
                step={1}
                value={timeThreshold ?? timeRange.max}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setTimeThreshold(val)
                  setIsReplaying(false)
                }}
                onMouseDown={() => setIsScrubbing(true)}
                onMouseUp={() => setIsScrubbing(false)}
                onTouchStart={() => setIsScrubbing(true)}
                onTouchEnd={() => setIsScrubbing(false)}
              />
            </div>

            {/* 日期标签 */}
            {timeThreshold !== null && timelineSortedNodes[Math.floor(timeThreshold)]?.modifiedAt ? (
              <span className="shrink-0 text-[10px] text-stone-400 dark:text-zinc-500">
                {new Date(timelineSortedNodes[Math.floor(timeThreshold)].modifiedAt!).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
              </span>
            ) : (
              <span className="shrink-0 text-[10px] text-stone-400 dark:text-zinc-500">全部</span>
            )}
          </div>
        </div>
      )}

      {graphData.nodes.length === 0 ? (
        <div className="relative z-[1] flex h-full flex-col items-center justify-center px-8 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border bg-white text-muted-foreground dark:border-white/10 dark:bg-zinc-900">
            <GitBranch className="h-5 w-5" />
          </div>
          <div className="text-sm font-medium">
            {baseGraphData.nodes.length > 0 && hasGraphFilters ? '当前筛选没有匹配节点' : '还没有可生成的 Markdown 节点'}
          </div>
          <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            {baseGraphData.nodes.length > 0 && hasGraphFilters
              ? '当前标签、邻域或关系数筛选隐藏了全部节点，清除筛选后可恢复显示。'
              : '创建或打开 Markdown 笔记后，图谱会根据双链关系自动生成。'}
          </div>
          {baseGraphData.nodes.length > 0 && hasGraphFilters ? (
            <button
              type="button"
              className="mt-4 rounded-full bg-stone-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-stone-700 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              onClick={resetGraphFilters}
            >
              清除筛选
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className="relative h-full w-full"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={stopDragging}
            onMouseLeave={stopDragging}
            onWheel={handleWheel}
            onClick={handleClick}
            onDoubleClick={(e) => { e.preventDefault() }}
            onContextMenu={handleContextMenu}
          />

          {/* Context menu */}
          {contextMenu && (
            <div
              className="fixed z-50 min-w-[180px] rounded-xl border border-stone-200/80 bg-white/95 py-1 shadow-[0_16px_48px_-24px_rgba(28,25,23,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-stone-700 transition hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={() => handleOpenInEditor(contextMenu.nodeId)}
              >
                <FileText className="h-3.5 w-3.5" />
                打开笔记
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-stone-700 transition hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={() => {
                  setSelectedNode(contextMenu.nodeId)
                  setDetailPanelOpen(true)
                  setContextMenu(null)
                }}
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
                在详情面板查看
              </button>
              {focusPath && focusPath !== contextMenu.nodeId && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-stone-700 transition hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  onClick={() => handleCreateLinkFromGraph(focusPath, contextMenu.nodeId)}
                >
                  <Link className="h-3.5 w-3.5" />
                  链接到当前笔记
                </button>
              )}
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-amber-600 transition hover:bg-stone-100 dark:text-amber-400 dark:hover:bg-zinc-800"
                onClick={() => {
                  setActiveFilePath(contextMenu.nodeId)
                  setContextMenu(null)
                  setHighlightedNode(null)
                }}
              >
                <LocateFixed className="h-3.5 w-3.5" />
                聚焦此节点
              </button>
              <div className="my-1 border-t border-stone-200/60 dark:border-white/10" />
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-stone-700 transition hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={() => {
                  if (highlightedNode === contextMenu.nodeId) {
                    setHighlightedNode(null)
                  } else {
                    setHighlightedNode(contextMenu.nodeId)
                  }
                  setContextMenu(null)
                }}
              >
                {highlightedNode === contextMenu.nodeId ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    取消高亮关联
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    高亮关联节点
                  </>
                )}
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-stone-700 transition hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={() => {
                  void navigator.clipboard.writeText(contextMenu.nodeId)
                  setContextMenu(null)
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                复制节点路径
              </button>
              <div className="my-1 border-t border-stone-200/60 dark:border-white/10" />
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-stone-500 transition hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                onClick={() => {
                  resetView()
                  setContextMenu(null)
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重置视图
              </button>
            </div>
          )}

          {/* Detail Panel Toggle */}
          <button
            type="button"
            className="absolute right-3 top-3 z-[2] inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200/70 bg-white/72 text-stone-500 shadow-[0_14px_40px_-28px_rgba(28,25,23,0.55)] backdrop-blur-xl transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.96] dark:border-white/10 dark:bg-zinc-900/72 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title={detailPanelOpen ? '关闭详情' : '节点详情'}
            onClick={() => setDetailPanelOpen(v => !v)}
          >
            {detailPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>

          {/* Right Detail Panel */}
          {detailPanelOpen && selectedNode && (() => {
            const node = graphRef.current.nodeIndex.get(selectedNode)
            if (!node) return null
            const relatedEdges = graphRef.current.edges.filter(e => e.source === selectedNode || e.target === selectedNode)
            const relatedNodes = relatedEdges.map(e => {
              const isSource = e.source === selectedNode
              const otherId = isSource ? e.target : e.source
              const otherNode = graphRef.current.nodeIndex.get(otherId)
              if (!otherNode) return null
              return {
                node: otherNode,
                edge: e,
                isOutgoing: isSource,
              }
            }).filter(Boolean).sort((a, b) => (b?.edge.weight || 0) - (a?.edge.weight || 0))
            return (
              <DetailPanel
                node={node}
                selectedNode={selectedNode}
                relatedNodes={relatedNodes}
                graphRef={graphRef}
                settings={settings}
                zoom={zoom}
                canvasRef={canvasRef}
                palette={palette}
                onClose={() => setDetailPanelOpen(false)}
                onSelectNode={(nodeId) => setSelectedNode(nodeId)}
                onPan={(newPan) => setPan(newPan)}
                onOpenNote={(path) => {
                  setActiveFilePath(path)
                  setHighlightedNode(null)
                }}
              />
            )
          })()}
        </>
      )}
      <style jsx global>{`
        .timeline-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${palette.accent};
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
          margin-top: -4.5px;
        }
        .timeline-slider::-webkit-slider-thumb:hover {
          transform: scale(1.3);
          box-shadow: 0 0 0 3px ${palette.accent}22, 0 1px 4px rgba(0,0,0,0.2);
        }
        .timeline-slider::-webkit-slider-thumb:active {
          transform: scale(1.15);
        }
        .timeline-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${palette.accent};
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          cursor: pointer;
        }
        .timeline-slider::-webkit-slider-runnable-track {
          height: 3px;
          border-radius: 2px;
          background: transparent;
        }
        .timeline-slider::-moz-range-track {
          height: 3px;
          border-radius: 2px;
          background: transparent;
        }
      `}</style>
    </div>
  )
}
