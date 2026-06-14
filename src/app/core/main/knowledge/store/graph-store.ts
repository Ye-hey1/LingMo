'use client';

import { create } from 'zustand';
import type { NoteTopic } from '@/db/note-topics';
import type { VectorEmbeddingDocument } from '@/db/vector';

// ==================== 类型定义 ====================

type NodeType = 'note' | 'concept' | 'person' | 'project' | 'tag';
type EdgeType = 'wikilink' | 'semantic' | 'references' | 'contains' | 'mentions' | 'has_tag' | 'custom';
type NodeKind = 'current' | 'hub' | 'linked' | 'note';

interface GraphNode {
  id: string;
  nodeType: NodeType;
  nodeLabel: string;
  nodeColor?: string;
  nodeSize?: number;
  nodeProperties: Record<string, any>;
  nodeMetadata: {
    createdAt: string;
    updatedAt: string;
  };
  connections?: number;
  kind?: NodeKind;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight?: number;
  confidence?: number;
  metadata?: {
    createdAt: string;
    source: string;
    evidence?: string;
  };
}

interface GraphFilters {
  types?: NodeType[];
  search?: string;
  minConnections?: number;
  maxConnections?: number;
}

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filteredNodes: GraphNode[];
  filteredEdges: GraphEdge[];
  nodesMapping: Map<string, GraphNode>;
  edgesMapping: Map<string, GraphEdge>;
  selectedNode: string | null;
  selectedEdge: string | null;
  hoveredNode: string | null;
  zoom: number;
  filters: GraphFilters;
  showDetailPanel: boolean;
  showSearchDialog: boolean;
  showFilterPanel: boolean;
  showExportDialog: boolean;
  isLoading: boolean;
  error: string | null;
  
  loadGraph: () => Promise<void>;
  loadNeighbors: (nodeId: string, depth?: number) => Promise<void>;
  createNode: (type: NodeType, data: Partial<GraphNode>) => Promise<void>;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  createEdge: (source: string, target: string, type: EdgeType) => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  fitView: () => void;
  setFilters: (filters: Partial<GraphFilters>) => void;
  searchNodes: (query: string) => Promise<void>;
  toggleDetailPanel: () => void;
  toggleSearchDialog: () => void;
  toggleFilterPanel: () => void;
  toggleExportDialog: () => void;
  clearError: () => void;
}

// ==================== 节点颜色配置 ====================

const NODE_TYPE_COLORS: Record<NodeType, string> = {
  note: '#3b82f6',
  concept: '#10b981',
  person: '#f59e0b',
  project: '#8b5cf6',
  tag: '#ec4899',
};

const TOPIC_PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

const TOPIC_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your', 'are', 'was', 'were',
  '一个', '一种', '以及', '就是', '可以', '进行', '通过', '基于', '关于', '这个', '这些', '那些',
  '如果', '因为', '所以', '但是', '然后', '我们', '你们', '他们', '它们', '自己', '什么',
  '笔记', '内容', '文章', '文件', '项目', '系统', '设计', '功能',
  'get', 'set', 'let', 'var', 'const', 'tsx', 'ts', 'jsx', 'js', 'css', 'html', 'json',
  'md', 'test', 'demo', 'todo', 'null', 'true', 'false', 'undefined', 'csdn', 'blog',
  'ent', 'src', 'app', 'lib', 'type', 'interface', 'function', 'return',
]);

const LATIN_TOPIC_ALLOWLIST = new Set(['ai', 'rag', 'llm', 'ui', 'ux', 'pm', 'mcp', 'api', 'agent', 'react', 'next', 'tauri']);

interface NoteMeta {
  path: string;
  name: string;
  title: string;
  content: string;
}

interface TopicAccumulator {
  id: string;
  keyword: string;
  totalWeight: number;
  vectorWeight: number;
  noteWeights: Map<string, number>;
  chunks: Set<number>;
  samples: Array<{ filename: string; title: string; content: string; score: number }>;
  clusterId: string;
  color: string;
}

