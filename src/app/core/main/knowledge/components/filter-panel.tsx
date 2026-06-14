'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Check, FileText, FolderGit2, Lightbulb, Tag, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGraphStore, type NodeType } from '../store/graph-store';

const NODE_TYPE_COLORS: Record<NodeType, string> = {
  note: '#2563eb',
  concept: '#059669',
  person: '#c2410c',
  project: '#7c3aed',
  tag: '#be185d',
};

const NODE_TYPES: Array<{
  type: NodeType;
  label: string;
  icon: React.ReactNode;
  color: string;
}> = [
  { type: 'note', label: '笔记', icon: <FileText className="h-3.5 w-3.5" />, color: NODE_TYPE_COLORS.note },
  { type: 'concept', label: '概念', icon: <Lightbulb className="h-3.5 w-3.5" />, color: NODE_TYPE_COLORS.concept },
  { type: 'person', label: '人物', icon: <User className="h-3.5 w-3.5" />, color: NODE_TYPE_COLORS.person },
  { type: 'project', label: '项目', icon: <FolderGit2 className="h-3.5 w-3.5" />, color: NODE_TYPE_COLORS.project },
  { type: 'tag', label: '标签', icon: <Tag className="h-3.5 w-3.5" />, color: NODE_TYPE_COLORS.tag },
];

export function FilterPanel() {
  const {
    filters,
    setFilters,
    toggleFilterPanel,
    nodes,
  } = useGraphStore();

  const nodeTypeCounts = new Map<NodeType, number>();
  for (const node of nodes) {
    nodeTypeCounts.set(node.nodeType, (nodeTypeCounts.get(node.nodeType) || 0) + 1);
  }

  const toggleType = (type: NodeType) => {
    const currentTypes = filters.types || [];
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(item => item !== type)
      : [...currentTypes, type];

    setFilters({ types: newTypes.length > 0 ? newTypes : undefined });
  };

  const clearFilters = () => {
    setFilters({
      types: undefined,
      search: '',
      minConnections: undefined,
      maxConnections: undefined,
    });
  };

  const hasActiveFilters = Boolean(
    (filters.types && filters.types.length > 0) ||
    filters.search ||
    filters.minConnections !== undefined ||
    filters.maxConnections !== undefined,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">筛选图谱</h3>
          <p className="mt-1 text-xs text-muted-foreground">缩小节点范围，保留当前关系上下文。</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2">
              清除
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" onClick={toggleFilterPanel} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      <div>
        <Label className="mb-2 block text-xs font-medium text-muted-foreground">节点类型</Label>
        <div className="space-y-1">
          {NODE_TYPES.map(({ type, label, icon, color }) => {
            const count = nodeTypeCounts.get(type) || 0;
            const isActive = filters.types?.includes(type) ?? false;

            return (
              <button
                key={type}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  isActive && 'bg-muted',
                )}
                onClick={() => toggleType(type)}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-background text-background',
                    isActive && 'border-foreground bg-foreground',
                  )}
                >
                  {isActive ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                  {icon}
                  {label}
                </span>
                <Badge variant="secondary" className="rounded-md text-[11px] tabular-nums">
                  {count}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      <div>
        <Label className="mb-2 block text-xs font-medium text-muted-foreground">连接数</Label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="最小"
            value={filters.minConnections}
            placeholder="0"
            onChange={value => setFilters({ minConnections: value })}
          />
          <NumberField
            label="最大"
            value={filters.maxConnections}
            placeholder="∞"
            onChange={value => setFilters({ maxConnections: value })}
          />
        </div>
      </div>

      <Separator />

      <div>
        <Label className="mb-2 block text-xs font-medium text-muted-foreground">快捷筛选</Label>
        <div className="grid gap-2">
          <QuickFilter color="#d97706" label="中心节点" detail="4+ 连接" onClick={() => setFilters({ minConnections: 4 })} />
          <QuickFilter color="#71717a" label="孤立节点" detail="0 连接" onClick={() => setFilters({ minConnections: 0, maxConnections: 0 })} />
          <QuickFilter color="#2563eb" label="仅显示笔记" detail="隐藏非笔记节点" onClick={() => setFilters({ types: ['note'] })} />
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value?: number;
  placeholder: string;
  onChange: (value?: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="number"
        min="0"
        value={value ?? ''}
        onChange={event => onChange(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)}
        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
        placeholder={placeholder}
      />
    </label>
  );
}

function QuickFilter({ color, label, detail, onClick }: { color: string; label: string; detail: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="h-auto justify-start px-2 py-2" onClick={onClick}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[11px] font-normal text-muted-foreground">{detail}</span>
      </span>
    </Button>
  );
}
