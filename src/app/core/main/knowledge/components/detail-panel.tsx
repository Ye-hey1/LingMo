'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import useArticleStore from '@/stores/article';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderGit2,
  Lightbulb,
  Link2,
  Network,
  Sparkles,
  Tag,
  User,
  X,
} from 'lucide-react';
import { useGraphStore, type GraphNode, type GraphEdge } from '../store/graph-store';
import { NODE_TYPE_COLORS } from '../constants';

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4" />,
  concept: <Lightbulb className="h-4 w-4" />,
  person: <User className="h-4 w-4" />,
  project: <FolderGit2 className="h-4 w-4" />,
  tag: <Tag className="h-4 w-4" />,
};

const NODE_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  concept: '概念',
  person: '人物',
  project: '项目',
  tag: '标签',
};

const EDGE_STYLE_CONFIGS: Record<string, { label: string }> = {
  wikilink: { label: '双链' },
  semantic: { label: '语义' },
  references: { label: '引用' },
  related: { label: '相关' },
  extends: { label: '延伸' },
  supports: { label: '支撑' },
  contradicts: { label: '矛盾' },
  analogous: { label: '类比' },
  'example-of': { label: '示例' },
  uses: { label: '使用' },
  'part-of': { label: '属于' },
  contains: { label: '包含' },
  mentions: { label: '提及' },
  has_tag: { label: '标签' },
  'topic-cooccurrence': { label: '共现' },
  'topic-semantic': { label: '语义' },
  'rag-vector': { label: 'RAG' },
  'topic-note': { label: '归属' },
};

const SOURCE_LABELS: Record<string, string> = {
  wikilink: '双链',
  frontmatter: '显式关联',
  keyword: '关键词',
  cosine: '向量',
  llm: 'AI 判定',
  cross_validated: '交叉验证',
  topic: '主题',
  vector: '向量',
};

