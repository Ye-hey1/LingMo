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
    maxClusters: 12,
    maxKeywordsPerCluster: 30,
    includeIsolated: true,
  })

  assert.equal(graph.keywordIndex.has('幽灵关键词'), false)
  assert.ok(graph.clusters.length > 0)
  assert.ok(graph.keywordNodes.some((node) => node.keyword === 'AI 写作'))
  assert.ok(graph.noteIndex.has('AI.md'))
})
