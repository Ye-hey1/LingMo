# LingMo 知识图谱模块重构计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 参考 flowsint 项目的知识图谱架构，重构 LingMo 的知识图谱模块，解决单体组件过大、性能瓶颈、数据模型薄弱等问题

**Architecture:** 采用分层架构：数据层(GraphStore/Repository) → 服务层(GraphService) → 渲染层(Canvas/WebGL) → UI层(React组件)，参考 flowsint 的 Repository Pattern 和 Type Registry 设计

**Tech Stack:** TypeScript, Zustand, HTML5 Canvas/WebGL, Web Workers, SQLite (Tauri)

---

## 一、现状分析与问题诊断

### LingMo 当前问题

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| 单体组件 | 🔴 严重 | `knowledge-graph.tsx` 2279行，所有逻辑耦合 |
| O(n²) 性能 | 🔴 严重 | 碰撞检测、邻接表构建都是 O(n²) |
| 数据模型薄弱 | 🟡 中等 | 只有4种节点类型，边类型简单 |
| 无图数据库 | 🟡 中等 | 每次渲染从文件系统重建图 |
| 缺少搜索/导出 | 🟡 中等 | 无法搜索节点、导出图 |
| 阈值不一致 | 🟠 一般 | 语义阈值在不同代码路径不一致 |

### flowsint 优秀实践

| 特性 | 实现方式 | 可借鉴点 |
|------|----------|----------|
| Type Registry | 38+节点类型自动注册 | 统一类型系统 |
| Repository Pattern | Protocol + Neo4j/InMemory实现 | 可测试性 |
| GraphSerializer | Pydantic ↔ Neo4j 双向转换 | 数据序列化 |
| Web Workers | pathfinder/layout 独立线程 | 性能优化 |
| react-force-graph-2d | 专业图可视化库 | 渲染质量 |
| Batch Operations | 批量创建/更新/删除 | 效率提升 |
| Soft Delete | `deleted_at` 字段 | 数据安全 |

---

## 二、重构架构设计

### 新目录结构

```
src/app/core/main/knowledge/
├── index.ts                          # 导出入口
├── constants.ts                      # 常量定义
├── types.ts                          # 类型定义
├── graph/                            # 图核心模块
│   ├── store.ts                      # Zustand store (参考 flowsint graph-store.ts)
│   ├── repository.ts                 # Repository Pattern (GraphRepositoryProtocol)
│   ├── sqlite-repository.ts          # SQLite 实现
│   ├── memory-repository.ts          # 内存实现(测试用)
│   ├── service.ts                    # GraphService 高级 API
│   ├── serializer.ts                 # 数据序列化器
│   └── types.ts                      # 图数据类型
├── registry/                         # 类型注册系统
│   ├── registry.ts                   # TypeRegistry (参考 flowsint)
│   ├── types/                        # 节点类型定义
│   │   ├── base.ts                   # 基类 GraphNodeType
│   │   ├── note.ts                   # 笔记节点
│   │   ├── concept.ts                # 概念节点
│   │   ├── person.ts                 # 人物节点
│   │   ├── project.ts                # 项目节点
│   │   └── index.ts                  # 自动加载
│   └── relations/                    # 关系类型定义
│       ├── base.ts                   # 基类 RelationType
│       ├── wikilink.ts               # Wiki链接
│       ├── semantic.ts               # 语义关系
│       └── index.ts
├── visualization/                    # 可视化模块
│   ├── renderer.ts                   # 渲染器接口
│   ├── canvas-renderer.ts            # Canvas 2D 渲染器
│   ├── node-renderer.ts              # 节点渲染 (参考 flowsint)
│   ├── edge-renderer.ts              # 边渲染 (参考 flowsint)
│   └── workers/                      # Web Workers
│       ├── layout.worker.ts          # 布局计算 (dagre)
│       └── pathfinder.worker.ts      # 路径查找 (BFS)
├── components/                       # React 组件
│   ├── graph-canvas.tsx              # 画布组件
│   ├── toolbar.tsx                   # 工具栏
│   ├── detail-panel.tsx              # 详情面板
│   ├── search-dialog.tsx             # 搜索对话框
│   ├── filter-panel.tsx              # 筛选面板
│   ├── settings-panel.tsx            # 设置面板
│   └── export-dialog.tsx             # 导出对话框
├── hooks/                            # 自定义 Hooks
│   ├── use-graph.ts                  # 图数据 Hook
│   ├── use-graph-interaction.ts      # 交互 Hook
│   └── use-graph-layout.ts           # 布局 Hook
└── utils/                            # 工具函数
    ├── adjacency.ts                  # 邻接表构建
    ├── clustering.ts                 # 聚类算法
    └── pathfinding.ts                # 路径查找
```

### 核心数据模型

```typescript
// types.ts - 参考 flowsint 的 FlowsintType

/** 节点基础类型 */
interface GraphNodeBase {
  id: string;
  nodeType: string;          // 类型标识 (note, concept, person...)
  nodeLabel: string;         // 显示标签
  nodeColor?: string;        // 颜色
  nodeIcon?: string;         // 图标
  nodeShape?: 'circle' | 'square' | 'hexagon' | 'diamond';
  nodeSize?: number;         // 大小
  nodeImage?: string;        // 图片URL
  nodeProperties: Record<string, any>;  // 自定义属性
  nodeMetadata: {
    createdAt: string;
    updatedAt: string;
    source?: string;         // 来源
  };
  // 布局相关
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  // 软删除
  deletedAt?: string | null;
}

/** 边类型 */
interface GraphEdge {
  id: string;
  source: string;            // 源节点ID
  target: string;            // 目标节点ID
  label: string;             // 关系类型
  weight?: number;           // 权重
  confidence?: number;       // 置信度 (0-1)
  caption?: string;          // 说明
  type?: string;             // 边样式类型
  metadata?: {
    createdAt: string;
    source: string;          // 来源 (wikilink, semantic, llm)
    evidence?: string;       // 证据
  };
  deletedAt?: string | null;
}

/** 节点类型注册 */
interface NodeTypeRegistration {
  type: string;              // 类型标识
  label: string;             // 显示名称
  icon: string;              // Lucide 图标名
  color: string;             // 默认颜色
  shape: string;             // 默认形状
  fields: NodeField[];       // 可编辑字段
  detect?: (text: string) => boolean;  // 自动检测
  create: (data: any) => GraphNodeBase; // 创建函数
}

/** Repository Protocol (参考 flowsint) */
interface GraphRepositoryProtocol {
  // 节点操作
  createNode(node: GraphNodeBase): Promise<GraphNodeBase>;
  getNodeById(id: string): Promise<GraphNodeBase | null>;
  getNodesByType(type: string): Promise<GraphNodeBase[]>;
  updateNode(id: string, updates: Partial<GraphNodeBase>): Promise<void>;
  deleteNode(id: string): Promise<void>;  // 软删除
  mergeNodes(sourceId: string, targetId: string): Promise<void>;
  
  // 边操作
  createEdge(edge: GraphEdge): Promise<GraphEdge>;
  getEdgesByNode(nodeId: string): Promise<GraphEdge[]>;
  deleteEdge(id: string): Promise<void>;
  
  // 图查询
  getGraph(filters?: GraphFilters): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }>;
  getNeighbors(nodeId: string, depth?: number): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }>;
  findPath(sourceId: string, targetId: string, maxDepth?: number): Promise<string[]>;
  
  // 批量操作
  batchCreateNodes(nodes: GraphNodeBase[]): Promise<void>;
  batchCreateEdges(edges: GraphEdge[]): Promise<void>;
}
```

