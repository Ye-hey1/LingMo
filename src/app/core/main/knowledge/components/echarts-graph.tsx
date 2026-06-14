'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore, type GraphNode, type GraphEdge } from '../store/graph-store';
import { useInertialDrag } from '../hooks/use-inertial-drag';
import { NodeDetailPopup } from './node-detail-popup';

interface EChartsGraphProps {
  width: number;
  height: number;
  layoutMode?: 'force' | 'circular' | 'tree' | 'radial';
}

interface EChartsEventParams {
  dataType?: 'node' | 'edge';
  data?: {
    id?: string;
    nodeData?: GraphNode;
    edgeData?: GraphEdge;
  };
  name?: string;
}

interface GraphTheme {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  surface: string;
  primary: string;
  accent: string;
}

interface GraphLayoutPosition {
  x: number;
  y: number;
  fixed?: boolean;
}

export type LayoutMode = 'force' | 'circular' | 'tree' | 'radial';

const CATEGORIES = [
  { name: '核心笔记', itemStyle: { color: '#d97706' } },
  { name: '关联笔记', itemStyle: { color: '#2563eb' } },
  { name: '普通笔记', itemStyle: { color: '#94a3b8' } },
  { name: '概念', itemStyle: { color: '#059669' } },
  { name: '人物', itemStyle: { color: '#ea580c' } },
  { name: '项目', itemStyle: { color: '#7c3aed' } },
  { name: '标签', itemStyle: { color: '#db2777' } },
];

const _CATEGORY_INDEX = new Map(CATEGORIES.map((category, index) => [category.name, index]));

const NODE_ROLE_COLORS: Record<string, string> = {
  current: '#d97706',
  hub: '#ea580c',
  linked: '#2563eb',
  note: '#94a3b8',
  concept: '#059669',
  person: '#ea580c',
  project: '#7c3aed',
  tag: '#db2777',
};

const VOS_PALETTE = [
  '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed',
  '#4f46e5', '#2563eb', '#0284c7', '#0891b2', '#0f766e',
  '#059669', '#16a34a', '#65a30d', '#ca8a04', '#d97706', '#ea580c',
];

const NODE_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  concept: '概念',
  person: '人物',
  project: '项目',
  tag: '标签',
};

const _NODE_TYPE_ICONS: Record<string, string> = {
  note: 'path://M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
  concept: 'path://M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  person: 'path://M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
  project: 'path://M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  tag: 'path://M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z',
};

