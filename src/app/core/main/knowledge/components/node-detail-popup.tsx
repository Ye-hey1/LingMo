'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, FileText, Link2, Hash, ExternalLink, Copy, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { GraphNode } from '../store/graph-store';

interface NodeDetailPopupProps {
  node: GraphNode;
  relatedNodes: Array<{ node: GraphNode; edgeLabel: string }>;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onCopyPath: (path: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4" />,
  concept: <Brain className="h-4 w-4" />,
  person: <span className="text-sm">👤</span>,
  project: <span className="text-sm">📁</span>,
  tag: <Hash className="h-4 w-4" />,
};

const NODE_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  concept: '概念',
  person: '人物',
  project: '项目',
  tag: '标签',
};

const NODE_TYPE_COLORS: Record<string, string> = {
  note: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  concept: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  person: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  project: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  tag: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
};

export function NodeDetailPopup({
  node,
  relatedNodes,
  onClose,
  onOpenNote,
  onCopyPath,
  onSelectNode,
}: NodeDetailPopupProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, 200); // Wait for animation
  }, [onClose]);

  const nodeType = node.nodeType || 'note';
  const nodeKind = node.kind || 'note';
  const connections = node.connections || 0;
  const path = node.nodeProperties?.path;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm transition-opacity duration-200',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
      onClick={handleClose}
    >
      <div
        className={cn(
          'relative w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl transition-all duration-200',
          isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', NODE_TYPE_COLORS[nodeType])}>
              {NODE_TYPE_ICONS[nodeType]}
            </div>
            <div>
              <h3 className="text-lg font-semibold leading-tight">{node.nodeLabel}</h3>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {NODE_TYPE_LABELS[nodeType]}
                </Badge>
                {nodeKind === 'hub' && (
                  <Badge variant="default" className="text-xs bg-amber-500">
                    核心节点
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator className="my-4" />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-2xl font-bold">{connections}</div>
            <div className="text-xs text-muted-foreground">连接数</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-2xl font-bold">{node.nodeProperties?.noteCount ?? 0}</div>
            <div className="text-xs text-muted-foreground">关联笔记</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-2xl font-bold">{node.nodeProperties?.chunkCount ?? 0}</div>
            <div className="text-xs text-muted-foreground">RAG切块</div>
          </div>
        </div>

        {/* Keywords */}
        {node.nodeProperties?.keyword && (
          <>
            <Separator className="my-4" />
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">关键词</h4>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-xs">
                  {node.nodeProperties.keyword}
                </Badge>
                {node.nodeProperties?.clusterLabel && (
                  <Badge variant="secondary" className="text-xs">
                    {node.nodeProperties.clusterLabel}
                  </Badge>
                )}
              </div>
            </div>
          </>
        )}

        {/* Related Nodes */}
        {relatedNodes.length > 0 && (
          <>
            <Separator className="my-4" />
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                关联节点 ({relatedNodes.length})
              </h4>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {relatedNodes.slice(0, 8).map(({ node: relatedNode, edgeLabel }) => (
                  <button
                    key={relatedNode.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted"
                    onClick={() => onSelectNode(relatedNode.id)}
                  >
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: relatedNode.nodeColor || '#64748b' }}
                    />
                    <span className="flex-1 truncate text-sm">{relatedNode.nodeLabel}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {edgeLabel}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <Separator className="my-4" />
        <div className="flex gap-2">
          {path && (
            <>
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={() => onOpenNote(path)}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                打开笔记
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopyPath(path)}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleClose}
          >
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
