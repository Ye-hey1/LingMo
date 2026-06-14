'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Download,
  Filter,
  GitBranch,
  GitFork,
  LayoutDashboard,
  Maximize,
  PanelRightOpen,
  RefreshCw,
  Route,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGraphStore } from '../store/graph-store';

type LayoutMode = 'force' | 'circular' | 'tree' | 'radial';

interface GraphToolbarProps {
  layoutMode?: LayoutMode;
  onLayoutChange?: (mode: LayoutMode) => void;
  onPathFinder?: () => void;
}

function ToolbarButton({
  label,
  active,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-8 w-8 rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96] dark:hover:bg-muted',
        active && 'bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:bg-foreground dark:text-background',
        danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      {children}
    </Button>
  );
}

const LAYOUT_OPTIONS: Array<{ mode: LayoutMode; label: string; icon: React.ReactNode }> = [
  { mode: 'force', label: '力导向布局', icon: <GitFork className="h-3.5 w-3.5" /> },
  { mode: 'circular', label: '环形布局', icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { mode: 'radial', label: '径向布局', icon: <LayoutDashboard className="h-3.5 w-3.5 rotate-45" /> },
];

export function GraphToolbar({ layoutMode = 'force', onLayoutChange, onPathFinder }: GraphToolbarProps) {
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const {
    zoom,
    selectedNode,
    showFilterPanel,
    showDetailPanel,
    setZoom,
    fitView,
    deleteNode,
    toggleSearchDialog,
    toggleFilterPanel,
    toggleDetailPanel,
    toggleExportDialog,
    loadGraph,
    isLoading,
  } = useGraphStore();

  return (
    <div className="absolute left-3 top-3 z-20 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background p-1">
        <div className="flex h-8 items-center gap-1 rounded-md bg-muted/70 px-2.5 text-[12px] font-medium text-foreground dark:bg-muted/60">
          <GitBranch className="h-3.5 w-3.5" />
          主题图谱
        </div>

        <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/80 dark:bg-white/10" />

        <ToolbarButton label="搜索节点 (Ctrl+/)" onClick={toggleSearchDialog}>
          <Search className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton label="路径查找" onClick={() => onPathFinder?.()}>
          <Route className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/80 dark:bg-white/10" />

        <div className="relative">
          <ToolbarButton
            label="切换布局"
            active={showLayoutMenu}
            onClick={() => setShowLayoutMenu(!showLayoutMenu)}
          >
            <GitFork className="h-4 w-4" />
          </ToolbarButton>

          {showLayoutMenu && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-background p-1 shadow-lg">
              {LAYOUT_OPTIONS.map(option => (
                <button
                  key={option.mode}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                    layoutMode === option.mode && 'bg-muted font-medium',
                  )}
                  onClick={() => {
                    onLayoutChange?.(option.mode);
                    setShowLayoutMenu(false);
                  }}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/80 dark:bg-white/10" />

        <ToolbarButton label="放大" onClick={() => setZoom(Number((zoom * 1.22).toFixed(2)))}>
          <ZoomIn className="h-4 w-4" />
        </ToolbarButton>

        <div className="min-w-[3.25rem] rounded-md bg-muted/65 px-2 py-1 text-center text-[11px] tabular-nums text-muted-foreground">
          {(zoom * 100).toFixed(0)}%
        </div>

        <ToolbarButton label="缩小" onClick={() => setZoom(Number((zoom * 0.82).toFixed(2)))}>
          <ZoomOut className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton label="适应视图" onClick={fitView}>
          <Maximize className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/80 dark:bg-white/10" />

        <ToolbarButton label="筛选节点" active={showFilterPanel} onClick={toggleFilterPanel}>
          <Filter className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton label="节点详情" active={showDetailPanel} onClick={toggleDetailPanel}>
          <PanelRightOpen className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton label="导出图谱" onClick={toggleExportDialog}>
          <Download className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/80 dark:bg-white/10" />

        <ToolbarButton label="刷新数据" disabled={isLoading} onClick={() => void loadGraph()}>
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </ToolbarButton>

        {selectedNode ? (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/80 dark:bg-white/10" />
            <ToolbarButton label="删除选中节点" danger onClick={() => void deleteNode(selectedNode)}>
              <Trash2 className="h-4 w-4" />
            </ToolbarButton>
          </>
        ) : null}
      </div>
    </div>
  );
}
