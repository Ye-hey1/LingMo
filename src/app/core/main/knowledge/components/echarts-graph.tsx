'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore, type GraphNode, type GraphEdge } from '../store/graph-store';

interface EChartsGraphProps {
  width: number;
  height: number;
  layoutMode?: 'force' | 'circular' | 'tree' | 'radial';
  onNodeClick?: (nodeId: string) => void;
  apiRef?: React.MutableRefObject<{
    zoomIn: () => void;
    zoomOut: () => void;
    fitView: () => void;
    refresh: () => void;
  } | null>;
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
  { name: '思维孤立点', itemStyle: { color: '#71717a' } },
  { name: '未创建盲区', itemStyle: { color: '#ef4444' } },
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
  '#10b981', '#38bdf8', '#8b5cf6', '#f59e0b', '#ef4444',
  '#14b8a6', '#6366f1', '#84cc16', '#f97316', '#ec4899',
];

const TRIPSTAR_TOPIC_PALETTE: Record<string, { start: string; end: string | null }> = {
  ai: { start: '#2563eb', end: '#38bdf8' },
  product: { start: '#16a34a', end: '#86efac' },
  design: { start: '#db2777', end: '#f9a8d4' },
  engineering: { start: '#7c3aed', end: '#c4b5fd' },
  research: { start: '#0891b2', end: '#67e8f9' },
  workflow: { start: '#ea580c', end: '#fdba74' },
};

const tripstarSymbolCache = new Map<string, string>();

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
const GRAPH_SERIES_ID = 'knowledge-graph-main-series';
const GRAPH_TOOLTIP_VERSION = 'light-tooltip-v2';
function deferEChartsEventUpdate(callback: () => void) {
  globalThis.setTimeout(callback, 0);
}

const EDGE_STYLE_MAP: Record<string, { label: string; color: string; type: string; width: number }> = {
  wikilink: { label: '双链', color: '#64748b', type: 'solid', width: 1.25 },
  semantic: { label: '语义关联', color: '#059669', type: 'dashed', width: 1.15 },
  references: { label: '引用', color: '#d97706', type: 'solid', width: 1 },
  related: { label: '相关', color: '#64748b', type: 'solid', width: 1 },
  extends: { label: '延伸', color: '#f59e0b', type: 'solid', width: 1.25 },
  supports: { label: '支撑', color: '#16a34a', type: 'solid', width: 1.25 },
  contradicts: { label: '矛盾', color: '#ef4444', type: 'solid', width: 1.35 },
  analogous: { label: '类比', color: '#8b5cf6', type: 'dashed', width: 1.1 },
  'example-of': { label: '示例', color: '#06b6d4', type: 'dashed', width: 1 },
  uses: { label: '使用', color: '#22c55e', type: 'solid', width: 1.15 },
  'part-of': { label: '属于', color: '#6366f1', type: 'solid', width: 1.1 },
  contains: { label: '包含', color: '#7c3aed', type: 'solid', width: 1 },
  mentions: { label: '提及', color: '#be185d', type: 'dotted', width: 1 },
  'topic-cooccurrence': { label: '主题共现', color: '#94a3b8', type: 'solid', width: 0.75 },
  'topic-semantic': { label: '主题语义', color: '#64748b', type: 'solid', width: 0.9 },
  'rag-vector': { label: 'RAG 向量相似', color: '#0f766e', type: 'solid', width: 1.05 },
  'topic-note': { label: '主题归属', color: '#94a3b8', type: 'dotted', width: 0.8 },
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

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getHashColor(id: string) {
  return VOS_PALETTE[hashString(id) % VOS_PALETTE.length];
}

function isLightColor(colorStr: string): boolean {
  if (!colorStr) return false;
  const clean = colorStr.trim().toLowerCase();

  // 1. 十六进制颜色
  if (clean.startsWith('#')) {
    const hex = clean.replace('#', '');
    const val = Number.parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
    if (!Number.isNaN(val)) {
      const r = (val >> 16) & 255;
      const g = (val >> 8) & 255;
      const b = val & 255;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      return brightness > 128;
    }
  }

  // 2. HSL 颜色，匹配亮度分量
  if (clean.startsWith('hsl')) {
    const matches = clean.match(/([\d.]+)%\s*[,)]/g);
    if (matches && matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const lightness = Number.parseFloat(lastMatch);
      if (!Number.isNaN(lightness)) {
        return lightness > 65;
      }
    }
    const parts = clean.split(/[\s,]+/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].includes('%')) {
        const val = Number.parseFloat(parts[i]);
        if (!Number.isNaN(val)) {
          return val > 65;
        }
      }
    }
  }

  // 3. RGB 颜色，明度公式
  if (clean.startsWith('rgb')) {
    const match = clean.match(/\(([^)]+)\)/);
    if (match) {
      const parts = match[1].split(/[\s,+/]+/).filter(Boolean).map(p => Number.parseFloat(p));
      if (parts.length >= 3) {
        const [r, g, b] = parts;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128;
      }
    }
  }

  return false;
}