---

## 三、分阶段实施计划

### Phase 1: 基础架构重构 (第1-3天)

#### Task 1.1: 创建类型系统基础

**Objective:** 建立节点/边的类型定义和注册系统

**Files:**
- Create: `src/app/core/main/knowledge/types.ts`
- Create: `src/app/core/main/knowledge/constants.ts`
- Create: `src/app/core/main/knowledge/registry/registry.ts`
- Create: `src/app/core/main/knowledge/registry/types/base.ts`

**Step 1: 定义核心类型**

```typescript
// types.ts
export interface GraphNodeBase {
  id: string;
  nodeType: string;
  nodeLabel: string;
  nodeColor?: string;
  nodeIcon?: string;
  nodeShape?: 'circle' | 'square' | 'hexagon' | 'diamond';
  nodeSize?: number;
  nodeProperties: Record<string, any>;
  nodeMetadata: {
    createdAt: string;
    updatedAt: string;
    source?: string;
  };
  x?: number;
  y?: number;
  deletedAt?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight?: number;
  confidence?: number;
  metadata?: {
    createdAt: string;
    source: string;
    evidence?: string;
  };
  deletedAt?: string | null;
}

export type NodeKind = 'current' | 'hub' | 'linked' | 'note';
export type EdgeType = 'wikilink' | 'keyword' | 'semantic' | 'llm' | 'custom';
```

**Step 2: 实现 TypeRegistry**

```typescript
// registry/registry.ts
import { GraphNodeBase } from '../types';

export interface NodeTypeRegistration {
  type: string;
  label: string;
  icon: string;
  color: string;
  shape: string;
  fields: NodeField[];
  detect?: (text: string) => boolean;
  create: (data: any) => GraphNodeBase;
}

export interface NodeField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date';
  required?: boolean;
  options?: string[];
}

class TypeRegistry {
  private types = new Map<string, NodeTypeRegistration>();
  private lowercaseMap = new Map<string, string>();

  register(registration: NodeTypeRegistration): void {
    this.types.set(registration.type, registration);
    this.lowercaseMap.set(registration.type.toLowerCase(), registration.type);
  }

  get(type: string): NodeTypeRegistration | undefined {
    return this.types.get(type) || this.types.get(this.lowercaseMap.get(type.toLowerCase()) || '');
  }

  getAll(): NodeTypeRegistration[] {
    return Array.from(this.types.values());
  }

  detectType(text: string): string | null {
    for (const reg of this.types.values()) {
      if (reg.detect?.(text)) return reg.type;
    }
    return null;
  }
}

export const typeRegistry = new TypeRegistry();
```

**Step 3: 定义内置节点类型**

```typescript
// registry/types/note.ts
import { typeRegistry, NodeTypeRegistration } from '../registry';

const noteType: NodeTypeRegistration = {
  type: 'note',
  label: '笔记',
  icon: 'FileText',
  color: '#3b82f6',
  shape: 'circle',
  fields: [
    { key: 'title', label: '标题', type: 'text', required: true },
    { key: 'tags', label: '标签', type: 'text' },
    { key: 'category', label: '分类', type: 'text' },
  ],
  detect: (text) => text.endsWith('.md'),
  create: (data) => ({
    id: data.id || crypto.randomUUID(),
    nodeType: 'note',
    nodeLabel: data.title || 'Untitled',
    nodeColor: '#3b82f6',
    nodeIcon: 'FileText',
    nodeProperties: { title: data.title, tags: data.tags, category: data.category },
    nodeMetadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  }),
};

typeRegistry.register(noteType);
```

**Verification:** 运行 TypeScript 编译检查

---

#### Task 1.2: 实现 Repository Pattern

**Objective:** 建立数据访问层，支持 SQLite 和内存两种实现

**Files:**
- Create: `src/app/core/main/knowledge/graph/repository.ts`
- Create: `src/app/core/main/knowledge/graph/sqlite-repository.ts`
- Create: `src/app/core/main/knowledge/graph/memory-repository.ts`

**Step 1: 定义 Repository 接口**

```typescript
// graph/repository.ts
import { GraphNodeBase, GraphEdge } from '../types';

export interface GraphFilters {
  types?: string[];
  search?: string;
  dateRange?: { start: string; end: string };
  hasEdges?: boolean;
}

export interface GraphRepositoryProtocol {
  // 节点操作
  createNode(node: GraphNodeBase): Promise<GraphNodeBase>;
  getNodeById(id: string): Promise<GraphNodeBase | null>;
  getNodesByType(type: string): Promise<GraphNodeBase[]>;
  updateNode(id: string, updates: Partial<GraphNodeBase>): Promise<void>;
  deleteNode(id: string): Promise<void>;
  mergeNodes(sourceId: string, targetId: string): Promise<void>;
  
  // 边操作
  createEdge(edge: GraphEdge): Promise<GraphEdge>;
  getEdgesByNode(nodeId: string): Promise<GraphEdge[]>;
  deleteEdge(id: string): Promise<void>;
  
  // 图查询
  getGraph(filters?: GraphFilters): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }>;
  getNeighbors(nodeId: string, depth?: number): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }>;
  findPath(sourceId: string, targetId: string, maxDepth?: number): Promise<string[]>;
  
  // 批量操作
  batchCreateNodes(nodes: GraphNodeBase[]): Promise<void>;
  batchCreateEdges(edges: GraphEdge[]): Promise<void>;
}
```

