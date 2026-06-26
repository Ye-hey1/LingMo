'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from './store/graph-store';
import { EChartsGraph } from './components/echarts-graph';
import { DetailPanel } from './components/detail-panel';
import { SearchDialog } from './components/search-dialog';
import { FilterPanel } from './components/filter-panel';
import { ExportDialog } from './components/export-dialog';
import { ContextMenu } from './components/context-menu';
import { PathFinder } from './components/path-finder';
import { EmptyGraphState } from './components/empty-graph-state';
import { PanelContainer } from './components/graph-layout-optimized';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, RefreshCw, Search, Filter, Maximize, GitBranch, Network, Layers3 } from 'lucide-react';
import useArticleStore from '@/stores/article';
import emitter from '@/lib/emitter';
import { cn } from '@/lib/utils';
import type { GraphFilters } from './types';

type LegendFilter = Pick<GraphFilters, 'nodeKinds' | 'nodeModes' | 'edgeLabels' | 'edgeSources'>;

interface LegendItem {
  id: string;
  label: string;
  value: number;
  color: string;
  filter: LegendFilter;
}

const NOTE_RELATION_LEGEND: Array<{ id: string; label: string; edgeLabel: string; color: string }> = [
  { id: 'wikilink', label: '双链', edgeLabel: 'wikilink', color: '#64748b' },
  { id: 'references', label: '引用', edgeLabel: 'references', color: '#d97706' },
  { id: 'extends', label: '延伸', edgeLabel: 'extends', color: '#f59e0b' },
  { id: 'supports', label: '支撑', edgeLabel: 'supports', color: '#16a34a' },
  { id: 'contradicts', label: '矛盾', edgeLabel: 'contradicts', color: '#ef4444' },
  { id: 'analogous', label: '类比', edgeLabel: 'analogous', color: '#8b5cf6' },
  { id: 'example-of', label: '示例', edgeLabel: 'example-of', color: '#06b6d4' },
  { id: 'uses', label: '使用', edgeLabel: 'uses', color: '#22c55e' },
  { id: 'part-of', label: '属于', edgeLabel: 'part-of', color: '#6366f1' },
  { id: 'semantic', label: '向量语义', edgeLabel: 'semantic', color: '#059669' },
];

const NOTE_SOURCE_LEGEND: Array<{ id: string; label: string; source: string; color: string }> = [
  { id: 'source-cross', label: '交叉验证', source: 'cross_validated', color: '#0f766e' },
  { id: 'source-llm', label: 'AI', source: 'llm', color: '#7c3aed' },
  { id: 'source-keyword', label: '关键词', source: 'keyword', color: '#ca8a04' },
  { id: 'source-frontmatter', label: '显式', source: 'frontmatter', color: '#d97706' },
];

function edgeSourcesOf(edge: { label: string; metadata?: { sourceMethod?: string; sourceMethods?: string[] } }) {
  return Array.from(new Set([
    ...(edge.metadata?.sourceMethods ?? []),
    edge.metadata?.sourceMethod,
    edge.label === 'wikilink' ? 'wikilink' : undefined,
    edge.label === 'semantic' ? 'cosine' : undefined,
  ].filter(Boolean) as string[]));
}

function sameStringArray(left?: readonly string[], right?: readonly string[]) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