function withAlpha(colorStr: string, alpha: number): string {
  if (!colorStr) return `rgba(100, 116, 139, ${alpha})`;
  const clean = colorStr.trim().toLowerCase();

  // 1. 处理 hsl 格式，转换为 hsla
  if (clean.startsWith('hsl')) {
    const match = clean.match(/hsla?\(([^)]+)\)/);
    if (match) {
      const parts = match[1].split(/[\s,+/]+/).filter(Boolean);
      if (parts.length >= 4) {
        parts[3] = String(alpha);
        return `hsla(${parts[0]}, ${parts[1]}, ${parts[2]}, ${parts[3]})`;
      }
      if (parts.length >= 3) {
        return `hsla(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
      }
    }
  }

  // 2. 处理 rgb 格式，转换为 rgba
  if (clean.startsWith('rgb')) {
    const match = clean.match(/rgba?\(([^)]+)\)/);
    if (match) {
      const parts = match[1].split(/[\s,+/]+/).filter(Boolean);
      if (parts.length >= 4) {
        parts[3] = String(alpha);
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${parts[3]})`;
      }
      if (parts.length >= 3) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
      }
    }
  }

  // 3. 处理十六进制格式
  if (clean.startsWith('#')) {
    const hex = clean.replace('#', '');
    const value = Number.parseInt(hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex, 16);
    if (!Number.isNaN(value)) {
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  return `rgba(100, 116, 139, ${alpha})`;
}

function buildFeatherCircleSvgDataUrl(size: number, start: string, end: string | null) {
  const center = size / 2;
  const radius = Math.round(size * 0.38);
  const gradientDef = end
    ? `<radialGradient id="kgNodeGradient" cx="38%" cy="32%" r="70%">
         <stop offset="0%" stop-color="#ffffff" stop-opacity="0.68" />
         <stop offset="42%" stop-color="${end}" stop-opacity="0.9" />
         <stop offset="100%" stop-color="${start}" />
       </radialGradient>`
    : '';
  const fillColor = end ? 'url(#kgNodeGradient)' : start;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      ${gradientDef}
      <filter id="kgNodeBlur" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.5" />
      </filter>
    </defs>
    <circle cx="${center}" cy="${center}" r="${radius + 2}" fill="${start}" opacity="0.2" filter="url(#kgNodeBlur)" />
    <circle cx="${center}" cy="${center}" r="${radius}" fill="${fillColor}" />
    <circle cx="${center}" cy="${center}" r="${Math.max(2, radius * 0.42)}" fill="#ffffff" opacity="0.16" />
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getTripstarNodeVisual(node: GraphNode) {
  const clusterId = String(node.nodeProperties?.clusterId ?? '');
  const palette = TRIPSTAR_TOPIC_PALETTE[clusterId] ?? {
    start: node.nodeColor ?? getNodeColor(node),
    end: null,
  };
  const rawSize = Number(node.nodeSize ?? 18);
  const noteCount = Number(node.nodeProperties?.noteCount ?? 0);
  const topicWeight = Number(node.nodeProperties?.topicWeight ?? 0);
  const vectorWeight = Number(node.nodeProperties?.vectorWeight ?? 0);
  const connections = Number(node.connections ?? 0);
  const weightedSize =
    rawSize * 1.12
    + Math.sqrt(Math.max(noteCount, 0)) * 4.6
    + Math.sqrt(Math.max(connections, 0)) * 2.4
    + Math.sqrt(Math.max(topicWeight + vectorWeight, 0)) * 1.2;
  const size = Math.round(clampNumber(weightedSize, 28, node.kind === 'hub' ? 76 : 62));
  return {
    size,
    start: palette.start,
    end: palette.end,
  };
}

function getGraphNodeDisplayColor(node: GraphNode) {
  if (node.nodeProperties?.mode === 'topic') {
    return getTripstarNodeVisual(node).start;
  }
  return getNodeColor(node);
}

function formatTopicCenterLabel(label: string) {
  return label.trim();
}

function formatFullGraphLabel(label: string, lineLength: number) {
  const normalized = label.trim().replace(/\s*[-·]+\s*/g, ' · ');
  if (!normalized || normalized.length <= lineLength) return normalized;

  const lines: string[] = [];
  let current = '';
  for (const char of normalized) {
    const next = `${current}${char}`;
    const visualLength = Array.from(next).reduce((sum, item) => sum + (/[\u4e00-\u9fa5]/.test(item) ? 1 : 0.58), 0);
    if (current && visualLength > lineLength) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function getTripstarNodeSymbol(node: GraphNode) {
  const visual = getTripstarNodeVisual(node);
  const cacheKey = `${visual.size}-${visual.start}-${visual.end ?? 'solid'}`;
  const cached = tripstarSymbolCache.get(cacheKey);
  if (cached) return cached;
  const symbol = `image://${buildFeatherCircleSvgDataUrl(visual.size, visual.start, visual.end)}`;
  tripstarSymbolCache.set(cacheKey, symbol);
  return symbol;
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
  if (node.nodeProperties?.isOrphan) return '思维孤立点';
  if (node.nodeProperties?.isUnresolved) return '未创建引用';
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
  if (node.nodeProperties?.isUnresolved) return '#f87171';
  if (node.nodeProperties?.isOrphan) return '#71717a';
  const role = getNodeRole(node);
  if (node.nodeProperties?.mode === 'note' || node.nodeType === 'note') {
    if (role === 'hub' || role === 'current') return NODE_ROLE_COLORS.hub;
    if (role === 'linked') return NODE_ROLE_COLORS.linked;
    return NODE_ROLE_COLORS.note;
  }
  if (node.nodeColor) return node.nodeColor;
  if (role === 'current') return NODE_ROLE_COLORS.current;
  if (role === 'hub') return NODE_ROLE_COLORS.hub;
  return NODE_ROLE_COLORS[role] ?? node.nodeColor ?? getHashColor(node.id);
}

function getNodeImportance(node: GraphNode) {
  const connections = node.connections ?? 0;
  if (node.kind === 'current') return 1;
  return Math.max(0, Math.min(1, (Math.sqrt(connections) + connections * 0.08) / 3.4));
}

function getAdaptiveFontSize(node: GraphNode, active: boolean) {
  const radiusHint = Math.sqrt(Math.max(node.nodeSize ?? 18, 18));
  return Math.max(11, Math.min(22, 10 + radiusHint * 1.3 + getNodeImportance(node) * 4 + (active ? 2 : 0)));
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
  const key = edge.label.startsWith('semantic:')
    ? 'semantic'
    : String(edge.metadata?.relationType ?? edge.label).replace(/_/g, '-');
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
  const centerY = height * 0.5;
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

function buildTripstarBoundaryLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const layout = new Map<string, GraphLayoutPosition>();
  if (nodes.length === 0) return layout;

  const degreeMap = new Map<string, number>();
  nodes.forEach(node => degreeMap.set(node.id, 0));
  edges.forEach(edge => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  });

  const centerX = width / 2;
  const centerY = height / 2;
  const root = [...nodes].sort((left, right) => (degreeMap.get(right.id) ?? 0) - (degreeMap.get(left.id) ?? 0))[0];
  if (root) {
    layout.set(root.id, { x: centerX, y: centerY, fixed: true });
  }

  const groupedNodes = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (node.id === root?.id) continue;
    const clusterId = String(node.nodeProperties?.clusterId ?? node.nodeProperties?.clusterLabel ?? getCategoryName(node));
    if (!groupedNodes.has(clusterId)) groupedNodes.set(clusterId, []);
    groupedNodes.get(clusterId)!.push(node);
  }

  const orderedGroups = Array.from(groupedNodes.entries())
    .sort((left, right) => right[1].length - left[1].length);
  const outerRadiusX = Math.max(120, width / 2 - 88);
  const outerRadiusY = Math.max(120, height / 2 - 88);
  const layerFactors = [1, 0.88, 0.76, 0.64];

  orderedGroups.forEach(([groupKey, group], groupIndex) => {
    const baseAngle = -Math.PI / 2 + (2 * Math.PI * groupIndex) / Math.max(1, orderedGroups.length);
    const spread = Math.min(1.28, Math.max(0.56, group.length * 0.035));
    const layerStride = Math.max(1, Math.ceil(group.length / layerFactors.length));

    group.forEach((node, nodeIndex) => {
      const visual = getTripstarNodeVisual(node);
      const angleJitter = (hashString(`${groupKey}:${node.id}`) % 19) / 120;
      const t = group.length === 1 ? 0 : nodeIndex / (group.length - 1) - 0.5;
      const angle = baseAngle + t * spread + angleJitter;
      const layerIndex = Math.min(layerFactors.length - 1, Math.floor(nodeIndex / layerStride));
      const nodeRadius = Math.round(visual.size * 0.34);
      const marginX = nodeRadius + 10;
      const marginY = nodeRadius + 10;
      const x = Math.max(marginX, Math.min(width - marginX, centerX + Math.cos(angle) * outerRadiusX * layerFactors[layerIndex]));
      const y = Math.max(marginY, Math.min(height - marginY, centerY + Math.sin(angle) * outerRadiusY * layerFactors[layerIndex]));
      layout.set(node.id, { x, y });
    });
  });

  return layout;
}

function formatPath(path?: string) {
  if (!path) return '';
  return path.length > 56 ? `...${path.slice(-53)}` : path;
}

export function EChartsGraph({ width, height, layoutMode = 'force', onNodeClick, apiRef }: EChartsGraphProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [ReactECharts, setReactECharts] = useState<React.ComponentType<any> | null>(null);
  const [theme, setTheme] = useState<GraphTheme>(() => readTheme());
  const [reducedMotion, setReducedMotion] = useState(false);
  const chartRef = useRef<any>(null);
  const roamTimeoutRef = useRef<any>(null);
  const getOptionRef = useRef<(() => any) | null>(null);

  // 交互与手势控制 Ref（不触发组件重渲染）
  const selectedNodeRef = useRef(useGraphStore.getState().selectedNode);
  const selectedEdgeRef = useRef(useGraphStore.getState().selectedEdge);
  const zoomRef = useRef(useGraphStore.getState().zoom || 0.72);
  const panCenterRef = useRef<[number | string, number | string]>(['50%', '50%']);

  const filteredNodes = useGraphStore((state) => state.filteredNodes);
  const filteredEdges = useGraphStore((state) => state.filteredEdges);

  // 只拉取 actions 方法，actions 引用恒定，不会引起组件重绘
  const selectNode = useGraphStore((state) => state.selectNode);
  const selectEdge = useGraphStore((state) => state.selectEdge);
  const setZoom = useGraphStore((state) => state.setZoom);

  const physics = useGraphStore((state) => state.physics);
  const colorGroups = useGraphStore((state) => state.colorGroups);
  const graphView = useGraphStore((state) => state.graphView);
  const localNodes = filteredNodes;
  const localEdges = filteredEdges;

  const topicMode = useMemo(
    () => localNodes.some(node => node.nodeProperties?.mode === 'topic'),
    [localNodes],
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
      if (roamTimeoutRef.current) {
        clearTimeout(roamTimeoutRef.current);
      }
    };
  }, []);



  const gridWidth = Math.round(width / 48) * 48;
  const gridHeight = Math.round(height / 48) * 48;

  const nodeIndex = useMemo(() => new Map(localNodes.map(node => [node.id, node])), [localNodes]);
  const layoutPositions = useMemo(
    () => topicMode
      ? buildTripstarBoundaryLayout(localNodes, localEdges, gridWidth, gridHeight)
      : buildCompactLayout(localNodes, localEdges, gridWidth, gridHeight),
    [localEdges, localNodes, gridHeight, topicMode, gridWidth],
  );

  const chartLayoutKey = useMemo(() => {
    const nodeSeed = localNodes.map(node => node.id).sort().join('|');
    const edgeSeed = localEdges.map(edge => edge.id).sort().join('|');
    return `${GRAPH_TOOLTIP_VERSION}:${topicMode ? 'topic-vos' : layoutMode}:${Math.round(gridWidth / 96)}:${Math.round(gridHeight / 96)}:${hashString(nodeSeed)}:${hashString(edgeSeed)}`;
  }, [localEdges, localNodes, gridHeight, layoutMode, topicMode, gridWidth]);

  // 瞬时监听 selectedNode, selectedEdge, zoom 变更，直接以 dispatchAction 操作 ECharts 实例，彻底避免 React 重新渲染
  useEffect(() => {
    const unsub = useGraphStore.subscribe((state) => {
      // 1. 处理 selectedNode 变化
      const currentSelectedNode = state.selectedNode;
      if (selectedNodeRef.current !== currentSelectedNode) {
        selectedNodeRef.current = currentSelectedNode;
        const instance = chartRef.current?.getEchartsInstance?.();
        if (instance) {
          if (currentSelectedNode) {
            const node = nodeIndex.get(currentSelectedNode);
            if (node) {
              instance.dispatchAction({
                type: 'select',
                seriesIndex: 0,
                name: node.id,
              });
              instance.dispatchAction({
                type: 'focusNodeAdjacency',
                seriesIndex: 0,
                name: node.id,
              });
            }
          } else {
            instance.dispatchAction({
              type: 'unfocusNodeAdjacency',
              seriesIndex: 0,
            });
            instance.dispatchAction({
              type: 'unselect',
              seriesIndex: 0,
              dataIndex: Array.from({ length: localNodes.length }, (_, i) => i),
            });
          }
          deferEChartsEventUpdate(() => {
            const latestInstance = chartRef.current?.getEchartsInstance?.();
            if (!latestInstance) return;
            const nextOption = getOptionRef.current?.();
            if (!nextOption) return;
            latestInstance.setOption(nextOption, { notMerge: true });
          });
        }
      }

      // 2. 处理 selectedEdge 变化
      selectedEdgeRef.current = state.selectedEdge;

      // 3. 处理 zoom 变化
      zoomRef.current = state.zoom ?? 0.72;
    });

    return () => unsub();
  }, [localNodes, nodeIndex]);





  // 监听容器物理尺寸变动，触发 ECharts 重新测量大小以防止裁切与硬位移偏移
  useEffect(() => {
    const instance = chartRef.current?.getEchartsInstance?.();
    if (instance) {
      instance.resize();
    }
  }, [gridWidth, gridHeight]);

  const getOption = useCallback(() => {
    const isBgLight = isLightColor(theme.background);
    const isBgTransparent = theme.background === 'transparent' || theme.background === 'rgba(0,0,0,0)';
    const isFgLight = isLightColor(theme.foreground);
    const isLightTheme = isBgTransparent ? !isFgLight : isBgLight;
    const isDark = !isLightTheme;
    const graphMotionEnabled = !reducedMotion;
    const focusNodeId = selectedNodeRef.current;
    const neighborIds = new Set<string>();
    if (focusNodeId) {
      neighborIds.add(focusNodeId);
      for (const edge of localEdges) {
        if (edge.source === focusNodeId) neighborIds.add(edge.target);
        if (edge.target === focusNodeId) neighborIds.add(edge.source);
      }
    }

    const localCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    const categoryColors = new Map<string, string>();

    for (const node of localNodes) {
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

    const echartsNodes = localNodes.map((node, nodeOrder) => {
      const categoryName = getCategoryName(node);
      const roleIndex = categoryIndexByName.get(categoryName) ?? 0;
      const localIndex = localCounts.get(categoryName) ?? 0;
      localCounts.set(categoryName, localIndex + 1);

      const isSelected = selectedNodeRef.current === node.id;
      const isHovered = false;
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
      const tripstarVisual = isTopicNode ? getTripstarNodeVisual(node) : null;
      const symbolSize = isTopicNode
        ? tripstarVisual!.size
        : Math.max(10, Math.min(56, node.nodeSize ? Math.max(node.nodeSize, baseSize) : baseSize));
      let color = isTopicNode && tripstarVisual ? tripstarVisual.start : getNodeColor(node);

      // 遍历自定义染色规则
      for (const group of colorGroups) {
        if (group.query.trim()) {
          const queryLower = group.query.toLowerCase();
          const labelMatch = node.nodeLabel.toLowerCase().includes(queryLower);
          const pathMatch = node.nodeProperties?.path
            ? String(node.nodeProperties.path).toLowerCase().includes(queryLower)
            : false;

          // 如果 query 是以 # 开头的 tag
          const isTagQuery = queryLower.startsWith('#');
          let tagMatch = false;
          if (isTagQuery && node.nodeProperties?.tags) {
            const cleanQueryTag = queryLower.slice(1);
            const tags = Array.isArray(node.nodeProperties.tags)
              ? node.nodeProperties.tags
              : typeof node.nodeProperties.tags === 'string'
                ? [node.nodeProperties.tags]
                : [];
            tagMatch = tags.some((t: string) => t.toLowerCase().includes(cleanQueryTag));
          }

          if (labelMatch || pathMatch || tagMatch) {
            color = group.color;
            break; // 首个匹配规则生效
          }
        }
      }
      const isOrphan = node.nodeProperties?.isOrphan === true;
      const isUnresolved = node.nodeProperties?.isUnresolved === true;

      const position = layoutPositions.get(node.id)
        ?? buildInitialPosition(node, localIndex, roleIndex, roleCounts.get(categoryName) ?? 1, gridWidth, gridHeight);
      const labelActive = isSelected || isNeighbor;
      const isNoteGraphNode = graphView === 'note' && node.nodeProperties?.mode === 'note';
      const labelVisible = true;
      const topicLabelLength = node.nodeLabel.trim().length;
      const labelFontSize = isTopicNode
        ? clampNumber(symbolSize / Math.max(4.8, topicLabelLength * 0.62), 7.5, symbolSize >= 58 ? 12 : 10.5)
        : isUnresolved ? 11
        : node.nodeProperties?.mode === 'note' ? 13
        : getAdaptiveFontSize(node, labelActive);

      const getItemStyle = () => {
        if (isUnresolved) {
          return {
            color: isDimmed ? 'rgba(248, 113, 113, 0.04)' : 'rgba(248, 113, 113, 0.08)',
            borderColor: isSelected ? '#f87171' : 'rgba(248, 113, 113, 0.86)',
            borderWidth: isSelected ? 2.4 : 2,
            borderType: 'dashed' as const,
            shadowBlur: isSelected ? 6 : 0,
            shadowColor: 'rgba(248, 113, 113, 0.35)',
            opacity: isDimmed ? 0.1 : 0.92,
          };
        }
        if (isOrphan) {
          return {
            color: isDimmed ? 'rgba(113, 113, 122, 0.04)' : 'rgba(113, 113, 122, 0.16)',
            borderColor: '#71717a',
            borderWidth: 1.5,
            borderType: 'dashed' as const,
            shadowBlur: 0,
            opacity: isDimmed ? 0.12 : 0.76,
          };
        }
        return {
          color: isTopicNode ? withAlpha(color, isDimmed ? 0.16 : 1) : withAlpha(color, isDimmed ? 0.09 : isSelected ? 0.95 : node.nodeProperties?.mode === 'note' ? 0.82 : isHovered ? 0.88 : 0.72),
          borderColor: isSelected
            ? theme.foreground
            : isHovered
              ? withAlpha(color, 0.72)
              : isTopicNode ? 'rgba(0,0,0,0)' : node.nodeProperties?.mode === 'note' ? withAlpha(color, 0.46) : withAlpha(color, 0.28),
          borderWidth: isTopicNode ? 0 : isSelected ? 2 : node.nodeProperties?.mode === 'note' ? 1.5 : isHovered ? 1.5 : 1,
          borderType: 'solid' as const,
          shadowBlur: isTopicNode ? 0 : isSelected ? 7 : node.nodeProperties?.mode === 'note' && connections > 0 ? 3 : 0,
          shadowColor: isTopicNode ? 'rgba(0,0,0,0)' : withAlpha(color, isSelected ? 0.22 : node.nodeProperties?.mode === 'note' ? 0.12 : isHovered ? 0.16 : 0),
          opacity: isDimmed ? 0.16 : 1,
        };
      };

      const finalX = position.x;
      const finalY = position.y;
      const isFixed = (topicMode || layoutMode !== 'force') ? (position.fixed ?? false) : false;

      // 墨色和暗边计算，用于在浅色/深色模式下自适应发光气泡的文字对比度
      const darkInkColor = mixColors('#111827', color, 0.22);
      const darkBorderColor = mixColors('#030712', color, 0.8);
      const isNodeColorLight = isLightColor(color);
      const labelPosition = isTopicNode
        ? 'inside'
        : isUnresolved ? 'right' : role === 'hub' || symbolSize >= 48 ? 'inside' : 'right';

      const getLabelColor = () => {
        if (isDimmed) {
          return isDark ? 'rgba(250, 250, 250, 0.46)' : 'rgba(64, 64, 64, 0.5)';
        }
        if (labelPosition === 'inside') {
          if (isTopicNode) {
            return isDark ? '#ffffff' : darkInkColor;
          }
          return isNodeColorLight ? '#111827' : '#ffffff';
        } else {
          const baseColor = isDark ? '#ffffff' : theme.foreground;
          if (isSelected || isHovered) {
            return baseColor;
          }
          return withAlpha(baseColor, 0.84);
        }
      };

      const getLabelBorderColor = () => {
        if (labelPosition === 'inside') {
          if (isTopicNode) {
            return isDark ? darkBorderColor : '#ffffff';
          }
          return isNodeColorLight ? '#ffffff' : mixColors('#030712', color, 0.8);
        } else {
          return isBgTransparent
            ? (isDark ? '#03080d' : '#ffffff')
            : theme.background;
        }
      };

      const labelColor = getLabelColor();
      const labelBorderColor = getLabelBorderColor();

      return {
        id: node.id,
        name: node.id,
        category: roleIndex,
        symbolSize: isSelected ? symbolSize + (isTopicNode ? 8 : 5) : symbolSize,
        symbol: isTopicNode ? getTripstarNodeSymbol(node) : (isOrphan || isUnresolved) ? 'circle' : SHAPE_MAP[node.nodeType] || 'circle',
        x: finalX,
        y: finalY,
        fixed: isFixed,
        value: connections,
        itemStyle: getItemStyle(),
        label: {
          show: labelVisible,
          position: labelPosition,
          formatter: (params: any) => {
            const name = String(params.data?.nodeData?.nodeLabel ?? params.data?.name ?? '');
            if (isTopicNode) return formatTopicCenterLabel(name);
            if (node.nodeProperties?.mode === 'note') return formatFullGraphLabel(name, isNoteGraphNode ? 14 : symbolSize >= 30 ? 12 : 10);
            return name;
          },
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          fontSize: labelFontSize,
          fontWeight: isTopicNode ? 650 : isSelected || role === 'hub' ? 600 : 500,
          color: isNeighbor && !isFocused ? withAlpha(labelColor, 0.9) : labelColor,
          textBorderColor: labelBorderColor,
          textBorderWidth: isTopicNode ? 1.15 : 2,
          textShadowBlur: isTopicNode ? 0 : 1,
          textShadowColor: isDark ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.1)',
          align: isTopicNode ? 'center' : undefined,
          verticalAlign: isTopicNode ? 'middle' : undefined,
          lineHeight: isTopicNode || node.nodeProperties?.mode === 'note' ? labelFontSize + 4 : undefined,
          distance: isTopicNode ? 0 : 6,
          overflow: isNoteGraphNode ? 'break' : 'truncate',
          width: isTopicNode
            ? Math.max(42, Math.round(symbolSize * 1.02))
            : isUnresolved ? 168
            : isNoteGraphNode ? 220
            : node.nodeProperties?.mode === 'note' ? 170
            : (isSelected || isHovered ? 140 : Math.max(60, Math.min(110, 50 + importance * 50))),
        },
        emphasis: {
          scale: false,
          itemStyle: {
            borderWidth: isTopicNode ? 0 : 1.5,
            borderColor: isTopicNode ? 'rgba(0,0,0,0)' : withAlpha(color, 0.58),
            shadowBlur: isTopicNode ? 0 : 7,
            shadowColor: withAlpha(color, 0.18),
          },
          label: {
            show: labelVisible,
            fontSize: labelFontSize,
            fontWeight: isTopicNode ? 650 : isSelected || role === 'hub' ? 600 : 500,
            color: isNeighbor && !isFocused ? withAlpha(labelColor, 0.9) : labelColor,
            distance: isTopicNode ? 0 : 6,
          },
        },
        nodeData: node,
        nodeOrder,
      };
    });

    const echartsEdges = localEdges.map(edge => {
      const isSelected = selectedEdgeRef.current === edge.id;
      const isHighlighted = focusNodeId === edge.source || focusNodeId === edge.target;
      const isFocusBridge = !!focusNodeId && edge.source !== focusNodeId && edge.target !== focusNodeId && neighborIds.has(edge.source) && neighborIds.has(edge.target);
      const isDimmed = !!focusNodeId && !isHighlighted;
      const isTopicEdge = edge.label === 'topic-cooccurrence' || edge.label === 'topic-semantic' || edge.label === 'rag-vector';
      const config = getEdgeConfig(edge);
      const weight = edge.weight ?? 1;
      const sourceColor = getGraphNodeDisplayColor(nodeIndex.get(edge.source) ?? ({ id: edge.source, nodeType: 'note', nodeLabel: edge.source, nodeProperties: {}, nodeMetadata: { createdAt: '', updatedAt: '' } } as GraphNode));
      const targetColor = getGraphNodeDisplayColor(nodeIndex.get(edge.target) ?? ({ id: edge.target, nodeType: 'note', nodeLabel: edge.target, nodeProperties: {}, nodeMetadata: { createdAt: '', updatedAt: '' } } as GraphNode));
      const opacity = isTopicEdge
        ? (isDimmed ? (isFocusBridge ? 0.06 : 0.006) : isSelected || isHighlighted ? 0.42 : Math.max(0.018, Math.min(0.09, 0.026 + Math.sqrt(weight) * 0.026)))
        : (isDimmed ? (isFocusBridge ? 0.12 : 0.012) : isSelected || isHighlighted ? 0.72 : Math.max(0.045, Math.min(0.28, 0.095 + Math.sqrt(weight) * 0.07)));
      const typedEdgeColor = edge.label === 'wikilink' || edge.label === 'semantic'
        ? null
        : config.color;

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        value: Math.max(1, Math.round(weight * 10)),
        lineStyle: {
          color: isTopicEdge
            ? withAlpha(theme.foreground, opacity)
            : typedEdgeColor
              ? withAlpha(typedEdgeColor, opacity)
              : {
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
            ? (isSelected ? 2.2 : isHighlighted ? 1.65 : 1)
            : (isSelected ? config.width + 1.5 : isHighlighted ? config.width + 1 : Math.max(0.5, config.width * Math.min(1.3, Math.sqrt(weight)))),
          type: isTopicEdge ? 'solid' : config.type,
          curveness: isTopicEdge ? 0.1 : localNodes.length > 90 ? 0.1 : 0.18,
          opacity: 1,
          shadowBlur: 0,
          shadowColor: withAlpha(sourceColor, 0),
        },
        emphasis: {
          lineStyle: {
            width: config.width + 1.1,
            color: typedEdgeColor ? withAlpha(typedEdgeColor, 0.82) : {
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
            opacity: 0.82,
            shadowBlur: 4,
            shadowColor: withAlpha(sourceColor, 0.16),
          },
        },
        edgeData: edge,
      };
    });

    const getForceConfig = () => {
      if (layoutMode === 'circular') {
        return {
          repulsion: physics.repulsion * 0.8,
          gravity: physics.gravity * 1.2,
          edgeLength: [physics.edgeLength, physics.edgeLength * 1.5],
          friction: 0.5,
          layoutAnimation: graphMotionEnabled,
        };
      }
      if (layoutMode === 'radial') {
        return {
          repulsion: physics.repulsion * 0.6,
          gravity: 0.3,
          edgeLength: [30, 80],
          friction: 0.52,
          layoutAnimation: graphMotionEnabled,
        };
      }
      return {
        repulsion: physics.repulsion,
        gravity: physics.gravity,
        edgeLength: [physics.edgeLength, physics.edgeLength * 1.5],
        friction: Math.max(0.46, physics.friction),
        layoutAnimation: graphMotionEnabled,
      };
    };

      return {
        backgroundColor: 'transparent',
      color: categories.map(category => category.itemStyle.color),
      tooltip: {
        trigger: 'item',
        confine: true,
        appendToBody: true,
        transitionDuration: 0.08,
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.76)' : 'rgba(255, 255, 255, 0.86)',
        borderColor: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.08)',
        borderWidth: 1,
        padding: [6, 8],
        extraCssText: 'pointer-events: none; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(15, 23, 42, 0.07); border-radius: 7px;',
        textStyle: {
          color: theme.foreground,
          fontSize: 11,
          lineHeight: 16,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        },
        formatter: (params: EChartsEventParams) => {
          if (params.dataType === 'node') {
            const nodeData = params.data?.nodeData;
            if (!nodeData) return '';

            const nodeColor = getNodeColor(nodeData);
            const textColor = theme.foreground;
            const mutedColor = theme.mutedForeground;
            const chipBgColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
            const isTopic = nodeData.nodeProperties?.mode === 'topic';
            const title = nodeData.nodeLabel;

            if (isTopic) {
              const noteCount = Number(nodeData.nodeProperties.noteCount ?? 0);
              const clusterLabel = String(nodeData.nodeProperties.clusterLabel ?? '主题');

              return `
                <div style="width: 150px; font-family: Inter, system-ui, sans-serif;">
                  <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                    <span style="width: 6px; height: 6px; border-radius: 999px; background-color: ${nodeColor}; display: inline-block; flex: 0 0 auto;"></span>
                    <span style="font-weight: 700; font-size: 12px; color: ${textColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${title}</span>
                  </div>
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; color: ${mutedColor};">
                    <span style="max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${clusterLabel}</span>
                    <span style="font-weight: 650; color: ${textColor}; background-color: ${chipBgColor}; padding: 1px 5px; border-radius: 999px;">${noteCount} 篇</span>
                  </div>
                </div>
              `;
            }

            const typeName = NODE_TYPE_LABELS[nodeData.nodeType] || nodeData.nodeType;
            const connections = nodeData.connections || 0;
            const path = nodeData.nodeProperties?.path;

            return `
              <div style="width: 160px; font-family: Inter, system-ui, sans-serif;">
                <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                  <span style="width: 6px; height: 6px; border-radius: 999px; background-color: ${nodeColor}; display: inline-block; flex: 0 0 auto;"></span>
                  <span style="font-weight: 700; font-size: 12px; color: ${textColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${title}</span>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; color: ${mutedColor};">
                  <span>${typeName}</span>
                  <span style="font-weight: 650; color: ${textColor}; background-color: ${chipBgColor}; padding: 1px 5px; border-radius: 999px;">${connections} 连接</span>
                </div>
                ${path ? `<div style="margin-top: 5px; color: ${mutedColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px;">${formatPath(String(path))}</div>` : ''}
              </div>
            `;
          }
          if (params.dataType === 'edge') {
            const edgeData = params.data?.edgeData;
            if (!edgeData) return '';
            const config = getEdgeConfig(edgeData);
            const source = nodeIndex.get(edgeData.source)?.nodeLabel ?? edgeData.source;
            const target = nodeIndex.get(edgeData.target)?.nodeLabel ?? edgeData.target;
            const textColor = theme.foreground;
            const mutedColor = theme.mutedForeground;
            const confidence = edgeData.confidence ? `${(edgeData.confidence * 100).toFixed(0)}% 相关` : '';
            const sourceLabel = edgeData.metadata?.source ? String(edgeData.metadata.source) : '';

            return `
              <div style="width: 172px; font-family: Inter, system-ui, sans-serif;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <span style="font-weight: 700; font-size: 12px; color: ${textColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${config.label}</span>
                  ${confidence ? `<span style="font-size: 10px; color: ${mutedColor}; white-space: nowrap;">${confidence}</span>` : ''}
                </div>
                <div style="margin-top: 5px; color: ${mutedColor}; font-size: 11px; line-height: 1.45;">
                  <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${source}
                  </div>
                  <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="color: ${textColor};">→</span> ${target}
                  </div>
                </div>
                ${sourceLabel ? `<div style="margin-top: 5px; color: ${mutedColor}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px;">${sourceLabel}</div>` : ''}
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
      animationDuration: reducedMotion ? 0 : (topicMode ? 1500 : 1100),
      animationDurationUpdate: reducedMotion ? 0 : 900,
      animationDelay: (index: number) => graphMotionEnabled ? Math.min(420, index * (topicMode ? 6 : 4)) : 0,
      animationDelayUpdate: () => 0,
      animationEasing: 'quinticOut',
      animationEasingUpdate: 'quinticInOut',
      series: [{
        id: GRAPH_SERIES_ID,
        type: 'graph',
        layout: topicMode ? 'force' : (layoutMode === 'circular' || layoutMode === 'radial') ? 'circular' : 'force',
        data: echartsNodes,
        links: echartsEdges,
        categories,
        roam: true,
        draggable: false,
        zoom: zoomRef.current,
        center: panCenterRef.current,
        cursor: 'pointer',
        force: topicMode
          ? {
            initLayout: 'none',
            repulsion: physics.repulsion,
            gravity: physics.gravity,
            edgeLength: [physics.edgeLength, physics.edgeLength * 1.5],
            friction: Math.max(0.44, physics.friction),
            layoutAnimation: graphMotionEnabled,
          }
          : getForceConfig(),
        circular: {
          rotateLabel: true,
        },
        edgeSymbol: topicMode ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: topicMode ? [0, 8] : [0, 0],
        emphasis: {
          focus: 'adjacency',
          blurScope: 'coordinateSystem',
          scale: false,
          itemStyle: {
            borderWidth: 2,
            borderColor: theme.foreground,
            shadowBlur: 4,
            shadowColor: withAlpha(theme.primary, 0.12),
          },
          lineStyle: {
            width: 1.5,
            shadowBlur: 0,
            shadowColor: withAlpha(theme.primary, 0),
          },
        },
        blur: {
          itemStyle: { opacity: 0.12 },
          lineStyle: { opacity: 0.025 },
          label: { opacity: 0.44 },
        },
        scaleLimit: {
          min: 0.32,
          max: 4.2,
        },
        labelLayout: {
          hideOverlap: false,
          moveOverlap: 'shiftY',
          maxLines: topicMode ? 2 : 4,
        },
        selectedMode: 'single',
        select: {
          itemStyle: {
            borderWidth: 2,
            borderColor: theme.foreground,
            shadowBlur: 6,
            shadowColor: withAlpha(theme.primary, 0.18),
          },
        },
        lineStyle: {
          opacity: 0.65,
        },
      }],
    };
  }, [
    localNodes,
    localEdges,
    gridHeight,
    layoutMode,
    layoutPositions,
    nodeIndex,
    reducedMotion,
    theme,
    topicMode,
    gridWidth,
    physics,
    colorGroups,
  ]);

  useEffect(() => {
    getOptionRef.current = getOption;
  }, [getOption]);

  useEffect(() => {
    if (!apiRef) return;
    const api = apiRef;
    api.current = {
      zoomIn: () => {
        const instance = chartRef.current?.getEchartsInstance?.();
        if (!instance) return;
        const next = Math.min(4.5, Number(((zoomRef.current || 1) * 1.22).toFixed(2)));
        instance.setOption({ series: [{ id: GRAPH_SERIES_ID, type: 'graph', zoom: next }] });
        setZoom(next);
        zoomRef.current = next;
      },
      zoomOut: () => {
        const instance = chartRef.current?.getEchartsInstance?.();
        if (!instance) return;
        const next = Math.max(0.28, Number(((zoomRef.current || 1) * 0.82).toFixed(2)));
        instance.setOption({ series: [{ id: GRAPH_SERIES_ID, type: 'graph', zoom: next }] });
        setZoom(next);
        zoomRef.current = next;
      },
      fitView: () => {
        const instance = chartRef.current?.getEchartsInstance?.();
        if (!instance) return;
        instance.setOption({ series: [{ id: GRAPH_SERIES_ID, type: 'graph', zoom: 0.72, center: ['50%', '50%'] }] });
        setZoom(0.72);
        zoomRef.current = 0.72;
        panCenterRef.current = ['50%', '50%'];
      },
      refresh: () => {
        const instance = chartRef.current?.getEchartsInstance?.();
        if (!instance) return;
        instance.setOption(getOption(), { notMerge: true });
      },
    };
    return () => {
      api.current = null;
    };
  }, [apiRef, getOption, setZoom]);

  const onEvents = useMemo(() => ({
    click: (params: EChartsEventParams) => {
      const clickedNodeId = params.data?.nodeData?.id ?? params.data?.id;
      const clickedEdgeId = params.data?.edgeData?.id ?? params.data?.id;
      const isNodeClick = !!clickedNodeId && (params.dataType === 'node' || !!params.data?.nodeData || !params.dataType);
      const isEdgeClick = !!clickedEdgeId && params.dataType === 'edge';

      deferEChartsEventUpdate(() => {
        if (isNodeClick && clickedNodeId) {
          selectNode(clickedNodeId);
          selectEdge(null);
          onNodeClick?.(clickedNodeId);
        } else if (isEdgeClick && clickedEdgeId) {
          selectEdge(clickedEdgeId);
          selectNode(null);
        } else {
          selectNode(null);
          selectEdge(null);
        }
      });
    },
    graphRoam: () => {
      if (roamTimeoutRef.current) {
        clearTimeout(roamTimeoutRef.current);
      }
      roamTimeoutRef.current = setTimeout(() => {
        const instance = chartRef.current?.getEchartsInstance?.();
        const option = instance?.getOption?.();
        const series = Array.isArray(option?.series) ? option.series : [];
        if (series[0]) {
          const nextZoom = Number(series[0].zoom ?? 1);
          const nextCenter = series[0].center ?? ['50%', '50%'];
          const currentZoom = useGraphStore.getState().zoom;
          if (Math.abs(currentZoom - nextZoom) > 0.01) {
            setZoom(nextZoom);
          }
          zoomRef.current = nextZoom;
          panCenterRef.current = nextCenter;
        }
      }, 150);
    },
  }), [onNodeClick, selectEdge, selectNode, setZoom]);

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
    <div className="relative h-full w-full bg-background">
      <ReactECharts
        ref={chartRef}
        key={`lingmo-knowledge-graph-canvas-${chartLayoutKey}`}
        option={getOption()}
        style={{ width: '100%', height: '100%' }}
        onEvents={onEvents}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
    </div>
  );
}