**Step 2: 实现 SQLite Repository**

```typescript
// graph/sqlite-repository.ts
import { GraphRepositoryProtocol, GraphFilters } from './repository';
import { GraphNodeBase, GraphEdge } from '../types';
import { invoke } from '@tauri-apps/api/core';

export class SQLiteGraphRepository implements GraphRepositoryProtocol {
  async createNode(node: GraphNodeBase): Promise<GraphNodeBase> {
    await invoke('db:execute', {
      sql: `INSERT INTO graph_nodes (id, node_type, node_label, node_color, node_icon, 
            node_shape, node_size, node_properties, node_metadata, x, y, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        node.id, node.nodeType, node.nodeLabel, node.nodeColor, node.nodeIcon,
        node.nodeShape, node.nodeSize, JSON.stringify(node.nodeProperties),
        JSON.stringify(node.nodeMetadata), node.x, node.y, node.deletedAt
      ]
    });
    return node;
  }

  async getNodeById(id: string): Promise<GraphNodeBase | null> {
    const result = await invoke<any[]>('db:query', {
      sql: 'SELECT * FROM graph_nodes WHERE id = ? AND deleted_at IS NULL',
      args: [id]
    });
    return result[0] ? this.mapRowToNode(result[0]) : null;
  }

  async getGraph(filters?: GraphFilters): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }> {
    let nodeSql = 'SELECT * FROM graph_nodes WHERE deleted_at IS NULL';
    let edgeSql = 'SELECT * FROM graph_edges WHERE deleted_at IS NULL';
    const args: any[] = [];

    if (filters?.types?.length) {
      nodeSql += ` AND node_type IN (${filters.types.map(() => '?').join(',')})`;
      args.push(...filters.types);
    }

    if (filters?.search) {
      nodeSql += ' AND node_label LIKE ?';
      args.push(`%${filters.search}%`);
    }

    const [nodes, edges] = await Promise.all([
      invoke<any[]>('db:query', { sql: nodeSql, args }),
      invoke<any[]>('db:query', { sql: edgeSql, args: [] })
    ]);

    return {
      nodes: nodes.map(this.mapRowToNode),
      edges: edges.map(this.mapRowToEdge)
    };
  }

  async getNeighbors(nodeId: string, depth: number = 1): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }> {
    // BFS 查找邻居
    const visited = new Set<string>();
    const queue: { id: string; level: number }[] = [{ id: nodeId, level: 0 }];
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (visited.has(id) || level > depth) continue;
      visited.add(id);
      nodeIds.add(id);

      const edges = await this.getEdgesByNode(id);
      for (const edge of edges) {
        edgeIds.add(edge.id);
        const neighborId = edge.source === id ? edge.target : edge.source;
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, level: level + 1 });
        }
      }
    }

    // 批量获取节点和边
    const nodes = await Promise.all(
      Array.from(nodeIds).map(id => this.getNodeById(id))
    );
    const edges = await Promise.all(
      Array.from(edgeIds).map(id => this.getEdgeById(id))
    );

    return {
      nodes: nodes.filter(Boolean) as GraphNodeBase[],
      edges: edges.filter(Boolean) as GraphEdge[]
    };
  }

  async findPath(sourceId: string, targetId: string, maxDepth: number = 4): Promise<string[]> {
    // BFS 最短路径
    const visited = new Map<string, string | null>(); // nodeId -> parentId
    const queue: string[] = [sourceId];
    visited.set(sourceId, null);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === targetId) {
        // 回溯路径
        const path: string[] = [];
        let node: string | null = targetId;
        while (node !== null) {
          path.unshift(node);
          node = visited.get(node) || null;
        }
        return path;
      }

      const edges = await this.getEdgesByNode(current);
      for (const edge of edges) {
        const neighbor = edge.source === current ? edge.target : edge.source;
        if (!visited.has(neighbor)) {
          visited.set(neighbor, current);
          queue.push(neighbor);
        }
      }
    }

    return []; // 无路径
  }

  // ... 其他方法实现
}
```

**Step 3: 实现内存 Repository (测试用)**

```typescript
// graph/memory-repository.ts
export class InMemoryGraphRepository implements GraphRepositoryProtocol {
  private nodes = new Map<string, GraphNodeBase>();
  private edges = new Map<string, GraphEdge>();

  async createNode(node: GraphNodeBase): Promise<GraphNodeBase> {
    this.nodes.set(node.id, { ...node });
    return node;
  }

  async getNodeById(id: string): Promise<GraphNodeBase | null> {
    const node = this.nodes.get(id);
    return node && !node.deletedAt ? { ...node } : null;
  }

  // ... 其他方法实现
}
```

---

#### Task 1.3: 实现 GraphService

**Objective:** 建立高级服务层，封装业务逻辑

**Files:**
- Create: `src/app/core/main/knowledge/graph/service.ts`

```typescript
// graph/service.ts
import { GraphRepositoryProtocol, GraphFilters } from './repository';
import { GraphNodeBase, GraphEdge } from '../types';
import { typeRegistry } from '../registry/registry';

export class GraphService {
  constructor(private repository: GraphRepositoryProtocol) {}

  // 节点操作
  async createNode(type: string, data: any): Promise<GraphNodeBase> {
    const registration = typeRegistry.get(type);
    if (!registration) throw new Error(`Unknown node type: ${type}`);
    
    const node = registration.create(data);
    return this.repository.createNode(node);
  }

  async createNodeFromText(text: string): Promise<GraphNodeBase | null> {
    const type = typeRegistry.detectType(text);
    if (!type) return null;
    
    return this.createNode(type, { title: text });
  }

  // 边操作
  async createRelation(sourceId: string, targetId: string, relationType: string, metadata?: any): Promise<GraphEdge> {
    const edge: GraphEdge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      label: relationType,
      weight: metadata?.weight || 1,
      confidence: metadata?.confidence || 1,
      metadata: {
        createdAt: new Date().toISOString(),
        source: metadata?.source || 'manual',
        evidence: metadata?.evidence
      }
    };
    
