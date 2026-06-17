'use client';

import { create } from 'zustand';
import type { NoteTopic } from '@/db/note-topics';
import type { VectorEmbeddingDocument } from '@/db/vector';
import type { NodeType, EdgeType, NodeKind, GraphNode, GraphEdge, GraphFilters, PhysicsConfig, ColorGroup } from '../types';
import { NODE_TYPE_COLORS } from '../constants';
import {
  cleanKnowledgeSample,
  extractKnowledgeTopicCandidates,
  isNoisyKnowledgeTopic,
  isUsefulKnowledgeTopic,
  normalizeKnowledgeTopic,
  prepareKnowledgeIndexText,
  stripKnowledgeNoise,
  topicQualityScore,
} from '@/lib/knowledge-topic-cleaner';
import { computedParentPath } from '@/lib/path';

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
  enable3D: boolean;
  enableInertialDrag: boolean;

  // 物理与染色状态
  physics: PhysicsConfig;
  colorGroups: ColorGroup[];

  // 局部图谱状态
  graphMode: 'global' | 'local';
  graphView: 'topic' | 'note';

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
  getNodeById: (id: string | null) => GraphNode | undefined;
  setZoom: (zoom: number) => void;
  fitView: () => void;
  setFilters: (filters: Partial<GraphFilters>) => void;
  searchNodes: (query: string) => Promise<void>;

  // 物理与染色控制
  setPhysics: (physics: Partial<PhysicsConfig>) => void;
  addColorGroup: (query: string, color: string) => void;
  removeColorGroup: (id: string) => void;
  updateColorGroup: (id: string, updates: Partial<Omit<ColorGroup, 'id'>>) => void;

  // 局部图谱控制
  setGraphMode: (mode: 'global' | 'local') => void;
  setGraphView: (view: 'topic' | 'note') => void;

  toggleDetailPanel: () => void;
  toggleSearchDialog: () => void;
  toggleFilterPanel: () => void;
  toggleExportDialog: () => void;
  toggle3D: () => void;
  toggleInertialDrag: () => void;
  clearError: () => void;
}

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

interface NoteMeta {
  path: string;
  name: string;
  title: string;
  content: string;
}

interface TopicAccumulator {
  id: string;
  keyword: string;
  noisy: boolean;
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

const NOTE_FILE_EXTENSION_PATTERN = /\.(md|markdown|mdx|txt)$/i;

/** 清理文件名作为显示标签 */
function cleanFileName(fileName: string): string {
  // 移除笔记文件扩展名
  let name = fileName.replace(NOTE_FILE_EXTENSION_PATTERN, '');

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
  return normalizeKnowledgeTopic(keyword);
}

function isUsefulTopic(keyword: string) {
  return isUsefulKnowledgeTopic(keyword);
}

function isNoisyTopic(keyword: string) {
  return isNoisyKnowledgeTopic(keyword);
}

function stripMarkdown(content: string) {
  return stripKnowledgeNoise(content).replace(/\s+/g, ' ');
}

function extractFallbackTopics(content: string, title: string): Array<{ keyword: string; weight: number }> {
  return extractKnowledgeTopicCandidates(content, title).slice(0, 12);
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
  const lower = normalizeTopicKeyword(keyword).toLowerCase();
  if (/ai|agent|模型|智能|大模型|llm|rag|向量|embedding|检索|生成/.test(lower)) return 'ai';
  if (/产品|用户|体验|交互|需求|pm|增长|运营/.test(lower)) return 'product';
  if (/设计|界面|视觉|ux|ui|布局|组件|动效/.test(lower)) return 'design';
  if (/技术|架构|工程|开发|代码|系统|算法|前端|后端|数据库|sqlite|索引/.test(lower)) return 'engineering';
  if (/学习|研究|论文|知识|方法|理论|概念|认知/.test(lower)) return 'research';
  if (/项目|计划|管理|流程|协作|任务|迭代/.test(lower)) return 'workflow';
  return `topic-${hashString(keyword) % 7}`;
}

function getTopicClusterLabel(clusterId: string) {
  const labels: Record<string, string> = {
    ai: 'AI 与大模型',
    product: '产品与用户',
    design: '体验设计',
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

function filterGraphData(nodes: GraphNode[], edges: GraphEdge[], filters: GraphFilters) {
  const filteredNodes = nodes.filter(node => {
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.includes(node.nodeType)) return false;
    }
    if (!filters.includeNoisyTopics && node.nodeProperties?.mode === 'topic' && node.nodeProperties?.isNoisyTopic) {
      return false;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      if (!node.nodeLabel.toLowerCase().includes(searchLower)) return false;
    }
    if (filters.minConnections !== undefined) {
      if ((node.connections || 0) < filters.minConnections) return false;
    }
    if (filters.maxConnections !== undefined) {
      if ((node.connections || 0) > filters.maxConnections) return false;
    }
    return true;
  });

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
  const filteredEdges = edges.filter(edge =>
    filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target),
  );

