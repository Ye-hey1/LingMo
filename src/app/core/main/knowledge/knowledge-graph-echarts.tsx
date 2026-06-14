'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore, type NodeType } from './store/graph-store';
import { EChartsGraph } from './components/echarts-graph';
import { GraphToolbar } from './components/toolbar';
import { DetailPanel } from './components/detail-panel';
import { SearchDialog } from './components/search-dialog';
import { FilterPanel } from './components/filter-panel';
import { ExportDialog } from './components/export-dialog';
import { ContextMenu } from './components/context-menu';
import { Minimap } from './components/minimap';
import { PathFinder } from './components/path-finder';
import { Button } from '@/components/ui/button';
import { AlertCircle, GitBranch, Loader2, RefreshCw } from 'lucide-react';

type LayoutMode = 'force' | 'circular' | 'tree' | 'radial';

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  note: '笔记',
  concept: '概念',
  person: '人物',
  project: '项目',
  tag: '标签',
};

function formatFilterSummary(filters: ReturnType<typeof useGraphStore.getState>['filters']) {
  const items: string[] = [];
  if (filters.types?.length) {
    items.push(filters.types.map(type => NODE_TYPE_LABELS[type] ?? type).join('、'));
  }
  if (filters.search) items.push(`搜索「${filters.search}」`);
  if (filters.minConnections !== undefined) items.push(`≥ ${filters.minConnections} 连接`);
  if (filters.maxConnections !== undefined) items.push(`≤ ${filters.maxConnections} 连接`);
  return items;
}

export function KnowledgeGraphECharts() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [showPathFinder, setShowPathFinder] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: any | null;
    edge: any | null;
  } | null>(null);

  const {
    loadGraph,
    nodes,
    edges,
    filteredNodes,
    filteredEdges,
    filters,
    nodesMapping,
    selectedNode,
    showDetailPanel,
    showFilterPanel,
    showExportDialog,
    isLoading,
    error,
    clearError,
    selectNode,
    selectEdge,
    toggleSearchDialog,
    zoom,
    setZoom,
    fitView,
    deleteNode,
  } = useGraphStore();

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateDimensions = () => {
      const rect = element.getBoundingClientRect();
      setDimensions({
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
        const nodeId = nodeElement.getAttribute('data-node-id');
        const node = nodesMapping.get(nodeId || '');
        if (node) {
          setContextMenu({ x: event.clientX, y: event.clientY, node, edge: null });
        }
      } else if (edgeElement) {
        const edgeId = edgeElement.getAttribute('data-edge-id');
        const edge = edges.find(e => e.id === edgeId);
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
  }, [toggleSearchDialog, selectNode, selectEdge, nodesMapping, edges]);

  const stats = useMemo(() => {
    const hubCount = nodes.filter(node => node.kind === 'hub').length;
    const ragEdgeCount = edges.filter(edge => edge.label === 'rag-vector' || edge.label === 'topic-semantic').length;
    const chunkCount = nodes.reduce((sum, node) => sum + Number(node.nodeProperties?.chunkCount ?? 0), 0);
    return {
      hubCount,
      ragEdgeCount,
      chunkCount,
      visibleRatio: nodes.length > 0 ? Math.round((filteredNodes.length / nodes.length) * 100) : 0,
    };
  }, [edges, filteredNodes.length, nodes]);

  const filterSummary = useMemo(() => formatFilterSummary(filters), [filters]);
  const selectedNodeLabel = selectedNode ? nodesMapping.get(selectedNode)?.nodeLabel : null;

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
        setZoom(Number((zoom * 1.22).toFixed(2)));
        break;
      case 'zoom-out':
        setZoom(Number((zoom * 0.82).toFixed(2)));
        break;
      case 'fit-view':
        fitView();
        break;
      case 'refresh':
        void loadGraph();
        break;
    }

    setContextMenu(null);
  }, [contextMenu, selectNode, deleteNode, setZoom, zoom, fitView, loadGraph]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">

      {error ? (
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
              <Button size="sm" onClick={() => { clearError(); void loadGraph(); }}>
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
        <>
          <GraphToolbar
            layoutMode={layoutMode}
            onLayoutChange={setLayoutMode}
            onPathFinder={() => setShowPathFinder(!showPathFinder)}
          />

          <div className="pointer-events-none absolute right-3 top-3 z-10 hidden max-w-[36rem] items-center justify-end gap-1.5 text-[11px] text-muted-foreground lg:flex">
            <Metric label="主题" value={filteredNodes.length} mutedValue={nodes.length !== filteredNodes.length ? `/${nodes.length}` : undefined} />
            <Metric label="链接" value={filteredEdges.length} mutedValue={edges.length !== filteredEdges.length ? `/${edges.length}` : undefined} />
            <Metric label="RAG 边" value={stats.ragEdgeCount} />
            <Metric label="切块" value={stats.chunkCount} />
            <Metric label="可见" value={`${stats.visibleRatio}%`} />
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-10">
            <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
                <GitBranch className="h-3.5 w-3.5" />
              </span>
              <span className="font-medium">LingMo Topics</span>
              <span className="text-muted-foreground">RAG cluster map</span>
            </div>
          </div>

          {(filterSummary.length > 0 || selectedNodeLabel) ? (
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex max-w-[42rem] flex-wrap justify-end gap-1.5 text-[11px]">
              {filterSummary.map(item => (
                <span key={item} className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                  {item}
                </span>
              ))}
              {selectedNodeLabel ? (
                <span className="max-w-[16rem] truncate rounded-md bg-foreground px-2 py-1 text-background">
                  已选：{selectedNodeLabel}
                </span>
              ) : null}
            </div>
          ) : null}

          <EChartsGraph
            width={dimensions.width || 800}
            height={dimensions.height || 600}
            layoutMode={layoutMode}
          />

          <Minimap />

          {showDetailPanel && (
            <div className="absolute right-0 top-0 z-20 h-full w-[min(360px,calc(100%-2rem))] overflow-hidden border-l border-border bg-background animate-in fade-in slide-in-from-right-2 duration-200">
              <DetailPanel />
            </div>
          )}

          {showPathFinder && (
            <div className="absolute right-0 top-0 z-20 h-full w-[min(360px,calc(100%-2rem))] overflow-hidden border-l border-border bg-background animate-in fade-in slide-in-from-right-2 duration-200">
              <PathFinder onClose={() => setShowPathFinder(false)} />
            </div>
          )}

          {showFilterPanel && (
            <div className="absolute right-3 top-14 z-30 w-[min(328px,calc(100%-1.5rem))] rounded-lg border border-border bg-background p-3 animate-in fade-in slide-in-from-top-2 duration-200">
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
        </>
      )}
    </div>
  );
}

function Metric({ label, value, mutedValue }: { label: string; value: React.ReactNode; mutedValue?: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold leading-none">
        {value}
        {mutedValue ? <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{mutedValue}</span> : null}
      </div>
    </div>
  );
}

export default KnowledgeGraphECharts;
