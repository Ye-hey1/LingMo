'use client';

import React, { useEffect, useRef } from 'react';
import {
  Copy,
  ExternalLink,
  FileText,
  Filter,
  GitBranch,
  Maximize,
  Pin,
  RefreshCw,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode, GraphEdge } from '../store/graph-store';

interface ContextMenuProps {
  x: number;
  y: number;
  node: GraphNode | null;
  edge: GraphEdge | null;
  onClose: () => void;
  onAction: (action: string) => void;
}

export function ContextMenu({ x, y, node, edge, onClose, onAction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 300);

  if (node) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-background p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
        style={{ left: adjustedX, top: adjustedY }}
      >
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          节点操作
        </div>
        <MenuItem icon={<Search className="h-3.5 w-3.5" />} label="聚焦节点" onClick={() => onAction('focus')} />
        <MenuItem icon={<ExternalLink className="h-3.5 w-3.5" />} label="打开笔记" onClick={() => onAction('open')} />
        <MenuItem icon={<Copy className="h-3.5 w-3.5" />} label="复制路径" onClick={() => onAction('copy')} />
        <MenuItem icon={<GitBranch className="h-3.5 w-3.5" />} label="展开邻居" onClick={() => onAction('expand')} />
        <MenuItem icon={<Filter className="h-3.5 w-3.5" />} label="筛选关联" onClick={() => onAction('filter')} />
        <div className="my-1 h-px bg-border" />
        <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除节点" danger onClick={() => onAction('delete')} />
      </div>
    );
  }

  if (edge) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-background p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
        style={{ left: adjustedX, top: adjustedY }}
      >
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          边操作
        </div>
        <MenuItem icon={<Search className="h-3.5 w-3.5" />} label="高亮边" onClick={() => onAction('highlight')} />
        <MenuItem icon={<FileText className="h-3.5 w-3.5" />} label="查看详情" onClick={() => onAction('detail')} />
        <div className="my-1 h-px bg-border" />
        <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除边" danger onClick={() => onAction('delete-edge')} />
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-background p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        画布操作
      </div>
      <MenuItem icon={<ZoomIn className="h-3.5 w-3.5" />} label="放大" onClick={() => onAction('zoom-in')} />
      <MenuItem icon={<ZoomOut className="h-3.5 w-3.5" />} label="缩小" onClick={() => onAction('zoom-out')} />
      <MenuItem icon={<Maximize className="h-3.5 w-3.5" />} label="适应视图" onClick={() => onAction('fit-view')} />
      <MenuItem icon={<RefreshCw className="h-3.5 w-3.5" />} label="刷新图谱" onClick={() => onAction('refresh')} />
      <MenuItem icon={<Pin className="h-3.5 w-3.5" />} label="取消固定" onClick={() => onAction('unfix-all')} />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        danger && 'text-destructive hover:bg-destructive/10',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
