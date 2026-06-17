/**
 * 知识图谱核心类型定义
 * 参考 flowsint 项目的设计，支持多种节点类型和关系类型
 */

// ==================== 节点类型 ====================

/** 节点类型枚举 */
export type NodeType = 'note' | 'concept' | 'person' | 'project' | 'tag';

/** 节点种类（用于视觉区分） */
export type NodeKind = 'current' | 'hub' | 'linked' | 'note';

/** 节点形状 */
export type NodeShape = 'circle' | 'diamond' | 'roundRect' | 'triangle' | 'pin';

/** 节点基础接口 */
export interface GraphNode {
  id: string;
  nodeType: NodeType;
  nodeLabel: string;
  nodeColor?: string;
  nodeIcon?: string;
  nodeShape?: NodeShape;
  nodeSize?: number;
  nodeImage?: string;
  nodeProperties: Record<string, any>;
  nodeMetadata: {
    createdAt: string;
    updatedAt: string;
    source?: string;
  };
  // 布局相关
  x?: number;
  y?: number;
  // 计算属性
  connections?: number;
  kind?: NodeKind;
}

/** 节点类型配置 */
export interface NodeTypeConfig {
  type: NodeType;
  label: string;
  icon: string;
  color: string;
  shape: NodeShape;
  description: string;
}

// ==================== 边类型 ====================

/** 边类型枚举 */
export type EdgeType = 'wikilink' | 'semantic' | 'references' | 'contains' | 'mentions' | 'has_tag' | 'custom';

/** 边基础接口 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: EdgeType | string;
  weight?: number;
  confidence?: number;
  caption?: string;
  metadata?: {
    createdAt: string;
    source: string;
    evidence?: string;
  };
}

/** 边样式配置 */
export interface EdgeStyleConfig {
  type: EdgeType | string;
  label: string;
  color: string;
  lineType: 'solid' | 'dashed' | 'dotted';
  width: number;
}

// ==================== 筛选和查询 ====================

/** 图谱筛选器 */
export interface GraphFilters {
  types?: NodeType[];
  search?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  minConnections?: number;
  maxConnections?: number;
  includeNoisyTopics?: boolean;
}

/** 搜索结果 */
export interface SearchResult {
  node: GraphNode;
  score: number;
  matchType: 'label' | 'property' | 'content';
}

// ==================== 图谱数据 ====================

/** 图谱完整数据 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: {
    totalNodes: number;
    totalEdges: number;
    lastUpdated: string;
  };
}

/** 邻居查询结果 */
export interface NeighborsResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerNodeId: string;
  depth: number;
}

/** 路径查询结果 */
export interface PathResult {
  path: string[];
  edges: GraphEdge[];
  found: boolean;
  hops: number;
}

// ==================== 组件 Props ====================

/** 图谱画布属性 */
export interface GraphCanvasProps {
  width: number;
  height: number;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onCanvasClick?: () => void;
}

/** 详情面板属性 */
export interface DetailPanelProps {
  nodeId: string | null;
  onClose: () => void;
  onNavigate?: (nodeId: string) => void;
}

/** 搜索对话框属性 */
export interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (nodeId: string) => void;
}

// ==================== Store 类型 ====================

/** 物理引擎配置 */
export interface PhysicsConfig {
  repulsion: number;  // 节点斥力
  gravity: number;    // 中心引力
  edgeLength: number; // 连线长度
  friction: number;   // 摩擦力/阻尼
}

/** 自定义染色规则 */
export interface ColorGroup {
  id: string;
  query: string;
  color: string;
}

/** 图谱状态 */
export interface GraphState {
  // 数据
  nodes: GraphNode[];
  edges: GraphEdge[];
  filteredNodes: GraphNode[];
  filteredEdges: GraphEdge[];
  
  // 索引
  nodesMapping: Map<string, GraphNode>;
  edgesMapping: Map<string, GraphEdge>;
  
  // 选择状态
  selectedNode: string | null;
  selectedEdge: string | null;
  hoveredNode: string | null;
  
  // 视图状态
  zoom: number;
  panX: number;
  panY: number;
  filters: GraphFilters;
  
  // UI 状态
  showDetailPanel: boolean;
  showSearchDialog: boolean;
  showFilterPanel: boolean;
  showExportDialog: boolean;
  isLoading: boolean;
  error: string | null;

  // 物理与染色状态
  physics: PhysicsConfig;
  colorGroups: ColorGroup[];

  // 局部图谱状态
  graphMode: 'global' | 'local';
  graphView: 'topic' | 'note';
}

/** 图谱 Actions */
export interface GraphActions {
  // 数据加载
  loadGraph: () => Promise<void>;
  loadNeighbors: (nodeId: string, depth?: number) => Promise<void>;
  
  // 节点操作
  createNode: (type: NodeType, data: Partial<GraphNode>) => Promise<void>;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  
  // 边操作
  createEdge: (source: string, target: string, type: EdgeType) => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;
  
  // 选择和交互
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  setHoveredNode: (nodeId: string | null) => void;
  getNodeById: (nodeId: string | null) => GraphNode | undefined;
  
  // 视图控制
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  fitView: () => void;
  
  // 物理与染色控制
  setPhysics: (physics: Partial<PhysicsConfig>) => void;
  addColorGroup: (query: string, color: string) => void;
  removeColorGroup: (id: string) => void;
  updateColorGroup: (id: string, updates: Partial<Omit<ColorGroup, 'id'>>) => void;
  
  // 局部图谱控制
  setGraphMode: (mode: 'global' | 'local') => void;
  setGraphView: (view: 'topic' | 'note') => void;
  
  // 筛选和搜索
  setFilters: (filters: Partial<GraphFilters>) => void;
  searchNodes: (query: string) => Promise<void>;
  
  // UI 控制
  toggleDetailPanel: () => void;
  toggleSearchDialog: () => void;
  toggleFilterPanel: () => void;
  toggleExportDialog: () => void;
  clearError: () => void;
}

// ==================== 导出类型 ====================

/** 导出格式 */
export type ExportFormat = 'png' | 'svg' | 'json';

/** 导出选项 */
export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  quality?: number;
  includeBackground?: boolean;
}