export function KnowledgeGraphECharts() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphStageRef = useRef<HTMLDivElement>(null);
  const graphApiRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    fitView: () => void;
    refresh: () => void;
  } | null>(null);
  const [stageDimensions, setStageDimensions] = useState({ width: 0, height: 0 });
  const [showPathFinder, setShowPathFinder] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: any | null;
    edge: any | null;
  } | null>(null);
  const [isGeneratingVectors, setIsGeneratingVectors] = useState(false);
  const openTabs = useArticleStore((state) => state.openTabs);
  const fileTree = useArticleStore((state) => state.fileTree);
  const newFile = useArticleStore((state) => state.newFile);
  const setActiveFilePath = useArticleStore((state) => state.setActiveFilePath);

  const {
    loadGraph,
    invalidateCache,
    filteredNodes,
    filteredEdges,
    filters,
    setFilters,
    selectedNode,
    nodesMapping,
    showDetailPanel,
    showFilterPanel,
    showExportDialog,
    isLoading,
    error,
    clearError,
    selectNode,
    selectEdge,
    toggleSearchDialog,
    toggleFilterPanel,
    fitView,
    deleteNode,
    nodes,
    edges,
    graphMode,
    graphView,
    setGraphMode,
    setGraphView,
  } = useGraphStore();

  const openTabSignature = useMemo(() => {
    const notePaths = [
      ...(openTabs ?? []).filter(tab =>
        !tab.isFolder &&
        tab.path &&
        !tab.path.startsWith('lingmo://') &&
        /\.(md|markdown|mdx|txt)$/i.test(tab.path),
      ).map(tab => tab.path.replace(/\\/g, '/')),
    ]
      .filter((path): path is string => Boolean(path))
      .filter(path => !path.startsWith('lingmo://') && /\.(md|markdown|mdx|txt)$/i.test(path));

    return Array.from(new Set(notePaths)).sort().join('|');
  }, [openTabs]);
  const openNoteCount = openTabSignature ? openTabSignature.split('|').length : 0;

  const localNodeCount = filteredNodes.length;
  const localEdgeCount = filteredEdges.length;
  const focusedNode = selectedNode ? nodesMapping.get(selectedNode) || null : null;

  useEffect(() => {
    const timer = graphMode === 'local'
      ? window.setTimeout(() => {
        void loadGraph();
      }, 420)
      : window.setTimeout(() => {
        void loadGraph();
      }, 0);

    return () => window.clearTimeout(timer);
  }, [graphMode, graphView, openTabSignature, loadGraph]);

  // Saved content is the only passive event that should invalidate graph snapshots.
  useEffect(() => {
    const handleArticleSaved = () => {
      invalidateCache();
    };
    emitter.on('article-saved', handleArticleSaved);
    return () => {
      emitter.off('article-saved', handleArticleSaved);
    };
  }, [invalidateCache]);

  // 检测空状态
  const isLocalWithoutOpenNotes = graphMode === 'local' && openNoteCount === 0;
  const isLocalWithoutTopics = graphMode === 'local' && openNoteCount > 0 && nodes.length === 0;
  const isEmptyGraph = !isLoading && !error && nodes.length === 0 && !isLocalWithoutOpenNotes && !isLocalWithoutTopics;
  const hasNotes = (fileTree?.length ?? 0) > 0;
  const noteCount = fileTree?.reduce((count, item) => {
    if (item.isFile && item.name.endsWith('.md')) return count + 1;
    if (item.children) {
      const childCount = item.children.reduce((subCount, child) =>
        subCount + (child.isFile && child.name.endsWith('.md') ? 1 : 0), 0);
      return count + childCount;
    }
    return count;
  }, 0) ?? 0;

  // 检测是否有向量数据（通过检查是否有图谱节点来判断）
  const hasVectors = nodes.length > 0 || !isLoading;
  const hubCount = nodes.filter(node => node.kind === 'hub').length;
  const visibleTopicCount = nodes.filter(node => node.nodeProperties?.mode === 'topic').length;
  const visibleNoteCount = nodes.filter(node => node.nodeType === 'note').length;
  const visibleSemanticCount = edges.filter(edge => edge.label === 'topic-semantic').length;
  const visibleCooccurrenceCount = edges.filter(edge => edge.label === 'topic-cooccurrence').length;
  const visibleRagCount = edges.filter(edge => edge.label === 'rag-vector').length;
  const noteRelationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(String(edge.label), (counts.get(String(edge.label)) ?? 0) + 1);
    }
    return counts;
  }, [edges]);
  const noteSourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      for (const source of edgeSourcesOf(edge)) {
        counts.set(source, (counts.get(source) ?? 0) + 1);
      }
    }
    return counts;
  }, [edges]);
  const legendItems = useMemo<LegendItem[]>(() => graphView === 'note'
    ? [
      { id: 'notes', label: '笔记', value: visibleNoteCount, color: '#60a5fa', filter: { nodeModes: ['note'] } },
      { id: 'hub', label: '核心', value: hubCount, color: '#f97316', filter: { nodeKinds: ['hub'] } },
      ...NOTE_RELATION_LEGEND
        .map(item => ({
          id: item.id,
          label: item.label,
          value: noteRelationCounts.get(item.edgeLabel) ?? 0,
          color: item.color,
          filter: { edgeLabels: [item.edgeLabel] },
        }))
        .filter(item => item.value > 0 || item.id === 'wikilink' || item.id === 'semantic'),
      ...NOTE_SOURCE_LEGEND
        .map(item => ({
          id: item.id,
          label: item.label,
          value: noteSourceCounts.get(item.source) ?? 0,
          color: item.color,
          filter: { edgeSources: [item.source] },
        }))
        .filter(item => item.value > 0),
    ]
    : [
      { id: 'topics', label: '主题', value: visibleTopicCount, color: '#10b981', filter: { nodeModes: ['topic'] } },
      { id: 'hub', label: '核心', value: hubCount, color: '#f59e0b', filter: { nodeKinds: ['hub'] } },
      { id: 'cooccurrence', label: '共现', value: visibleCooccurrenceCount, color: '#94a3b8', filter: { edgeLabels: ['topic-cooccurrence'] } },
      { id: 'semantic', label: '语义', value: visibleSemanticCount, color: '#059669', filter: { edgeLabels: ['topic-semantic'] } },
      { id: 'vector', label: '向量', value: visibleRagCount, color: '#0f766e', filter: { edgeLabels: ['rag-vector'] } },
    ], [graphView, hubCount, noteRelationCounts, noteSourceCounts, visibleCooccurrenceCount, visibleNoteCount, visibleRagCount, visibleSemanticCount, visibleTopicCount]);

  const isLegendItemActive = useCallback((item: LegendItem) => {
    const itemNodeKinds = item.filter.nodeKinds ? [...item.filter.nodeKinds] : undefined;
    const itemNodeModes = item.filter.nodeModes ? [...item.filter.nodeModes] : undefined;
    const itemEdgeLabels = item.filter.edgeLabels;
    const itemEdgeSources = item.filter.edgeSources;
    return (
      sameStringArray(filters.nodeKinds, itemNodeKinds) &&
      sameStringArray(filters.nodeModes, itemNodeModes) &&
      sameStringArray(filters.edgeLabels, itemEdgeLabels) &&
      sameStringArray(filters.edgeSources, itemEdgeSources)
    );
  }, [filters.edgeLabels, filters.edgeSources, filters.nodeKinds, filters.nodeModes]);

  const toggleLegendFilter = useCallback((item: LegendItem) => {
    if (isLegendItemActive(item)) {
      setFilters({ nodeKinds: undefined, nodeModes: undefined, edgeLabels: undefined, edgeSources: undefined });
      return;
    }

    setFilters({
      nodeKinds: item.filter.nodeKinds ? [...item.filter.nodeKinds] : undefined,
      nodeModes: item.filter.nodeModes ? [...item.filter.nodeModes] : undefined,
      edgeLabels: item.filter.edgeLabels,
      edgeSources: item.filter.edgeSources,
    });
  }, [isLegendItemActive, setFilters]);

  useEffect(() => {
    const element = graphStageRef.current;
    if (!element) return;

    const updateDimensions = () => {
      const rect = element.getBoundingClientRect();
      setStageDimensions({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(320, Math.floor(rect.height)),
      });
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        toggleSearchDialog();
      }

      if (event.key === 'Escape') {
        selectNode(null);
        selectEdge(null);
        setContextMenu(null);
      }

      if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey) {
        const store = useGraphStore.getState();
        if (store.selectedNode) {
          void store.deleteNode(store.selectedNode);
        }
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement;
      const nodeElement = target.closest('[data-node-id]');
      const edgeElement = target.closest('[data-edge-id]');

      if (nodeElement) {
        setContextMenu({ x: event.clientX, y: event.clientY, node: null, edge: null });
      } else if (edgeElement) {
        const edgeId = edgeElement.getAttribute('data-edge-id');
        const edge = filteredEdges.find(e => e.id === edgeId);
        if (edge) {
          setContextMenu({ x: event.clientX, y: event.clientY, node: null, edge });
        }
      } else {
        setContextMenu({ x: event.clientX, y: event.clientY, node: null, edge: null });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [toggleSearchDialog, selectNode, selectEdge, filteredEdges]);

  // 处理生成向量数据
  const handleGenerateVectors = useCallback(async () => {
    setIsGeneratingVectors(true);
    try {
      const { processAllMarkdownFiles } = await import('@/lib/rag');
      await processAllMarkdownFiles();
      // 重新加载图谱
      await loadGraph({ force: true });
    } catch (error) {
      console.error('Failed to generate vectors:', error);
    } finally {
      setIsGeneratingVectors(false);
    }
  }, [loadGraph]);

  // 处理创建笔记
  const handleCreateNote = useCallback(() => {
    // 触发新建笔记
    newFile();
    // 关闭知识图谱标签页，让用户专注于创建笔记
    setActiveFilePath('');
  }, [newFile, setActiveFilePath]);

  const handleContextMenuAction = useCallback(async (action: string) => {
    if (!contextMenu) return;

    switch (action) {
      case 'focus':
        if (contextMenu.node) {
          selectNode(contextMenu.node.id);
        }
        break;
      case 'open':
        if (contextMenu.node?.nodeProperties?.path) {
          const useArticleStore = (await import('@/stores/article')).default;
          useArticleStore.getState().setActiveFilePath(contextMenu.node.nodeProperties.path);
        }
        break;
      case 'copy':
        if (contextMenu.node?.nodeProperties?.path) {
          await navigator.clipboard.writeText(contextMenu.node.nodeProperties.path);
        }
        break;
      case 'expand':
        if (contextMenu.node) {
          void useGraphStore.getState().loadNeighbors(contextMenu.node.id);
        }
        break;
      case 'delete':
        if (contextMenu.node) {
          void deleteNode(contextMenu.node.id);
        }
        break;
      case 'zoom-in':
        graphApiRef.current?.zoomIn();
        break;
      case 'zoom-out':
        graphApiRef.current?.zoomOut();
        break;
      case 'fit-view':
        graphApiRef.current?.fitView();
        break;
      case 'refresh':
        graphApiRef.current?.refresh();
        break;
    }

    setContextMenu(null);
  }, [contextMenu, selectNode, deleteNode]);

  const handleNodeClick = useCallback((nodeId: string) => {
    selectNode(nodeId);
  }, [selectNode]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">

      {/* 空状态 */}
      {isEmptyGraph ? (
        <EmptyGraphState
          hasNotes={hasNotes}
          hasVectors={hasVectors}
          noteCount={noteCount}
          onGenerateVectors={handleGenerateVectors}
          onCreateNote={handleCreateNote}
          onRefresh={() => void loadGraph({ force: true })}
          isLoading={isGeneratingVectors}
        />
      ) : error ? (
        <div className="relative z-[1] flex h-full w-full items-center justify-center px-6">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <AlertCircle className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">知识图谱加载失败</div>
                <div className="mt-0.5 text-xs text-muted-foreground">笔记索引或关系数据暂时不可用</div>
              </div>
            </div>
            <p className="mb-4 rounded-md bg-muted/55 px-3 py-2 text-xs leading-5 text-muted-foreground">{error}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={clearError}>
                忽略
              </Button>
              <Button size="sm" onClick={() => { clearError(); void loadGraph({ force: true }); }}>
                <RefreshCw className="h-3.5 w-3.5" />
                重新加载
              </Button>
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="relative z-[1] flex h-full w-full items-center justify-center">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在分析笔记关系
          </div>
        </div>
      ) : (
        <div className="relative flex-1 h-full min-h-0 w-full overflow-hidden">
          {/* ECharts 画布 - 全屏铺满 */}
          <div ref={graphStageRef} className="absolute inset-0 h-full w-full overflow-hidden bg-[#03080d]">
            <EChartsGraph
              width={stageDimensions.width || 720}
              height={stageDimensions.height || 520}
              onNodeClick={handleNodeClick}
              apiRef={graphApiRef}
            />
          </div>

          {/* 局域图谱未激活提示 */}
          {isLocalWithoutOpenNotes && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#03080d]/65 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border/40 bg-background/85 px-6 py-5 text-center shadow-2xl backdrop-blur-md max-w-sm pointer-events-auto animate-in fade-in zoom-in-95 duration-200">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Network className="h-5 w-5" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">未激活局部跟随</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  请在编辑器中打开一篇或多篇 Markdown 笔记，图谱会跟随这些文章生成局部主题与聚类分析。
                </p>
              </div>
            </div>
          )}

          {isLocalWithoutTopics && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#03080d]/45 backdrop-blur-sm">
              <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border/40 bg-background/85 px-6 py-5 text-center shadow-2xl backdrop-blur-md pointer-events-auto animate-in fade-in zoom-in-95 duration-200">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Layers3 className="h-5 w-5" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">暂未提取到局部主题</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  当前已跟随 {openNoteCount} 篇打开的笔记。请确认内容包含可分析的段落、标题或双链引用，刷新后会重新生成局部图谱。
                </p>
              </div>
            </div>
          )}
 
          {/* 顶部工作栏 */}
          <div className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-white/[0.08] bg-background/72 px-4 text-foreground backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2 select-none">
              <Network className="h-4 w-4 text-primary/80" />
              <span className="text-sm font-semibold text-foreground">知识图谱</span>
              <div className="ml-1 flex items-center rounded-md bg-muted/70 p-0.5">
                {(['topic', 'note'] as const).map(view => (
                  <button
                    key={view}
                    type="button"
                    className={cn(
                      'rounded px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                      graphView === view && 'bg-background text-foreground shadow-sm shadow-black/10',
                    )}
                    onClick={() => setGraphView(view)}
                  >
                    {view === 'topic' ? '主题' : '笔记'}
                  </button>
                ))}
              </div>
              <span className="h-3 w-px bg-border" />
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {localNodeCount} {graphView === 'note' ? '笔记' : '主题'} · {localEdgeCount} 关系
                {graphMode === 'local' && openNoteCount > 0 ? ` · ${openNoteCount} 篇打开` : ''}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  graphMode === 'local' && "bg-muted text-foreground"
                )}
                title={graphMode === 'local' ? "切换到全局模式" : "切换到局域跟随模式"}
                onClick={() => setGraphMode(graphMode === 'local' ? 'global' : 'local')}
              >
                <Layers3 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="搜索" onClick={toggleSearchDialog}>
                <Search className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="筛选" onClick={toggleFilterPanel}>
                <Filter className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="适应视图" onClick={fitView}>
                <Maximize className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="刷新" onClick={() => void loadGraph({ force: true })}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="路径查找" onClick={() => setShowPathFinder(!showPathFinder)}>
                <GitBranch className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {focusedNode ? (
            <div className="absolute left-4 top-[58px] z-20 flex max-w-[min(420px,calc(100%-2rem))] items-center gap-2 rounded-md border border-border/60 bg-background/90 px-2.5 py-1.5 text-xs text-foreground shadow-none backdrop-blur-sm">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: focusedNode.nodeColor || '#737373' }} />
              <span className="min-w-0 truncate">
                正在聚焦 <span className="font-medium">{focusedNode.nodeLabel}</span> 的一跳邻域
              </span>
              <button
                type="button"
                className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => selectNode(null)}
              >
                退出
              </button>
            </div>
          ) : null}

          {/* 底部图谱统计 */}
          <div className="absolute inset-x-3 bottom-4 z-20 flex justify-center overflow-x-auto overflow-y-hidden px-1 text-foreground select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center justify-center gap-2 sm:gap-2.5">
            {legendItems.map(item => {
              const active = isLegendItemActive(item);
              return (
                <button
                  type="button"
                  key={item.label}
                  disabled={item.value === 0}
                  aria-pressed={active}
                  title={active ? `取消筛选：${item.label}` : `只看${item.label}`}
                  onClick={() => toggleLegendFilter(item)}
                  className={cn(
                    'pointer-events-auto flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
                    active
                      ? 'border-foreground/22 bg-foreground text-background shadow-none'
                      : 'border-black/5 bg-white/72 text-slate-700 hover:bg-white/90 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:bg-slate-950/55',
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full shadow-none dark:shadow-[0_0_0_2px_rgba(255,255,255,0.08)]"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.label}</span>
                  <span className={cn('font-semibold tabular-nums', active ? 'text-background' : 'text-slate-900 dark:text-slate-50')}>{item.value}</span>
                </button>
              );
            })}
            </div>
          </div>

          {/* 详情面板 */}
          {showDetailPanel && (
            <PanelContainer
              position="right"
              width="w-[min(340px,calc(100%-1.5rem))]"
              hideHeader
              onClose={() => selectNode(null)}
            >
              <DetailPanel />
            </PanelContainer>
          )}

          {/* 路径查找 */}
          {showPathFinder && (
            <PanelContainer
              position="right"
              onClose={() => setShowPathFinder(false)}
            >
              <PathFinder onClose={() => setShowPathFinder(false)} />
            </PanelContainer>
          )}

          {/* 筛选面板 */}
          {showFilterPanel && (
            <div className="absolute right-3 top-[56px] z-30 w-[min(268px,calc(100%-1rem))] overflow-hidden rounded-lg border border-border/55 bg-background/98 shadow-[0_8px_22px_rgba(15,23,42,0.09)] backdrop-blur-sm animate-in fade-in slide-in-from-top-1 duration-200 text-foreground dark:shadow-[0_8px_24px_rgba(0,0,0,0.26)]">
              <FilterPanel />
            </div>
          )}

          <SearchDialog />
          {showExportDialog && <ExportDialog />}

          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              node={contextMenu.node}
              edge={contextMenu.edge}
              onClose={() => setContextMenu(null)}
              onAction={handleContextMenuAction}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default KnowledgeGraphECharts;
