'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, FolderGit2, Lightbulb, Search, Tag, User, X } from 'lucide-react';
import { useGraphStore, type GraphNode } from '../store/graph-store';
import { NODE_TYPE_COLORS } from '../constants';

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-3.5 w-3.5" />,
  concept: <Lightbulb className="h-3.5 w-3.5" />,
  person: <User className="h-3.5 w-3.5" />,
  project: <FolderGit2 className="h-3.5 w-3.5" />,
  tag: <Tag className="h-3.5 w-3.5" />,
};

const NODE_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  concept: '概念',
  person: '人物',
  project: '项目',
  tag: '标签',
};

export function SearchDialog() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GraphNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    nodes,
    filters,
    showSearchDialog,
    toggleSearchDialog,
    selectNode,
  } = useGraphStore();

  useEffect(() => {
    if (showSearchDialog) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [showSearchDialog]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    const searchLower = trimmedQuery.toLowerCase();
    const includeNoisyTopics = filters.includeNoisyTopics === true;
    const filtered = nodes
      .filter(node => {
        if (!includeNoisyTopics && node.nodeProperties?.mode === 'topic' && node.nodeProperties?.isNoisyTopic) {
          return false;
        }
        return node.nodeLabel.toLowerCase().includes(searchLower) ||
          node.nodeProperties?.path?.toLowerCase().includes(searchLower) ||
          node.nodeProperties?.name?.toLowerCase().includes(searchLower);
      })
      .sort((a, b) => (b.connections || 0) - (a.connections || 0))
      .slice(0, 20);

    setResults(filtered);
  }, [filters.includeNoisyTopics, query, nodes]);

  const handleSelect = (nodeId: string) => {
    selectNode(nodeId);
    toggleSearchDialog();
    setQuery('');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showSearchDialog) {
        toggleSearchDialog();
        setQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearchDialog, toggleSearchDialog]);

  if (!showSearchDialog) return null;

  return (
    <div className="absolute right-4 top-12 z-30 w-[min(360px,calc(100%-2rem))] overflow-hidden rounded-lg border border-border/70 bg-background/95 shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="text-sm font-semibold">搜索节点</div>
        <button
          type="button"
          aria-label="关闭搜索"
          onClick={() => {
            toggleSearchDialog();
            setQuery('');
          }}
          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="输入节点名称、路径或文件名"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && results[0]) {
                event.preventDefault();
                handleSelect(results[0].id);
              }
            }}
            className="h-8 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
          />
          {query ? (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery('')}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="max-h-[300px] px-2 py-2">
        <div className="space-y-1">
          {results.map(node => (
            <button
              key={node.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => handleSelect(node.id)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: getNodeColor(node) }} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{node.nodeLabel}</span>
                  <Badge variant="secondary" className="shrink-0 gap-1 rounded-md text-[11px]">
                    {NODE_TYPE_ICONS[node.nodeType]}
                    {NODE_TYPE_LABELS[node.nodeType] || node.nodeType}
                  </Badge>
                </span>
                {node.nodeProperties?.path ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {node.nodeProperties.path}
                  </span>
                ) : null}
              </span>
              {node.connections !== undefined && node.connections > 0 ? (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {node.connections}
                </span>
              ) : null}
            </button>
          ))}

          {query && results.length === 0 ? (
            <EmptySearchState title="未找到匹配节点" description="换一个标题关键词或路径片段试试。" />
          ) : null}

          {!query ? (
            <EmptySearchState title="输入关键词开始搜索" description="按 Enter 可打开第一条结果。" />
          ) : null}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>Ctrl / ⌘ + / 打开搜索</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
}

function EmptySearchState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-4 py-10 text-center text-muted-foreground">
      <Search className="mx-auto mb-2 h-7 w-7 opacity-45" />
      <p className="text-sm">{title}</p>
      <p className="mt-1 text-xs">{description}</p>
    </div>
  );
}

function getNodeColor(node: GraphNode): string {
  return node.nodeColor || NODE_TYPE_COLORS[node.nodeType] || '#71717a';
}