export function DetailPanel() {
  const [copied, setCopied] = useState(false);
  const {
    edges,
    nodesMapping,
    selectedNode,
    selectedEdge,
    selectNode,
    selectEdge,
    getNodeById,
  } = useGraphStore();

  const node = useMemo(() => {
    if (!selectedNode) return null;
    return getNodeById(selectedNode) || nodesMapping.get(selectedNode) || null;
  }, [selectedNode, getNodeById, nodesMapping]);

  const edge = selectedEdge ? edges.find(item => item.id === selectedEdge) || null : null;
  const isTopicNode = node?.nodeProperties?.mode === 'topic';
  const isUnresolvedNode = node?.nodeProperties?.isUnresolved === true;
  const nodePath = node && !isTopicNode && !isUnresolvedNode ? String(node.nodeProperties?.path ?? node.id) : '';

  const handleClose = () => {
    selectNode(null);
    selectEdge(null);
  };

  const handleOpenNote = () => {
    if (!nodePath) return;
    useArticleStore.getState().setActiveFilePath(nodePath);
  };

  const handleCopyPath = async () => {
    if (!nodePath || typeof navigator === 'undefined') return;
    await navigator.clipboard.writeText(nodePath);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  if (!node && !edge) {
    return (
      <div className="flex h-full flex-col bg-background/95">
        <PanelHeader title="节点详情" onClose={handleClose} />
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-muted-foreground">
          点击任意节点后，这里会显示它的来源、关键词和关联关系。
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background/95 text-foreground">
      <PanelHeader
        title={node ? '节点详情' : '关系详情'}
        onClose={handleClose}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {node ? (
            <NodeDetail node={node} edges={edges} nodesMapping={nodesMapping} selectNode={selectNode} />
          ) : null}
          {edge ? <EdgeDetail edge={edge} nodesMapping={nodesMapping} selectNode={selectNode} /> : null}
        </div>
      </ScrollArea>

      {node && !isTopicNode ? (
        <div className="border-t border-border/70 bg-background/90 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="default" size="sm" onClick={handleOpenNote} className="h-8 justify-center">
              <ExternalLink className="h-3.5 w-3.5" />
              打开笔记
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyPath()} className="h-8 justify-center">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已复制' : '复制路径'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-4 py-2.5">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface NodeDetailProps {
  node: GraphNode;
  edges: GraphEdge[];
  nodesMapping: Map<string, GraphNode>;
  selectNode: (id: string | null) => void;
}

function NodeDetail({ node, edges, nodesMapping, selectNode }: NodeDetailProps) {
  const isTopicNode = node.nodeProperties?.mode === 'topic';
  const isOrphan = node.nodeProperties?.isOrphan === true;
  const isUnresolved = node.nodeProperties?.isUnresolved === true;
  const relatedNotes = Array.isArray(node.nodeProperties?.notes)
    ? node.nodeProperties.notes as Array<{ path: string; title: string; weight: number }>
    : [];
  const samples = Array.isArray(node.nodeProperties?.samples)
    ? node.nodeProperties.samples as Array<{ filename: string; title: string; content: string; score: number }>
    : [];

  const relatedEdges = useMemo(
    () => edges.filter(edge => edge.source === node.id || edge.target === node.id),
    [edges, node.id],
  );

  const relationRows = useMemo(() => relatedEdges
    .map(edge => {
      const relatedId = edge.source === node.id ? edge.target : edge.source;
      const relatedNode = nodesMapping.get(relatedId);
      return relatedNode ? { edge, relatedNode } : null;
    })
    .filter(Boolean) as Array<{ edge: GraphEdge; relatedNode: GraphNode }>,
    [node.id, nodesMapping, relatedEdges],
  );

  const keywords = getKeywords(node);
  const summary = getNodeSummary(node, samples);
  const path = node.nodeProperties?.path ? String(node.nodeProperties.path) : '';
  const nodeTypeLabel = isTopicNode
    ? '主题'
    : isOrphan
      ? '孤立点'
      : isUnresolved
        ? '未创建引用'
        : NODE_TYPE_LABELS[node.nodeType] || node.nodeType;

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/50 text-background shadow-sm"
            style={{ backgroundColor: getNodeColor(node) }}
          >
            {NODE_TYPE_ICONS[node.nodeType] || <Network className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-lg font-semibold leading-tight">
              {isUnresolved ? '未创建引用' : node.nodeLabel}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="rounded-md">{nodeTypeLabel}</Badge>
              {node.kind === 'hub' ? <Badge className="rounded-md bg-amber-500 text-white">核心节点</Badge> : null}
              {isUnresolved ? <Badge variant="destructive" className="rounded-md">被引用但未建文件</Badge> : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="连接" value={node.connections || relatedEdges.length || 0} />
          <Metric label="笔记" value={Number(node.nodeProperties?.noteCount ?? relatedNotes.length ?? 0)} />
          <Metric
            label={isTopicNode ? '权重' : '切块'}
            value={isTopicNode ? Number(node.nodeProperties?.topicWeight ?? 0).toFixed(2) : Number(node.nodeProperties?.chunkCount ?? 0)}
          />
        </div>
      </section>

      {summary ? (
        <InfoSection title="摘要">
          <p className="text-sm leading-6 text-foreground/85">{summary}</p>
        </InfoSection>
      ) : null}

      {(path || node.nodeMetadata?.source || node.nodeMetadata?.updatedAt) ? (
        <InfoSection title="来源">
          <div className="space-y-2 text-sm">
            {path ? (
              <div className="rounded-md border border-border/60 bg-muted/35 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">文件路径</div>
                <div className="break-all">{path}</div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {node.nodeMetadata?.source ? <PlainInfo label="来源" value={node.nodeMetadata.source} /> : null}
              {node.nodeMetadata?.updatedAt ? <PlainInfo label="更新" value={formatDate(node.nodeMetadata.updatedAt)} /> : null}
            </div>
          </div>
        </InfoSection>
      ) : null}

      {keywords.length > 0 ? (
        <InfoSection title="关键词">
          <div className="flex flex-wrap gap-1.5">
            {keywords.slice(0, 12).map(keyword => (
              <Badge key={keyword} variant="outline" className="rounded-md bg-background text-xs">
                {keyword}
              </Badge>
            ))}
          </div>
        </InfoSection>
      ) : null}

      {(isOrphan || isUnresolved) ? (
        <InsightActions node={node} isOrphan={isOrphan} isUnresolved={isUnresolved} />
      ) : null}

      {relatedNotes.length > 0 ? (
        <InfoSection title={`相关笔记 ${relatedNotes.length}`}>
          <div className="space-y-1">
            {relatedNotes.slice(0, 8).map(note => (
              <button
                key={note.path}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => useArticleStore.getState().setActiveFilePath(note.path)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{Number(note.weight ?? 0).toFixed(1)}</span>
              </button>
            ))}
          </div>
        </InfoSection>
      ) : null}

      {samples.length > 0 ? (
        <InfoSection title="RAG 片段">
          <div className="space-y-2">
            {samples.slice(0, 3).map((sample, index) => (
              <button
                key={`${sample.filename}-${index}`}
                type="button"
                className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => useArticleStore.getState().setActiveFilePath(sample.filename)}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{sample.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{Number(sample.score ?? 0).toFixed(1)}</span>
                </div>
                <div className="line-clamp-3 text-xs leading-5 text-muted-foreground">{sample.content}</div>
              </button>
            ))}
          </div>
        </InfoSection>
      ) : null}

      {relationRows.length > 0 ? (
        <InfoSection title={`关联节点 ${relationRows.length}`}>
          <div className="grid grid-cols-2 gap-1.5">
            {relationRows.slice(0, 18).map(({ edge, relatedNode }) => (
              <button
                key={`${edge.id}-${relatedNode.id}`}
                type="button"
                title={`${relatedNode.nodeLabel} · ${getEdgeConfig(edge).label}`}
                className="min-w-0 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-left transition hover:border-border hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => selectNode(relatedNode.id)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getNodeColor(relatedNode) }} />
                  <span className="min-w-0 flex-1 truncate text-sm leading-5">{relatedNode.nodeLabel}</span>
                  <span className="shrink-0 text-[10px] tabular-nums leading-5 text-muted-foreground">{relatedNode.connections || 0}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] leading-4 text-muted-foreground">
                  {getEdgeConfig(edge).label}
                </span>
              </button>
            ))}
            {relationRows.length > 18 ? (
              <div className="col-span-2 rounded-md bg-muted/40 px-2 py-1.5 text-center text-xs text-muted-foreground">
                还有 {relationRows.length - 18} 个关联节点
              </div>
            ) : null}
          </div>
        </InfoSection>
      ) : null}
    </>
  );
}

function InsightActions({ node, isOrphan, isUnresolved }: { node: GraphNode; isOrphan: boolean; isUnresolved: boolean }) {
  const sourceNotes = (node.nodeProperties?.sourceNotes as Array<{ path: string; title: string }> ?? []);
  const recommendations = (node.nodeProperties?.recommendations as Array<{ path: string; title: string; similarity: number }> ?? []);

  return (
    <InfoSection title="建议">
      <div className="rounded-md border border-amber-200/70 bg-amber-50/80 p-3 text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
          {isUnresolved ? <AlertTriangle className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          {isUnresolved ? '未创建引用' : '建议补充双链'}
        </div>
        <p className="text-xs leading-5 opacity-80">
          {isUnresolved
            ? '某篇笔记里有这条双链引用，但当前工作区还没有找到同名 Markdown 文件。'
            : '这个节点当前连接较弱，可以从推荐笔记中补充链接。'}
        </p>

        {isUnresolved && node.nodeProperties?.originalReference ? (
          <div className="mt-2 rounded border border-amber-200/50 bg-background/35 px-2 py-1.5 text-xs leading-5 opacity-85 dark:border-amber-500/15">
            引用标题：{String(node.nodeProperties.originalReference)}
          </div>
        ) : null}

        {isUnresolved && sourceNotes.length > 0 ? (
          <div className="mt-2 space-y-1">
            {sourceNotes.slice(0, 4).map(source => (
              <button
                key={source.path}
                type="button"
                onClick={() => useArticleStore.getState().setActiveFilePath(source.path)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition hover:bg-background/50"
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{source.title}</span>
              </button>
            ))}
          </div>
        ) : null}

        {isOrphan && recommendations.length > 0 ? (
          <div className="mt-2 space-y-1">
            {recommendations.slice(0, 4).map(rec => (
              <button
                key={rec.path}
                type="button"
                onClick={() => useArticleStore.getState().setActiveFilePath(rec.path)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition hover:bg-background/50"
              >
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{rec.title}</span>
                <span className="shrink-0 tabular-nums opacity-70">{(rec.similarity * 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </InfoSection>
  );
}

interface EdgeDetailProps {
  edge: GraphEdge;
  nodesMapping: Map<string, GraphNode>;
  selectNode: (id: string | null) => void;
}

function EdgeDetail({ edge, nodesMapping, selectNode }: EdgeDetailProps) {
  const sourceNode = nodesMapping.get(edge.source);
  const targetNode = nodesMapping.get(edge.target);
  const config = getEdgeConfig(edge);
  const sourceMethods = getEdgeSources(edge);
  const relationTypes = getEdgeRelationTypes(edge);

  return (
    <>
      <InfoSection title="关系">
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/25 p-3">
          <PlainInfo label="类型" value={config.label} />
          {relationTypes.length > 1 ? <PlainInfo label="合并类型" value={relationTypes.map(getRelationLabel).join(' / ')} /> : null}
          {sourceMethods.length > 0 ? <PlainInfo label="来源" value={sourceMethods.map(getSourceLabel).join(' / ')} /> : null}
          {edge.weight !== undefined ? <PlainInfo label="权重" value={`${(edge.weight * 100).toFixed(0)}%`} /> : null}
          {edge.confidence !== undefined ? <PlainInfo label="置信度" value={`${(edge.confidence * 100).toFixed(1)}%`} /> : null}
        </div>
      </InfoSection>

      <InfoSection title="端点">
        <div className="space-y-2">
          {sourceNode ? <NodeLink node={sourceNode} caption="源节点" onClick={() => selectNode(sourceNode.id)} /> : null}
          {targetNode ? <NodeLink node={targetNode} caption="目标节点" onClick={() => selectNode(targetNode.id)} /> : null}
        </div>
      </InfoSection>

      {edge.metadata?.evidence ? (
        <InfoSection title="证据">
          <div className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
            {edge.metadata.evidence}
          </div>
        </InfoSection>
      ) : null}
    </>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <Separator className="flex-1" />
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/35 px-2.5 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function PlainInfo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

function NodeLink({ node, caption, onClick }: { node: GraphNode; caption: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-background px-2.5 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: getNodeColor(node) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{node.nodeLabel}</span>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </span>
    </button>
  );
}

function getKeywords(node: GraphNode) {
  const hidden = new Set(['topic', 'note', 'concept', 'undefined', 'null']);
  const raw = [
    node.nodeProperties?.keyword,
    node.nodeProperties?.clusterLabel,
    ...(Array.isArray(node.nodeProperties?.tags) ? node.nodeProperties.tags : []),
  ];
  return Array.from(new Set(raw
    .map(item => String(item ?? '').trim())
    .filter(item => item && !hidden.has(item.toLowerCase()))));
}

function getNodeSummary(node: GraphNode, samples: Array<{ content: string }>) {
  const candidates = [
    node.nodeProperties?.summary,
    node.nodeProperties?.description,
    node.nodeProperties?.content,
    samples[0]?.content,
  ];
  const text = candidates.map(item => String(item ?? '').trim()).find(Boolean);
  if (!text) return '';
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function getEdgeConfig(edge: GraphEdge) {
  const label = edge.label.startsWith('semantic:') ? 'semantic' : normalizeRelationLabel(String(edge.metadata?.relationType ?? edge.label));
  return EDGE_STYLE_CONFIGS[label] || { label: edge.label };
}

function normalizeRelationLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'related_to') return 'related';
  if (normalized === 'part_of') return 'part-of';
  if (normalized === 'example_of') return 'example-of';
  if (normalized === 'similar_to') return 'analogous';
  if (normalized === 'builds_on') return 'extends';
  return normalized.replace(/_/g, '-');
}

function getRelationLabel(value: string) {
  return EDGE_STYLE_CONFIGS[normalizeRelationLabel(value)]?.label ?? value;
}

function getSourceLabel(value: string) {
  return SOURCE_LABELS[value] ?? value;
}

function getEdgeSources(edge: GraphEdge) {
  return Array.from(new Set([
    ...(edge.metadata?.sourceMethods ?? []),
    edge.metadata?.sourceMethod,
    edge.label === 'wikilink' ? 'wikilink' : undefined,
    edge.label === 'semantic' ? 'cosine' : undefined,
  ].filter(Boolean) as string[]));
}

function getEdgeRelationTypes(edge: GraphEdge) {
  return Array.from(new Set([
    ...(edge.metadata?.relationTypes ?? []),
    edge.metadata?.relationType,
    edge.label,
  ].filter(Boolean).map(item => normalizeRelationLabel(String(item)))));
}

function getNodeColor(node: GraphNode): string {
  return node.nodeColor || NODE_TYPE_COLORS[node.nodeType] || '#71717a';
}