  return { filteredNodes, filteredEdges };
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
  const cleanedContent = prepareKnowledgeIndexText(doc.content);
  const contentLower = cleanedContent.toLowerCase();
  return (topicsByFile.get(doc.filename) ?? [])
    .map(topic => {
      const keywordLower = topic.keyword.toLowerCase();
      const mentioned = contentLower.includes(keywordLower) || cleanedContent.includes(topic.keyword);
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

interface TopicGraphOptions {
  includeDiagnostics?: boolean;
  maxTopics?: number;
  maxEdges?: number;
}

function buildTopicGraph(
  noteMetas: NoteMeta[],
  storedTopics: NoteTopic[],
  vectorDocs: VectorEmbeddingDocument[],
  options: TopicGraphOptions = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const now = new Date().toISOString();
  const includeDiagnostics = options.includeDiagnostics ?? true;
  const maxTopics = options.maxTopics ?? 120;
  const maxEdges = options.maxEdges ?? 400;
  const noteMetaByPath = new Map(noteMetas.map(meta => [meta.path, meta]));
  const topicsByFile = new Map<string, Array<{ keyword: string; weight: number; source: string }>>();

  for (const topic of storedTopics) {
    const keyword = normalizeTopicKeyword(topic.keyword);
    if (!isUsefulTopic(keyword)) continue;
    const quality = topicQualityScore(keyword);
    if (!topicsByFile.has(topic.filename)) topicsByFile.set(topic.filename, []);
    topicsByFile.get(topic.filename)!.push({
      keyword,
      weight: clamp((topic.weight || 0.1) * quality, 0.08, 3.4),
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
    if (!isUsefulTopic(cleanKeyword)) return null;
    const id = `topic:${slugTopic(cleanKeyword)}`;
    const clusterId = getTopicClusterId(cleanKeyword);
    if (!topicMap.has(id)) {
      topicMap.set(id, {
        id,
        keyword: cleanKeyword,
        noisy: isNoisyTopic(cleanKeyword),
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
      if (!accumulator) continue;
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
        if (!accumulator) return null;
        return { id: accumulator.id, weight: topic.weight };
      })
      .filter((item): item is { id: string; weight: number } => Boolean(item))
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
          content: cleanKnowledgeSample(meta.content, 180),
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
          content: cleanKnowledgeSample(doc.content, 220),
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
    .filter(topic => !topic.noisy && isUsefulTopic(topic.keyword))
    .map(topic => ({
      topic,
      score: (topic.totalWeight + topic.vectorWeight + topic.noteWeights.size * 0.65 + topic.chunks.size * 0.18) * topicQualityScore(topic.keyword),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxTopics);

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
    const nodeSize = Math.round(clamp(8 + importance * 24 + noteRatio * 10, 9, 44));
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
        isNoisyTopic: topic.noisy,
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
    .slice(0, maxEdges)
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
      nodeSize: Math.round(clamp((node.nodeSize ?? 12) + Math.sqrt(connections) * 1.6, 8, 48)),
    };
  });

  if (!includeDiagnostics) {
    return { nodes, edges: topicEdges };
  }

  // ==================== 第三步：AI 自检与脑区自愈 ====================
  const resolvedPathsAndTitles = new Set<string>();
  for (const meta of noteMetas) {
    resolvedPathsAndTitles.add(meta.title.toLowerCase());
    resolvedPathsAndTitles.add(cleanFileName(meta.name).toLowerCase());
    resolvedPathsAndTitles.add(meta.path.toLowerCase());
  }

  const unresolvedMap = new Map<string, Set<string>>(); // targetTitle -> Set of sourcePaths
  const noteLinks = new Map<string, Set<string>>(); // sourcePath -> Set of referenced targetTitles

  for (const meta of noteMetas) {
    noteLinks.set(meta.path, new Set());
    const content = meta.content;
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const targetTitle = match[1].trim();
      if (!targetTitle) continue;
      if (isNoisyKnowledgeTopic(targetTitle)) continue;

      noteLinks.get(meta.path)!.add(targetTitle);

      const targetLower = targetTitle.toLowerCase();
      let isResolved = false;
      for (const resolved of resolvedPathsAndTitles) {
        if (resolved === targetLower || resolved.replace(NOTE_FILE_EXTENSION_PATTERN, '') === targetLower) {
          isResolved = true;
          break;
        }
      }

      if (!isResolved) {
        if (!unresolvedMap.has(targetTitle)) {
          unresolvedMap.set(targetTitle, new Set());
        }
        unresolvedMap.get(targetTitle)!.add(meta.path);
      }
    }
  }

  // 计算每个笔记切片的平均 Embedding 向量
  const noteEmbeddings = new Map<string, number[]>();
  for (const doc of vectorDocs) {
    if (!doc.embedding || doc.embedding.length === 0) continue;
    if (!noteEmbeddings.has(doc.filename)) {
      noteEmbeddings.set(doc.filename, new Array(doc.embedding.length).fill(0));
    }
    const arr = noteEmbeddings.get(doc.filename)!;
    for (let i = 0; i < doc.embedding.length; i++) {
      arr[i] += doc.embedding[i];
    }
  }

  for (const [filename, arr] of noteEmbeddings.entries()) {
    const count = vectorDocs.filter(d => d.filename === filename).length;
    if (count > 0) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] /= count;
      }
    }
  }

  // 构建 Unresolved Nodes 和 Edges
  const unresolvedNodes: GraphNode[] = [];
  const unresolvedEdges: GraphEdge[] = [];
  let unresolvedEdgeCounter = 0;

  for (const [targetTitle, sourcePaths] of unresolvedMap.entries()) {
    const nodeId = `unresolved:${targetTitle}`;
    const unresolvedTitle = targetTitle.replace(/\s*[-·]+\s*/g, ' · ');
    unresolvedNodes.push({
      id: nodeId,
      nodeType: 'note',
      nodeLabel: unresolvedTitle,
      nodeColor: '#f87171',
      nodeSize: 12,
      nodeProperties: {
        isUnresolved: true,
        unresolvedTitle,
        originalReference: targetTitle,
        sourceNotes: Array.from(sourcePaths).map(p => ({
          path: p,
          title: noteMetaByPath.get(p)?.title ?? cleanFileName(p.split(/[\\/]/).pop() || p),
        })),
      },
      nodeMetadata: {
        createdAt: now,
        updatedAt: now,
      },
      connections: sourcePaths.size,
      kind: 'linked',
    });

    for (const sourcePath of sourcePaths) {
      let bestTopicId = '';
      let maxWeight = -1;
      for (const [topicId, topicObj] of topicMap.entries()) {
        const weight = topicObj.noteWeights.get(sourcePath) ?? 0;
        if (weight > maxWeight) {
          maxWeight = weight;
          bestTopicId = topicId;
        }
      }

      if (bestTopicId) {
        unresolvedEdges.push({
          id: `unresolved-edge:${unresolvedEdgeCounter++}:${bestTopicId}->${nodeId}`,
          source: bestTopicId,
          target: nodeId,
          label: 'mentions',
          weight: 0.6,
          confidence: 1,
          metadata: {
            createdAt: now,
            source: '未解析双链引用',
            evidence: `提及于笔记：${noteMetaByPath.get(sourcePath)?.title ?? sourcePath}`,
          },
        });
      }
    }
  }

  // 提取已分配给活动主题词的笔记路径集合
  const activeTopicNotePaths = new Set<string>();
  for (const nodeItem of nodes) {
    if (nodeItem.nodeProperties?.notes) {
      const notesArr = nodeItem.nodeProperties.notes as Array<{ path: string }>;
      for (const noteObj of notesArr) {
        activeTopicNotePaths.add(noteObj.path);
      }
    }
  }

  // 构建 Orphan Nodes
  const orphanNodes: GraphNode[] = [];
  for (const meta of noteMetas) {
    const path = meta.path;
    let isReferenced = false;
    for (const [sourcePath, refs] of noteLinks.entries()) {
      if (sourcePath === path) continue;
      const cleanName = cleanFileName(meta.name).toLowerCase();
      const titleLower = meta.title.toLowerCase();
      for (const ref of refs) {
        if (ref.toLowerCase() === cleanName || ref.toLowerCase() === titleLower) {
          isReferenced = true;
          break;
        }
      }
      if (isReferenced) break;
    }

    const hasOutgoing = (noteLinks.get(path)?.size ?? 0) > 0;
    const isIncludedInTopics = activeTopicNotePaths.has(path);

    if (!isReferenced && !hasOutgoing && !isIncludedInTopics) {
      const recommendations: Array<{ path: string; title: string; similarity: number }> = [];
      const vecA = noteEmbeddings.get(path);
      if (vecA) {
        for (const [otherPath, vecB] of noteEmbeddings.entries()) {
          if (otherPath === path) continue;
          const sim = cosineSimilarity(vecA, vecB);
          if (sim > 0.58) {
            recommendations.push({
              path: otherPath,
              title: noteMetaByPath.get(otherPath)?.title ?? cleanFileName(otherPath.split(/[\\/]/).pop() || otherPath),
              similarity: sim,
            });
          }
        }
      }
      recommendations.sort((a, b) => b.similarity - a.similarity);

      orphanNodes.push({
        id: `orphan:${path}`,
        nodeType: 'note',
        nodeLabel: meta.title,
        nodeColor: '#71717a',
        nodeSize: 14,
        nodeProperties: {
          isOrphan: true,
          path: path,
          recommendations: recommendations.slice(0, 3),
        },
        nodeMetadata: {
          createdAt: now,
          updatedAt: now,
        },
        connections: 0,
        kind: 'note',
      });
    }
  }

  const finalNodes = [...nodes, ...unresolvedNodes, ...orphanNodes];
  const finalEdges = [...topicEdges, ...unresolvedEdges];

  return { nodes: finalNodes, edges: finalEdges };
}

function normalizeNoteLookupKey(value: string) {
  return value
    .trim()
    .replace(NOTE_FILE_EXTENSION_PATTERN, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function collectNoteFilesFromTree(items: Array<{ name: string; isDirectory?: boolean; isFile?: boolean; children?: any[]; parent?: any }>, parent?: any): Array<{ name: string; relativePath: string }> {
  const files: Array<{ name: string; relativePath: string }> = [];
  for (const item of items) {
    if (!item?.name || item.name === '.DS_Store' || item.name.startsWith('.')) continue;
    const itemWithParent = { ...item, parent };
    if (item.isDirectory || item.children) {
      files.push(...collectNoteFilesFromTree(item.children ?? [], itemWithParent));
    } else if ((item.isFile || !item.isDirectory) && NOTE_FILE_EXTENSION_PATTERN.test(item.name)) {
      files.push({
        name: item.name,
        relativePath: computedParentPath(itemWithParent as any).replace(/\\/g, '/'),
      });
    }
  }
  return files;
}

function normalizeGraphNotePath(path: string) {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^article\//, '')
    .replace(/\/+/g, '/');
}

function isRealNotePath(path?: string) {
  if (!path) return false;
  const normalized = normalizeGraphNotePath(path);
  return NOTE_FILE_EXTENSION_PATTERN.test(normalized) && !normalized.startsWith('lingmo://');
}

function collectOpenNotePaths(articleState: {
  openTabs?: Array<{ path: string; name?: string; isFolder?: boolean }>;
  activeFilePath?: string;
}) {
  const paths: string[] = [];
  const addPath = (path?: string, isFolder?: boolean) => {
    if (isFolder || !isRealNotePath(path)) return;
    const normalized = normalizeGraphNotePath(path!);
    if (!paths.includes(normalized)) paths.push(normalized);
  };

  for (const tab of articleState.openTabs ?? []) {
    addPath(tab.path, tab.isFolder);
  }
  addPath(articleState.activeFilePath);

  return paths;
}

async function readNoteMetaFromPath(
  relativePath: string,
  readTextFile: (path: string, options?: any) => Promise<string>,
  getFilePathOptions: (relativePath: string) => Promise<{ path: string; baseDir?: any }>,
  activeFilePath?: string,
  currentArticle?: string,
): Promise<NoteMeta> {
  const normalizedPath = normalizeGraphNotePath(relativePath);
  const fileName = normalizedPath.split('/').pop() || normalizedPath;
  let content = '';

  if (normalizeGraphNotePath(activeFilePath ?? '') === normalizedPath && currentArticle?.trim()) {
    content = currentArticle;
  } else {
    const { path, baseDir } = await getFilePathOptions(normalizedPath);
    content = baseDir ? await readTextFile(path, { baseDir }) : await readTextFile(path);
  }

  return {
    path: normalizedPath,
    name: fileName,
    title: extractTitle(content, fileName),
    content,
  };
}

function filterLocalKnowledgeRows<T extends { filename: string }>(rows: T[], notePaths: string[]) {
  const localPathSet = new Set(notePaths.map(normalizeGraphNotePath));
  return rows.filter(row => localPathSet.has(normalizeGraphNotePath(row.filename)));
}

function getAverageNoteEmbeddings(vectorDocs: VectorEmbeddingDocument[]) {
  const sums = new Map<string, number[]>();
  const counts = new Map<string, number>();

  for (const doc of vectorDocs) {
    if (!doc.embedding?.length) continue;
    if (!sums.has(doc.filename)) {
      sums.set(doc.filename, new Array(doc.embedding.length).fill(0));
      counts.set(doc.filename, 0);
    }
    const sum = sums.get(doc.filename)!;
    for (let index = 0; index < doc.embedding.length; index++) {
      sum[index] += doc.embedding[index];
    }
    counts.set(doc.filename, (counts.get(doc.filename) ?? 0) + 1);
  }

  for (const [filename, sum] of sums.entries()) {
    const count = counts.get(filename) ?? 1;
    for (let index = 0; index < sum.length; index++) {
      sum[index] /= count;
    }
  }

  return sums;
}

function buildNoteGraph(
  noteMetas: NoteMeta[],
  vectorDocs: VectorEmbeddingDocument[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const now = new Date().toISOString();
  const noteByKey = new Map<string, NoteMeta>();

  for (const meta of noteMetas) {
    const pathWithoutExt = meta.path.replace(NOTE_FILE_EXTENSION_PATTERN, '');
    const nameWithoutExt = cleanFileName(meta.name);
    noteByKey.set(normalizeNoteLookupKey(meta.path), meta);
    noteByKey.set(normalizeNoteLookupKey(pathWithoutExt), meta);
    noteByKey.set(normalizeNoteLookupKey(meta.title), meta);
    noteByKey.set(normalizeNoteLookupKey(nameWithoutExt), meta);
  }

  const nodes: GraphNode[] = noteMetas.map(meta => ({
    id: meta.path,
    nodeType: 'note' as NodeType,
    nodeLabel: meta.title,
    nodeColor: NODE_TYPE_COLORS.note,
    nodeSize: 16,
    nodeProperties: {
      path: meta.path,
      mode: 'note',
      summary: stripMarkdown(meta.content).slice(0, 180),
      chunkCount: vectorDocs.filter(doc => doc.filename === meta.path).length,
    },
    nodeMetadata: {
      createdAt: now,
      updatedAt: now,
      source: 'markdown',
    },
    connections: 0,
    kind: 'note' as NodeKind,
  }));

  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  let edgeCounter = 0;

  for (const meta of noteMetas) {
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = regex.exec(meta.content)) !== null) {
      const targetText = match[1].trim();
      const target = noteByKey.get(normalizeNoteLookupKey(targetText));
      if (!target || target.path === meta.path) continue;

      const key = `${meta.path}->${target.path}:wikilink`;
      if (edgeIds.has(key)) continue;
      edgeIds.add(key);
      edges.push({
        id: `note-wikilink:${edgeCounter++}`,
        source: meta.path,
        target: target.path,
        label: 'wikilink',
        weight: 1,
        confidence: 1,
        metadata: {
          createdAt: now,
          source: 'wiki-link',
          evidence: `[[${targetText}]]`,
        },
      });
    }
  }

  const noteEmbeddings = getAverageNoteEmbeddings(vectorDocs);
  const metasWithEmbeddings = noteMetas.filter(meta => noteEmbeddings.has(meta.path));
  for (let first = 0; first < metasWithEmbeddings.length; first++) {
    const left = metasWithEmbeddings[first];
    const leftEmbedding = noteEmbeddings.get(left.path);
    if (!leftEmbedding) continue;

    for (let second = first + 1; second < metasWithEmbeddings.length; second++) {
      const right = metasWithEmbeddings[second];
      const rightEmbedding = noteEmbeddings.get(right.path);
      if (!rightEmbedding) continue;

      const similarity = cosineSimilarity(leftEmbedding, rightEmbedding);
      if (similarity < 0.74) continue;

      const key = edgeKey(left.path, right.path);
      if (edgeIds.has(`${key}:semantic`)) continue;
      edgeIds.add(`${key}:semantic`);
      edges.push({
        id: `note-semantic:${edgeCounter++}`,
        source: left.path,
        target: right.path,
        label: 'semantic',
        weight: clamp((similarity - 0.7) * 3.3, 0.08, 1),
        confidence: similarity,
        metadata: {
          createdAt: now,
          source: 'file embedding similarity',
          evidence: `文件平均向量相似度 ${(similarity * 100).toFixed(1)}%`,
        },
      });
    }
  }

  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
  }

  const nodesWithConnections = nodes.map(node => {
    const connections = connectionCounts.get(node.id) ?? 0;
    return {
      ...node,
      connections,
      nodeSize: Math.round(clamp(14 + Math.sqrt(connections) * 5, 14, 34)),
      kind: connections >= 6 ? 'hub' as NodeKind : connections > 0 ? 'linked' as NodeKind : 'note' as NodeKind,
    };
  });

  return { nodes: nodesWithConnections, edges };
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
  zoom: 0.72,
  filters: {},
  showDetailPanel: false,
  showSearchDialog: false,
  showFilterPanel: false,
  showExportDialog: false,
  isLoading: false,
  error: null,
  enable3D: true,
  enableInertialDrag: true,
  physics: {
    repulsion: 140,
    gravity: 0.18,
    edgeLength: 95,
    friction: 0.28,
  },
  colorGroups: [],
  graphMode: 'global',
  graphView: 'topic',

  // ==================== 数据加载 ====================

  loadGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      // 动态导入依赖
      const useArticleStore = (await import('@/stores/article')).default;
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const { getFilePathOptions } = await import('@/lib/workspace');
      const { getAllTopics } = await import('@/db/note-topics');
      const { getAllVectorEmbeddingDocuments } = await import('@/db/vector');

      const articleStore = useArticleStore.getState();
      const noteMetas: NoteMeta[] = [];
      const graphMode = get().graphMode;
      const graphView = get().graphView;
      let storedTopics: NoteTopic[] = [];
      let vectorDocs: VectorEmbeddingDocument[] = [];

      if (graphMode === 'local') {
        const openNotePaths = collectOpenNotePaths(articleStore);
        for (const relativePath of openNotePaths) {
          try {
            noteMetas.push(await readNoteMetaFromPath(
              relativePath,
              readTextFile,
              getFilePathOptions,
              articleStore.activeFilePath,
              articleStore.currentArticle,
            ));
          } catch {
            const fileName = relativePath.split('/').pop() || relativePath;
            noteMetas.push({
              path: relativePath,
              name: fileName,
              title: cleanFileName(fileName),
              content: '',
            });
          }
        }

        const [allTopics, allVectorDocs] = await Promise.all([
          getAllTopics().catch(() => [] as NoteTopic[]),
          getAllVectorEmbeddingDocuments().catch(() => [] as VectorEmbeddingDocument[]),
        ]);
        storedTopics = filterLocalKnowledgeRows(allTopics, openNotePaths);
        vectorDocs = filterLocalKnowledgeRows(allVectorDocs, openNotePaths);
      } else {
        const { useNoteIndexStore } = await import('@/stores/note-index');
        const noteIndexStore = useNoteIndexStore.getState();

        await articleStore.loadFileTree({ skipRemoteSync: true });

        const currentFileTree = useArticleStore.getState().fileTree;

        // 确保索引已构建
        if (!noteIndexStore.isIndexed && !noteIndexStore.isBuilding) {
          await noteIndexStore.buildIndex(currentFileTree);
        }

        const allFiles = collectNoteFilesFromTree(currentFileTree)
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN'));

        // 读取笔记内容，主题词节点需要知道来源笔记和标题
        for (const file of allFiles) {
          try {
            noteMetas.push(await readNoteMetaFromPath(file.relativePath, readTextFile, getFilePathOptions));
          } catch {
            noteMetas.push({
              path: file.relativePath,
              name: file.name,
              title: cleanFileName(file.name),
              content: '',
            });
          }
        }

        [storedTopics, vectorDocs] = await Promise.all([
          getAllTopics().catch(() => [] as NoteTopic[]),
          getAllVectorEmbeddingDocuments().catch(() => [] as VectorEmbeddingDocument[]),
        ]);
      }

      const { nodes, edges } = graphView === 'note'
        ? buildNoteGraph(noteMetas, vectorDocs)
        : buildTopicGraph(noteMetas, storedTopics, vectorDocs, graphMode === 'local'
          ? {
            includeDiagnostics: false,
            maxTopics: clamp(noteMetas.length * 18, 24, 90),
            maxEdges: clamp(noteMetas.length * 36, 48, 240),
          }
          : undefined);
      const filters = get().filters;
      const { filteredNodes, filteredEdges } = filterGraphData(nodes, edges, filters);

      // 构建索引
      const nodesMapping = new Map(nodes.map(n => [n.id, n]));
      const edgesMapping = new Map(edges.map(e => [e.id, e]));

      set({
        nodes,
        edges,
        filteredNodes,
        filteredEdges,
        nodesMapping,
        edgesMapping,
        isLoading: false,
      });

      console.log(`[KnowledgeGraph] Loaded ${nodes.length} ${graphMode}/${graphView} nodes, ${edges.length} edges`);
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
  getNodeById: (id: string | null) => {
    try {
      if (!id) return undefined;
      const { nodesMapping, nodes } = get();
      let n = nodesMapping.get(id);
      if (!n) {
        n = nodes.find(item => item && item.id === id);
      }
      if (!n && typeof id === 'string' && (id.startsWith('topic:') || id.startsWith('topic-'))) {
        const cleanId = id.replace(/^topic[:-]/, '');
        n = nodes.find(item => item && item.id && typeof item.id === 'string' && item.id.replace(/^topic[:-]/, '') === cleanId);
      }
      return n;
    } catch (e) {
      console.error('[GraphStore] Error in getNodeById:', e);
      return undefined;
    }
  },
  setZoom: (zoom) => set({ zoom: Math.max(0.28, Math.min(4.5, zoom)) }),
  fitView: () => set({ zoom: 0.86 }),

  // ==================== 筛选和搜索 ====================

  setFilters: (filters) => {
    const newFilters = { ...get().filters, ...filters };
    set({ filters: newFilters });

    const { nodes, edges } = get();
    const { filteredNodes, filteredEdges } = filterGraphData(nodes, edges, newFilters);

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

    const includeNoisyTopics = get().filters.includeNoisyTopics === true;
    const filteredNodes = nodes.filter(node => {
      if (!includeNoisyTopics && node.nodeProperties?.mode === 'topic' && node.nodeProperties?.isNoisyTopic) {
        return false;
      }
      return node.nodeLabel.toLowerCase().includes(searchLower) ||
        node.nodeProperties?.path?.toLowerCase().includes(searchLower);
    });

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

  setPhysics: (physics) => {
    set(state => ({
      physics: { ...state.physics, ...physics },
    }));
  },

  addColorGroup: (query, color) => {
    const newGroup: ColorGroup = {
      id: `color-group-${Date.now()}`,
      query,
      color,
    };
    set(state => ({
      colorGroups: [...state.colorGroups, newGroup],
    }));
  },

  removeColorGroup: (id) => {
    set(state => ({
      colorGroups: state.colorGroups.filter(g => g.id !== id),
    }));
  },

  updateColorGroup: (id, updates) => {
    set(state => ({
      colorGroups: state.colorGroups.map(g => g.id === id ? { ...g, ...updates } : g),
    }));
  },

  setGraphMode: (mode) => {
    set({
      graphMode: mode,
      filters: {},
      selectedNode: null,
      selectedEdge: null,
      showDetailPanel: false,
    });
    void get().loadGraph();
  },
  setGraphView: (view) => {
    set({
      graphView: view,
      filters: {},
      selectedNode: null,
      selectedEdge: null,
      showDetailPanel: false,
    });
    void get().loadGraph();
  },

  toggleDetailPanel: () => set(state => ({ showDetailPanel: !state.showDetailPanel })),
  toggleSearchDialog: () => set(state => ({ showSearchDialog: !state.showSearchDialog })),
  toggleFilterPanel: () => set(state => ({ showFilterPanel: !state.showFilterPanel })),
  toggleExportDialog: () => set(state => ({ showExportDialog: !state.showExportDialog })),
  toggle3D: () => set(state => ({ enable3D: !state.enable3D })),
  toggleInertialDrag: () => set(state => ({ enableInertialDrag: !state.enableInertialDrag })),
  clearError: () => set({ error: null }),
}));

// 导出类型
export type { GraphNode, GraphEdge, NodeType, EdgeType, GraphFilters, NodeKind };
