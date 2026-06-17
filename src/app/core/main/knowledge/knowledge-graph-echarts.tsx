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
import { cn } from '@/lib/utils';

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
  const articleStore = useArticleStore();

  const {
    loadGraph,
    filteredNodes,
    filteredEdges,
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
    graphMode,
    graphView,
    setGraphMode,
    setGraphView,
  } = useGraphStore();

  const activeFilePath = articleStore.activeFilePath;
  const currentArticle = articleStore.currentArticle;
  const openTabSignature = useMemo(() => {
    const notePaths = [
      ...(articleStore.openTabs ?? []).filter(tab =>
        !tab.isFolder &&
        tab.path &&
        !tab.path.startsWith('lingmo://') &&
        /\.(md|markdown|mdx|txt)$/i.test(tab.path),
      ).map(tab => tab.path.replace(/\\/g, '/')),
      activeFilePath,
    ]
      .filter((path): path is string => Boolean(path))
      .filter(path => !path.startsWith('lingmo://') && /\.(md|markdown|mdx|txt)$/i.test(path));

    return Array.from(new Set(notePaths)).sort().join('|');
  }, [articleStore.openTabs, activeFilePath]);
  const openNoteCount = openTabSignature ? openTabSignature.split('|').length : 0;

  const localNodeCount = filteredNodes.length;
  const localEdgeCount = filteredEdges.length;

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (graphMode !== 'local') return;
    const timer = window.setTimeout(() => {
      void loadGraph();
    }, 420);
    return () => window.clearTimeout(timer);
  }, [graphMode, openTabSignature, activeFilePath, currentArticle, loadGraph]);

  // 检测空状态
  const isLocalWithoutOpenNotes = graphMode === 'local' && openNoteCount === 0;
  const isLocalWithoutTopics = graphMode === 'local' && openNoteCount > 0 && nodes.length === 0;
  const isEmptyGraph = !isLoading && !error && nodes.length === 0 && !isLocalWithoutOpenNotes && !isLocalWithoutTopics;
  const hasNotes = (articleStore.fileTree?.length ?? 0) > 0;
  const noteCount = articleStore.fileTree?.reduce((count, item) => {
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
  const hubCount = filteredNodes.filter(node => node.kind === 'hub').length;
  const visibleTopicCount = filteredNodes.filter(node => node.nodeProperties?.mode === 'topic').length;
  const visibleNoteCount = filteredNodes.filter(node => node.nodeType === 'note').length;
  const visibleWikilinkCount = filteredEdges.filter(edge => edge.label === 'wikilink').length;
  const visibleSemanticCount = filteredEdges.filter(edge => edge.label === 'topic-semantic').length;
  const visibleNoteSemanticCount = filteredEdges.filter(edge => edge.label === 'semantic').length;
  const visibleCooccurrenceCount = filteredEdges.filter(edge => edge.label === 'topic-cooccurrence').length;
  const visibleRagCount = filteredEdges.filter(edge => edge.label === 'rag-vector').length;
  const legendItems = useMemo(() => graphView === 'note'
    ? [
      { label: '笔记', value: visibleNoteCount, color: '#60a5fa' },
      { label: '核心', value: hubCount, color: '#f97316' },
      { label: '双链', value: visibleWikilinkCount, color: '#64748b' },
      { label: '语义', value: visibleNoteSemanticCount, color: '#059669' },
    ]
    : [
      { label: '主题', value: visibleTopicCount, color: '#10b981' },
      { label: '核心', value: hubCount, color: '#f59e0b' },
      { label: '共现', value: visibleCooccurrenceCount, color: '#94a3b8' },
      { label: '语义', value: visibleSemanticCount, color: '#059669' },
      { label: '向量', value: visibleRagCount, color: '#0f766e' },
    ], [graphView, hubCount, visibleCooccurrenceCount, visibleNoteCount, visibleNoteSemanticCount, visibleRagCount, visibleSemanticCount, visibleTopicCount, visibleWikilinkCount]);

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
      await loadGraph();
    } catch (error) {
      console.error('Failed to generate vectors:', error);
    } finally {
      setIsGeneratingVectors(false);
    }
  }, [loadGraph]);

  // 处理创建笔记
  const handleCreateNote = useCallback(() => {
    // 触发新建笔记
    const { newFile } = articleStore;
    newFile();
    // 关闭知识图谱标签页，让用户专注于创建笔记
    const { setActiveFilePath } = articleStore;
    setActiveFilePath('');
  }, [articleStore]);

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
          onRefresh={() => void loadGraph()}
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
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="刷新" onClick={() => void loadGraph()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="路径查找" onClick={() => setShowPathFinder(!showPathFinder)}>
                <GitBranch className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 底部图谱统计 */}
          <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center justify-center gap-3 overflow-hidden text-foreground pointer-events-none select-none sm:gap-4">
            {legendItems.map(item => (
              <div
                key={item.label}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/5 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <span
                  className="h-2 w-2 rounded-full shadow-none dark:shadow-[0_0_0_2px_rgba(255,255,255,0.08)]"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{item.value}</span>
              </div>
            ))}
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