    return this.repository.createEdge(edge);
  }

  // 图查询
  async getGraph(filters?: GraphFilters) {
    return this.repository.getGraph(filters);
  }

  async getNeighbors(nodeId: string, depth?: number) {
    return this.repository.getNeighbors(nodeId, depth);
  }

  async findPath(sourceId: string, targetId: string) {
    return this.repository.findPath(sourceId, targetId);
  }

  // 聚类分析
  async detectClusters(): Promise<Map<string, string[]>> {
    const { nodes, edges } = await this.repository.getGraph();
    
    // 构建邻接表
    const adjacency = new Map<string, Set<string>>();
    for (const node of nodes) {
      adjacency.set(node.id, new Set());
    }
    for (const edge of edges) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }

    // 标签传播算法
    const labels = new Map<string, string>();
    nodes.forEach(n => labels.set(n.id, n.id));

    for (let i = 0; i < 10; i++) {
      for (const node of nodes) {
        const neighbors = adjacency.get(node.id) || new Set();
        if (neighbors.size === 0) continue;

        // 投票选择最常见的标签
        const labelCounts = new Map<string, number>();
        for (const neighbor of neighbors) {
          const label = labels.get(neighbor)!;
          labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
        }

        let maxCount = 0;
        let maxLabel = labels.get(node.id)!;
        for (const [label, count] of labelCounts) {
          if (count > maxCount) {
            maxCount = count;
            maxLabel = label;
          }
        }
        labels.set(node.id, maxLabel);
      }
    }

    // 按标签分组
    const clusters = new Map<string, string[]>();
    for (const [nodeId, label] of labels) {
      if (!clusters.has(label)) clusters.set(label, []);
      clusters.get(label)!.push(nodeId);
    }

    return clusters;
  }

  // 批量操作
  async batchCreateNodes(nodes: GraphNodeBase[]) {
    return this.repository.batchCreateNodes(nodes);
  }

  async batchCreateEdges(edges: GraphEdge[]) {
    return this.repository.batchCreateEdges(edges);
  }
}
```

---

### Phase 2: 可视化重构 (第4-6天)

#### Task 2.1: 创建渲染器接口和 Canvas 渲染器

**Objective:** 分离渲染逻辑，实现可插拔的渲染器架构

**Files:**
- Create: `src/app/core/main/knowledge/visualization/renderer.ts`
- Create: `src/app/core/main/knowledge/visualization/canvas-renderer.ts`
- Create: `src/app/core/main/knowledge/visualization/node-renderer.ts`
- Create: `src/app/core/main/knowledge/visualization/edge-renderer.ts`

**Step 1: 定义渲染器接口**

```typescript
// visualization/renderer.ts
import { GraphNodeBase, GraphEdge } from '../types';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  selectedNodes: Set<string>;
  hoveredNode: string | null;
  time: number;
}

export interface GraphRenderer {
  init(canvas: HTMLCanvasElement): void;
  render(nodes: GraphNodeBase[], edges: GraphEdge[], context: RenderContext): void;
  destroy(): void;
  
  // 交互
  getNodeAtPosition(x: number, y: number): string | null;
  getEdgeAtPosition(x: number, y: number): string | null;
}
```

**Step 2: 实现节点渲染器 (参考 flowsint node-renderer.ts)**

```typescript
// visualization/node-renderer.ts
import { GraphNodeBase } from '../types';
import { RenderContext } from './renderer';
import { typeRegistry } from '../registry/registry';

// 图标缓存
const iconCache = new Map<string, HTMLImageElement>();

