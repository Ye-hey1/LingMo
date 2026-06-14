/**
 * 知识图谱模块入口
 * 统一导出所有组件、类型、常量
 */

// ==================== 类型导出 ====================
export type {
  NodeType,
  NodeKind,
  NodeShape,
  GraphNode,
  NodeTypeConfig,
  EdgeType,
  GraphEdge,
  EdgeStyleConfig,
  GraphFilters,
  SearchResult,
  GraphData,
  NeighborsResult,
  PathResult,
  GraphCanvasProps,
  DetailPanelProps,
  SearchDialogProps,
  GraphState,
  GraphActions,
  ExportFormat,
  ExportOptions,
} from './types';

// ==================== 常量导出 ====================
export {
  NODE_TYPE_CONFIGS,
  ECHARTS_CATEGORIES,
  NODE_TYPE_COLORS,
  EDGE_STYLE_CONFIGS,
  DEFAULT_EDGE_STYLE,
  FORCE_LAYOUT_CONFIG,
  NODE_SIZE_CONFIG,
  ZOOM_CONFIG,
  LABEL_VISIBILITY,
  GRAPH_THEME,
  TOOLBAR_BUTTONS,
  KEYBOARD_SHORTCUTS,
  DEFAULT_FILTERS,
  EMPTY_GRAPH_DATA,
  KNOWLEDGE_GRAPH_TAB,
} from './constants';

// ==================== Store 导出 ====================
export { useGraphStore } from './store/graph-store';

// ==================== 组件导出 ====================
export { EChartsGraph } from './components/echarts-graph';
export { GraphToolbar } from './components/toolbar';
export { DetailPanel } from './components/detail-panel';
export { SearchDialog } from './components/search-dialog';
export { FilterPanel } from './components/filter-panel';
export { ExportDialog } from './components/export-dialog';
export { NodeDetailPopup } from './components/node-detail-popup';

// ==================== 主页面导出 ====================
export { KnowledgeGraphECharts, default } from './knowledge-graph-echarts';
