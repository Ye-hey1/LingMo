/**
 * 知识图谱常量定义
 * 包含节点类型配置、边类型配置、默认值等
 */

import type { NodeType, NodeTypeConfig, EdgeStyleConfig } from './types';

// ==================== 节点类型配置 ====================

/** 节点类型注册表 */
export const NODE_TYPE_CONFIGS: Record<NodeType, NodeTypeConfig> = {
  note: {
    type: 'note',
    label: '笔记',
    icon: 'FileText',
    color: '#3b82f6',
    shape: 'circle',
    description: 'Markdown 笔记文档',
  },
  concept: {
    type: 'concept',
    label: '概念',
    icon: 'Lightbulb',
    color: '#10b981',
    shape: 'diamond',
    description: '从笔记中提取的关键概念',
  },
  person: {
    type: 'person',
    label: '人物',
    icon: 'User',
    color: '#f59e0b',
    shape: 'roundRect',
    description: '提及的人物或作者',
  },
  project: {
    type: 'project',
    label: '项目',
    icon: 'FolderGit2',
    color: '#8b5cf6',
    shape: 'triangle',
    description: '项目或工作流',
  },
  tag: {
    type: 'tag',
    label: '标签',
    icon: 'Tag',
    color: '#ec4899',
    shape: 'pin',
    description: '分类标签',
  },
};

/** ECharts 分类配置 */
export const ECHARTS_CATEGORIES = Object.values(NODE_TYPE_CONFIGS).map((config, _index) => ({
  name: config.label,
  itemStyle: {
    color: config.color,
  },
  symbol: config.shape === 'roundRect' ? 'roundRect' : config.shape,
}));

/** 节点类型颜色映射 */
export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  note: '#3b82f6',
  concept: '#10b981',
  person: '#f59e0b',
  project: '#8b5cf6',
  tag: '#ec4899',
};

// ==================== 边类型配置 ====================

/** 边类型样式配置 */
export const EDGE_STYLE_CONFIGS: Record<string, EdgeStyleConfig> = {
  wikilink: {
    type: 'wikilink',
    label: 'Wiki链接',
    color: '#3b82f6',
    lineType: 'solid',
    width: 2,
  },
  semantic: {
    type: 'semantic',
    label: '语义关联',
    color: '#10b981',
    lineType: 'dashed',
    width: 1.5,
  },
  references: {
    type: 'references',
    label: '引用',
    color: '#f59e0b',
    lineType: 'solid',
    width: 1,
  },
  contains: {
    type: 'contains',
    label: '包含',
    color: '#8b5cf6',
    lineType: 'solid',
    width: 1,
  },
  mentions: {
    type: 'mentions',
    label: '提及',
    color: '#ec4899',
    lineType: 'dotted',
    width: 1,
  },
  has_tag: {
    type: 'has_tag',
    label: '标签',
    color: '#6b7280',
    lineType: 'dashed',
    width: 1,
  },
};

/** 默认边样式 */
export const DEFAULT_EDGE_STYLE: EdgeStyleConfig = {
  type: 'custom',
  label: '关联',
  color: '#94a3b8',
  lineType: 'solid',
  width: 1,
};

// ==================== 力导向布局配置 ====================

/** ECharts 力导向布局参数 */
export const FORCE_LAYOUT_CONFIG = {
  repulsion: 200,           // 斥力系数
  gravity: 0.1,             // 引力系数
  edgeLength: 150,          // 边长度
  friction: 0.6,            // 摩擦力
  layoutAnimation: true,    // 布局动画
  edgeLengthVariation: 0.5, // 边长度变化
};

// ==================== 视觉配置 ====================

/** 节点大小配置 */
export const NODE_SIZE_CONFIG = {
  min: 20,
  max: 60,
  default: 30,
  hubThreshold: 4,        // 连接数 >= 4 视为中心节点
  hubSizeBonus: 15,       // 中心节点额外大小
};

/** 缩放配置 */
export const ZOOM_CONFIG = {
  min: 0.3,
  max: 5,
  default: 1,
  step: 0.1,
};

/** 标签显示阈值 */
export const LABEL_VISIBILITY = {
  showThreshold: 0.8,     // 缩放 > 0.8 时显示标签
  hideOverlap: true,      // 隐藏重叠标签
};

// ==================== 颜色配置 ====================

/** 图谱主题颜色 */
export const GRAPH_THEME = {
  background: 'transparent',
  nodeBorder: '#ffffff',
  selectedBorder: '#ffffff',
  selectedGlow: 'rgba(59, 130, 246, 0.5)',
  hoverGlow: 'rgba(255, 255, 255, 0.3)',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  edgeDefault: '#94a3b8',
  edgeHighlight: '#3b82f6',
  edgeBlur: 'rgba(148, 163, 184, 0.2)',
};

// ==================== 工具栏配置 ====================

/** 工具栏按钮 ID */
export const TOOLBAR_BUTTONS = {
  SEARCH: 'search',
  ZOOM_IN: 'zoom-in',
  ZOOM_OUT: 'zoom-out',
  FIT_VIEW: 'fit-view',
  FILTER: 'filter',
  EXPORT: 'export',
  SETTINGS: 'settings',
  DELETE: 'delete',
} as const;

// ==================== 快捷键配置 ====================

/** 快捷键映射 */
export const KEYBOARD_SHORTCUTS = {
  SEARCH: { key: '/', ctrl: true, label: '搜索' },
  DELETE: { key: 'Delete', ctrl: false, label: '删除选中' },
  FIT_VIEW: { key: '0', ctrl: true, label: '适应视图' },
  ZOOM_IN: { key: '=', ctrl: true, label: '放大' },
  ZOOM_OUT: { key: '-', ctrl: true, label: '缩小' },
  ESCAPE: { key: 'Escape', ctrl: false, label: '取消选择' },
};

// ==================== 默认值 ====================

/** 默认筛选器 */
export const DEFAULT_FILTERS: import('./types').GraphFilters = {
  types: undefined,
  search: '',
  minConnections: undefined,
  maxConnections: undefined,
};

/** 默认图谱数据 */
export const EMPTY_GRAPH_DATA: import('./types').GraphData = {
  nodes: [],
  edges: [],
  metadata: {
    totalNodes: 0,
    totalEdges: 0,
    lastUpdated: new Date().toISOString(),
  },
};

// ==================== Tab 配置 ====================

/** 知识图谱 Tab 常量 */
export const KNOWLEDGE_GRAPH_TAB = {
  id: 'knowledge-graph',
  path: '/core/knowledge/graph',
  name: '知识图谱',
};
