import assert from 'node:assert/strict'

const parser = await import('../src/lib/structured-knowledge/markdown-parser.ts')

const markdown = `---
title: Knowledge Graph Note
tags: [ai, graph]
---
# Knowledge Graph

Intro paragraph with [[RAG]] and #agent.

## Evidence

- item one
- item two

\`\`\`ts
const x = 1
\`\`\`
`

const result = parser.parseStructuredMarkdown({
  filePath: 'notes/kg.md',
  sourceObjectId: 'ko_note_notes/kg.md',
  content: markdown,
  now: 1700000000000,
})

assert.equal(result.document.title, 'Knowledge Graph Note')
assert.deepEqual(result.document.tags.sort(), ['agent', 'ai', 'graph'])
assert.deepEqual(result.document.wikilinks, ['RAG'])
assert.equal(result.headings.length, 2)
assert.equal(result.headings[1].path.join(' / '), 'Knowledge Graph / Evidence')
assert.ok(result.blocks.some(block => block.type === 'code' && block.markdown.includes('const x = 1')))
assert.ok(result.localEntities.some(entity => entity.name === 'RAG' && entity.extractionMethod === 'local'))
assert.ok(result.localEntities.some(entity => entity.name === 'agent' && entity.extractionMethod === 'local'))

const deterministicA = parser.parseStructuredMarkdown({
  filePath: 'notes/kg.md',
  sourceObjectId: 'ko_note_notes/kg.md',
  content: markdown,
})
const deterministicB = parser.parseStructuredMarkdown({
  filePath: 'notes/kg.md',
  sourceObjectId: 'ko_note_notes/kg.md',
  content: markdown,
})

assert.equal(deterministicA.document.createdAt, 0)
assert.equal(deterministicA.document.updatedAt, 0)
assert.equal(deterministicA.document.structuredAt, 0)
assert.equal(deterministicA.document.createdAt, deterministicB.document.createdAt)
assert.equal(deterministicA.document.updatedAt, deterministicB.document.updatedAt)
assert.equal(deterministicA.document.structuredAt, deterministicB.document.structuredAt)
assert.equal(deterministicA.document.id, deterministicB.document.id)
assert.equal(deterministicA.document.contentHash, deterministicB.document.contentHash)
assert.deepEqual(deterministicA.headings.map(heading => heading.id), deterministicB.headings.map(heading => heading.id))
assert.deepEqual(deterministicA.blocks.map(block => block.id), deterministicB.blocks.map(block => block.id))
assert.deepEqual(deterministicA.blocks.map(block => block.contentHash), deterministicB.blocks.map(block => block.contentHash))
assert.deepEqual(deterministicA.localEntities.map(entity => entity.id), deterministicB.localEntities.map(entity => entity.id))

const persistence = await import('../src/db/structured-knowledge.ts')
const encoded = persistence.encodeJson(['a', 'b'])
assert.equal(encoded, '["a","b"]')
assert.deepEqual(persistence.decodeJsonArray(encoded), ['a', 'b'])
assert.deepEqual(persistence.decodeJsonArray('bad json'), [])
assert.deepEqual(persistence.decodeJsonRecord('{"a":1}'), { a: 1 })
assert.deepEqual(persistence.decodeJsonRecord('[]'), {})

const sync = await import('../src/lib/structured-knowledge/sync.ts')
const metadata = sync.buildStructuredKnowledgeMetadata({
  documentId: 'doc1',
  blockCount: 2,
  headingCount: 1,
  entityCount: 3,
  relationCount: 4,
  lastStructuredAt: 1700000000000,
  lastSemanticExtractedAt: 1700000001000,
})
assert.deepEqual(metadata.structuredKnowledge, {
  documentId: 'doc1',
  documentKind: 'markdown',
  blockCount: 2,
  headingCount: 1,
  entityCount: 3,
  relationCount: 4,
  lastStructuredAt: 1700000000000,
  lastSemanticExtractedAt: 1700000001000,
})

const ragAdapter = await import('../src/lib/structured-knowledge/rag-adapter.ts')
const chunks = ragAdapter.buildStructuredRagChunks(result.document, result.blocks, { targetSize: 120, overlap: 20 })
assert.ok(chunks.length >= 1)
assert.equal(chunks[0].metadata.structuredDocumentId, result.document.id)
assert.ok(Array.isArray(chunks[0].metadata.blockIds))
assert.ok(chunks[0].content.includes('Intro paragraph'))

const graphAdapter = await import('../src/lib/structured-knowledge/graph-adapter.ts')
const graph = graphAdapter.buildStructuredGraphForBundle({
  document: result.document,
  blocks: result.blocks,
  entities: result.localEntities,
  relations: [],
}, { includeHeadings: true })
assert.ok(graph.nodes.some(node => node.type === 'note'))
assert.ok(graph.nodes.some(node => node.type === 'heading'))
assert.ok(graph.nodes.some(node => node.type === 'entity'))
assert.ok(graph.edges.some(edge => edge.type === 'contains'))

const evidence = await import('../src/lib/structured-knowledge/evidence.ts')
const introBlock = result.blocks.find(block => block.text.includes('Intro paragraph'))
assert.ok(introBlock)
assert.ok(evidence.scoreEvidenceBlock(introBlock, 'RAG agent') > 0)
const formatted = evidence.formatEvidenceBlock({
  block: introBlock,
  document: { id: result.document.id, filePath: result.document.filePath, title: result.document.title },
  score: 3,
  excerpt: introBlock.text,
})
assert.ok(formatted.includes('notes/kg.md'))
assert.ok(formatted.includes(introBlock.id))

const semantic = await import('../src/lib/structured-knowledge/semantic-extractor.ts')
const semanticParsed = semantic.parseSemanticExtractionResponse('```json\n{"entities":[{"name":"知识图谱","type":"concept","evidenceBlockIds":["block_a"],"confidence":0.9}],"relations":[]}\n```')
assert.equal(semanticParsed.entities[0].name, '知识图谱')
assert.deepEqual(semantic.parseSemanticExtractionResponse('not json'), { entities: [], relations: [] })

const validatedSemantic = semantic.validateSemanticExtraction({
  entities: [
    { name: '知识图谱', type: 'concept', evidenceBlockIds: [introBlock.id], confidence: 0.9 },
    { name: 'RAG', type: 'concept', evidenceBlockIds: [introBlock.id], confidence: 0.8 },
  ],
  relations: [
    { source: '知识图谱', target: 'RAG', relationType: 'references', evidenceBlockIds: [introBlock.id], confidence: 0.8 },
    { source: '知识图谱', target: 'RAG', relationType: 'related', evidenceBlockIds: ['missing_block'], confidence: 0.8 },
  ],
}, result.document, result.blocks, 1700000000000)
assert.equal(validatedSemantic.relations.length, 1)
assert.equal(validatedSemantic.discardedRelations, 1)
assert.deepEqual(validatedSemantic.relations[0].evidenceBlockIds, [introBlock.id])

const settingsModule = await import('../src/lib/structured-knowledge/semantic-extraction-settings.ts')
assert.equal(settingsModule.DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS.mode, 'manual')
assert.equal(settingsModule.DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS.maxBlocks, 40)
assert.equal(settingsModule.DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS.costWarningAccepted, false)
assert.equal(settingsModule.DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS.privacyWarningAccepted, false)

console.log('structured-knowledge tests passed')