export function renderNode(
  ctx: CanvasRenderingContext2D,
  node: GraphNodeBase,
  context: RenderContext
) {
  const { zoom, selectedNodes, hoveredNode } = context;
  const isSelected = selectedNodes.has(node.id);
  const isHovered = hoveredNode === node.id;
  const registration = typeRegistry.get(node.nodeType);
  
  const x = node.x || 0;
  const y = node.y || 0;
  const radius = node.nodeSize || 20;
  const color = node.nodeColor || registration?.color || '#6b7280';

  // 计算缩放后的大小
  const scaledRadius = radius * Math.min(zoom, 2);

  ctx.save();
  ctx.translate(x, y);

  // 绘制形状
  switch (node.nodeShape || registration?.shape || 'circle') {
    case 'circle':
      drawCircle(ctx, scaledRadius, color, isSelected, isHovered);
      break;
    case 'square':
      drawSquare(ctx, scaledRadius, color, isSelected, isHovered);
      break;
    case 'hexagon':
      drawHexagon(ctx, scaledRadius, color, isSelected, isHovered);
      break;
    case 'diamond':
      drawDiamond(ctx, scaledRadius, color, isSelected, isHovered);
      break;
  }

  // 绘制图标 (缩放 > 0.5 时显示)
  if (zoom > 0.5) {
    const icon = node.nodeIcon || registration?.icon;
    if (icon) {
      drawIcon(ctx, icon, scaledRadius * 0.6);
    }
  }

  // 绘制标签 (缩放 > 1 时显示)
  if (zoom > 1) {
    drawLabel(ctx, node.nodeLabel, scaledRadius, zoom);
  }

  ctx.restore();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  radius: number,
  color: string,
  isSelected: boolean,
  isHovered: boolean
) {
  // 阴影
  if (isSelected || isHovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = isSelected ? 20 : 10;
  }

  // 填充
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 边框
  if (isSelected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
}

function drawIcon(ctx: CanvasRenderingContext2D, iconName: string, size: number) {
  // 从缓存获取或加载图标
  let img = iconCache.get(iconName);
  if (!img) {
    img = new Image();
    img.src = `/icons/${iconName}.svg`;
    iconCache.set(iconName, img);
  }

  if (img.complete) {
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, label: string, radius: number, zoom: number) {
  const fontSize = Math.max(10, 12 / zoom);
  ctx.font = `${fontSize}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  
  // 背景
  const metrics = ctx.measureText(label);
  const padding = 4;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(
    -metrics.width / 2 - padding,
    radius + 4,
    metrics.width + padding * 2,
    fontSize + padding
  );

  // 文字
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 0, radius + 6);
}
```

**Step 3: 实现边渲染器 (参考 flowsint link-renderer.ts)**

```typescript
// visualization/edge-renderer.ts
import { GraphNodeBase, GraphEdge } from '../types';
import { RenderContext } from './renderer';

export function renderEdge(
  ctx: CanvasRenderingContext2D,
  edge: GraphEdge,
  sourceNode: GraphNodeBase,
  targetNode: GraphNodeBase,
  context: RenderContext
) {
  const { zoom, selectedNodes } = context;
  const isHighlighted = selectedNodes.has(sourceNode.id) || selectedNodes.has(targetNode.id);
  
  const sx = sourceNode.x || 0;
  const sy = sourceNode.y || 0;
  const tx = targetNode.x || 0;
  const ty = targetNode.y || 0;

  // 计算贝塞尔曲线控制点 (防止重叠)
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = 0.2;
  const mx = (sx + tx) / 2 + dy * curvature;
  const my = (sy + ty) / 2 - dx * curvature;

  ctx.save();

  // 边样式
  ctx.strokeStyle = isHighlighted ? '#3b82f6' : '#94a3b8';
  ctx.lineWidth = isHighlighted ? 2 : 1;
  ctx.globalAlpha = isHighlighted ? 1 : 0.6;

  // 绘制贝塞尔曲线
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(mx, my, tx, ty);
  ctx.stroke();

  // 绘制箭头
  if (zoom > 0.5) {
    drawArrowhead(ctx, mx, my, tx, ty, 8);
  }

  // 绘制标签 (高亮时显示)
  if (isHighlighted && zoom > 1 && edge.label) {
    drawEdgeLabel(ctx, edge.label, mx, my);
  }

  ctx.restore();
}

function drawArrowhead(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - size * Math.cos(angle - Math.PI / 6),
    toY - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - size * Math.cos(angle + Math.PI / 6),
    toY - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}
```

---

#### Task 2.2: 实现 Web Workers

**Objective:** 将计算密集型任务移到 Worker 线程

**Files:**
- Create: `src/app/core/main/knowledge/visualization/workers/layout.worker.ts`
- Create: `src/app/core/main/knowledge/visualization/workers/pathfinder.worker.ts`

**Step 1: 布局 Worker (使用 dagre)**

```typescript
// visualization/workers/layout.worker.ts
import dagre from '@dagrejs/dagre';

interface LayoutMessage {
  type: 'layout';
  nodes: { id: string; width: number; height: number }[];
  edges: { source: string; target: string }[];
  options?: {
    direction?: 'TB' | 'LR' | 'BT' | 'RL';
    ranksep?: number;
    nodesep?: number;
  };
}

interface LayoutResult {
  type: 'layout-result';
  positions: Map<string, { x: number; y: number }>;
}

self.onmessage = (e: MessageEvent<LayoutMessage>) => {
  if (e.data.type === 'layout') {
    const { nodes, edges, options } = e.data;
    
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: options?.direction || 'TB',
      ranksep: options?.ranksep || 50,
      nodesep: options?.nodesep || 50,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // 添加节点
    for (const node of nodes) {
      g.setNode(node.id, { width: node.width, height: node.height });
    }

    // 添加边
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    // 执行布局
    dagre.layout(g);

    // 收集结果
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      const pos = g.node(node.id);
      positions.set(node.id, { x: pos.x, y: pos.y });
    }

    const result: LayoutResult = { type: 'layout-result', positions };
    self.postMessage(result);
  }
};
```

**Step 2: 路径查找 Worker**

```typescript
// visualization/workers/pathfinder.worker.ts
interface PathMessage {
  type: 'find-path';
  adjacency: Map<string, string[]>; // 邻接表
  source: string;
  target: string;
  maxDepth?: number;
}

interface PathResult {
  type: 'path-result';
  path: string[];
  found: boolean;
}

self.onmessage = (e: MessageEvent<PathMessage>) => {
  if (e.data.type === 'find-path') {
    const { adjacency, source, target, maxDepth = 4 } = e.data;
    
    // BFS 最短路径
    const visited = new Map<string, string | null>();
    const queue: { id: string; depth: number }[] = [{ id: source, depth: 0 }];
    visited.set(source, null);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      
      if (id === target) {
        // 回溯路径
        const path: string[] = [];
        let node: string | null = target;
        while (node !== null) {
          path.unshift(node);
          node = visited.get(node) || null;
        }
        
        self.postMessage({ type: 'path-result', path, found: true } as PathResult);
        return;
      }

      if (depth >= maxDepth) continue;

      const neighbors = adjacency.get(id) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.set(neighbor, id);
          queue.push({ id: neighbor, depth: depth + 1 });
        }
      }
    }

    self.postMessage({ type: 'path-result', path: [], found: false } as PathResult);
  }
};
```

---

### Phase 3: React 组件重构 (第7-9天)

#### Task 3.1: 创建 Zustand Store

**Objective:** 实现集中状态管理

**Files:**
- Create: `src/app/core/main/knowledge/graph/store.ts`

```typescript
// graph/store.ts
import { create } from 'zustand';
import { GraphNodeBase, GraphEdge, GraphFilters } from '../types';
import { GraphService } from './service';
import { SQLiteGraphRepository } from './sqlite-repository';

interface GraphState {
  // 数据
  nodes: GraphNodeBase[];
  edges: GraphEdge[];
  filteredNodes: GraphNodeBase[];
  filteredEdges: GraphEdge[];
  
  // 索引
  nodesMapping: Map<string, GraphNodeBase>;
  edgesMapping: Map<string, GraphEdge>;
  
  // 选择状态
  selectedNodes: Set<string>;
  selectedEdges: Set<string>;
  currentNode: GraphNodeBase | null;
  currentEdge: GraphEdge | null;
  hoveredNode: string | null;
  
  // 视图状态
  zoom: number;
  panX: number;
  panY: number;
  filters: GraphFilters;
  
  // UI 状态
  showDetailPanel: boolean;
  showSearchDialog: boolean;
  showSettingsPanel: boolean;
  
  // 服务
  service: GraphService;
  
  // Actions
  loadGraph: () => Promise<void>;
  createNode: (type: string, data: any) => Promise<void>;
  createEdge: (source: string, target: string, type: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setFilters: (filters: Partial<GraphFilters>) => void;
  toggleDetailPanel: () => void;
  toggleSearchDialog: () => void;
  toggleSettingsPanel: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => {
  const repository = new SQLiteGraphRepository();
  const service = new GraphService(repository);

  return {
    // 初始状态
    nodes: [],
    edges: [],
    filteredNodes: [],
    filteredEdges: [],
    nodesMapping: new Map(),
    edgesMapping: new Map(),
    selectedNodes: new Set(),
    selectedEdges: new Set(),
    currentNode: null,
    currentEdge: null,
    hoveredNode: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    filters: {},
    showDetailPanel: false,
    showSearchDialog: false,
    showSettingsPanel: false,
    service,

    // Actions
    loadGraph: async () => {
      const { nodes, edges } = await service.getGraph(get().filters);
      
      const nodesMapping = new Map(nodes.map(n => [n.id, n]));
      const edgesMapping = new Map(edges.map(e => [e.id, e]));
      
      set({
        nodes,
        edges,
        filteredNodes: nodes,
        filteredEdges: edges,
        nodesMapping,
        edgesMapping,
      });
    },

    createNode: async (type, data) => {
      const node = await service.createNode(type, data);
      set(state => ({
        nodes: [...state.nodes, node],
        filteredNodes: [...state.filteredNodes, node],
        nodesMapping: new Map(state.nodesMapping).set(node.id, node),
      }));
    },

    createEdge: async (source, target, type) => {
      const edge = await service.createRelation(source, target, type);
      set(state => ({
        edges: [...state.edges, edge],
        filteredEdges: [...state.filteredEdges, edge],
        edgesMapping: new Map(state.edgesMapping).set(edge.id, edge),
      }));
    },

    deleteNode: async (id) => {
      await service.repository.deleteNode(id);
      set(state => {
        const newNodes = state.nodes.filter(n => n.id !== id);
        const newEdges = state.edges.filter(e => e.source !== id && e.target !== id);
        const newNodesMapping = new Map(state.nodesMapping);
        newNodesMapping.delete(id);
        return {
          nodes: newNodes,
          edges: newEdges,
          filteredNodes: newNodes,
          filteredEdges: newEdges,
          nodesMapping: newNodesMapping,
          currentNode: state.currentNode?.id === id ? null : state.currentNode,
          selectedNodes: new Set([...state.selectedNodes].filter(n => n !== id)),
        };
      });
    },

    deleteEdge: async (id) => {
      await service.repository.deleteEdge(id);
      set(state => ({
        edges: state.edges.filter(e => e.id !== id),
        filteredEdges: state.filteredEdges.filter(e => e.id !== id),
        edgesMapping: (() => {
          const m = new Map(state.edgesMapping);
          m.delete(id);
          return m;
        })(),
        currentEdge: state.currentEdge?.id === id ? null : state.currentEdge,
      }));
    },

    selectNode: (id) => {
      set({
        selectedNodes: id ? new Set([id]) : new Set(),
        currentNode: id ? get().nodesMapping.get(id) || null : null,
        showDetailPanel: !!id,
      });
    },

    selectEdge: (id) => {
      set({
        selectedEdges: id ? new Set([id]) : new Set(),
        currentEdge: id ? get().edgesMapping.get(id) || null : null,
      });
    },

    setHoveredNode: (id) => set({ hoveredNode: id }),
    setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
    setPan: (x, y) => set({ panX: x, panY: y }),
    
    setFilters: (filters) => {
      const newFilters = { ...get().filters, ...filters };
      set({ filters: newFilters });
      // 重新过滤
      const { nodes, edges } = get();
      const filteredNodes = filterNodes(nodes, newFilters);
      const filteredEdges = filterEdges(edges, filteredNodes);
      set({ filteredNodes, filteredEdges });
    },

    toggleDetailPanel: () => set(state => ({ showDetailPanel: !state.showDetailPanel })),
    toggleSearchDialog: () => set(state => ({ showSearchDialog: !state.showSearchDialog })),
    toggleSettingsPanel: () => set(state => ({ showSettingsPanel: !state.showSettingsPanel })),
  };
});

// 辅助函数
function filterNodes(nodes: GraphNodeBase[], filters: GraphFilters): GraphNodeBase[] {
  return nodes.filter(node => {
    if (filters.types?.length && !filters.types.includes(node.nodeType)) return false;
    if (filters.search && !node.nodeLabel.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.hasEdges) {
      // 需要边数据来判断，这里简化处理
    }
    return true;
  });
}

function filterEdges(edges: GraphEdge[], filteredNodes: GraphNodeBase[]): GraphEdge[] {
  const nodeIds = new Set(filteredNodes.map(n => n.id));
  return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
}
```

---

#### Task 3.2: 重构图组件

**Objective:** 将单体组件拆分为多个小组件

**Files:**
- Create: `src/app/core/main/knowledge/components/graph-canvas.tsx`
- Create: `src/app/core/main/knowledge/components/toolbar.tsx`
- Create: `src/app/core/main/knowledge/components/detail-panel.tsx`
- Create: `src/app/core/main/knowledge/components/search-dialog.tsx`
- Modify: `src/app/core/main/knowledge/knowledge-graph.tsx` (重写)

**Step 1: 创建 GraphCanvas 组件**

```typescript
// components/graph-canvas.tsx
'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../graph/store';
import { GraphRenderer, RenderContext } from '../visualization/renderer';
import { CanvasGraphRenderer } from '../visualization/canvas-renderer';

interface GraphCanvasProps {
  width: number;
  height: number;
}

export function GraphCanvas({ width, height }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const animationFrameRef = useRef<number>(0);
  
  const {
    filteredNodes,
    filteredEdges,
    selectedNodes,
    hoveredNode,
    zoom,
    panX,
    panY,
    selectNode,
    setHoveredNode,
    setZoom,
    setPan,
  } = useGraphStore();

  // 初始化渲染器
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const renderer = new CanvasGraphRenderer();
    renderer.init(canvasRef.current);
    rendererRef.current = renderer;

    return () => {
      renderer.destroy();
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // 渲染循环
  useEffect(() => {
    const render = () => {
      if (!canvasRef.current || !rendererRef.current) return;
      
      const context: RenderContext = {
        ctx: canvasRef.current.getContext('2d')!,
        width,
        height,
        zoom,
        panX,
        panY,
        selectedNodes,
        hoveredNode,
        time: Date.now(),
      };

      rendererRef.current.render(filteredNodes, filteredEdges, context);
      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [filteredNodes, filteredEdges, selectedNodes, hoveredNode, zoom, panX, panY, width, height]);

  // 鼠标事件处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rendererRef.current) return;

    const x = (e.clientX - rect.left - panX) / zoom;
    const y = (e.clientY - rect.top - panY) / zoom;

    const nodeId = rendererRef.current.getNodeAtPosition(x, y);
    selectNode(nodeId);
  }, [zoom, panX, panY, selectNode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rendererRef.current) return;

    const x = (e.clientX - rect.left - panX) / zoom;
    const y = (e.clientY - rect.top - panY) / zoom;

    const nodeId = rendererRef.current.getNodeAtPosition(x, y);
    setHoveredNode(nodeId);
  }, [zoom, panX, panY, setHoveredNode]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(zoom * delta);
  }, [zoom, setZoom]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onWheel={handleWheel}
      style={{ cursor: hoveredNode ? 'pointer' : 'grab' }}
    />
  );
}
```

**Step 2: 创建 Toolbar 组件**

```typescript
// components/toolbar.tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Search,
  Filter,
  Download,
  Settings,
  ZoomIn,
  ZoomOut,
  Maximize,
  Plus,
  Trash2,
} from 'lucide-react';
import { useGraphStore } from '../graph/store';

export function GraphToolbar() {
  const {
    zoom,
    setZoom,
    toggleSearchDialog,
    toggleSettingsPanel,
    selectedNodes,
    deleteNode,
  } = useGraphStore();

  return (
    <div className="absolute top-4 left-4 flex gap-2">
      <Button variant="outline" size="icon" onClick={toggleSearchDialog}>
        <Search className="h-4 w-4" />
      </Button>
      
      <Button variant="outline" size="icon" onClick={() => setZoom(zoom * 1.2)}>
        <ZoomIn className="h-4 w-4" />
      </Button>
      
      <Button variant="outline" size="icon" onClick={() => setZoom(zoom * 0.8)}>
        <ZoomOut className="h-4 w-4" />
      </Button>
      
      <Button variant="outline" size="icon" onClick={() => setZoom(1)}>
        <Maximize className="h-4 w-4" />
      </Button>
      
      <Button variant="outline" size="icon" onClick={toggleSettingsPanel}>
        <Settings className="h-4 w-4" />
      </Button>
      
      {selectedNodes.size > 0 && (
        <Button
          variant="destructive"
          size="icon"
          onClick={() => {
            selectedNodes.forEach(id => deleteNode(id));
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
```

**Step 3: 创建主图组件**

```typescript
// knowledge-graph.tsx (重构后)
'use client';

import React, { useEffect, useState } from 'react';
import { useGraphStore } from './graph/store';
import { GraphCanvas } from './components/graph-canvas';
import { GraphToolbar } from './components/toolbar';
import { DetailPanel } from './components/detail-panel';
import { SearchDialog } from './components/search-dialog';
import { SettingsPanel } from './components/settings-panel';

export function KnowledgeGraph() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const { loadGraph, showDetailPanel, showSearchDialog, showSettingsPanel } = useGraphStore();

  // 加载图数据
  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // 监听窗口大小变化
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-background">
      {/* 画布 */}
      <GraphCanvas width={dimensions.width} height={dimensions.height} />
      
      {/* 工具栏 */}
      <GraphToolbar />
      
      {/* 详情面板 */}
      {showDetailPanel && (
        <div className="absolute right-0 top-0 bottom-0 w-80 border-l bg-background">
          <DetailPanel />
        </div>
      )}
      
      {/* 搜索对话框 */}
      {showSearchDialog && <SearchDialog />}
      
      {/* 设置面板 */}
      {showSettingsPanel && <SettingsPanel />}
    </div>
  );
}
```

---

### Phase 4: 功能增强 (第10-12天)

#### Task 4.1: 实现搜索和筛选

**Objective:** 添加节点搜索和高级筛选功能

**Files:**
- Create: `src/app/core/main/knowledge/components/search-dialog.tsx`
- Create: `src/app/core/main/knowledge/components/filter-panel.tsx`

```typescript
// components/search-dialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import { useGraphStore } from '../graph/store';
import { typeRegistry } from '../registry/registry';

export function SearchDialog() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const { nodes, selectNode, toggleSearchDialog } = useGraphStore();

  // 搜索
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const filtered = nodes.filter(node =>
      node.nodeLabel.toLowerCase().includes(query.toLowerCase()) ||
      node.nodeType.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 20);

    setResults(filtered);
  }, [query, nodes]);

  return (
    <Dialog open onOpenChange={toggleSearchDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>搜索节点</DialogTitle>
        </DialogHeader>
        
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="输入关键词..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <Button variant="ghost" size="icon" onClick={() => setQuery('')}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="mt-4 max-h-60 overflow-y-auto">
          {results.map(node => {
            const registration = typeRegistry.get(node.nodeType);
            return (
              <div
                key={node.id}
                className="flex items-center gap-3 p-2 hover:bg-accent rounded cursor-pointer"
                onClick={() => {
                  selectNode(node.id);
                  toggleSearchDialog();
                }}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: node.nodeColor || registration?.color }}
                />
                <span className="font-medium">{node.nodeLabel}</span>
                <span className="text-sm text-muted-foreground">
                  {registration?.label || node.nodeType}
                </span>
              </div>
            );
          })}
          
          {query && results.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              未找到匹配的节点
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

#### Task 4.2: 实现导出功能

**Objective:** 支持导出图为 PNG、SVG、JSON 格式

**Files:**
- Create: `src/app/core/main/knowledge/components/export-dialog.tsx`
- Create: `src/app/core/main/knowledge/utils/export.ts`

```typescript
// utils/export.ts
import { GraphNodeBase, GraphEdge } from '../types';

export function exportToJSON(nodes: GraphNodeBase[], edges: GraphEdge[]): string {
  return JSON.stringify({ nodes, edges }, null, 2);
}

export function exportToPNG(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

export function exportToSVG(nodes: GraphNodeBase[], edges: GraphEdge[], width: number, height: number): string {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  
  // 绘制边
  for (const edge of edges) {
    const source = nodes.find(n => n.id === edge.source);
    const target = nodes.find(n => n.id === edge.target);
    if (!source || !target) continue;
    
    svg += `<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" 
            stroke="#94a3b8" stroke-width="1" />`;
  }
  
  // 绘制节点
  for (const node of nodes) {
    svg += `<circle cx="${node.x}" cy="${node.y}" r="${node.nodeSize || 20}" 
            fill="${node.nodeColor || '#6b7280'}" />`;
    svg += `<text x="${node.x}" y="${node.y + (node.nodeSize || 20) + 15}" 
            text-anchor="middle" font-size="12">${node.nodeLabel}</text>`;
  }
  
  svg += '</svg>';
  return svg;
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

### Phase 5: 性能优化 (第13-15天)

#### Task 5.1: 优化碰撞检测

**Objective:** 将 O(n²) 碰撞检测优化为 O(n log n)

**Files:**
- Modify: `src/app/core/main/knowledge/visualization/canvas-renderer.ts`

```typescript
// 使用四叉树优化碰撞检测
import { QuadTree, Rectangle, Point } from '../utils/quadtree';

export class OptimizedCanvasGraphRenderer implements GraphRenderer {
  private quadTree: QuadTree | null = null;

  render(nodes: GraphNodeBase[], edges: GraphEdge[], context: RenderContext) {
    // 构建四叉树
    this.quadTree = new QuadTree(
      new Rectangle(0, 0, context.width, context.height),
      4 // 每个节点最多存储4个点
    );

    for (const node of nodes) {
      if (node.x !== undefined && node.y !== undefined) {
        this.quadTree.insert({ x: node.x, y: node.y, data: node });
      }
    }

    // 使用四叉树进行碰撞检测
    // ...
  }

  getNodeAtPosition(x: number, y: number): string | null {
    if (!this.quadTree) return null;

    const range = new Rectangle(x - 20, y - 20, 40, 40);
    const candidates = this.quadTree.query(range);

    for (const candidate of candidates) {
      const node = candidate.data as GraphNodeBase;
      const dx = x - (node.x || 0);
      const dy = y - (node.y || 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < (node.nodeSize || 20)) {
        return node.id;
      }
    }

    return null;
  }
}
```

---

#### Task 5.2: 实现增量更新

**Objective:** 避免每次渲染都重新绘制整个图

**Files:**
- Modify: `src/app/core/main/knowledge/visualization/canvas-renderer.ts`

```typescript
export class IncrementalCanvasGraphRenderer implements GraphRenderer {
  private dirtyNodes = new Set<string>();
  private dirtyEdges = new Set<string>();
  private lastRenderTime = 0;

  markNodeDirty(nodeId: string) {
    this.dirtyNodes.add(nodeId);
  }

  markEdgeDirty(edgeId: string) {
    this.dirtyEdges.add(edgeId);
  }

  render(nodes: GraphNodeBase[], edges: GraphEdge[], context: RenderContext) {
    const now = Date.now();
    const deltaTime = now - this.lastRenderTime;
    
    // 如果脏节点/边太多，全量重绘
    if (this.dirtyNodes.size > nodes.length * 0.3) {
      this.fullRender(nodes, edges, context);
    } else {
      this.incrementalRender(nodes, edges, context);
    }
    
    this.lastRenderTime = now;
    this.dirtyNodes.clear();
    this.dirtyEdges.clear();
  }

  private incrementalRender(nodes: GraphNodeBase[], edges: GraphEdge[], context: RenderContext) {
    // 只重绘脏节点和相关的边
    // ...
  }

  private fullRender(nodes: GraphNodeBase[], edges: GraphEdge[], context: RenderContext) {
    // 全量重绘
    // ...
  }
}
```

---

## 四、测试验证

### 单元测试

```typescript
// graph/__tests__/service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphService } from '../service';
import { InMemoryGraphRepository } from '../memory-repository';

describe('GraphService', () => {
  let service: GraphService;
  let repository: InMemoryGraphRepository;

  beforeEach(() => {
    repository = new InMemoryGraphRepository();
    service = new GraphService(repository);
  });

  it('should create a node', async () => {
    const node = await service.createNode('note', { title: 'Test Note' });
    expect(node).toBeDefined();
    expect(node.nodeType).toBe('note');
    expect(node.nodeLabel).toBe('Test Note');
  });

  it('should create a relation', async () => {
    const node1 = await service.createNode('note', { title: 'Note 1' });
    const node2 = await service.createNode('note', { title: 'Note 2' });
    
    const edge = await service.createRelation(node1.id, node2.id, 'references');
    expect(edge).toBeDefined();
    expect(edge.source).toBe(node1.id);
    expect(edge.target).toBe(node2.id);
  });

  it('should find path between nodes', async () => {
    const node1 = await service.createNode('note', { title: 'Note 1' });
    const node2 = await service.createNode('note', { title: 'Note 2' });
    const node3 = await service.createNode('note', { title: 'Note 3' });
    
    await service.createRelation(node1.id, node2.id, 'references');
    await service.createRelation(node2.id, node3.id, 'references');
    
    const path = await service.findPath(node1.id, node3.id);
    expect(path).toEqual([node1.id, node2.id, node3.id]);
  });
});
```

### 集成测试

```bash
# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 构建验证
pnpm build
```

---

## 五、迁移指南

### 从旧代码迁移

1. **数据迁移脚本**

```typescript
// scripts/migrate-knowledge-graph.ts
import { useGraphStore } from '../src/app/core/main/knowledge/graph/store';
import { typeRegistry } from '../src/app/core/main/knowledge/registry/registry';

async function migrateOldGraph() {
  // 1. 读取旧的 localStorage 数据
  const oldData = localStorage.getItem('knowledge-graph-layout-cache-v5');
  if (!oldData) return;

  const oldNodes = JSON.parse(oldData);
  
  // 2. 转换为新格式
  const newNodes = oldNodes.map((old: any) => ({
    id: old.id,
    nodeType: 'note',
    nodeLabel: old.label,
    nodeColor: old.color,
    nodeProperties: {},
    nodeMetadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    x: old.x,
    y: old.y,
  }));

  // 3. 批量导入
  const store = useGraphStore.getState();
  await store.service.batchCreateNodes(newNodes);
  
  console.log(`Migrated ${newNodes.length} nodes`);
}
```

2. **渐进式迁移策略**

```typescript
// 使用 feature flag 控制新旧版本
const USE_NEW_GRAPH = process.env.NEXT_PUBLIC_USE_NEW_GRAPH === 'true';

export function KnowledgeGraphPage() {
  if (USE_NEW_GRAPH) {
    return <NewKnowledgeGraph />;
  }
  return <OldKnowledgeGraph />;
}
```

---

## 六、预期效果

| 指标 | 旧版本 | 新版本 | 提升 |
|------|--------|--------|------|
| 代码行数 | 2279行单文件 | ~15个文件，平均150行 | 可维护性 ↑ |
| 碰撞检测 | O(n²) | O(n log n) | 性能 ↑ |
| 节点类型 | 4种 | 10+种(可扩展) | 灵活性 ↑ |
| 搜索功能 | 无 | 实时搜索 | UX ↑ |
| 导出功能 | 无 | PNG/SVG/JSON | 功能 ↑ |
| 测试覆盖 | 0% | 80%+ | 质量 ↑ |
| 类型安全 | 部分 | 完全 | 可靠性 ↑ |

---

## 七、风险与注意事项

1. **兼容性**: 确保新版本能读取旧的 localStorage 数据
2. **性能**: 大图(>1000节点)需要启用 WebGL 渲染
3. **测试**: 每个阶段都要写测试，特别是 Repository 和 Service 层
4. **文档**: 及时更新 API 文档和使用指南
5. **渐进式**: 使用 feature flag 控制新旧版本切换

---

**Plan complete. Ready to execute using subagent-driven-development.**
