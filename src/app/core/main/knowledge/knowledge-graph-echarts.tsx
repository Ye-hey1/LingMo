'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphStore } from './store/graph-store';
import { EChartsGraph } from './components/echarts-graph';
import { GraphToolbar } from './components/toolbar';
import { DetailPanel } from './components/detail-panel';
import { SearchDialog } from './components/search-dialog';
import { FilterPanel } from './components/filter-panel';
import { ExportDialog } from './components/export-dialog';
import { ContextMenu } from './components/context-menu';
import { PathFinder } from './components/path-finder';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

type LayoutMode = 'force' | 'circular' | 'tree' | 'radial';

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
    filteredEdges,
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
  }, [toggleSearchDialog, selectNode, selectEdge, nodesMapping, filteredEdges]);

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

          <EChartsGraph
            width={dimensions.width || 800}
            height={dimensions.height || 600}
            layoutMode={layoutMode}
          />

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

export default KnowledgeGraphECharts;
