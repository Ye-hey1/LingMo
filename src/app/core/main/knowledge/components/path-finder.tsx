'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, GitBranch, Search, X } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';

interface PathFinderProps {
  onClose: () => void;
}

export function PathFinder({ onClose }: PathFinderProps) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [paths, setPaths] = useState<string[][]>([]);

  const {
    filteredNodes,
    filteredEdges,
    selectNode,
  } = useGraphStore();

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const node of filteredNodes) {
      adj.set(node.id, new Set());
    }
    for (const edge of filteredEdges) {
      adj.get(edge.source)?.add(edge.target);
      adj.get(edge.target)?.add(edge.source);
    }
    return adj;
  }, [filteredNodes, filteredEdges]);

  const sourceResults = useMemo(() => {
    if (!sourceQuery.trim()) return [];
    const query = sourceQuery.toLowerCase();
    return filteredNodes
      .filter(n => n.nodeLabel.toLowerCase().includes(query))
      .slice(0, 5);
  }, [sourceQuery, filteredNodes]);

  const targetResults = useMemo(() => {
    if (!targetQuery.trim()) return [];
    const query = targetQuery.toLowerCase();
    return filteredNodes
      .filter(n => n.nodeLabel.toLowerCase().includes(query))
      .slice(0, 5);
  }, [targetQuery, filteredNodes]);

  const findPaths = useCallback(() => {
    if (!sourceId || !targetId) return;

    const result: string[][] = [];
    const queue: string[][] = [[sourceId]];
    const visited = new Set<string>();
    visited.add(sourceId);

    while (queue.length > 0 && result.length < 3) {
      const path = queue.shift()!;
      const current = path[path.length - 1];

      if (current === targetId) {
        result.push(path);
        continue;
      }

      if (path.length > 4) continue;

      const neighbors = adjacency.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }

    setPaths(result);
  }, [sourceId, targetId, adjacency]);

  useEffect(() => {
    if (sourceId && targetId) {
      findPaths();
    }
  }, [sourceId, targetId, findPaths]);

  const sourceNode = filteredNodes.find(n => n.id === sourceId);
  const targetNode = filteredNodes.find(n => n.id === targetId);

  return (
    <div className="flex h-full flex-col bg-background/95">
      <div className="flex items-center justify-between border-b border-border/80 p-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          <span className="text-sm font-semibold">路径查找</span>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">起点</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索起点节点..."
                value={sourceQuery}
                onChange={e => setSourceQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            {sourceResults.length > 0 && !sourceId && (
              <div className="mt-1 rounded-md border border-border bg-background">
                {sourceResults.map(node => (
                  <button
                    key={node.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setSourceId(node.id);
                      setSourceQuery(node.nodeLabel);
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: node.nodeColor || '#3b82f6' }} />
                    {node.nodeLabel}
                  </button>
                ))}
              </div>
            )}
            {sourceNode && (
              <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sourceNode.nodeColor || '#3b82f6' }} />
                <span className="text-sm">{sourceNode.nodeLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6"
                  onClick={() => {
                    setSourceId(null);
                    setSourceQuery('');
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">终点</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索终点节点..."
                value={targetQuery}
                onChange={e => setTargetQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            {targetResults.length > 0 && !targetId && (
              <div className="mt-1 rounded-md border border-border bg-background">
                {targetResults.map(node => (
                  <button
                    key={node.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setTargetId(node.id);
                      setTargetQuery(node.nodeLabel);
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: node.nodeColor || '#3b82f6' }} />
                    {node.nodeLabel}
                  </button>
                ))}
              </div>
            )}
            {targetNode && (
              <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: targetNode.nodeColor || '#3b82f6' }} />
                <span className="text-sm">{targetNode.nodeLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6"
                  onClick={() => {
                    setTargetId(null);
                    setTargetQuery('');
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {paths.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">
                找到 {paths.length} 条路径
              </label>
              <div className="space-y-2">
                {paths.map((path, pathIndex) => (
                  <div
                    key={pathIndex}
                    className="rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      {path.map((nodeId, nodeIndex) => {
                        const node = filteredNodes.find(n => n.id === nodeId);
                        return (
                          <React.Fragment key={nodeId}>
                            <button
                              type="button"
                              className="rounded-md px-2 py-1 text-xs font-medium hover:bg-muted"
                              onClick={() => selectNode(nodeId)}
                            >
                              {node?.nodeLabel || nodeId}
                            </button>
                            {nodeIndex < path.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      路径长度: {path.length - 1} 跳
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sourceId && targetId && paths.length === 0 && (
            <div className="rounded-md bg-muted/50 p-4 text-center text-sm text-muted-foreground">
              未找到连接路径
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
