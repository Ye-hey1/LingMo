import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildKeywordClusterGraph,
  collectMarkdownFilePaths,
} from './keyword-cluster-data.js'

const fileTree = [
  { name: 'AI.md', isFile: true, isDirectory: false },
  { name: 'Product.md', isFile: true, isDirectory: false },
  {
    name: 'Archive',
    isFile: false,
    isDirectory: true,
    children: [
      { name: 'Old.md', isFile: true, isDirectory: false },
    ],
  },
]

test('collectMarkdownFilePaths returns workspace-relative markdown paths', () => {
  assert.deepEqual(
    Array.from(collectMarkdownFilePaths(fileTree)).sort(),
    ['AI.md', 'Archive/Old.md', 'Product.md'],
  )
})

test('buildKeywordClusterGraph filters deleted files and creates traceable clusters', () => {
  const topics = [
    { filename: 'AI.md', keyword: 'AI 写作', weight: 0.9, source: 'textrank', updated_at: 1 },
    { filename: 'AI.md', keyword: '提示词', weight: 0.8, source: 'textrank', updated_at: 1 },
    { filename: 'Product.md', keyword: '产品设计', weight: 0.9, source: 'textrank', updated_at: 1 },
    { filename: 'Product.md', keyword: '用户体验', weight: 0.7, source: 'textrank', updated_at: 1 },
    { filename: 'Deleted.md', keyword: '幽灵关键词', weight: 1, source: 'textrank', updated_at: 1 },
  ]

  const graph = buildKeywordClusterGraph(topics, fileTree, {
    topKeywordsPerNote: 12,
    minKeywordNoteCount: 1,
    minCooccurrenceNoteCount: 1,
    maxClusters: 12,
    maxKeywordsPerCluster: 30,
  })

  assert.equal(graph.keywordIndex.has('幽灵关键词'), false)
  assert.ok(graph.clusters.length > 0)
  assert.ok(graph.keywordNodes.some((node) => node.keyword === 'AI 写作'))
  assert.ok(graph.noteIndex.has('AI.md'))
})

test('buildKeywordClusterGraph keeps weak keywords as free visible points instead of a loose bucket', () => {
  const topics = [
    { filename: 'AI.md', keyword: 'AI Agent', weight: 0.9, source: 'textrank', updated_at: 1 },
    { filename: 'AI.md', keyword: '规划', weight: 0.8, source: 'textrank', updated_at: 1 },
    { filename: 'Product.md', keyword: 'AI Agent', weight: 0.9, source: 'textrank', updated_at: 1 },
    { filename: 'Product.md', keyword: '规划', weight: 0.75, source: 'textrank', updated_at: 1 },
    { filename: 'Archive/Old.md', keyword: '孤立关键词', weight: 0.6, source: 'textrank', updated_at: 1 },
  ]

  const graph = buildKeywordClusterGraph(topics, fileTree, {
    topKeywordsPerNote: 12,
    minKeywordNoteCount: 1,
    minCooccurrenceNoteCount: 2,
    maxClusters: 12,
    maxKeywordsPerCluster: 30,
  })

  assert.ok(graph.clusters.some((cluster) => cluster.keywords.includes('AI Agent')))
  const loose = graph.keywordNodes.find((node) => node.keyword === '孤立关键词')
  assert.ok(loose)
  assert.equal(loose.clusterId, null)
  assert.equal(graph.clusters.some((cluster) => cluster.label === '零散主题'), false)
})