interface TopicEdgeAccumulator {
  source: string;
  target: string;
  cooccurrence: number;
  vector: number;
  count: number;
}

// ==================== 工具函数 ====================

/** 清理文件名作为显示标签 */
function cleanFileName(fileName: string): string {
  // 移除 .md 扩展名
  let name = fileName.replace(/\.md$/i, '');
  
  // 移除日期前缀 (如 20260515-1500-)
  name = name.replace(/^\d{8}-\d{4}-/, '');
  
  // 移除时间戳前缀 (如 20260520-1739-)
  name = name.replace(/^\d{8}-\d{4}-/, '');
  
  // 如果太长，截断
  if (name.length > 20) {
    name = name.substring(0, 18) + '...';
  }
  
  return name || '未命名笔记';
}

/** 从文件内容提取标题 */
function extractTitle(content: string, fileName: string): string {
  // 尝试从 Markdown 标题提取
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1]) {
    const title = h1Match[1].trim();
    if (title.length > 20) {
      return title.substring(0, 18) + '...';
    }
    return title;
  }
  
  // 尝试从 YAML frontmatter 提取
  const yamlMatch = content.match(/^---\s*\n[\s\S]*?title:\s*(.+)\n[\s\S]*?---/);
  if (yamlMatch && yamlMatch[1]) {
    const title = yamlMatch[1].trim().replace(/['"]/g, '');
    if (title.length > 20) {
      return title.substring(0, 18) + '...';
    }
    return title;
  }
  
  // 使用清理后的文件名
  return cleanFileName(fileName);
}

function hashString(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function slugTopic(keyword: string) {
  return keyword
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || `topic-${hashString(keyword)}`;
}

function normalizeTopicKeyword(keyword: string) {
  return keyword
    .replace(/^[#>*\-\d.\s]+/, '')
    .replace(/[`"'“”‘’()[\]{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulTopic(keyword: string) {
  const normalized = normalizeTopicKeyword(keyword);
  const lower = normalized.toLowerCase();
  if (normalized.length < 2 || normalized.length > 24) return false;
  if (TOPIC_STOP_WORDS.has(lower) || TOPIC_STOP_WORDS.has(normalized)) return false;
  if (normalized.startsWith('的')) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^[a-z]$/i.test(normalized)) return false;
  if (/^[a-z0-9_+\-.]+$/i.test(normalized) && normalized.length <= 4 && !LATIN_TOPIC_ALLOWLIST.has(lower)) return false;
  if (/^[a-z0-9_+\-.]+$/i.test(normalized) && !LATIN_TOPIC_ALLOWLIST.has(lower) && /^[a-z]{1,5}$/i.test(normalized)) return false;
  if (/^(http|https|www|com|md|png|jpg|jpeg)$/i.test(normalized)) return false;
  return true;
}

function stripMarkdown(content: string) {
  return content
    .replace(/^---[\s\S]*?---/m, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~|:[\]{}()]/g, ' ')
    .replace(/\s+/g, ' ');
}

function extractFallbackTopics(content: string, title: string): Array<{ keyword: string; weight: number }> {
  const text = `${title} ${stripMarkdown(content).slice(0, 5000)}`;
  const candidates = text.match(/[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9+\-/ ]{1,23}/g) ?? [];
  const scores = new Map<string, number>();

  for (const raw of candidates) {
    const keyword = normalizeTopicKeyword(raw);
    if (!isUsefulTopic(keyword)) continue;
    const lower = keyword.toLowerCase();
    const chineseChars = (keyword.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    const tokenBonus = chineseChars >= 2 ? 1.2 : 0.85;
    const titleBonus = title.includes(keyword) ? 1.8 : 1;
    scores.set(keyword, (scores.get(keyword) ?? 0) + tokenBonus * titleBonus);
    if (lower !== keyword) scores.set(lower, (scores.get(lower) ?? 0) + 0.2);
  }

  return Array.from(scores.entries())
    .map(([keyword, score]) => ({ keyword, weight: score }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 12);
}

function cosineSimilarity(vecA: number[], vecB: number[]) {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < vecA.length; index++) {
    dotProduct += vecA[index] * vecB[index];
    normA += vecA[index] * vecA[index];
    normB += vecB[index] * vecB[index];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getTopicColor(clusterId: string) {
  return TOPIC_PALETTE[hashString(clusterId) % TOPIC_PALETTE.length];
}

function getTopicClusterId(keyword: string) {
  const lower = keyword.toLowerCase();
  if (/ai|agent|模型|智能|大模型|llm|rag|向量/.test(lower)) return 'ai';
  if (/产品|用户|体验|设计|交互|界面|ux|ui/.test(lower)) return 'product';
  if (/技术|架构|工程|开发|代码|系统|算法/.test(lower)) return 'engineering';
  if (/学习|研究|论文|知识|方法|理论/.test(lower)) return 'research';
  if (/项目|计划|管理|流程|协作/.test(lower)) return 'workflow';
  return `topic-${hashString(keyword) % 7}`;
}

function getTopicClusterLabel(clusterId: string) {
  const labels: Record<string, string> = {
    ai: 'AI 与大模型',
    product: '产品设计',
    engineering: '技术架构',
    research: '学术研究',
    workflow: '项目管理',
  };
  return labels[clusterId] ?? '综合主题';
}

function edgeKey(source: string, target: string) {
  return source < target ? `${source}:::${target}` : `${target}:::${source}`;
}

function addTopicEdge(
  edgeMap: Map<string, TopicEdgeAccumulator>,
  source: string,
  target: string,
  weight: number,
  sourceType: 'cooccurrence' | 'vector',
) {
  if (source === target || weight <= 0) return;
  const key = edgeKey(source, target);
  const [normalizedSource, normalizedTarget] = key.split(':::');
  const current = edgeMap.get(key) ?? {
    source: normalizedSource,
    target: normalizedTarget,
    cooccurrence: 0,
    vector: 0,
    count: 0,
  };

  if (sourceType === 'vector') current.vector += weight;
  else current.cooccurrence += weight;
  current.count += 1;
  edgeMap.set(key, current);
}

function refineTopicClusters(
  topicMap: Map<string, TopicAccumulator>,
  edgeMap: Map<string, TopicEdgeAccumulator>,
) {
  const topics = Array.from(topicMap.values());
  if (topics.length === 0 || edgeMap.size === 0) return;

  for (let round = 0; round < 5; round++) {
    for (const topic of topics) {
      const clusterScores = new Map<string, number>();
      clusterScores.set(topic.clusterId, 0.05);

      for (const edge of edgeMap.values()) {
        const neighborId = edge.source === topic.id ? edge.target : edge.target === topic.id ? edge.source : null;
        if (!neighborId) continue;
        const neighbor = topicMap.get(neighborId);
        if (!neighbor) continue;
        const score = edge.vector * 1.45 + edge.cooccurrence * 0.42;
        clusterScores.set(neighbor.clusterId, (clusterScores.get(neighbor.clusterId) ?? 0) + score);
      }

      const best = Array.from(clusterScores.entries()).sort((left, right) => right[1] - left[1])[0];
      if (best && best[1] > 0.18) {
        topic.clusterId = best[0];
        topic.color = getTopicColor(best[0]);
      }
    }
  }
}

function getTopTopicsForChunk(
  doc: VectorEmbeddingDocument,
  topicsByFile: Map<string, TopicAccumulator[]>,
) {
  const contentLower = doc.content.toLowerCase();
  return (topicsByFile.get(doc.filename) ?? [])
    .map(topic => {
      const keywordLower = topic.keyword.toLowerCase();
      const mentioned = contentLower.includes(keywordLower) || doc.content.includes(topic.keyword);
      const noteWeight = topic.noteWeights.get(doc.filename) ?? 0;
      return {
        topic,
        score: noteWeight * (mentioned ? 1.45 : 0.58),
      };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

function pickVectorDocuments(docs: VectorEmbeddingDocument[]) {
  const byFile = new Map<string, VectorEmbeddingDocument[]>();
  for (const doc of docs) {
    if (!doc.embedding.length) continue;
    if (!byFile.has(doc.filename)) byFile.set(doc.filename, []);
    byFile.get(doc.filename)!.push(doc);
  }

  return Array.from(byFile.values())
    .flatMap(fileDocs => fileDocs
      .sort((left, right) => left.chunk_id - right.chunk_id)
      .slice(0, 8))
    .sort((left, right) => right.updated_at - left.updated_at)
    .slice(0, 520);
}

function buildTopicGraph(
  noteMetas: NoteMeta[],
  storedTopics: NoteTopic[],
  vectorDocs: VectorEmbeddingDocument[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const now = new Date().toISOString();
  const noteMetaByPath = new Map(noteMetas.map(meta => [meta.path, meta]));
  const topicsByFile = new Map<string, Array<{ keyword: string; weight: number; source: string }>>();

  for (const topic of storedTopics) {
    const keyword = normalizeTopicKeyword(topic.keyword);
    if (!isUsefulTopic(keyword)) continue;
    if (!topicsByFile.has(topic.filename)) topicsByFile.set(topic.filename, []);
    topicsByFile.get(topic.filename)!.push({
      keyword,
      weight: clamp(topic.weight || 0.1, 0.08, 3),
      source: topic.source,
    });
  }

  for (const meta of noteMetas) {
    const existing = topicsByFile.get(meta.path);
    if (existing && existing.length >= 4) continue;
    const fallback = extractFallbackTopics(meta.content, meta.title)
      .slice(0, Math.max(4, 10 - (existing?.length ?? 0)))
      .map(topic => ({ ...topic, weight: clamp(topic.weight / 4, 0.08, 1.6), source: 'fallback' }));
    if (fallback.length) {
      topicsByFile.set(meta.path, [...(existing ?? []), ...fallback]);
    }
  }

  if (topicsByFile.size === 0) return { nodes: [], edges: [] };

  const topicMap = new Map<string, TopicAccumulator>();
  const getTopic = (keyword: string) => {
    const cleanKeyword = normalizeTopicKeyword(keyword);
    const id = `topic:${slugTopic(cleanKeyword)}`;
    const clusterId = getTopicClusterId(cleanKeyword);
    if (!topicMap.has(id)) {
      topicMap.set(id, {
        id,
        keyword: cleanKeyword,
        totalWeight: 0,
        vectorWeight: 0,
        noteWeights: new Map(),
        chunks: new Set(),
        samples: [],
        clusterId,
        color: getTopicColor(clusterId),
      });
    }
    return topicMap.get(id)!;
  };

  for (const [filename, topics] of topicsByFile) {
    for (const topic of topics.slice(0, 16)) {
      const accumulator = getTopic(topic.keyword);
      const nextWeight = (accumulator.noteWeights.get(filename) ?? 0) + topic.weight;
      accumulator.noteWeights.set(filename, nextWeight);
      accumulator.totalWeight += topic.weight;
    }
  }

  const edgeMap = new Map<string, TopicEdgeAccumulator>();
  for (const [filename, topics] of topicsByFile) {
    const rankedTopicIds = topics
      .map(topic => {
        const accumulator = getTopic(topic.keyword);
        return { id: accumulator.id, weight: topic.weight };
      })
      .filter((item, index, items) => items.findIndex(other => other.id === item.id) === index)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 10);

    for (let first = 0; first < rankedTopicIds.length; first++) {
      for (let second = first + 1; second < rankedTopicIds.length; second++) {
        const weight = Math.sqrt(rankedTopicIds[first].weight * rankedTopicIds[second].weight);
        addTopicEdge(edgeMap, rankedTopicIds[first].id, rankedTopicIds[second].id, weight, 'cooccurrence');
      }
    }

    const meta = noteMetaByPath.get(filename);
    if (meta) {
      for (const item of rankedTopicIds.slice(0, 5)) {
        const topic = topicMap.get(item.id);
        if (!topic || topic.samples.length >= 6) continue;
        topic.samples.push({
          filename,
          title: meta.title,
          content: meta.content.slice(0, 180),
          score: item.weight,
        });
      }
    }
  }

  const selectedVectorDocs = pickVectorDocuments(vectorDocs);
  const accumulatorsByFile = new Map<string, TopicAccumulator[]>();
  for (const topic of topicMap.values()) {
    for (const filename of topic.noteWeights.keys()) {
      if (!accumulatorsByFile.has(filename)) accumulatorsByFile.set(filename, []);
      accumulatorsByFile.get(filename)!.push(topic);
    }
  }

  const chunkTopics = new Map<number, ReturnType<typeof getTopTopicsForChunk>>();
  for (const doc of selectedVectorDocs) {
    const topTopics = getTopTopicsForChunk(doc, accumulatorsByFile);
    if (topTopics.length === 0) continue;
    chunkTopics.set(doc.id, topTopics);

    for (const item of topTopics) {
      item.topic.chunks.add(doc.id);
      item.topic.vectorWeight += item.score * 0.18;
      if (item.topic.samples.length < 6) {
        item.topic.samples.push({
          filename: doc.filename,
          title: noteMetaByPath.get(doc.filename)?.title ?? cleanFileName(doc.filename.split(/[\\/]/).pop() || doc.filename),
          content: doc.content.slice(0, 220),
          score: item.score,
        });
      }
    }
  }

  for (let first = 0; first < selectedVectorDocs.length; first++) {
    const firstDoc = selectedVectorDocs[first];
    const firstTopics = chunkTopics.get(firstDoc.id);
    if (!firstTopics?.length) continue;

    for (let second = first + 1; second < selectedVectorDocs.length; second++) {
      const secondDoc = selectedVectorDocs[second];
      if (firstDoc.filename === secondDoc.filename) continue;
      const secondTopics = chunkTopics.get(secondDoc.id);
      if (!secondTopics?.length) continue;

      const similarity = cosineSimilarity(firstDoc.embedding, secondDoc.embedding);
      if (similarity < 0.69) continue;

      for (const source of firstTopics.slice(0, 3)) {
        for (const target of secondTopics.slice(0, 3)) {
          if (source.topic.id === target.topic.id) continue;
          const weight = similarity * Math.sqrt(source.score * target.score);
          addTopicEdge(edgeMap, source.topic.id, target.topic.id, weight, 'vector');
        }
      }
    }
  }

  refineTopicClusters(topicMap, edgeMap);

  const rankedTopics = Array.from(topicMap.values())
    .map(topic => ({
      topic,
      score: topic.totalWeight + topic.vectorWeight + topic.noteWeights.size * 0.65 + topic.chunks.size * 0.18,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 120);

  const selectedTopicIds = new Set(rankedTopics.map(item => item.topic.id));
  const maxScore = Math.max(...rankedTopics.map(item => item.score), 1);
  const maxNotes = Math.max(...rankedTopics.map(item => item.topic.noteWeights.size), 1);

  const topicNodes = rankedTopics.map(({ topic, score }) => {
    const relatedNotes = Array.from(topic.noteWeights.entries())
      .map(([filename, weight]) => ({
        path: filename,
        title: noteMetaByPath.get(filename)?.title ?? cleanFileName(filename.split(/[\\/]/).pop() || filename),
        weight,
      }))
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 12);
    const importance = Math.sqrt(score / maxScore);
    const noteRatio = Math.sqrt(topic.noteWeights.size / maxNotes);
    const nodeSize = Math.round(clamp(8 + importance * 26 + noteRatio * 9, 9, 42));
    const connections = Array.from(edgeMap.values()).filter(edge =>
      (edge.source === topic.id || edge.target === topic.id) &&
      selectedTopicIds.has(edge.source) &&
      selectedTopicIds.has(edge.target)
    ).length;

    return {
      id: topic.id,
      nodeType: 'concept' as NodeType,
      nodeLabel: topic.keyword,
      nodeColor: topic.color,
      nodeSize,
      nodeProperties: {
        mode: 'topic',
        keyword: topic.keyword,
        topicWeight: Number(topic.totalWeight.toFixed(2)),
        vectorWeight: Number(topic.vectorWeight.toFixed(2)),
        noteCount: topic.noteWeights.size,
        chunkCount: topic.chunks.size,
        clusterId: topic.clusterId,
        clusterLabel: getTopicClusterLabel(topic.clusterId),
        notes: relatedNotes,
        samples: topic.samples
          .sort((left, right) => right.score - left.score)
          .slice(0, 5),
      },
      nodeMetadata: {
        createdAt: now,
        updatedAt: now,
      },
      connections,
      kind: connections >= 7 || topic.noteWeights.size >= 4 ? 'hub' as NodeKind : connections > 0 ? 'linked' as NodeKind : 'note' as NodeKind,
    };
  });

  const topicEdges = Array.from(edgeMap.values())
    .filter(edge => selectedTopicIds.has(edge.source) && selectedTopicIds.has(edge.target))
    .map(edge => {
      const weight = edge.cooccurrence * 0.62 + edge.vector * 0.9;
      return { edge, weight };
    })
    .filter(item => item.weight > 0.08)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 400)
    .map(({ edge, weight }, index) => ({
      id: `topic-edge:${index}:${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      label: edge.vector > edge.cooccurrence ? 'rag-vector' : edge.vector > 0 ? 'topic-semantic' : 'topic-cooccurrence',
      weight: clamp(weight / 5, 0.08, 1.8),
      confidence: clamp(edge.vector / Math.max(edge.cooccurrence + edge.vector, 0.01), 0, 1),
      metadata: {
        createdAt: now,
        source: edge.vector > 0 ? 'RAG chunk similarity' : 'topic co-occurrence',
        evidence: `共现 ${edge.cooccurrence.toFixed(2)} · 向量 ${edge.vector.toFixed(2)} · 样本 ${edge.count}`,
      },
    }));

  const connectionCounts = new Map<string, number>();
  for (const edge of topicEdges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
  }

  const nodes = topicNodes.map(node => {
    const connections = connectionCounts.get(node.id) ?? node.connections ?? 0;
    return {
      ...node,
      connections,
      kind: connections >= 7 || (node.nodeProperties.noteCount ?? 0) >= 4 ? 'hub' as NodeKind : connections > 0 ? 'linked' as NodeKind : 'note' as NodeKind,
      nodeSize: Math.round(clamp(Math.max(node.nodeSize ?? 12, connections >= 12 ? 36 : connections >= 6 ? 28 : 11), 8, 42)),
    };
  });

  return { nodes, edges: topicEdges };
}

// ==================== Store 实现 ====================

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  filteredNodes: [],
  filteredEdges: [],
  nodesMapping: new Map(),
  edgesMapping: new Map(),
  selectedNode: null,
  selectedEdge: null,
  hoveredNode: null,
  zoom: 0.86,
  filters: {},
  showDetailPanel: false,
  showSearchDialog: false,
  showFilterPanel: false,
  showExportDialog: false,
  isLoading: false,
  error: null,

  // ==================== 数据加载 ====================
  
  loadGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      // 动态导入依赖
      const useArticleStore = (await import('@/stores/article')).default;
      const { useNoteIndexStore } = await import('@/stores/note-index');
      const { getAllMarkdownFiles } = await import('@/lib/files');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const { getFilePathOptions } = await import('@/lib/workspace');
      const { getAllTopics } = await import('@/db/note-topics');
      const { getAllVectorEmbeddingDocuments } = await import('@/db/vector');
      
      const articleStore = useArticleStore.getState();
      const noteIndexStore = useNoteIndexStore.getState();

      // 确保索引已构建
      if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
        await noteIndexStore.buildIndex(articleStore.fileTree);
      }

      const allFiles = await getAllMarkdownFiles();
      const noteMetas: NoteMeta[] = [];

      // 读取笔记内容，主题词节点需要知道来源笔记和标题
      for (const file of allFiles) {
        try {
          const { path, baseDir } = await getFilePathOptions(file.relativePath);
          const content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path);
          const title = extractTitle(content, file.name);
          noteMetas.push({
            path: file.relativePath,
            name: file.name,
            title,
            content,
          });
        } catch {
          noteMetas.push({
            path: file.relativePath,
            name: file.name,
            title: cleanFileName(file.name),
            content: '',
          });
        }
      }

      const [storedTopics, vectorDocs] = await Promise.all([
        getAllTopics().catch(() => [] as NoteTopic[]),
        getAllVectorEmbeddingDocuments().catch(() => [] as VectorEmbeddingDocument[]),
      ]);
      const { nodes, edges } = buildTopicGraph(noteMetas, storedTopics, vectorDocs);

      // 构建索引
      const nodesMapping = new Map(nodes.map(n => [n.id, n]));
      const edgesMapping = new Map(edges.map(e => [e.id, e]));

      set({
        nodes,
        edges,
        filteredNodes: nodes,
        filteredEdges: edges,
        nodesMapping,
        edgesMapping,
        isLoading: false,
      });
      
      console.log(`[KnowledgeGraph] Loaded ${nodes.length} topic nodes, ${edges.length} topic edges`);
    } catch (error) {
      console.error('[KnowledgeGraph] Failed to load:', error);
      set({ error: String(error), isLoading: false });
    }
  },

  loadNeighbors: async (nodeId: string, depth: number = 1) => {
    const { edges, nodesMapping } = get();
    const node = nodesMapping.get(nodeId);
    if (!node) return;

    const neighborIds = new Set<string>();
    for (const edge of edges) {
      if (edge.source === nodeId) neighborIds.add(edge.target);
      if (edge.target === nodeId) neighborIds.add(edge.source);
    }

    if (depth > 1) {
      for (const neighborId of Array.from(neighborIds)) {
        for (const edge of edges) {
          if (edge.source === neighborId && !neighborIds.has(edge.target) && edge.target !== nodeId) {
            neighborIds.add(edge.target);
          }
          if (edge.target === neighborId && !neighborIds.has(edge.source) && edge.source !== nodeId) {
            neighborIds.add(edge.source);
          }
        }
      }
    }
  },

  // ==================== 节点操作 ====================

  createNode: async (type: NodeType, data: Partial<GraphNode>) => {
    const newNode: GraphNode = {
      id: data.id || `node-${Date.now()}`,
      nodeType: type,
      nodeLabel: data.nodeLabel || '新建节点',
      nodeColor: data.nodeColor || NODE_TYPE_COLORS[type],
      nodeSize: data.nodeSize || 30,
      nodeProperties: data.nodeProperties || {},
      nodeMetadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      connections: 0,
      kind: 'note',
    };

    set(state => ({
      nodes: [...state.nodes, newNode],
      filteredNodes: [...state.filteredNodes, newNode],
      nodesMapping: new Map(state.nodesMapping).set(newNode.id, newNode),
    }));
  },

  updateNode: async (nodeId: string, updates: Partial<GraphNode>) => {
    set(state => {
      const node = state.nodesMapping.get(nodeId);
      if (!node) return state;

      const updatedNode = { ...node, ...updates };
      const newNodes = state.nodes.map(n => n.id === nodeId ? updatedNode : n);
      const newNodesMapping = new Map(state.nodesMapping);
      newNodesMapping.set(nodeId, updatedNode);

      return {
        nodes: newNodes,
        filteredNodes: newNodes,
        nodesMapping: newNodesMapping,
      };
    });
  },

  deleteNode: async (nodeId: string) => {
    set(state => {
      const newNodes = state.nodes.filter(n => n.id !== nodeId);
      const newEdges = state.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
      const newNodesMapping = new Map(state.nodesMapping);
      newNodesMapping.delete(nodeId);

      return {
        nodes: newNodes,
        edges: newEdges,
        filteredNodes: newNodes,
        filteredEdges: newEdges,
        nodesMapping: newNodesMapping,
        selectedNode: state.selectedNode === nodeId ? null : state.selectedNode,
        showDetailPanel: state.selectedNode === nodeId ? false : state.showDetailPanel,
      };
    });
  },

  // ==================== 边操作 ====================

  createEdge: async (source: string, target: string, type: EdgeType) => {
    const newEdge: GraphEdge = {
      id: `edge-${Date.now()}`,
      source,
      target,
      label: type,
      weight: 1,
    };

    set(state => ({
      edges: [...state.edges, newEdge],
      filteredEdges: [...state.filteredEdges, newEdge],
      edgesMapping: new Map(state.edgesMapping).set(newEdge.id, newEdge),
    }));
  },

  deleteEdge: async (edgeId: string) => {
    set(state => {
      const newEdges = state.edges.filter(e => e.id !== edgeId);
      const newEdgesMapping = new Map(state.edgesMapping);
      newEdgesMapping.delete(edgeId);

      return {
        edges: newEdges,
        filteredEdges: newEdges,
        edgesMapping: newEdgesMapping,
        selectedEdge: state.selectedEdge === edgeId ? null : state.selectedEdge,
      };
    });
  },

  // ==================== 选择和交互 ====================

  selectNode: (id) => set({ selectedNode: id, selectedEdge: null, showDetailPanel: !!id }),
  selectEdge: (id) => set({ selectedEdge: id, selectedNode: null, showDetailPanel: !!id }),
  setHoveredNode: (id) => set({ hoveredNode: id }),
  setZoom: (zoom) => set({ zoom: Math.max(0.28, Math.min(4.5, zoom)) }),
  fitView: () => set({ zoom: 0.86 }),

  // ==================== 筛选和搜索 ====================

  setFilters: (filters) => {
    const newFilters = { ...get().filters, ...filters };
    set({ filters: newFilters });

    const { nodes, edges } = get();
    const filteredNodes = nodes.filter(node => {
      if (newFilters.types && newFilters.types.length > 0) {
        if (!newFilters.types.includes(node.nodeType)) return false;
      }
      if (newFilters.search) {
        const searchLower = newFilters.search.toLowerCase();
        if (!node.nodeLabel.toLowerCase().includes(searchLower)) return false;
      }
      if (newFilters.minConnections !== undefined) {
        if ((node.connections || 0) < newFilters.minConnections) return false;
      }
      if (newFilters.maxConnections !== undefined) {
        if ((node.connections || 0) > newFilters.maxConnections) return false;
      }
      return true;
    });

    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = edges.filter(e => 
      filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );

    set({ filteredNodes, filteredEdges });
  },

  searchNodes: async (query: string) => {
    if (!query.trim()) {
      set(state => ({
        filteredNodes: state.nodes,
        filteredEdges: state.edges,
        filters: { ...state.filters, search: '' },
      }));
      return;
    }

    const { nodes, edges } = get();
    const searchLower = query.toLowerCase();
    
    const filteredNodes = nodes.filter(node => 
      node.nodeLabel.toLowerCase().includes(searchLower) ||
      node.nodeProperties?.path?.toLowerCase().includes(searchLower)
    );

    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = edges.filter(e => 
      filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );

    set({
      filteredNodes,
      filteredEdges,
      filters: { ...get().filters, search: query },
    });
  },

  // ==================== UI 控制 ====================

  toggleDetailPanel: () => set(state => ({ showDetailPanel: !state.showDetailPanel })),
  toggleSearchDialog: () => set(state => ({ showSearchDialog: !state.showSearchDialog })),
  toggleFilterPanel: () => set(state => ({ showFilterPanel: !state.showFilterPanel })),
  toggleExportDialog: () => set(state => ({ showExportDialog: !state.showExportDialog })),
  clearError: () => set({ error: null }),
}));

// 导出类型
export type { GraphNode, GraphEdge, NodeType, EdgeType, GraphFilters, NodeKind };