const SHAPE_MAP: Record<string, string> = {
  note: 'circle',
  concept: 'diamond',
  person: 'roundRect',
  project: 'triangle',
  tag: 'pin',
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const EDGE_STYLE_MAP: Record<string, { label: string; color: string; type: string; width: number }> = {
  wikilink: { label: '双链', color: '#64748b', type: 'solid', width: 1.25 },
  semantic: { label: '语义关联', color: '#059669', type: 'dashed', width: 1.15 },
  references: { label: '引用', color: '#d97706', type: 'solid', width: 1 },
  contains: { label: '包含', color: '#7c3aed', type: 'solid', width: 1 },
  mentions: { label: '提及', color: '#be185d', type: 'dotted', width: 1 },
  'topic-cooccurrence': { label: '主题共现', color: '#94a3b8', type: 'solid', width: 0.75 },
  'topic-semantic': { label: '主题语义', color: '#64748b', type: 'solid', width: 0.9 },
  'rag-vector': { label: 'RAG 向量相似', color: '#0f766e', type: 'solid', width: 1.05 },
};

function cssColor(variable: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `hsl(${value})` : fallback;
}

function readTheme(): GraphTheme {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return {
    background: cssColor('--background', dark ? '#0a0a0a' : '#ffffff'),
    foreground: cssColor('--foreground', dark ? '#fafafa' : '#0a0a0a'),
    muted: cssColor('--muted', dark ? '#1c1c1c' : '#f5f5f5'),
    mutedForeground: cssColor('--muted-foreground', dark ? '#9a9a9a' : '#737373'),
    border: cssColor('--border', dark ? '#1c1c1c' : '#e5e5e5'),
    surface: cssColor('--card', dark ? '#0a0a0a' : '#ffffff'),
    primary: cssColor('--primary', dark ? '#3b82f6' : '#2563eb'),
    accent: cssColor('--accent', dark ? '#1e40af' : '#dbeafe'),
  };
}

function hashString(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getHashColor(id: string) {
  return VOS_PALETTE[hashString(id) % VOS_PALETTE.length];
}

function withAlpha(hex: string, alpha: number) {
  const cleanHex = hex.replace('#', '');
  const value = Number.parseInt(cleanHex.length === 3 ? cleanHex.split('').map(char => char + char).join('') : cleanHex, 16);
  if (Number.isNaN(value)) return `rgba(100, 116, 139, ${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixColors(hex1: string, hex2: string, ratio: number = 0.5) {
  const clean1 = hex1.replace('#', '');
  const clean2 = hex2.replace('#', '');
  const val1 = Number.parseInt(clean1.length === 3 ? clean1.split('').map(c => c + c).join('') : clean1, 16);
  const val2 = Number.parseInt(clean2.length === 3 ? clean2.split('').map(c => c + c).join('') : clean2, 16);
  if (Number.isNaN(val1) || Number.isNaN(val2)) return hex1;
  const r1 = (val1 >> 16) & 255, g1 = (val1 >> 8) & 255, b1 = val1 & 255;
  const r2 = (val2 >> 16) & 255, g2 = (val2 >> 8) & 255, b2 = val2 & 255;
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function getNodeRole(node: GraphNode) {
  if (node.nodeType !== 'note') return node.nodeType;
  return node.kind ?? 'note';
}

function getCategoryName(node: GraphNode) {
  if (node.nodeProperties?.clusterLabel) return String(node.nodeProperties.clusterLabel);
  const role = getNodeRole(node);
  if (role === 'hub' || role === 'current') return '核心笔记';
  if (role === 'linked') return '关联笔记';
  if (node.nodeType === 'concept') return '概念';
  if (node.nodeType === 'person') return '人物';
  if (node.nodeType === 'project') return '项目';
  if (node.nodeType === 'tag') return '标签';
  return '普通笔记';
}

function getNodeColor(node: GraphNode) {
  if (node.nodeColor) return node.nodeColor;
  const role = getNodeRole(node);
  if (role === 'current') return NODE_ROLE_COLORS.current;
  if (role === 'hub') return NODE_ROLE_COLORS.hub;
  if (node.nodeType === 'note') return getHashColor(node.id);
  return NODE_ROLE_COLORS[role] ?? node.nodeColor ?? getHashColor(node.id);
}

function getNodeImportance(node: GraphNode) {
  const connections = node.connections ?? 0;
  if (node.kind === 'current') return 1;
  return Math.max(0, Math.min(1, (Math.sqrt(connections) + connections * 0.08) / 3.4));
}

function getAdaptiveFontSize(node: GraphNode, active: boolean) {
  const radiusHint = Math.sqrt(Math.max(node.nodeSize ?? 18, 18));
  return Math.max(9, Math.min(18, 8 + radiusHint * 1.15 + getNodeImportance(node) * 3 + (active ? 1.5 : 0)));
}

function _getEdgeGradient(sourceColor: string, targetColor: string, opacity: number) {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 1,
    y2: 0,
    colorStops: [
      { offset: 0, color: withAlpha(sourceColor, opacity) },
      { offset: 0.5, color: withAlpha(sourceColor, opacity * 0.72) },
      { offset: 1, color: withAlpha(targetColor, opacity) },
    ],
  };
}

function getEdgeConfig(edge: GraphEdge) {
  const key = edge.label.startsWith('semantic:') ? 'semantic' : edge.label;
  return EDGE_STYLE_MAP[key] ?? { label: edge.label || '关联', color: '#64748b', type: 'solid', width: 1 };
}

function buildInitialPosition(
  node: GraphNode,
  localIndex: number,
  roleIndex: number,
  roleCount: number,
  width: number,
  height: number,
): GraphLayoutPosition {
  const centerX = width / 2;
  const centerY = height / 2;
  const shortest = Math.max(360, Math.min(width, height));
  const role = getNodeRole(node);
  const hash = hashString(node.id);

  if (role === 'hub' || role === 'current') {
    const angle = (localIndex * Math.PI * 2) / Math.max(roleCount, 1) + (hash % 31) / 100;
    const radius = 24 + Math.sqrt(localIndex + 1) * 18;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  }

  const categoryAngle = (roleIndex / Math.max(CATEGORIES.length, 1)) * Math.PI * 2 - Math.PI / 2;
  const clusterRadius = shortest * 0.22;
  const localAngle = localIndex * (Math.PI * (3 - Math.sqrt(5))) + (hash % 53) / 100;
  const localRadius = 42 + Math.sqrt(localIndex + 1) * 23;
  return {
    x: centerX + Math.cos(categoryAngle) * clusterRadius + Math.cos(localAngle) * localRadius,
    y: centerY + Math.sin(categoryAngle) * clusterRadius + Math.sin(localAngle) * localRadius,
  };
}

function buildCompactLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const layout = new Map<string, GraphLayoutPosition>();
  if (nodes.length === 0) return layout;

  const centerX = width / 2;
  const centerY = height * 0.48;
  const shortest = Math.max(360, Math.min(width, height));
  const nodeIds = new Set(nodes.map(node => node.id));
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const degreeOf = (nodeId: string) => adjacency.get(nodeId)?.size ?? 0;
  const visited = new Set<string>();
  const components: GraphNode[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const component: GraphNode[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) continue;
      const currentNode = nodes.find(item => item.id === currentId);
      if (currentNode) component.push(currentNode);

      for (const nextId of adjacency.get(currentId) ?? []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }

    components.push(component);
  }

  const connectedComponents = components
    .filter(component => component.some(node => degreeOf(node.id) > 0))
    .sort((left, right) => {
      const rightDegree = right.reduce((sum, node) => sum + degreeOf(node.id), 0);
      const leftDegree = left.reduce((sum, node) => sum + degreeOf(node.id), 0);
      return rightDegree - leftDegree || right.length - left.length;
    });

  const isolatedNodes = components
    .filter(component => component.every(node => degreeOf(node.id) === 0))
    .flat();

  const communitySpread = Math.min(shortest * 0.15, 128);

  connectedComponents.forEach((component, componentIndex) => {
    const componentHash = hashString(component.map(node => node.id).sort().join('|'));
    const componentAngle = componentIndex * GOLDEN_ANGLE + (componentHash % 41) / 120;
    const componentRadius = connectedComponents.length <= 1
      ? 0
      : communitySpread * (connectedComponents.length <= 3 ? 0.56 : 1);
    const componentCenterX = centerX + Math.cos(componentAngle) * componentRadius;
    const componentCenterY = centerY + Math.sin(componentAngle) * componentRadius;
    const orderedNodes = [...component].sort((left, right) => {
      return degreeOf(right.id) - degreeOf(left.id) || hashString(left.id) - hashString(right.id);
    });
    const localLimit = Math.min(94, 34 + Math.sqrt(component.length) * 19);

    orderedNodes.forEach((node, index) => {
      const degree = degreeOf(node.id);
      const hash = hashString(node.id);

      if (index === 0 && degree > 1) {
        layout.set(node.id, {
          x: componentCenterX + ((hash % 11) - 5) * 0.7,
          y: componentCenterY + (((hash >> 3) % 11) - 5) * 0.7,
        });
        return;
      }

      const angle = index * GOLDEN_ANGLE + (hash % 89) / 120;
      const radius = Math.min(localLimit, component.length <= 2 ? 38 : 26 + Math.sqrt(index + 1) * 18);
      layout.set(node.id, {
        x: componentCenterX + Math.cos(angle) * radius,
        y: componentCenterY + Math.sin(angle) * radius,
      });
    });
  });

  const isolatedBaseRadius = connectedComponents.length === 0
    ? 22
    : Math.min(shortest * 0.19, 142);

  isolatedNodes.forEach((node, index) => {
    const hash = hashString(node.id);
    const angle = index * GOLDEN_ANGLE + (hash % 97) / 130;
    const radius = connectedComponents.length === 0
      ? Math.min(shortest * 0.2, 28 + Math.sqrt(index + 1) * 26)
      : isolatedBaseRadius + ((index % 3) - 1) * 16;

    layout.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      fixed: nodes.length <= 80,
    });
  });

  return layout;
}

function buildVosTopicLayout(nodes: GraphNode[], width: number, height: number) {
  const layout = new Map<string, GraphLayoutPosition>();
  if (nodes.length === 0) return layout;

  const centerX = width / 2;
  const centerY = height * 0.48;
  const shortest = Math.max(360, Math.min(width, height));
  const networkRadius = Math.min(shortest * 0.27, 245);
  const clusters = new Map<string, GraphNode[]>();

  for (const node of nodes) {
    const clusterId = String(node.nodeProperties?.clusterId ?? node.nodeProperties?.clusterLabel ?? 'topic');
    if (!clusters.has(clusterId)) clusters.set(clusterId, []);
    clusters.get(clusterId)!.push(node);
  }

  const importanceOf = (node: GraphNode) => {
    const noteCount = Number(node.nodeProperties?.noteCount ?? 0);
    const chunkCount = Number(node.nodeProperties?.chunkCount ?? 0);
    return (node.nodeSize ?? 10) + (node.connections ?? 0) * 1.8 + noteCount * 1.6 + chunkCount * 0.22;
  };

  const orderedClusters = Array.from(clusters.entries())
    .map(([clusterId, clusterNodes]) => ({
      clusterId,
      nodes: clusterNodes.sort((left, right) => importanceOf(right) - importanceOf(left)),
      score: clusterNodes.reduce((sum, node) => sum + importanceOf(node), 0),
    }))
    .sort((left, right) => right.score - left.score);

  orderedClusters.forEach((cluster, clusterIndex) => {
    const angle = clusterIndex === 0 ? 0 : (clusterIndex - 1) * GOLDEN_ANGLE - Math.PI / 2;
    const ring = clusterIndex === 0
      ? 0
      : networkRadius * (0.38 + Math.min(0.54, Math.sqrt(clusterIndex) * 0.2));
    const centerJitter = (hashString(cluster.clusterId) % 17) - 8;
    const clusterCenterX = centerX + Math.cos(angle) * ring + centerJitter * 0.9;
    const clusterCenterY = centerY + Math.sin(angle) * ring + centerJitter * 0.45;
    const localRadius = Math.min(112, Math.max(34, 20 + Math.sqrt(cluster.nodes.length) * 13));

    cluster.nodes.forEach((node, nodeIndex) => {
      if (clusterIndex === 0 && nodeIndex === 0) {
        layout.set(node.id, {
          x: clusterCenterX,
          y: clusterCenterY,
          fixed: true,
        });
        return;
      }

      const localAngle = nodeIndex * GOLDEN_ANGLE + (hashString(node.id) % 53) / 110;
      const localRing = Math.min(
        localRadius,
        12 + Math.sqrt(nodeIndex + 1) * (cluster.nodes.length > 24 ? 10.5 : 13.5),
      );
      layout.set(node.id, {
        x: clusterCenterX + Math.cos(localAngle) * localRing,
        y: clusterCenterY + Math.sin(localAngle) * localRing,
        fixed: true,
      });
    });
  });

  return layout;
}

function formatPath(path?: string) {
  if (!path) return '';
  return path.length > 56 ? `...${path.slice(-53)}` : path;
}

export function EChartsGraph({ width, height, layoutMode = 'force' }: EChartsGraphProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [ReactECharts, setReactECharts] = useState<React.ComponentType<any> | null>(null);
  const [theme, setTheme] = useState<GraphTheme>(() => readTheme());
  const [reducedMotion, setReducedMotion] = useState(false);
  const chartRef = useRef<any>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [popupNode, setPopupNode] = useState<GraphNode | null>(null);
  const [popupRelatedNodes, setPopupRelatedNodes] = useState<Array<{ node: GraphNode; edgeLabel: string }>>([]);

  const {
    filteredNodes,
    filteredEdges,
    selectedNode,
    selectedEdge,
    hoveredNode,
    zoom,
    enableInertialDrag,
    selectNode,
    selectEdge,
    setHoveredNode,
    setZoom,
  } = useGraphStore();

  const topicMode = useMemo(
    () => filteredNodes.some(node => node.nodeProperties?.mode === 'topic'),
    [filteredNodes],
  );
  useEffect(() => {
    const loadECharts = async () => {
      try {
        const reactEchartsModule = await import('echarts-for-react');
        setReactECharts(() => reactEchartsModule.default);
        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to load ECharts:', error);
      }
    };
    loadECharts();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateTheme = () => setTheme(readTheme());
    const updateMotion = () => setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    updateTheme();
    updateMotion();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', updateMotion);
    return () => {
      observer.disconnect();
      motionQuery.removeEventListener('change', updateMotion);
    };
  }, []);

  const nodeIndex = useMemo(() => new Map(filteredNodes.map(node => [node.id, node])), [filteredNodes]);
  const layoutPositions = useMemo(
    () => topicMode
      ? buildVosTopicLayout(filteredNodes, width, height)
      : buildCompactLayout(filteredNodes, filteredEdges, width, height),
    [filteredEdges, filteredNodes, height, topicMode, width],
  );

  const chartLayoutKey = useMemo(() => {
    const nodeSeed = filteredNodes.map(node => node.id).sort().join('|');
    const edgeSeed = filteredEdges.map(edge => edge.id).sort().join('|');
    return `${topicMode ? 'topic-vos' : layoutMode}:${Math.round(width / 96)}:${Math.round(height / 96)}:${hashString(nodeSeed)}:${hashString(edgeSeed)}`;
  }, [filteredEdges, filteredNodes, height, layoutMode, topicMode, width]);

  const focusNodeId = selectedNode ?? hoveredNode;
  const neighborIds = useMemo(() => {
    if (!focusNodeId) return new Set<string>();
    const ids = new Set<string>([focusNodeId]);
    for (const edge of filteredEdges) {
      if (edge.source === focusNodeId) ids.add(edge.target);
      if (edge.target === focusNodeId) ids.add(edge.source);
    }
    return ids;
  }, [filteredEdges, focusNodeId]);

  const syncChartZoom = useCallback((nextZoom: number) => {
    const instance = chartRef.current?.getEchartsInstance?.();
    if (!instance) return;
    instance.setOption(
      { series: [{ zoom: nextZoom }] },
      { notMerge: false, lazyUpdate: false, silent: true },
    );
  }, []);

  useEffect(() => {
    syncChartZoom(zoom);
  }, [chartLayoutKey, syncChartZoom, zoom]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    setZoom(Number((useGraphStore.getState().zoom * factor).toFixed(2)));
  }, [setZoom]);

  const handleDrag = useCallback((deltaX: number, deltaY: number) => {
    setPanOffset(prev => ({
      x: prev.x + deltaX,
      y: prev.y + deltaY,
    }));
  }, []);

  const dragHandlers = useInertialDrag({
    onDrag: handleDrag,
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    friction: enableInertialDrag ? 0.94 : 0,
    maxVelocity: enableInertialDrag ? 30 : 0,
  });

  useEffect(() => {
    if (zoom === 0.86) {
      setPanOffset({ x: 0, y: 0 });
    }
  }, [zoom]);

  const getOption = useCallback(() => {
    const visibleLabels = filteredNodes.length <= 140;
    const localCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    const categoryColors = new Map<string, string>();

    for (const node of filteredNodes) {
      const category = getCategoryName(node);
      roleCounts.set(category, (roleCounts.get(category) ?? 0) + 1);
      if (!categoryColors.has(category)) {
        categoryColors.set(category, node.nodeColor ?? getNodeColor(node));
      }
    }

    const categories = Array.from(categoryColors.entries()).map(([name, color]) => ({
      name,
      itemStyle: { color },
    }));
    const categoryIndexByName = new Map(categories.map((category, index) => [category.name, index]));

    const echartsNodes = filteredNodes.map((node, nodeOrder) => {
      const categoryName = getCategoryName(node);
      const roleIndex = categoryIndexByName.get(categoryName) ?? 0;
      const localIndex = localCounts.get(categoryName) ?? 0;
      localCounts.set(categoryName, localIndex + 1);

      const isSelected = selectedNode === node.id;
      const isHovered = hoveredNode === node.id;
      const isFocused = focusNodeId === node.id;
      const isNeighbor = focusNodeId ? neighborIds.has(node.id) : false;
      const isDimmed = !!focusNodeId && !isFocused && !isNeighbor;
      const isTopicNode = node.nodeProperties?.mode === 'topic';
      const connections = node.connections ?? 0;
      const role = getNodeRole(node);
      const importance = getNodeImportance(node);
      const baseSize = role === 'hub' || role === 'current'
        ? 28 + Math.sqrt(Math.max(connections, 1)) * 6
        : 14 + Math.sqrt(Math.max(connections, 1)) * 4.5;
      const symbolSize = isTopicNode
        ? Math.max(4, Math.min(36, node.nodeSize ?? 10))
        : Math.max(10, Math.min(56, node.nodeSize ? Math.max(node.nodeSize, baseSize) : baseSize));
      const color = getNodeColor(node);
      const _fillColor = isTopicNode ? withAlpha(color, isSelected ? 0.98 : isHovered ? 0.95 : 0.84) : color;
      const position = layoutPositions.get(node.id)
        ?? buildInitialPosition(node, localIndex, roleIndex, roleCounts.get(categoryName) ?? 1, width, height);
      const labelActive = isSelected || isHovered;
      const labelVisible = isTopicNode
        ? (visibleLabels && (symbolSize >= 12 || connections >= 3)) || labelActive
        : visibleLabels || labelActive || role === 'current' || connections >= 3;
      const labelFontSize = isTopicNode
        ? Math.max(8, Math.min(18, 7.8 + Math.sqrt(symbolSize) * 1.1 + Math.min(3.5, connections * 0.15) + (labelActive ? 1.5 : 0)))
        : getAdaptiveFontSize(node, labelActive);

      return {
        id: node.id,
        name: node.nodeLabel,
        category: roleIndex,
        symbolSize: isSelected ? symbolSize + 5 : isHovered ? symbolSize + 3 : symbolSize,
        symbol: isTopicNode ? 'circle' : SHAPE_MAP[node.nodeType] || 'circle',
        x: position.x,
        y: position.y,
        fixed: position.fixed,
        value: connections,
        itemStyle: {
          color: {
            type: 'radial',
            x: 0.4,
            y: 0.4,
            r: 0.6,
            colorStops: [
              { offset: 0, color: withAlpha(color, 1) },
              { offset: 0.6, color: withAlpha(color, 0.9) },
              { offset: 1, color: withAlpha(color, 0.7) },
            ],
          },
          borderColor: isSelected 
            ? theme.foreground 
            : isHovered 
              ? withAlpha(color, 0.8) 
              : withAlpha(color, 0.3),
          borderWidth: isSelected ? 2.5 : isHovered ? 2 : 0.8,
          shadowBlur: isSelected ? 20 : isHovered ? 15 : 4 + importance * 8,
          shadowColor: withAlpha(color, isSelected ? 0.4 : isHovered ? 0.3 : 0.15),
          opacity: isDimmed ? 0.15 : 1,
        },
        label: {
          show: labelVisible,
          position: isTopicNode
            ? symbolSize >= 32 ? 'inside' : 'right'
            : role === 'hub' || symbolSize >= 48 ? 'inside' : 'right',
          formatter: '{b}',
          fontSize: labelFontSize,
          fontWeight: isSelected || role === 'hub' ? 600 : 400,
          color: isDimmed
            ? 'rgba(115, 115, 115, 0.3)'
            : isSelected || isHovered
              ? theme.foreground
              : withAlpha(theme.foreground, 0.75),
          distance: 5,
          overflow: 'truncate',
          width: isTopicNode
            ? (isSelected || isHovered ? 120 : Math.max(40, Math.min(90, 36 + importance * 40)))
            : (isSelected || isHovered ? 140 : Math.max(60, Math.min(110, 50 + importance * 50))),
        },
        emphasis: {
          itemStyle: {
            borderWidth: 2.5,
            borderColor: theme.foreground,
            shadowBlur: 20,
            shadowColor: withAlpha(color, 0.4),
          },
          label: {
            show: true,
            fontSize: 13,
            fontWeight: 600,
            color: theme.foreground,
            distance: 6,
          },
        },
        nodeData: node,
        nodeOrder,
      };
    });

    const echartsEdges = filteredEdges.map(edge => {
      const isSelected = selectedEdge === edge.id;
      const isHighlighted = focusNodeId === edge.source || focusNodeId === edge.target;
      const isDimmed = !!focusNodeId && !isHighlighted;
      const isTopicEdge = edge.label === 'topic-cooccurrence' || edge.label === 'topic-semantic' || edge.label === 'rag-vector';
      const config = getEdgeConfig(edge);
      const weight = edge.weight ?? 1;
      const sourceColor = getNodeColor(nodeIndex.get(edge.source) ?? ({ id: edge.source, nodeType: 'note', nodeLabel: edge.source, nodeProperties: {}, nodeMetadata: { createdAt: '', updatedAt: '' } } as GraphNode));
      const targetColor = getNodeColor(nodeIndex.get(edge.target) ?? ({ id: edge.target, nodeType: 'note', nodeLabel: edge.target, nodeProperties: {}, nodeMetadata: { createdAt: '', updatedAt: '' } } as GraphNode));
      const opacity = isTopicEdge
        ? (isDimmed ? 0.03 : isSelected || isHighlighted ? 0.6 : Math.max(0.05, Math.min(0.25, 0.06 + Math.sqrt(weight) * 0.08)))
        : (isDimmed ? 0.05 : isSelected || isHighlighted ? 0.7 : Math.max(0.08, Math.min(0.4, 0.15 + Math.sqrt(weight) * 0.1)));

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        value: Math.max(1, Math.round(weight * 10)),
        lineStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: withAlpha(sourceColor, opacity) },
              { offset: 0.3, color: withAlpha(sourceColor, opacity * 0.85) },
              { offset: 0.5, color: withAlpha(mixColors(sourceColor, targetColor), opacity * 0.7) },
              { offset: 0.7, color: withAlpha(targetColor, opacity * 0.85) },
              { offset: 1, color: withAlpha(targetColor, opacity) },
            ],
          },
          width: isTopicEdge
            ? (isSelected ? config.width + 1 : isHighlighted ? config.width + 0.5 : Math.max(0.3, config.width * Math.min(1.1, Math.sqrt(weight))))
            : (isSelected ? config.width + 1.5 : isHighlighted ? config.width + 1 : Math.max(0.5, config.width * Math.min(1.3, Math.sqrt(weight)))),
          type: config.type,
          curveness: isTopicEdge ? 0.04 : filteredNodes.length > 90 ? 0.1 : 0.18,
          opacity: 1,
          shadowBlur: isSelected ? 8 : isHighlighted ? 5 : 0,
          shadowColor: withAlpha(sourceColor, isSelected ? 0.25 : isHighlighted ? 0.15 : 0),
        },
        emphasis: {
          lineStyle: {
            width: config.width + 1.5,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: withAlpha(sourceColor, 0.8) },
                { offset: 0.5, color: withAlpha(mixColors(sourceColor, targetColor), 0.6) },
                { offset: 1, color: withAlpha(targetColor, 0.8) },
              ],
            },
            opacity: 0.9,
            shadowBlur: 10,
            shadowColor: withAlpha(sourceColor, 0.3),
          },
        },
        edgeData: edge,
      };
    });

    const smallGraph = filteredNodes.length <= 36;
    const sparseGraph = filteredEdges.length < filteredNodes.length * (topicMode ? 1.15 : 0.65);
    const forceRepulsion = smallGraph
      ? (sparseGraph ? 50 : 80)
      : filteredNodes.length > 140
        ? (topicMode ? 120 : 150)
        : (topicMode ? (sparseGraph ? 70 : 100) : (sparseGraph ? 100 : 130));
    const forceGravity = smallGraph
      ? (sparseGraph ? 0.3 : 0.25)
      : filteredNodes.length > 140
        ? (topicMode ? 0.12 : 0.1)
        : (topicMode ? (sparseGraph ? 0.22 : 0.18) : (sparseGraph ? 0.18 : 0.14));
    const forceEdgeLength = smallGraph
      ? (sparseGraph ? [30, 60] : [40, 80])
      : filteredNodes.length > 140
        ? (topicMode ? [35, 80] : [60, 120])
        : (topicMode ? [30, 70] : [50, 100]);

    const getForceConfig = () => {
      if (layoutMode === 'circular') {
        return {
          repulsion: forceRepulsion * 0.8,
          gravity: forceGravity * 1.2,
          edgeLength: forceEdgeLength,
          friction: 0.6,
          layoutAnimation: !reducedMotion,
        };
      }
      if (layoutMode === 'radial') {
        return {
          repulsion: forceRepulsion * 0.6,
          gravity: 0.3,
          edgeLength: [30, 80],
          friction: 0.6,
          layoutAnimation: !reducedMotion,
        };
      }
      return {
        repulsion: forceRepulsion,
        gravity: forceGravity,
        edgeLength: forceEdgeLength,
        friction: smallGraph ? 0.62 : 0.68,
        layoutAnimation: !reducedMotion,
      };
    };

    return {
      backgroundColor: 'transparent',
      color: categories.map(category => category.itemStyle.color),
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        backgroundColor: withAlpha(theme.surface, 0.96),
        borderColor: theme.border,
        borderWidth: 1,
        extraCssText: 'box-shadow: 0 6px 24px rgba(0,0,0,0.28); border-radius: 12px; backdrop-filter: blur(10px);',
        textStyle: {
          color: theme.foreground,
          fontSize: 12,
          lineHeight: 18,
        },
        formatter: (params: EChartsEventParams) => {
          if (params.dataType === 'node') {
            const nodeData = params.data?.nodeData;
            if (!nodeData) return '';
            if (nodeData.nodeProperties?.mode === 'topic') {
              const noteCount = Number(nodeData.nodeProperties.noteCount ?? 0);
              const chunkCount = Number(nodeData.nodeProperties.chunkCount ?? 0);
              const topicWeight = Number(nodeData.nodeProperties.topicWeight ?? 0);
              const clusterLabel = String(nodeData.nodeProperties.clusterLabel ?? '主题簇');
              return `
                <div style="min-width: 220px; max-width: 320px;">
                  <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${params.name ?? nodeData.nodeLabel}</div>
                  <div style="color: ${theme.mutedForeground}; line-height: 1.7;">
                    <div>聚类：${clusterLabel}</div>
                    <div>覆盖笔记：${noteCount} 篇</div>
                    <div>RAG 切块：${chunkCount} 个</div>
                    <div>主题权重：${topicWeight.toFixed(2)}</div>
                  </div>
                </div>
              `;
            }
            return `
              <div style="min-width: 220px; max-width: 300px;">
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">${params.name ?? nodeData.nodeLabel}</div>
                <div style="color: ${theme.mutedForeground}; line-height: 1.7;">
                  <div>类型：${NODE_TYPE_LABELS[nodeData.nodeType] || nodeData.nodeType}</div>
                  <div>连接：${nodeData.connections || 0} 个</div>
                  ${nodeData.nodeProperties?.path ? `<div style="margin-top: 4px; word-break: break-all;">路径：${formatPath(nodeData.nodeProperties.path)}</div>` : ''}
                </div>
              </div>
            `;
          }
          if (params.dataType === 'edge') {
            const edgeData = params.data?.edgeData;
            if (!edgeData) return '';
            const config = getEdgeConfig(edgeData);
            const source = nodeIndex.get(edgeData.source)?.nodeLabel ?? edgeData.source;
            const target = nodeIndex.get(edgeData.target)?.nodeLabel ?? edgeData.target;
            return `
              <div style="min-width: 220px; max-width: 300px;">
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">${config.label}</div>
                <div style="color: ${theme.mutedForeground}; line-height: 1.7;">
                  <div>${source} → ${target}</div>
                  ${edgeData.confidence ? `<div>置信度：${(edgeData.confidence * 100).toFixed(1)}%</div>` : ''}
                </div>
              </div>
            `;
          }
          return '';
        },
      },
      legend: {
        show: false,
        data: categories.map(category => category.name),
        bottom: 18,
        left: 'center',
        orient: 'horizontal',
        itemGap: 14,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'circle',
        textStyle: {
          color: theme.mutedForeground,
          fontSize: 11,
        },
        inactiveColor: theme.border,
      },
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 1200,
      animationDurationUpdate: reducedMotion ? 0 : 400,
      animationDelay: (index: number) => topicMode && !reducedMotion ? Math.min(600, index * 8) : 0,
      animationDelayUpdate: (index: number) => topicMode && !reducedMotion ? Math.min(250, index * 5) : 0,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicInOut',
      series: [{
        type: 'graph',
        layout: topicMode ? 'none' : (layoutMode === 'circular' || layoutMode === 'radial') ? 'circular' : 'force',
        data: echartsNodes,
        links: echartsEdges,
        categories,
        roam: true,
        draggable: true,
        zoom,
        cursor: 'pointer',
        force: getForceConfig(),
        circular: {
          rotateLabel: true,
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 10],
        emphasis: {
          focus: 'adjacency',
          blurScope: 'coordinateSystem',
          scale: true,
          itemStyle: {
            borderWidth: 3,
            borderColor: theme.foreground,
            shadowBlur: 25,
            shadowColor: withAlpha(theme.primary, 0.5),
          },
          lineStyle: {
            width: 3,
            shadowBlur: 15,
            shadowColor: withAlpha(theme.primary, 0.4),
          },
        },
        blur: {
          itemStyle: { opacity: 0.12 },
          lineStyle: { opacity: 0.03 },
          label: { opacity: 0.1 },
        },
        scaleLimit: {
          min: 0.32,
          max: 4.2,
        },
        labelLayout: {
          hideOverlap: true,
          moveOverlap: 'shiftY',
          maxLines: 2,
        },
        selectedMode: 'single',
        select: {
          itemStyle: {
            borderWidth: 3,
            borderColor: theme.foreground,
            shadowBlur: 25,
            shadowColor: withAlpha(theme.primary, 0.45),
          },
        },
        lineStyle: {
          opacity: 0.65,
        },
      }],
    };
  }, [
    filteredNodes,
    filteredEdges,
    focusNodeId,
    height,
    hoveredNode,
    layoutMode,
    layoutPositions,
    neighborIds,
    nodeIndex,
    reducedMotion,
    selectedEdge,
    selectedNode,
    theme,
    topicMode,
    width,
    zoom,
  ]);

  const onEvents = useMemo(() => ({
    click: (params: EChartsEventParams) => {
      if (params.dataType === 'node' && params.data?.id) {
        const clickedNode = filteredNodes.find(n => n.id === params.data!.id);
        if (clickedNode) {
          const related: Array<{ node: GraphNode; edgeLabel: string }> = [];
          for (const edge of filteredEdges) {
            if (edge.source === clickedNode.id) {
              const targetNode = filteredNodes.find(n => n.id === edge.target);
              if (targetNode) related.push({ node: targetNode, edgeLabel: edge.label });
            }
            if (edge.target === clickedNode.id) {
              const sourceNode = filteredNodes.find(n => n.id === edge.source);
              if (sourceNode) related.push({ node: sourceNode, edgeLabel: edge.label });
            }
          }
          setPopupNode(clickedNode);
          setPopupRelatedNodes(related);
          selectNode(params.data.id);
        }
        selectEdge(null);
      } else if (params.dataType === 'edge' && params.data?.id) {
        selectEdge(params.data.id);
        selectNode(null);
        setPopupNode(null);
      } else {
        selectNode(null);
        selectEdge(null);
        setPopupNode(null);
      }
    },
    mouseover: (params: EChartsEventParams) => {
      if (params.dataType === 'node' && params.data?.id) {
        setHoveredNode(params.data.id);
      }
    },
    mouseout: () => {
      setHoveredNode(null);
    },
    graphRoam: () => {
      setZoom(useGraphStore.getState().zoom);
    },
  }), [selectEdge, selectNode, setHoveredNode, setZoom, filteredNodes, filteredEdges]);

  const handleOpenNote = useCallback(async (path: string) => {
    const useArticleStore = (await import('@/stores/article')).default;
    useArticleStore.getState().setActiveFilePath(path);
    setPopupNode(null);
  }, []);

  const handleCopyPath = useCallback(async (path: string) => {
    await navigator.clipboard.writeText(path);
  }, []);

  const handleSelectNodeFromPopup = useCallback((nodeId: string) => {
    selectNode(nodeId);
    const newNode = filteredNodes.find(n => n.id === nodeId);
    if (newNode) {
      const related: Array<{ node: GraphNode; edgeLabel: string }> = [];
      for (const edge of filteredEdges) {
        if (edge.source === nodeId) {
          const targetNode = filteredNodes.find(n => n.id === edge.target);
          if (targetNode) related.push({ node: targetNode, edgeLabel: edge.label });
        }
        if (edge.target === nodeId) {
          const sourceNode = filteredNodes.find(n => n.id === edge.source);
          if (sourceNode) related.push({ node: sourceNode, edgeLabel: edge.label });
        }
      }
      setPopupNode(newNode);
      setPopupRelatedNodes(related);
    }
  }, [selectNode, filteredNodes, filteredEdges]);

  if (!isLoaded || !ReactECharts) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
          正在布置知识网络...
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full touch-none bg-background"
      onWheel={handleWheel}
      {...dragHandlers}
    >
      <div style={{
        transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
      }}>
        <ReactECharts
          ref={chartRef}
          key={chartLayoutKey}
          option={getOption()}
          style={{ width, height }}
          onEvents={onEvents}
          opts={{ renderer: 'canvas' }}
          notMerge={false}
          lazyUpdate
        />
      </div>

      {popupNode && (
        <NodeDetailPopup
          node={popupNode}
          relatedNodes={popupRelatedNodes}
          onClose={() => setPopupNode(null)}
          onOpenNote={handleOpenNote}
          onCopyPath={handleCopyPath}
          onSelectNode={handleSelectNodeFromPopup}
        />
      )}
    </div>
  );
}
