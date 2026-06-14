'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import useArticleStore from '@/stores/article';
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderGit2,
  Lightbulb,
  Tag,
  User,
  X,
} from 'lucide-react';
import { useGraphStore, type GraphNode, type GraphEdge } from '../store/graph-store';

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

const NODE_TYPE_COLORS: Record<string, string> = {
  note: '#2563eb',
  concept: '#059669',
  person: '#c2410c',
  project: '#7c3aed',
  tag: '#be185d',
};

const EDGE_STYLE_CONFIGS: Record<string, { label: string }> = {
  wikilink: { label: '双链' },
  semantic: { label: '语义关联' },
  references: { label: '引用' },
  contains: { label: '包含' },
  mentions: { label: '提及' },
  has_tag: { label: '标签' },
};

export function DetailPanel() {
  const [copied, setCopied] = useState(false);
  const {
    edges,
    nodesMapping,
    selectedNode,
    selectedEdge,
    toggleDetailPanel,
    selectNode,
  } = useGraphStore();

  const node = selectedNode ? nodesMapping.get(selectedNode) : null;
  const edge = selectedEdge ? edges.find(item => item.id === selectedEdge) : null;
  const isTopicNode = node?.nodeProperties?.mode === 'topic';
  const nodePath = node && !isTopicNode ? String(node.nodeProperties?.path ?? node.id) : '';

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

  if (!node && !edge) return null;

  return (
    <div className="flex h-full flex-col bg-background/95">
      <div className="flex items-start justify-between gap-3 border-b border-border/80 p-4">
        <div className="flex min-w-0 items-start gap-3">
          {node ? (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getNodeColor(node) }} />
            </div>
          ) : (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{isTopicNode ? '主题词详情' : node ? '节点详情' : '关系详情'}</div>
            <h3 className="mt-1 truncate text-sm font-semibold">{node ? node.nodeLabel : edge?.label}</h3>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={toggleDetailPanel} className="h-8 w-8 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {node ? <NodeDetail node={node} edges={edges} nodesMapping={nodesMapping} selectNode={selectNode} /> : null}
          {edge ? <EdgeDetail edge={edge} nodesMapping={nodesMapping} selectNode={selectNode} /> : null}
        </div>
      </ScrollArea>

      {node && !isTopicNode ? (
        <div className="border-t border-border/80 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleOpenNote} className="justify-center">
              <ExternalLink className="h-3.5 w-3.5" />
              打开笔记
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyPath()} className="justify-center">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已复制' : '复制路径'}
            </Button>
          </div>
        </div>
      ) : null}
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

  const connectedNodes = useMemo(() => {
    const connectedNodeIds = new Set<string>();
    for (const edge of relatedEdges) {
      if (edge.source === node.id) connectedNodeIds.add(edge.target);
      if (edge.target === node.id) connectedNodeIds.add(edge.source);
    }
    return Array.from(connectedNodeIds)
      .map(id => nodesMapping.get(id))
      .filter(Boolean) as GraphNode[];
  }, [node.id, nodesMapping, relatedEdges]);

  return (
    <>
      <SectionTitle>基本信息</SectionTitle>
      <div className="space-y-2 rounded-md bg-muted/45 p-3">
        <InfoRow label="类型">
          <Badge variant="secondary" className="gap-1 rounded-md">
            {NODE_TYPE_ICONS[node.nodeType]}
            {isTopicNode ? '主题词' : NODE_TYPE_LABELS[node.nodeType] || node.nodeType}
          </Badge>
        </InfoRow>
        <InfoRow label="连接数">
          <span className="text-sm font-medium tabular-nums">{node.connections || 0}</span>
        </InfoRow>
        {isTopicNode ? (
          <>
            <InfoRow label="覆盖笔记">
              <span className="text-sm font-medium tabular-nums">{Number(node.nodeProperties?.noteCount ?? 0)}</span>
            </InfoRow>
            <InfoRow label="RAG 切块">
              <span className="text-sm font-medium tabular-nums">{Number(node.nodeProperties?.chunkCount ?? 0)}</span>
            </InfoRow>
            <InfoRow label="主题权重">
              <span className="text-sm font-medium tabular-nums">{Number(node.nodeProperties?.topicWeight ?? 0).toFixed(2)}</span>
            </InfoRow>
            <InfoRow label="聚类">
              <span className="truncate text-sm">{String(node.nodeProperties?.clusterLabel ?? '主题簇')}</span>
            </InfoRow>
          </>
        ) : null}
        {node.nodeProperties?.path ? (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">路径</div>
            <div className="break-all rounded-md bg-background px-2 py-1.5 text-xs leading-5 text-foreground">
              {node.nodeProperties.path}
            </div>
          </div>
        ) : null}
      </div>

      {isTopicNode && relatedNotes.length > 0 ? (
        <>
          <Separator />
          <SectionTitle>相关笔记 ({relatedNotes.length})</SectionTitle>
          <div className="space-y-1">
            {relatedNotes.slice(0, 10).map(note => (
              <button
                key={note.path}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => useArticleStore.getState().setActiveFilePath(note.path)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{note.weight.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {isTopicNode && samples.length > 0 ? (
        <>
          <Separator />
          <SectionTitle>RAG 相关片段</SectionTitle>
          <div className="space-y-2">
            {samples.slice(0, 4).map((sample, index) => (
              <button
                key={`${sample.filename}-${index}`}
                type="button"
                className="w-full rounded-md border border-border/70 bg-background px-2.5 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => useArticleStore.getState().setActiveFilePath(sample.filename)}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{sample.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{sample.score.toFixed(1)}</span>
                </div>
                <div className="line-clamp-3 text-xs leading-5 text-muted-foreground">{sample.content}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {connectedNodes.length > 0 ? (
        <>
          <Separator />
          <SectionTitle>连接节点 ({connectedNodes.length})</SectionTitle>
          <div className="space-y-1">
            {connectedNodes.slice(0, 12).map(connected => (
              <button
                key={connected.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => selectNode(connected.id)}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getNodeColor(connected) }} />
                <span className="min-w-0 flex-1 truncate text-sm">{connected.nodeLabel}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{connected.connections || 0}</span>
              </button>
            ))}
            {connectedNodes.length > 12 ? (
              <div className="rounded-md bg-muted/45 px-2 py-1.5 text-center text-xs text-muted-foreground">
                还有 {connectedNodes.length - 12} 个节点
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {relatedEdges.length > 0 ? (
        <>
          <Separator />
          <SectionTitle>关系 ({relatedEdges.length})</SectionTitle>
          <div className="space-y-1.5">
            {relatedEdges.slice(0, 12).map(edge => {
              const sourceNode = nodesMapping.get(edge.source);
              const targetNode = nodesMapping.get(edge.target);
              const config = getEdgeConfig(edge);

              return (
                <div key={edge.id} className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-1 text-xs">
                    <span className="truncate">{sourceNode?.nodeLabel ?? edge.source}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="truncate">{targetNode?.nodeLabel ?? edge.target}</span>
                  </div>
                  <Badge variant="outline" className="mt-1.5 rounded-md text-[11px]">
                    {config.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </>
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

  return (
    <>
      <SectionTitle>关系信息</SectionTitle>
      <div className="space-y-2 rounded-md bg-muted/45 p-3">
        <InfoRow label="类型">
          <Badge variant="secondary" className="rounded-md">{config.label}</Badge>
        </InfoRow>
        {edge.weight !== undefined ? (
          <InfoRow label="权重">
            <span className="text-sm tabular-nums">{(edge.weight * 100).toFixed(0)}%</span>
          </InfoRow>
        ) : null}
        {edge.confidence !== undefined ? (
          <InfoRow label="置信度">
            <span className="text-sm tabular-nums">{(edge.confidence * 100).toFixed(1)}%</span>
          </InfoRow>
        ) : null}
      </div>

      <Separator />
      <SectionTitle>关联节点</SectionTitle>
      <div className="space-y-2">
        {sourceNode ? <NodeLink node={sourceNode} caption="源节点" onClick={() => selectNode(sourceNode.id)} /> : null}
        {targetNode ? <NodeLink node={targetNode} caption="目标节点" onClick={() => selectNode(targetNode.id)} /> : null}
      </div>

      {edge.metadata ? (
        <>
          <Separator />
          <SectionTitle>元数据</SectionTitle>
          <div className="space-y-2 rounded-md bg-muted/45 p-3">
            {edge.metadata.source ? <InfoRow label="来源"><span className="text-sm">{edge.metadata.source}</span></InfoRow> : null}
            {edge.metadata.evidence ? (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">证据</div>
                <div className="rounded-md bg-background px-2 py-1.5 text-xs leading-5">{edge.metadata.evidence}</div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-medium text-muted-foreground">{children}</h4>;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
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

function getEdgeConfig(edge: GraphEdge) {
  const label = edge.label.startsWith('semantic:') ? 'semantic' : edge.label;
  return EDGE_STYLE_CONFIGS[label] || { label: edge.label };
}

function getNodeColor(node: GraphNode): string {
  return node.nodeColor || NODE_TYPE_COLORS[node.nodeType] || '#71717a';
}
