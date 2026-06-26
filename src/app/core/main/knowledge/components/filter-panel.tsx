'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  X,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Palette,
  Plus,
  Trash2,
  Layers3,
  Network,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGraphStore } from '../store/graph-store';

const NEON_COLORS = ['#38bdf8', '#ec4899', '#f59e0b', '#22c55e', '#a855f7', '#ef4444'];
const NOTE_EDGE_FILTERS = [
  { id: 'wikilink', label: '双链', color: '#64748b' },
  { id: 'references', label: '引用', color: '#d97706' },
  { id: 'related', label: '相关', color: '#64748b' },
  { id: 'extends', label: '延伸', color: '#f59e0b' },
  { id: 'supports', label: '支撑', color: '#16a34a' },
  { id: 'contradicts', label: '矛盾', color: '#ef4444' },
  { id: 'analogous', label: '类比', color: '#8b5cf6' },
  { id: 'example-of', label: '示例', color: '#06b6d4' },
  { id: 'uses', label: '使用', color: '#22c55e' },
  { id: 'part-of', label: '属于', color: '#6366f1' },
  { id: 'semantic', label: '语义', color: '#059669' },
];
const TOPIC_EDGE_FILTERS = [
  { id: 'topic-cooccurrence', label: '共现', color: '#94a3b8' },
  { id: 'topic-semantic', label: '语义', color: '#64748b' },
  { id: 'rag-vector', label: '向量', color: '#0f766e' },
];
const EDGE_SOURCE_FILTERS = [
  { id: 'cross_validated', label: '交叉验证', color: '#0f766e' },
  { id: 'llm', label: 'AI', color: '#7c3aed' },
  { id: 'keyword', label: '关键词', color: '#ca8a04' },
  { id: 'cosine', label: '向量', color: '#059669' },
  { id: 'wikilink', label: '双链', color: '#64748b' },
  { id: 'frontmatter', label: '显式', color: '#d97706' },
];

type TypePreset = 'all' | 'note' | 'concept' | 'person-project' | 'tag' | 'custom';
type RelationPreset = 'all' | 'hub' | 'isolated' | 'custom';

export function FilterPanel() {
  const {
    filters,
    setFilters,
    toggleFilterPanel,
    physics,
    setPhysics,
    colorGroups,
    addColorGroup,
    removeColorGroup,
    graphMode,
    graphView,
  } = useGraphStore();

  const [rangeExpanded, setRangeExpanded] = useState(false);
  const [edgeFiltersExpanded, setEdgeFiltersExpanded] = useState(false);
  const [physicsExpanded, setPhysicsExpanded] = useState(false);
  const [colorGroupsExpanded, setColorGroupsExpanded] = useState(false);
  const [newGroupQuery, setNewGroupQuery] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#38bdf8');

  const hasConnectionFilter = filters.minConnections !== undefined || filters.maxConnections !== undefined;
  const hasActiveFilters = Boolean(
    filters.search ||
    hasConnectionFilter ||
    filters.nodeKinds?.length ||
    filters.nodeModes?.length ||
    filters.edgeLabels?.length ||
    filters.edgeSources?.length ||
    filters.includeNoisyTopics,
  );

  const typePreset = useMemo<TypePreset>(() => {
    if (!filters.types?.length) return 'all';
    const sorted = [...filters.types].sort().join('|');
    if (sorted === 'note') return 'note';
    if (sorted === 'concept') return 'concept';
    if (sorted === 'person|project') return 'person-project';
    if (sorted === 'tag') return 'tag';
    return 'custom';
  }, [filters.types]);

  const relationPreset = useMemo<RelationPreset>(() => {
    if (filters.minConnections === undefined && filters.maxConnections === undefined) return 'all';
    if (filters.minConnections === 4 && filters.maxConnections === undefined) return 'hub';
    if (filters.minConnections === 0 && filters.maxConnections === 0) return 'isolated';
    return 'custom';
  }, [filters.minConnections, filters.maxConnections]);

  const clearFilters = () => {
    setFilters({
      types: undefined,
      nodeKinds: undefined,
      nodeModes: undefined,
      edgeLabels: undefined,
      edgeSources: undefined,
      search: '',
      minConnections: undefined,
      maxConnections: undefined,
      includeNoisyTopics: false,
    });
  };

  const setTypePreset = (preset: TypePreset) => {
    if (preset === 'all') setFilters({ types: undefined });
    if (preset === 'note') setFilters({ types: ['note'] });
    if (preset === 'concept') setFilters({ types: ['concept'] });
    if (preset === 'person-project') setFilters({ types: ['person', 'project'] });
    if (preset === 'tag') setFilters({ types: ['tag'] });
  };

  const setRelationPreset = (preset: RelationPreset) => {
    if (preset === 'all') setFilters({ minConnections: undefined, maxConnections: undefined });
    if (preset === 'hub') setFilters({ minConnections: 4, maxConnections: undefined });
    if (preset === 'isolated') setFilters({ minConnections: 0, maxConnections: 0 });
  };

  const toggleEdgeLabel = (edgeLabel: string) => {
    const current = new Set(filters.edgeLabels ?? []);
    if (current.has(edgeLabel)) current.delete(edgeLabel);
    else current.add(edgeLabel);
    setFilters({ edgeLabels: current.size ? Array.from(current) : undefined });
  };

  const toggleEdgeSource = (source: string) => {
    const current = new Set(filters.edgeSources ?? []);
    if (current.has(source)) current.delete(source);
    else current.add(source);
    setFilters({ edgeSources: current.size ? Array.from(current) : undefined });
  };

  return (
    <div className="flex max-h-[min(520px,calc(100vh-88px))] flex-col text-foreground">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/45 px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">筛选图谱</h3>
            <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {graphView === 'note' ? '笔记' : '主题'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2 text-xs">
              清除
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" onClick={toggleFilterPanel} className="h-7 w-7 rounded-md">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <FilterSelect
            label="类型"
            value={typePreset}
            onValueChange={value => setTypePreset(value as TypePreset)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'note', label: '只看笔记' },
              { value: 'concept', label: '只看概念' },
              { value: 'person-project', label: '人物/项目' },
              { value: 'tag', label: '标签' },
              ...(typePreset === 'custom' ? [{ value: 'custom', label: '自定义' }] : []),
            ]}
          />
          <FilterSelect
            label="关系"
            value={relationPreset}
            onValueChange={value => setRelationPreset(value as RelationPreset)}
            options={[
              { value: 'all', label: '不限' },
              { value: 'hub', label: '核心' },
              { value: 'isolated', label: '孤立' },
              ...(relationPreset === 'custom' ? [{ value: 'custom', label: '自定义' }] : []),
            ]}
          />
        </div>

        {graphView === 'topic' ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-muted/20 px-2.5 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium">信息过滤</div>
            </div>
            <Switch
              checked={!filters.includeNoisyTopics}
              onCheckedChange={checked => setFilters({ includeNoisyTopics: !checked })}
              aria-label="信息过滤"
            />
          </div>
        ) : null}

        {graphMode === 'local' ? (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/[0.06] px-2.5 py-2 text-[11px] text-muted-foreground">
            <Layers3 className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">局域跟随：只分析编辑器已打开笔记</span>
          </div>
        ) : null}

        <div className="mt-2.5 space-y-1 border-t border-border/45 pt-2">
          <CompactDisclosure
            icon={<Network className="h-3.5 w-3.5" />}
            label={`关系筛选${(filters.edgeLabels?.length ?? 0) + (filters.edgeSources?.length ?? 0) ? ` · ${(filters.edgeLabels?.length ?? 0) + (filters.edgeSources?.length ?? 0)}` : ''}`}
            open={edgeFiltersExpanded}
            onToggle={() => setEdgeFiltersExpanded(!edgeFiltersExpanded)}
          />
          {edgeFiltersExpanded ? (
            <div className="space-y-3 rounded-md bg-muted/20 p-2">
              <ChipGroup
                label="类型"
                items={graphView === 'note' ? NOTE_EDGE_FILTERS : TOPIC_EDGE_FILTERS}
                selected={filters.edgeLabels ?? []}
                onToggle={toggleEdgeLabel}
              />
              {graphView === 'note' ? (
                <ChipGroup
                  label="来源"
                  items={EDGE_SOURCE_FILTERS}
                  selected={filters.edgeSources ?? []}
                  onToggle={toggleEdgeSource}
                />
              ) : null}
            </div>
          ) : null}

          <CompactDisclosure
            icon={<Network className="h-3.5 w-3.5" />}
            label={hasConnectionFilter ? `关系范围 · ${filters.minConnections ?? 0}-${filters.maxConnections ?? '∞'}` : '关系范围'}
            open={rangeExpanded}
            onToggle={() => setRangeExpanded(!rangeExpanded)}
          />
          {rangeExpanded ? (
            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/20 p-2">
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
          ) : null}

          <CompactDisclosure
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            label="动力学参数"
            open={physicsExpanded}
            onToggle={() => setPhysicsExpanded(!physicsExpanded)}
          />
          {physicsExpanded ? (
            <div className="space-y-3 rounded-md bg-muted/20 px-2.5 py-3">
              <PhysicsSlider label="节点斥力" value={physics.repulsion} min={50} max={2000} step={10} onChange={value => setPhysics({ repulsion: value })} />
              <PhysicsSlider label="中心引力" value={physics.gravity} min={0} max={1} step={0.01} onChange={value => setPhysics({ gravity: value })} />
              <PhysicsSlider label="连线长度" value={physics.edgeLength} min={20} max={500} step={5} onChange={value => setPhysics({ edgeLength: value })} />
              <PhysicsSlider label="阻尼" value={physics.friction} min={0.1} max={1} step={0.01} onChange={value => setPhysics({ friction: value })} />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setPhysics({ repulsion: 180, gravity: 0.1, edgeLength: 95, friction: 0.62 })}
                >
                  重置
                </Button>
              </div>
            </div>
          ) : null}

          <CompactDisclosure
            icon={<Palette className="h-3.5 w-3.5" />}
            label={`染色规则${colorGroups.length ? ` · ${colorGroups.length}` : ''}`}
            open={colorGroupsExpanded}
            onToggle={() => setColorGroupsExpanded(!colorGroupsExpanded)}
          />
          {colorGroupsExpanded ? (
            <div className="space-y-3 rounded-md bg-muted/20 px-2.5 py-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="关键词、路径或 #标签"
                  value={newGroupQuery}
                  onChange={(event) => setNewGroupQuery(event.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    if (newGroupQuery.trim()) {
                      addColorGroup(newGroupQuery.trim(), newGroupColor);
                      setNewGroupQuery('');
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-1.5">
                  {NEON_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewGroupColor(color)}
                      className={cn(
                        'h-4 w-4 rounded-full border border-transparent transition hover:scale-110',
                        newGroupColor === color && 'scale-110 border-foreground ring-1 ring-ring',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={newGroupColor}
                  onChange={(event) => setNewGroupColor(event.target.value)}
                  className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                />
              </div>

              {colorGroups.length > 0 ? (
                <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                  {colorGroups.map(group => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background/70 px-2 py-1.5 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                        <span className="truncate font-medium text-foreground/80">{group.query}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeColorGroup(group.id)}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[10px] font-medium leading-3 text-muted-foreground">{label}</div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-7 rounded-md border-border/60 bg-muted/25 px-2 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
      <span className="text-[10px] text-muted-foreground">{label}</span>
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

function ChipGroup({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: Array<{ id: string; label: string; color: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(item => {
          const active = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(item.id)}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                active
                  ? 'border-foreground/20 bg-foreground text-background'
                  : 'border-border/55 bg-background/65 text-muted-foreground hover:bg-background hover:text-foreground',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompactDisclosure({
  icon,
  label,
  open,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-md px-1.5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/30 hover:text-foreground"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </button>
  );
}

function PhysicsSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-xs font-medium">{value}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={next => onChange(next[0])} />
    </div>
  );
}
