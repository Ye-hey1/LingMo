# Structured Markdown Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Markdown-only structured knowledge loop from Markdown files to structured document objects, KnowledgeObject metadata, RAG metadata, graph output, and Agent tools.

**Architecture:** Add an additive `src/lib/structured-knowledge` layer with parser, persistence, sync, RAG adapter, graph adapter, semantic extractor, and evidence helpers. Keep Markdown files as existing `note` KnowledgeObjects and store structured status in metadata; LLM entity/relation extraction is manual via Agent/user tools only.

**Tech Stack:** Next.js/React 19, TypeScript, Tauri SQL plugin SQLite, existing LingMo Agent Tool API, existing OpenAI-compatible AI client, existing RAG/vector table.

## Global Constraints

- Markdown-only for this phase; do not implement PDF, OCR, Office, image, or webpage document intelligence.
- Saving/reindexing performs local deterministic structuring only; no automatic LLM calls.
- LLM entity/relation extraction is manually triggered by user or Agent tool.
- LLM-generated relations must have valid `evidenceBlockIds`; unsupported relations are excluded or discarded.
- Do not introduce a top-level `document` KnowledgeObject type in this phase; structured Markdown files remain `note` objects.
- Avoid graph node explosion: global graph should not render every block by default.
- Keep implementation additive and avoid broad rewrites of RAG, graph, editor, or existing Agent tools.

---

## File Structure

### New files

- `src/lib/structured-knowledge/types.ts` — shared structured document, heading, block, entity, relation, sync result, and graph adapter types.
- `src/lib/structured-knowledge/markdown-parser.ts` — deterministic Markdown parser for frontmatter, headings, blocks, wikilinks, and tags.
- `src/db/structured-knowledge.ts` — SQLite table initialization and persistence helpers.
- `src/lib/structured-knowledge/sync.ts` — orchestration from Markdown content/file path to structured DB rows and KnowledgeObject metadata.
- `src/lib/structured-knowledge/evidence.ts` — evidence block lookup and citation formatting.
- `src/lib/structured-knowledge/semantic-extractor.ts` — manual LLM entity/relation extractor with strict JSON and evidence validation.
- `src/lib/structured-knowledge/rag-adapter.ts` — convert structured blocks to vector document inputs with metadata.
- `src/lib/structured-knowledge/graph-adapter.ts` — convert structured entities/relations to graph-consumable nodes/edges.
- `src/lib/agent/tools/structured-knowledge-tools.ts` — Agent tools for structured note read, rebuild, evidence lookup, and semantic extraction.
- `scripts/structured-knowledge-tests.mjs` — Node test runner for parser/evidence/semantic parsing without Tauri runtime.

### Modified files

- `src/db/index.ts` — initialize structured knowledge DB.
- `src/db/vector.ts` — add nullable `metadata` column and metadata-aware vector document upsert/read support.
- `src/lib/rag.ts` — optionally route Markdown indexing through structured RAG metadata when structured blocks exist.
- `src/lib/agent/tools/index.ts` — register structured knowledge tools.
- `src/app/core/main/knowledge/store/graph-store.ts` — consume structured graph adapter output in existing graph build path.
- `package.json` — add `test:structured-knowledge` script.

---

### Task 1: Add structured knowledge domain types

**Files:**
- Create: `src/lib/structured-knowledge/types.ts`
- Test: `scripts/structured-knowledge-tests.mjs` will import parser/evidence in later tasks; this task is type-only and verified by `pnpm typecheck`.

**Interfaces:**
- Produces: `StructuredMarkdownDocument`, `StructuredHeading`, `StructuredBlock`, `ExtractedEntity`, `ExtractedRelation`, `StructuredKnowledgeSyncResult`, `StructuredGraphNode`, `StructuredGraphEdge`, helper union types used by all later tasks.

- [ ] **Step 1: Create the type file**

Create `src/lib/structured-knowledge/types.ts` with:

```ts
export type StructuredBlockType =
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'heading'
  | 'html'
  | 'math'

export type StructuredEntityType =
  | 'concept'
  | 'person'
  | 'organization'
  | 'method'
  | 'tool'
  | 'claim'
  | 'metric'
  | 'project'
  | 'other'

export type StructuredExtractionMethod = 'local' | 'llm' | 'manual'

export type StructuredRelationType =
  | 'supports'
  | 'contradicts'
  | 'extends'
  | 'references'
  | 'defines'
  | 'uses'
  | 'part_of'
  | 'causes'
  | 'improves'
  | 'related'

export interface StructuredHeading {
  id: string
  documentId: string
  level: number
  text: string
  slug: string
  order: number
  parentId?: string
  path: string[]
  lineStart?: number
  lineEnd?: number
}

export interface StructuredBlock {
  id: string
  documentId: string
  headingId?: string
  type: StructuredBlockType
  text: string
  markdown: string
  order: number
  lineStart?: number
  lineEnd?: number
  headingPath: string[]
  wikilinks: string[]
  tags: string[]
  contentHash: string
}

export interface StructuredMarkdownDocument {
  id: string
  sourceObjectId: string
  filePath: string
  title: string
  contentHash: string
  frontmatter: Record<string, unknown>
  tags: string[]
  wikilinks: string[]
  headings: StructuredHeading[]
  blocks: StructuredBlock[]
  summary?: string
  createdAt: number
  updatedAt: number
  structuredAt: number
  semanticExtractedAt?: number
}

export interface ExtractedEntity {
  id: string
  documentId: string
  name: string
  normalizedName: string
  type: StructuredEntityType
  aliases: string[]
  evidenceBlockIds: string[]
  confidence: number
  extractionMethod: StructuredExtractionMethod
  createdAt: number
  updatedAt: number
}

export interface ExtractedRelation {
  id: string
  documentId: string
  sourceEntityId: string
  targetEntityId: string
  relationType: StructuredRelationType
  evidenceBlockIds: string[]
  confidence: number
  extractionMethod: Exclude<StructuredExtractionMethod, 'local'> | 'inferred'
  createdAt: number
  updatedAt: number
}

export interface ParsedMarkdownStructure {
  document: StructuredMarkdownDocument
  headings: StructuredHeading[]
  blocks: StructuredBlock[]
  localEntities: ExtractedEntity[]
  warnings: string[]
}

export interface StructuredKnowledgeSyncResult {
  documentId: string
  filePath: string
  skipped: boolean
  warningCount: number
  warnings: string[]
  blockCount: number
  headingCount: number
  entityCount: number
  relationCount: number
}

export interface EvidenceBlockResult {
  block: StructuredBlock
  document: Pick<StructuredMarkdownDocument, 'id' | 'filePath' | 'title'>
  score: number
  excerpt: string
}

export interface StructuredGraphNode {
  id: string
  label: string
  type: 'note' | 'heading' | 'entity' | 'claim' | 'block'
  sourceDocumentId?: string
  sourceObjectId?: string
  filePath?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface StructuredGraphEdge {
  id: string
  source: string
  target: string
  type: 'contains' | 'mentions' | 'links_to' | StructuredRelationType | 'evidenced_by'
  label?: string
  confidence?: number
  evidenceBlockIds?: string[]
  metadata?: Record<string, unknown>
}
```

- [ ] **Step 2: Run typecheck to verify no type syntax errors**

Run: `pnpm typecheck`

Expected: either PASS, or existing unrelated TypeScript errors. There must be no error pointing at `src/lib/structured-knowledge/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/structured-knowledge/types.ts
git commit -m "feat(knowledge): add structured markdown domain types"
```

---

### Task 2: Implement deterministic Markdown parser with tests

**Files:**
- Create: `src/lib/structured-knowledge/markdown-parser.ts`
- Create/Modify: `scripts/structured-knowledge-tests.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `parseStructuredMarkdown(input: ParseStructuredMarkdownInput): ParsedMarkdownStructure`, `createStableId(prefix: string, parts: unknown[]): string`, `hashText(text: string): string`, `extractWikilinks(text: string): string[]`, `extractHashTags(text: string): string[]`.

- [ ] **Step 1: Add test script skeleton**

Modify `package.json` scripts by adding:

```json
"test:structured-knowledge": "node scripts/structured-knowledge-tests.mjs"
```

Create `scripts/structured-knowledge-tests.mjs` with an initial failing parser test:

```js
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

console.log('structured-knowledge tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `markdown-parser.ts` does not exist or exports are missing.

- [ ] **Step 3: Implement parser**

Create `src/lib/structured-knowledge/markdown-parser.ts`:

```ts
import { createHash } from 'crypto'
import type {
  ExtractedEntity,
  ParsedMarkdownStructure,
  StructuredBlock,
  StructuredBlockType,
  StructuredHeading,
  StructuredMarkdownDocument,
} from './types'

export interface ParseStructuredMarkdownInput {
  filePath: string
  sourceObjectId: string
  content: string
  now?: number
}

export function hashText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex')
}

export function createStableId(prefix: string, parts: unknown[]): string {
  return `${prefix}_${hashText(parts.map(part => String(part ?? '')).join('\u241f')).slice(0, 24)}`
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function titleFromPath(filePath: string): string {
  const name = normalizePath(filePath).split('/').pop() || filePath
  return name.replace(/\.(md|markdown|mdx)$/i, '') || name
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  const quoted = trimmed.match(/^['"]([\s\S]*)['"]$/)
  if (quoted) return quoted[1]
  const array = trimmed.match(/^\[(.*)]$/)
  if (array) {
    return array[1]
      .split(',')
      .map(item => String(parseScalar(item.trim())).trim())
      .filter(Boolean)
  }
  return trimmed
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string; warnings: string[] } {
  const warnings: string[] = []
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return { frontmatter: {}, body: content, warnings }

  const frontmatter: Record<string, unknown> = {}
  try {
    for (const line of match[1].split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const pair = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (!pair) {
        warnings.push(`Unsupported frontmatter line: ${trimmed}`)
        continue
      }
      frontmatter[pair[1]] = parseScalar(pair[2])
    }
  } catch (error) {
    warnings.push(`Frontmatter parse failed: ${error instanceof Error ? error.message : String(error)}`)
    return { frontmatter: {}, body: content.slice(match[0].length), warnings }
  }

  return { frontmatter, body: content.slice(match[0].length), warnings }
}

export function extractWikilinks(text: string): string[] {
  const links = new Set<string>()
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?]]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    const value = match[1]?.trim()
    if (value) links.add(value)
  }
  return Array.from(links)
}

export function extractHashTags(text: string): string[] {
  const tags = new Set<string>()
  const regex = /(^|\s)#([\p{L}\p{N}_-]{2,})/gu
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    const value = match[2]?.trim()
    if (value) tags.add(value)
  }
  return Array.from(tags)
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean)
  return []
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~\[\]()]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .slice(0, 80) || 'section'
}

function blockTypeFromLines(lines: string[]): StructuredBlockType {
  const first = lines.find(line => line.trim())?.trim() || ''
  if (/^#{1,6}\s+/.test(first)) return 'heading'
  if (/^```|^~~~/.test(first)) return 'code'
  if (/^>\s?/.test(first)) return 'quote'
  if (/^[-*+]\s+|^\d+\.\s+/.test(first)) return 'list'
  if (/^\|.*\|$/.test(first)) return 'table'
  if (/^<\/?[A-Za-z]/.test(first)) return 'html'
  if (/^\$\$/.test(first)) return 'math'
  return 'paragraph'
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, match => match.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_m, target, label) => label || target)
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildHeadingPath(stack: StructuredHeading[]): string[] {
  return stack.map(item => item.text)
}

function createLocalEntity(documentId: string, name: string, type: ExtractedEntity['type'], evidenceBlockIds: string[], now: number): ExtractedEntity {
  const normalizedName = name.trim().toLowerCase()
  return {
    id: createStableId('ske', [documentId, normalizedName, type]),
    documentId,
    name: name.trim(),
    normalizedName,
    type,
    aliases: [],
    evidenceBlockIds,
    confidence: 0.75,
    extractionMethod: 'local',
    createdAt: now,
    updatedAt: now,
  }
}

export function parseStructuredMarkdown(input: ParseStructuredMarkdownInput): ParsedMarkdownStructure {
  const now = input.now ?? Date.now()
  const filePath = normalizePath(input.filePath)
  const documentId = createStableId('smd', [filePath])
  const { frontmatter, body, warnings } = parseFrontmatter(input.content)
  const documentTags = new Set([...stringArray(frontmatter.tags), ...extractHashTags(body)])
  const documentLinks = new Set(extractWikilinks(body))
  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : titleFromPath(filePath)

  const headings: StructuredHeading[] = []
  const blocks: StructuredBlock[] = []
  const headingStack: StructuredHeading[] = []
  const lines = body.split(/\r?\n/)
  let buffer: string[] = []
  let bufferStart = 1
  let inFence = false
  let fenceMarker = ''
  let currentHeading: StructuredHeading | undefined

  const flushBlock = (endLine: number) => {
    const markdown = buffer.join('\n').trimEnd()
    if (!markdown.trim()) {
      buffer = []
      bufferStart = endLine + 1
      return
    }
    const text = plainText(markdown)
    const block: StructuredBlock = {
      id: createStableId('skb', [documentId, blocks.length, bufferStart, hashText(markdown)]),
      documentId,
      headingId: currentHeading?.id,
      type: blockTypeFromLines(buffer),
      text,
      markdown,
      order: blocks.length,
      lineStart: bufferStart,
      lineEnd: endLine,
      headingPath: buildHeadingPath(headingStack),
      wikilinks: extractWikilinks(markdown),
      tags: extractHashTags(markdown),
      contentHash: hashText(markdown),
    }
    blocks.push(block)
    buffer = []
    bufferStart = endLine + 1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }
      if (buffer.length === 0) bufferStart = lineNo
      buffer.push(line)
      continue
    }

    if (!inFence) {
      const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (headingMatch) {
        flushBlock(lineNo - 1)
        const level = headingMatch[1].length
        const text = headingMatch[2].trim()
        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop()
        }
        const heading: StructuredHeading = {
          id: createStableId('skh', [documentId, headings.length, level, text]),
          documentId,
          level,
          text,
          slug: slugify(text),
          order: headings.length,
          parentId: headingStack[headingStack.length - 1]?.id,
          path: [...headingStack.map(item => item.text), text],
          lineStart: lineNo,
          lineEnd: lineNo,
        }
        headings.push(heading)
        headingStack.push(heading)
        currentHeading = heading
        bufferStart = lineNo + 1
        continue
      }

      if (!line.trim()) {
        flushBlock(lineNo - 1)
        continue
      }
    }

    if (buffer.length === 0) bufferStart = lineNo
    buffer.push(line)
  }
  flushBlock(lines.length)

  const entitiesByKey = new Map<string, ExtractedEntity>()
  for (const link of documentLinks) {
    const evidence = blocks.filter(block => block.wikilinks.includes(link)).map(block => block.id)
    entitiesByKey.set(`concept:${link.toLowerCase()}`, createLocalEntity(documentId, link, 'concept', evidence, now))
  }
  for (const tag of documentTags) {
    const evidence = blocks.filter(block => block.tags.includes(tag)).map(block => block.id)
    entitiesByKey.set(`concept:${tag.toLowerCase()}`, createLocalEntity(documentId, tag, 'concept', evidence, now))
  }
  for (const heading of headings) {
    entitiesByKey.set(`concept:${heading.text.toLowerCase()}`, createLocalEntity(documentId, heading.text, 'concept', [], now))
  }

  const document: StructuredMarkdownDocument = {
    id: documentId,
    sourceObjectId: input.sourceObjectId,
    filePath,
    title,
    contentHash: hashText(input.content),
    frontmatter,
    tags: Array.from(documentTags),
    wikilinks: Array.from(documentLinks),
    headings,
    blocks,
    createdAt: now,
    updatedAt: now,
    structuredAt: now,
  }

  return {
    document,
    headings,
    blocks,
    localEntities: Array.from(entitiesByKey.values()),
    warnings,
  }
}
```

- [ ] **Step 4: Run parser tests**

Run: `pnpm test:structured-knowledge`

Expected: PASS with `structured-knowledge tests passed`.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`

Expected: no new errors in `src/lib/structured-knowledge/markdown-parser.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/structured-knowledge-tests.mjs src/lib/structured-knowledge/markdown-parser.ts
git commit -m "feat(knowledge): parse markdown into structured blocks"
```

---

### Task 3: Add structured knowledge database persistence

**Files:**
- Create: `src/db/structured-knowledge.ts`
- Modify: `src/db/index.ts`
- Modify: `scripts/structured-knowledge-tests.mjs`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `initStructuredKnowledgeDb()`, `upsertStructuredDocument(parsed)`, `getStructuredDocumentByPath(filePath)`, `getStructuredDocumentBundleByPath(filePath)`, `getStructuredBlocksByDocument(documentId)`, `upsertStructuredEntities(documentId, entities, method?)`, `upsertStructuredRelations(documentId, relations)`, `countStructuredEntities(documentId)`, `countStructuredRelations(documentId)`.

- [ ] **Step 1: Add persistence test for serializer helpers**

Append to `scripts/structured-knowledge-tests.mjs`:

```js
const persistence = await import('../src/db/structured-knowledge.ts')
const encoded = persistence.encodeJson(['a', 'b'])
assert.equal(encoded, '["a","b"]')
assert.deepEqual(persistence.decodeJsonArray(encoded), ['a', 'b'])
assert.deepEqual(persistence.decodeJsonArray('bad json'), [])
assert.deepEqual(persistence.decodeJsonRecord('{"a":1}'), { a: 1 })
assert.deepEqual(persistence.decodeJsonRecord('[]'), {})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `src/db/structured-knowledge.ts` does not exist.

- [ ] **Step 3: Implement DB module**

Create `src/db/structured-knowledge.ts`:

```ts
import { getDb, runDbTransaction, serializedWrite } from './index'
import type {
  ExtractedEntity,
  ExtractedRelation,
  ParsedMarkdownStructure,
  StructuredBlock,
  StructuredHeading,
  StructuredMarkdownDocument,
} from '@/lib/structured-knowledge/types'

export function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export function decodeJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function decodeJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

interface StructuredDocumentRow {
  id: string
  source_object_id: string
  file_path: string
  title: string
  content_hash: string
  frontmatter?: string | null
  tags?: string | null
  wikilinks?: string | null
  headings?: string | null
  summary?: string | null
  created_at: number
  updated_at: number
  structured_at: number
  semantic_extracted_at?: number | null
}

interface StructuredBlockRow {
  id: string
  document_id: string
  heading_id?: string | null
  type: StructuredBlock['type']
  text: string
  markdown: string
  block_order: number
  line_start?: number | null
  line_end?: number | null
  heading_path?: string | null
  wikilinks?: string | null
  tags?: string | null
  content_hash: string
  created_at: number
  updated_at: number
}

interface StructuredEntityRow {
  id: string
  document_id: string
  name: string
  normalized_name: string
  entity_type: ExtractedEntity['type']
  aliases?: string | null
  evidence_block_ids?: string | null
  confidence: number
  extraction_method: ExtractedEntity['extractionMethod']
  created_at: number
  updated_at: number
}

interface StructuredRelationRow {
  id: string
  document_id: string
  source_entity_id: string
  target_entity_id: string
  relation_type: ExtractedRelation['relationType']
  evidence_block_ids?: string | null
  confidence: number
  extraction_method: ExtractedRelation['extractionMethod']
  created_at: number
  updated_at: number
}

export async function initStructuredKnowledgeDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists structured_documents (
      id text primary key,
      source_object_id text not null,
      file_path text not null unique,
      title text not null,
      content_hash text not null,
      frontmatter text,
      tags text,
      wikilinks text,
      headings text,
      summary text,
      created_at integer not null,
      updated_at integer not null,
      structured_at integer not null,
      semantic_extracted_at integer
    )
  `)
  await db.execute(`
    create table if not exists structured_blocks (
      id text primary key,
      document_id text not null,
      heading_id text,
      type text not null,
      text text not null,
      markdown text not null,
      block_order integer not null,
      line_start integer,
      line_end integer,
      heading_path text,
      wikilinks text,
      tags text,
      content_hash text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)
  await db.execute(`create index if not exists idx_structured_blocks_document on structured_blocks(document_id, block_order)`)
  await db.execute(`create index if not exists idx_structured_blocks_heading on structured_blocks(document_id, heading_id)`)
  await db.execute(`
    create table if not exists structured_entities (
      id text primary key,
      document_id text not null,
      name text not null,
      normalized_name text not null,
      entity_type text not null,
      aliases text,
      evidence_block_ids text,
      confidence real not null,
      extraction_method text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)
  await db.execute(`create index if not exists idx_structured_entities_document on structured_entities(document_id)`)
  await db.execute(`create index if not exists idx_structured_entities_normalized_name on structured_entities(normalized_name)`)
  await db.execute(`
    create table if not exists structured_relations (
      id text primary key,
      document_id text not null,
      source_entity_id text not null,
      target_entity_id text not null,
      relation_type text not null,
      evidence_block_ids text,
      confidence real not null,
      extraction_method text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)
  await db.execute(`create index if not exists idx_structured_relations_document on structured_relations(document_id)`)
  await db.execute(`create index if not exists idx_structured_relations_source on structured_relations(source_entity_id)`)
  await db.execute(`create index if not exists idx_structured_relations_target on structured_relations(target_entity_id)`)
}

function rowToDocument(row: StructuredDocumentRow, blocks: StructuredBlock[] = []): StructuredMarkdownDocument {
  const headings = decodeJsonRecord(row.headings).items as StructuredHeading[] | undefined
  return {
    id: row.id,
    sourceObjectId: row.source_object_id,
    filePath: row.file_path,
    title: row.title,
    contentHash: row.content_hash,
    frontmatter: decodeJsonRecord(row.frontmatter),
    tags: decodeJsonArray(row.tags),
    wikilinks: decodeJsonArray(row.wikilinks),
    headings: Array.isArray(headings) ? headings : [],
    blocks,
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    structuredAt: row.structured_at,
    semanticExtractedAt: row.semantic_extracted_at ?? undefined,
  }
}

function rowToBlock(row: StructuredBlockRow): StructuredBlock {
  return {
    id: row.id,
    documentId: row.document_id,
    headingId: row.heading_id ?? undefined,
    type: row.type,
    text: row.text,
    markdown: row.markdown,
    order: row.block_order,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    headingPath: decodeJsonArray(row.heading_path),
    wikilinks: decodeJsonArray(row.wikilinks),
    tags: decodeJsonArray(row.tags),
    contentHash: row.content_hash,
  }
}

function rowToEntity(row: StructuredEntityRow): ExtractedEntity {
  return {
    id: row.id,
    documentId: row.document_id,
    name: row.name,
    normalizedName: row.normalized_name,
    type: row.entity_type,
    aliases: decodeJsonArray(row.aliases),
    evidenceBlockIds: decodeJsonArray(row.evidence_block_ids),
    confidence: row.confidence,
    extractionMethod: row.extraction_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRelation(row: StructuredRelationRow): ExtractedRelation {
  return {
    id: row.id,
    documentId: row.document_id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relationType: row.relation_type,
    evidenceBlockIds: decodeJsonArray(row.evidence_block_ids),
    confidence: row.confidence,
    extractionMethod: row.extraction_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function upsertStructuredDocument(parsed: ParsedMarkdownStructure): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      const doc = parsed.document
      await db.execute(
        `insert into structured_documents (
          id, source_object_id, file_path, title, content_hash, frontmatter, tags, wikilinks, headings,
          summary, created_at, updated_at, structured_at, semantic_extracted_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        on conflict(file_path) do update set
          source_object_id = excluded.source_object_id,
          title = excluded.title,
          content_hash = excluded.content_hash,
          frontmatter = excluded.frontmatter,
          tags = excluded.tags,
          wikilinks = excluded.wikilinks,
          headings = excluded.headings,
          summary = excluded.summary,
          updated_at = excluded.updated_at,
          structured_at = excluded.structured_at,
          semantic_extracted_at = excluded.semantic_extracted_at`,
        [
          doc.id,
          doc.sourceObjectId,
          doc.filePath,
          doc.title,
          doc.contentHash,
          encodeJson(doc.frontmatter),
          encodeJson(doc.tags),
          encodeJson(doc.wikilinks),
          encodeJson({ items: parsed.headings }),
          doc.summary ?? null,
          doc.createdAt,
          doc.updatedAt,
          doc.structuredAt,
          doc.semanticExtractedAt ?? null,
        ],
      )
      await db.execute('delete from structured_blocks where document_id = $1', [doc.id])
      for (const block of parsed.blocks) {
        await db.execute(
          `insert into structured_blocks (
            id, document_id, heading_id, type, text, markdown, block_order, line_start, line_end,
            heading_path, wikilinks, tags, content_hash, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            block.id,
            block.documentId,
            block.headingId ?? null,
            block.type,
            block.text,
            block.markdown,
            block.order,
            block.lineStart ?? null,
            block.lineEnd ?? null,
            encodeJson(block.headingPath),
            encodeJson(block.wikilinks),
            encodeJson(block.tags),
            block.contentHash,
            doc.structuredAt,
            doc.structuredAt,
          ],
        )
      }
      await db.execute('delete from structured_entities where document_id = $1 and extraction_method = $2', [doc.id, 'local'])
      for (const entity of parsed.localEntities) {
        await upsertEntityRow(db, entity)
      }
    })
  })
}

async function upsertEntityRow(db: Awaited<ReturnType<typeof getDb>>, entity: ExtractedEntity) {
  await db.execute(
    `insert into structured_entities (
      id, document_id, name, normalized_name, entity_type, aliases, evidence_block_ids,
      confidence, extraction_method, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict(id) do update set
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      entity_type = excluded.entity_type,
      aliases = excluded.aliases,
      evidence_block_ids = excluded.evidence_block_ids,
      confidence = excluded.confidence,
      extraction_method = excluded.extraction_method,
      updated_at = excluded.updated_at`,
    [
      entity.id,
      entity.documentId,
      entity.name,
      entity.normalizedName,
      entity.type,
      encodeJson(entity.aliases),
      encodeJson(entity.evidenceBlockIds),
      entity.confidence,
      entity.extractionMethod,
      entity.createdAt,
      entity.updatedAt,
    ],
  )
}

export async function upsertStructuredEntities(documentId: string, entities: ExtractedEntity[]): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      for (const entity of entities.filter(entity => entity.documentId === documentId)) {
        await upsertEntityRow(db, entity)
      }
    })
  })
}

export async function upsertStructuredRelations(documentId: string, relations: ExtractedRelation[]): Promise<void> {
  await serializedWrite(async () => {
    const db = await getDb()
    await runDbTransaction(db, async () => {
      for (const relation of relations.filter(relation => relation.documentId === documentId)) {
        await db.execute(
          `insert into structured_relations (
            id, document_id, source_entity_id, target_entity_id, relation_type, evidence_block_ids,
            confidence, extraction_method, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          on conflict(id) do update set
            source_entity_id = excluded.source_entity_id,
            target_entity_id = excluded.target_entity_id,
            relation_type = excluded.relation_type,
            evidence_block_ids = excluded.evidence_block_ids,
            confidence = excluded.confidence,
            extraction_method = excluded.extraction_method,
            updated_at = excluded.updated_at`,
          [
            relation.id,
            relation.documentId,
            relation.sourceEntityId,
            relation.targetEntityId,
            relation.relationType,
            encodeJson(relation.evidenceBlockIds),
            relation.confidence,
            relation.extractionMethod,
            relation.createdAt,
            relation.updatedAt,
          ],
        )
      }
    })
  })
}

export async function getStructuredDocumentByPath(filePath: string): Promise<StructuredMarkdownDocument | undefined> {
  const db = await getDb()
  const rows = await db.select<StructuredDocumentRow[]>('select * from structured_documents where file_path = $1', [filePath.replace(/\\/g, '/')])
  return rows[0] ? rowToDocument(rows[0]) : undefined
}

export async function getStructuredBlocksByDocument(documentId: string): Promise<StructuredBlock[]> {
  const db = await getDb()
  const rows = await db.select<StructuredBlockRow[]>('select * from structured_blocks where document_id = $1 order by block_order', [documentId])
  return rows.map(rowToBlock)
}

export async function getStructuredEntitiesByDocument(documentId: string): Promise<ExtractedEntity[]> {
  const db = await getDb()
  const rows = await db.select<StructuredEntityRow[]>('select * from structured_entities where document_id = $1 order by confidence desc, name asc', [documentId])
  return rows.map(rowToEntity)
}

export async function getStructuredRelationsByDocument(documentId: string): Promise<ExtractedRelation[]> {
  const db = await getDb()
  const rows = await db.select<StructuredRelationRow[]>('select * from structured_relations where document_id = $1 order by confidence desc', [documentId])
  return rows.map(rowToRelation)
}

export async function getStructuredDocumentBundleByPath(filePath: string) {
  const document = await getStructuredDocumentByPath(filePath)
  if (!document) return undefined
  const [blocks, entities, relations] = await Promise.all([
    getStructuredBlocksByDocument(document.id),
    getStructuredEntitiesByDocument(document.id),
    getStructuredRelationsByDocument(document.id),
  ])
  return {
    document: { ...document, blocks },
    blocks,
    entities,
    relations,
  }
}

export async function countStructuredEntities(documentId: string): Promise<number> {
  const db = await getDb()
  const rows = await db.select<Array<{ count: number }>>('select count(*) as count from structured_entities where document_id = $1', [documentId])
  return rows[0]?.count || 0
}

export async function countStructuredRelations(documentId: string): Promise<number> {
  const db = await getDb()
  const rows = await db.select<Array<{ count: number }>>('select count(*) as count from structured_relations where document_id = $1', [documentId])
  return rows[0]?.count || 0
}
```

- [ ] **Step 4: Initialize DB in global init**

Modify `src/db/index.ts` in `initAllDatabases()`:

```ts
const { initStructuredKnowledgeDb } = await import('./structured-knowledge')
```

Then after `await initKnowledgeObjectsDb()` add:

```ts
await initStructuredKnowledgeDb()
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in `src/db/structured-knowledge.ts` or `src/db/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/db/structured-knowledge.ts src/db/index.ts scripts/structured-knowledge-tests.mjs
git commit -m "feat(knowledge): persist structured markdown data"
```

---

### Task 4: Implement sync from Markdown to structured records and KnowledgeObject metadata

**Files:**
- Create: `src/lib/structured-knowledge/sync.ts`
- Modify: `scripts/structured-knowledge-tests.mjs`

**Interfaces:**
- Consumes: `parseStructuredMarkdown`, persistence helpers, `objectRegistry`.
- Produces: `syncStructuredMarkdownContent(input): Promise<StructuredKnowledgeSyncResult>` and `buildStructuredKnowledgeMetadata(...)`.

- [ ] **Step 1: Add metadata builder test**

Append to `scripts/structured-knowledge-tests.mjs`:

```js
const sync = await import('../src/lib/structured-knowledge/sync.ts')
const metadata = sync.buildStructuredKnowledgeMetadata({
  documentId: 'doc1',
  blockCount: 2,
  headingCount: 1,
  entityCount: 3,
  relationCount: 4,
  lastStructuredAt: 1700000000000,
})
assert.deepEqual(metadata.structuredKnowledge, {
  documentId: 'doc1',
  documentKind: 'markdown',
  blockCount: 2,
  headingCount: 1,
  entityCount: 3,
  relationCount: 4,
  lastStructuredAt: 1700000000000,
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `sync.ts` does not exist.

- [ ] **Step 3: Implement sync module**

Create `src/lib/structured-knowledge/sync.ts`:

```ts
import { objectRegistry } from '@/lib/knowledge/object-registry'
import { parseStructuredMarkdown } from './markdown-parser'
import type { StructuredKnowledgeSyncResult } from './types'
import {
  countStructuredEntities,
  countStructuredRelations,
  getStructuredDocumentByPath,
  upsertStructuredDocument,
} from '@/db/structured-knowledge'

export interface StructuredKnowledgeMetadataInput {
  documentId: string
  blockCount: number
  headingCount: number
  entityCount: number
  relationCount: number
  lastStructuredAt: number
  lastSemanticExtractedAt?: number
}

export function buildStructuredKnowledgeMetadata(input: StructuredKnowledgeMetadataInput) {
  return {
    structuredKnowledge: {
      documentId: input.documentId,
      documentKind: 'markdown' as const,
      blockCount: input.blockCount,
      headingCount: input.headingCount,
      entityCount: input.entityCount,
      relationCount: input.relationCount,
      lastStructuredAt: input.lastStructuredAt,
      ...(input.lastSemanticExtractedAt ? { lastSemanticExtractedAt: input.lastSemanticExtractedAt } : {}),
    },
  }
}

export interface SyncStructuredMarkdownContentInput {
  filePath: string
  content: string
  title?: string
  updateKnowledgeObject?: boolean
  force?: boolean
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function titleFromPath(filePath: string): string {
  const name = normalizePath(filePath).split('/').pop() || filePath
  return name.replace(/\.(md|markdown|mdx)$/i, '') || name
}

export async function syncStructuredMarkdownContent(input: SyncStructuredMarkdownContentInput): Promise<StructuredKnowledgeSyncResult> {
  const filePath = normalizePath(input.filePath)
  const sourceId = filePath
  let ko = await objectRegistry.getBySource('note', sourceId)
  if (!ko && input.updateKnowledgeObject !== false) {
    const id = await objectRegistry.register({
      sourceType: 'note',
      sourceId,
      path: filePath,
      title: input.title || titleFromPath(filePath),
      origin: 'synced',
      status: 'active',
    })
    ko = await objectRegistry.getById(id)
  }
  const sourceObjectId = ko?.id || `ko_note_${sourceId}`
  const parsed = parseStructuredMarkdown({
    filePath,
    sourceObjectId,
    content: input.content,
  })

  const existing = await getStructuredDocumentByPath(filePath)
  if (!input.force && existing?.contentHash === parsed.document.contentHash) {
    const entityCount = await countStructuredEntities(existing.id)
    const relationCount = await countStructuredRelations(existing.id)
    return {
      documentId: existing.id,
      filePath,
      skipped: true,
      warningCount: 0,
      warnings: [],
      blockCount: existing.blocks?.length || 0,
      headingCount: existing.headings.length,
      entityCount,
      relationCount,
    }
  }

  await upsertStructuredDocument(parsed)
  const entityCount = await countStructuredEntities(parsed.document.id)
  const relationCount = await countStructuredRelations(parsed.document.id)

  if (input.updateKnowledgeObject !== false) {
    await objectRegistry.touch('note', sourceId, {
      path: filePath,
      title: parsed.document.title,
      contentHash: parsed.document.contentHash,
      metadata: buildStructuredKnowledgeMetadata({
        documentId: parsed.document.id,
        blockCount: parsed.blocks.length,
        headingCount: parsed.headings.length,
        entityCount,
        relationCount,
        lastStructuredAt: parsed.document.structuredAt,
      }),
    })
  }

  return {
    documentId: parsed.document.id,
    filePath,
    skipped: false,
    warningCount: parsed.warnings.length,
    warnings: parsed.warnings,
    blockCount: parsed.blocks.length,
    headingCount: parsed.headings.length,
    entityCount,
    relationCount,
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in `src/lib/structured-knowledge/sync.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/structured-knowledge/sync.ts scripts/structured-knowledge-tests.mjs
git commit -m "feat(knowledge): sync markdown into structured metadata"
```

---

### Task 5: Add vector metadata support and structured RAG adapter

**Files:**
- Modify: `src/db/vector.ts`
- Create: `src/lib/structured-knowledge/rag-adapter.ts`
- Modify: `scripts/structured-knowledge-tests.mjs`

**Interfaces:**
- Consumes: `StructuredBlock`, existing vector DB functions.
- Produces: `StructuredRagChunk`, `buildStructuredRagChunks(document, blocks, options?)`, metadata-aware vector document writes.

- [ ] **Step 1: Add RAG adapter test**

Append to `scripts/structured-knowledge-tests.mjs`:

```js
const ragAdapter = await import('../src/lib/structured-knowledge/rag-adapter.ts')
const chunks = ragAdapter.buildStructuredRagChunks(result.document, result.blocks, { targetSize: 120, overlap: 20 })
assert.ok(chunks.length >= 1)
assert.equal(chunks[0].metadata.structuredDocumentId, result.document.id)
assert.ok(Array.isArray(chunks[0].metadata.blockIds))
assert.ok(chunks[0].content.includes('Intro paragraph'))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `rag-adapter.ts` does not exist.

- [ ] **Step 3: Modify vector types and schema**

In `src/db/vector.ts`, update interfaces:

```ts
export interface VectorDocument {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  embedding: string;
  updated_at: number;
  metadata?: string | null;
}
```

Add `metadata?: string | null` to `CachedVector` and `VectorEmbeddingDocument`.

In `initVectorDb()`, after table creation, add:

```ts
try {
  await db.execute('alter table vector_documents add column metadata text')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!/duplicate column|already exists/i.test(message)) {
    console.warn('[VectorDB] metadata migration skipped:', error)
  }
}
```

Update selects to include metadata:

```sql
select id, filename, chunk_id, content, embedding, updated_at, metadata from vector_documents
```

Update insert/upsert SQL in `upsertVectorDocument`, `upsertVectorDocumentsBatch`, and `replaceVectorDocumentsForFile`:

```sql
insert into vector_documents (filename, chunk_id, content, embedding, updated_at, metadata)
values ($1, $2, $3, $4, $5, $6)
on conflict(filename, chunk_id) do update set
  content = excluded.content,
  embedding = excluded.embedding,
  updated_at = excluded.updated_at,
  metadata = excluded.metadata
```

Use args:

```ts
[doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at, doc.metadata ?? null]
```

- [ ] **Step 4: Implement RAG adapter**

Create `src/lib/structured-knowledge/rag-adapter.ts`:

```ts
import type { StructuredBlock, StructuredMarkdownDocument } from './types'

export interface StructuredRagChunkMetadata {
  sourceObjectId: string
  structuredDocumentId: string
  blockIds: string[]
  headingPath: string[]
  wikilinks: string[]
  tags: string[]
  chunkType: 'structured_markdown'
}

export interface StructuredRagChunk {
  filename: string
  chunkId: number
  content: string
  metadata: StructuredRagChunkMetadata
}

export interface BuildStructuredRagChunksOptions {
  targetSize?: number
  overlap?: number
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function sameHeadingPath(a: string[], b: string[]): boolean {
  return a.join('\u241f') === b.join('\u241f')
}

function chunkContentForBlock(block: StructuredBlock): string {
  const prefix = block.headingPath.length ? `## ${block.headingPath.join(' / ')}\n\n` : ''
  return `${prefix}${block.markdown || block.text}`.trim()
}

function finalizeChunk(document: StructuredMarkdownDocument, chunkId: number, blocks: StructuredBlock[]): StructuredRagChunk {
  const headingPath = blocks[0]?.headingPath || []
  return {
    filename: document.filePath,
    chunkId,
    content: blocks.map(chunkContentForBlock).join('\n\n').trim(),
    metadata: {
      sourceObjectId: document.sourceObjectId,
      structuredDocumentId: document.id,
      blockIds: blocks.map(block => block.id),
      headingPath,
      wikilinks: unique(blocks.flatMap(block => block.wikilinks)),
      tags: unique(blocks.flatMap(block => block.tags)),
      chunkType: 'structured_markdown',
    },
  }
}

export function buildStructuredRagChunks(
  document: StructuredMarkdownDocument,
  blocks: StructuredBlock[],
  options: BuildStructuredRagChunksOptions = {},
): StructuredRagChunk[] {
  const targetSize = options.targetSize ?? 1200
  const chunks: StructuredRagChunk[] = []
  let current: StructuredBlock[] = []
  let currentSize = 0

  for (const block of blocks) {
    if (!block.text.trim() && !block.markdown.trim()) continue
    const blockContent = chunkContentForBlock(block)
    const shouldKeepWhole = block.type === 'code' || block.type === 'table' || block.type === 'quote'
    const headingChanged = current.length > 0 && !sameHeadingPath(current[0].headingPath, block.headingPath)
    const wouldOverflow = current.length > 0 && currentSize + blockContent.length > targetSize

    if (headingChanged || (wouldOverflow && !shouldKeepWhole)) {
      chunks.push(finalizeChunk(document, chunks.length, current))
      current = []
      currentSize = 0
    }

    current.push(block)
    currentSize += blockContent.length + 2

    if (shouldKeepWhole && currentSize >= targetSize) {
      chunks.push(finalizeChunk(document, chunks.length, current))
      current = []
      currentSize = 0
    }
  }

  if (current.length > 0) {
    chunks.push(finalizeChunk(document, chunks.length, current))
  }

  return chunks
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in vector metadata changes or RAG adapter.

- [ ] **Step 6: Commit**

```bash
git add src/db/vector.ts src/lib/structured-knowledge/rag-adapter.ts scripts/structured-knowledge-tests.mjs
git commit -m "feat(rag): add structured markdown chunk metadata"
```

---

### Task 6: Add evidence lookup helpers

**Files:**
- Create: `src/lib/structured-knowledge/evidence.ts`
- Modify: `scripts/structured-knowledge-tests.mjs`

**Interfaces:**
- Consumes: structured DB bundle helpers.
- Produces: `scoreEvidenceBlock(block, query)`, `formatEvidenceBlock(result)`, `findEvidenceBlocks(input): Promise<EvidenceBlockResult[]>`.

- [ ] **Step 1: Add evidence helper tests**

Append to `scripts/structured-knowledge-tests.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `evidence.ts` does not exist.

- [ ] **Step 3: Implement evidence helpers**

Create `src/lib/structured-knowledge/evidence.ts`:

```ts
import { getStructuredDocumentBundleByPath } from '@/db/structured-knowledge'
import type { EvidenceBlockResult, StructuredBlock } from './types'

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(query: string): string[] {
  const compact = normalizeText(query).toLowerCase()
  if (!compact) return []
  const tokens = compact.split(/[^\p{L}\p{N}_-]+/u).map(item => item.trim()).filter(item => item.length >= 2)
  return Array.from(new Set([compact, ...tokens]))
}

export function scoreEvidenceBlock(block: StructuredBlock, query: string): number {
  const tokens = tokenize(query)
  if (!tokens.length) return 0
  const haystack = [block.text, block.markdown, block.headingPath.join(' '), block.wikilinks.join(' '), block.tags.join(' ')]
    .join(' ')
    .toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (!token) continue
    if (haystack.includes(token)) score += token.includes(' ') ? 4 : 1
    if (block.headingPath.join(' ').toLowerCase().includes(token)) score += 2
    if (block.wikilinks.some(link => link.toLowerCase().includes(token))) score += 2
    if (block.tags.some(tag => tag.toLowerCase().includes(token))) score += 1.5
  }
  return score
}

export function createExcerpt(text: string, query: string, maxLength = 260): string {
  const normalized = normalizeText(text)
  if (normalized.length <= maxLength) return normalized
  const tokens = tokenize(query).filter(token => !token.includes(' '))
  const lower = normalized.toLowerCase()
  const firstHit = tokens.map(token => lower.indexOf(token)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstHit - Math.floor(maxLength / 3))
  const end = Math.min(normalized.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`
}

export function formatEvidenceBlock(result: EvidenceBlockResult): string {
  const heading = result.block.headingPath.length ? ` / ${result.block.headingPath.join(' / ')}` : ''
  return `[${result.document.filePath}${heading} / ${result.block.id}] ${result.excerpt}`
}

export interface FindEvidenceBlocksInput {
  query: string
  filePath: string
  limit?: number
}

export async function findEvidenceBlocks(input: FindEvidenceBlocksInput): Promise<EvidenceBlockResult[]> {
  const bundle = await getStructuredDocumentBundleByPath(input.filePath)
  if (!bundle) return []
  const scored = bundle.blocks
    .map(block => ({
      block,
      document: { id: bundle.document.id, filePath: bundle.document.filePath, title: bundle.document.title },
      score: scoreEvidenceBlock(block, input.query),
      excerpt: createExcerpt(block.text || block.markdown, input.query),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.block.order - b.block.order)
  return scored.slice(0, Math.max(1, input.limit || 8))
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in `evidence.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/structured-knowledge/evidence.ts scripts/structured-knowledge-tests.mjs
git commit -m "feat(knowledge): add structured evidence helpers"
```

---

### Task 7: Implement semantic extractor with JSON parsing and evidence validation

**Files:**
- Create: `src/lib/structured-knowledge/semantic-extractor.ts`
- Modify: `scripts/structured-knowledge-tests.mjs`

**Interfaces:**
- Consumes: structured DB bundle, AI client, parser stable IDs.
- Produces: `parseSemanticExtractionResponse(text)`, `validateSemanticExtraction(raw, bundle, now)`, `extractNoteSemantics(input): Promise<SemanticExtractionResult>`.

- [ ] **Step 1: Add semantic parser tests**

Append to `scripts/structured-knowledge-tests.mjs`:

```js
const semantic = await import('../src/lib/structured-knowledge/semantic-extractor.ts')
const semanticParsed = semantic.parseSemanticExtractionResponse('```json\n{"entities":[{"name":"知识图谱","type":"concept","evidenceBlockIds":["block_a"],"confidence":0.9}],"relations":[]}\n```')
assert.equal(semanticParsed.entities[0].name, '知识图谱')
assert.deepEqual(semantic.parseSemanticExtractionResponse('not json'), { entities: [], relations: [] })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `semantic-extractor.ts` does not exist.

- [ ] **Step 3: Implement semantic extractor**

Create `src/lib/structured-knowledge/semantic-extractor.ts`:

```ts
import { Store } from '@tauri-apps/plugin-store'
import type { AiConfig } from '@/app/core/setting/config'
import { invokeAiJson } from '@/lib/ai/tauri-client'
import { getStructuredDocumentBundleByPath, upsertStructuredEntities, upsertStructuredRelations } from '@/db/structured-knowledge'
import { createStableId } from './markdown-parser'
import type { ExtractedEntity, ExtractedRelation, StructuredEntityType, StructuredRelationType, StructuredMarkdownDocument, StructuredBlock } from './types'

export interface RawSemanticEntity {
  name?: unknown
  type?: unknown
  aliases?: unknown
  evidenceBlockIds?: unknown
  confidence?: unknown
}

export interface RawSemanticRelation {
  source?: unknown
  target?: unknown
  relationType?: unknown
  evidenceBlockIds?: unknown
  confidence?: unknown
}

export interface ParsedSemanticExtraction {
  entities: RawSemanticEntity[]
  relations: RawSemanticRelation[]
}

export interface SemanticExtractionResult {
  documentId: string
  filePath: string
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
  discardedRelations: number
  warnings: string[]
}

const ENTITY_TYPES = new Set<StructuredEntityType>(['concept', 'person', 'organization', 'method', 'tool', 'claim', 'metric', 'project', 'other'])
const RELATION_TYPES = new Set<StructuredRelationType>(['supports', 'contradicts', 'extends', 'references', 'defines', 'uses', 'part_of', 'causes', 'improves', 'related'])

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).map(item => item.trim()).filter(Boolean)
}

function confidence(value: unknown, fallback = 0.7): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function parseSemanticExtractionResponse(text: string): ParsedSemanticExtraction {
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) candidates.unshift(fenced[1])
  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch?.[0]) candidates.push(objectMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'))
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      }
    } catch {
      continue
    }
  }

  return { entities: [], relations: [] }
}

export function validateSemanticExtraction(
  raw: ParsedSemanticExtraction,
  document: StructuredMarkdownDocument,
  blocks: StructuredBlock[],
  now = Date.now(),
): { entities: ExtractedEntity[]; relations: ExtractedRelation[]; discardedRelations: number; warnings: string[] } {
  const warnings: string[] = []
  const validBlockIds = new Set(blocks.map(block => block.id))
  const entitiesByName = new Map<string, ExtractedEntity>()

  for (const rawEntity of raw.entities) {
    const name = typeof rawEntity.name === 'string' ? rawEntity.name.trim() : ''
    if (!name) continue
    const evidenceBlockIds = asStringArray(rawEntity.evidenceBlockIds).filter(id => validBlockIds.has(id))
    const entityType = ENTITY_TYPES.has(rawEntity.type as StructuredEntityType) ? rawEntity.type as StructuredEntityType : 'other'
    const normalizedName = normalizeName(name)
    const entity: ExtractedEntity = {
      id: createStableId('ske', [document.id, normalizedName, entityType, 'llm']),
      documentId: document.id,
      name,
      normalizedName,
      type: entityType,
      aliases: asStringArray(rawEntity.aliases),
      evidenceBlockIds,
      confidence: confidence(rawEntity.confidence),
      extractionMethod: 'llm',
      createdAt: now,
      updatedAt: now,
    }
    entitiesByName.set(normalizedName, entity)
  }

  let discardedRelations = 0
  const relations: ExtractedRelation[] = []
  for (const rawRelation of raw.relations) {
    const sourceName = typeof rawRelation.source === 'string' ? normalizeName(rawRelation.source) : ''
    const targetName = typeof rawRelation.target === 'string' ? normalizeName(rawRelation.target) : ''
    const source = entitiesByName.get(sourceName)
    const target = entitiesByName.get(targetName)
    const evidenceBlockIds = asStringArray(rawRelation.evidenceBlockIds).filter(id => validBlockIds.has(id))
    if (!source || !target || evidenceBlockIds.length === 0) {
      discardedRelations++
      continue
    }
    const relationType = RELATION_TYPES.has(rawRelation.relationType as StructuredRelationType)
      ? rawRelation.relationType as StructuredRelationType
      : 'related'
    relations.push({
      id: createStableId('skr', [document.id, source.id, target.id, relationType, evidenceBlockIds.join('|')]),
      documentId: document.id,
      sourceEntityId: source.id,
      targetEntityId: target.id,
      relationType,
      evidenceBlockIds,
      confidence: confidence(rawRelation.confidence),
      extractionMethod: 'llm',
      createdAt: now,
      updatedAt: now,
    })
  }

  if (discardedRelations > 0) warnings.push(`${discardedRelations} relation(s) discarded because source/target/evidence was invalid.`)
  return { entities: Array.from(entitiesByName.values()), relations, discardedRelations, warnings }
}

async function getAIConfig() {
  const store = await Store.load('store.json')
  const currentModel = await store.get<string>('aiModel')
  const aiModelList = await store.get<AiConfig[]>('aiModelList')
  if (!currentModel || !aiModelList) return null
  for (const config of aiModelList) {
    const target = config.models?.find(model => model.id === currentModel && model.modelType === 'chat')
    if (target) return { ...config, model: target.model, modelType: target.modelType }
    if (!config.models?.length && config.key === currentModel && config.modelType === 'chat') return config
  }
  return null
}

function buildPrompt(document: StructuredMarkdownDocument, blocks: StructuredBlock[], mode: 'entities' | 'relations' | 'both') {
  const blockText = blocks.map(block => `[${block.id}] ${block.headingPath.join(' / ')}\n${block.text}`).join('\n\n')
  return `你是 LingMo 的结构化知识抽取器。请只基于给定 Markdown 块抽取语义信息。\n\n文件：${document.filePath}\n模式：${mode}\n\n要求：\n- 只返回严格 JSON，不要 Markdown 解释。\n- entities[].evidenceBlockIds 必须使用给定块 ID。\n- relations[].evidenceBlockIds 必须非空。\n- 如果证据不足，不要生成 relation。\n\nJSON 结构：\n{\n  "entities": [{"name":"...","type":"concept|person|organization|method|tool|claim|metric|project|other","aliases":[],"evidenceBlockIds":["..."],"confidence":0.0}],\n  "relations": [{"source":"实体名","target":"实体名","relationType":"supports|contradicts|extends|references|defines|uses|part_of|causes|improves|related","evidenceBlockIds":["..."],"confidence":0.0}]\n}\n\nMarkdown 块：\n${blockText}`
}

export async function extractNoteSemantics(input: { filePath: string; mode?: 'entities' | 'relations' | 'both'; maxBlocks?: number; overwrite?: boolean }): Promise<SemanticExtractionResult> {
  const bundle = await getStructuredDocumentBundleByPath(input.filePath)
  if (!bundle) throw new Error(`Structured document not found for ${input.filePath}`)
  const config = await getAIConfig()
  if (!config) throw new Error('No chat AI model configured')
  const blocks = bundle.blocks.slice(0, Math.max(1, input.maxBlocks || 40))
  const prompt = buildPrompt(bundle.document, blocks, input.mode || 'both')
  const response = await invokeAiJson<any>({
    config: {
      baseUrl: config.baseURL || '',
      apiKey: config.apiKey || undefined,
      customHeaders: config.customHeaders,
    },
    path: '/chat/completions',
    method: 'POST',
    body: {
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1800,
    },
  })
  const content = response?.choices?.[0]?.message?.content || ''
  const parsed = parseSemanticExtractionResponse(content)
  const validated = validateSemanticExtraction(parsed, bundle.document, bundle.blocks)
  await upsertStructuredEntities(bundle.document.id, validated.entities)
  await upsertStructuredRelations(bundle.document.id, validated.relations)
  return {
    documentId: bundle.document.id,
    filePath: bundle.document.filePath,
    entities: validated.entities,
    relations: validated.relations,
    discardedRelations: validated.discardedRelations,
    warnings: validated.warnings,
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in `semantic-extractor.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/structured-knowledge/semantic-extractor.ts scripts/structured-knowledge-tests.mjs
git commit -m "feat(knowledge): add evidence-bound semantic extraction"
```

---

### Task 8: Add structured graph adapter

**Files:**
- Create: `src/lib/structured-knowledge/graph-adapter.ts`
- Modify: `scripts/structured-knowledge-tests.mjs`
- Later integration into graph store happens in Task 10.

**Interfaces:**
- Consumes: structured DB bundles/entities/relations.
- Produces: `buildStructuredGraphForBundle(bundle, options?)`, `getStructuredGraphForFile(filePath, options?)`.

- [ ] **Step 1: Add graph adapter pure test**

Append to `scripts/structured-knowledge-tests.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:structured-knowledge`

Expected: FAIL because `graph-adapter.ts` does not exist.

- [ ] **Step 3: Implement graph adapter**

Create `src/lib/structured-knowledge/graph-adapter.ts`:

```ts
import { getStructuredDocumentBundleByPath } from '@/db/structured-knowledge'
import type { ExtractedEntity, ExtractedRelation, StructuredBlock, StructuredGraphEdge, StructuredGraphNode, StructuredMarkdownDocument } from './types'

export interface StructuredGraphBundle {
  document: StructuredMarkdownDocument
  blocks: StructuredBlock[]
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
}

export interface StructuredGraphOptions {
  includeHeadings?: boolean
  includeEvidenceBlocks?: boolean
  minConfidence?: number
}

function entityNodeId(entity: ExtractedEntity) {
  return `structured_entity:${entity.id}`
}

function noteNodeId(document: StructuredMarkdownDocument) {
  return `structured_note:${document.id}`
}

export function buildStructuredGraphForBundle(bundle: StructuredGraphBundle, options: StructuredGraphOptions = {}): { nodes: StructuredGraphNode[]; edges: StructuredGraphEdge[] } {
  const minConfidence = options.minConfidence ?? 0.7
  const nodes: StructuredGraphNode[] = []
  const edges: StructuredGraphEdge[] = []
  const noteId = noteNodeId(bundle.document)

  nodes.push({
    id: noteId,
    label: bundle.document.title,
    type: 'note',
    sourceDocumentId: bundle.document.id,
    sourceObjectId: bundle.document.sourceObjectId,
    filePath: bundle.document.filePath,
  })

  if (options.includeHeadings) {
    for (const heading of bundle.document.headings) {
      const headingId = `structured_heading:${heading.id}`
      nodes.push({
        id: headingId,
        label: heading.text,
        type: 'heading',
        sourceDocumentId: bundle.document.id,
        filePath: bundle.document.filePath,
        metadata: { level: heading.level, path: heading.path },
      })
      edges.push({
        id: `structured_edge:${bundle.document.id}:contains:${heading.id}`,
        source: noteId,
        target: headingId,
        type: 'contains',
      })
    }
  }

  const entityById = new Map<string, ExtractedEntity>()
  for (const entity of bundle.entities) {
    if (entity.confidence < minConfidence) continue
    entityById.set(entity.id, entity)
    nodes.push({
      id: entityNodeId(entity),
      label: entity.name,
      type: entity.type === 'claim' ? 'claim' : 'entity',
      sourceDocumentId: bundle.document.id,
      filePath: bundle.document.filePath,
      confidence: entity.confidence,
      metadata: { entityType: entity.type, aliases: entity.aliases },
    })
    edges.push({
      id: `structured_edge:${bundle.document.id}:mentions:${entity.id}`,
      source: noteId,
      target: entityNodeId(entity),
      type: 'mentions',
      confidence: entity.confidence,
      evidenceBlockIds: entity.evidenceBlockIds,
    })
  }

  for (const relation of bundle.relations) {
    if (relation.confidence < minConfidence) continue
    if (!relation.evidenceBlockIds.length) continue
    if (!entityById.has(relation.sourceEntityId) || !entityById.has(relation.targetEntityId)) continue
    edges.push({
      id: `structured_relation:${relation.id}`,
      source: entityNodeId(entityById.get(relation.sourceEntityId)!),
      target: entityNodeId(entityById.get(relation.targetEntityId)!),
      type: relation.relationType,
      label: relation.relationType,
      confidence: relation.confidence,
      evidenceBlockIds: relation.evidenceBlockIds,
    })
  }

  if (options.includeEvidenceBlocks) {
    for (const block of bundle.blocks) {
      const blockId = `structured_block:${block.id}`
      nodes.push({
        id: blockId,
        label: block.headingPath.at(-1) || `Block ${block.order + 1}`,
        type: 'block',
        sourceDocumentId: bundle.document.id,
        filePath: bundle.document.filePath,
        metadata: { order: block.order, headingPath: block.headingPath },
      })
    }
  }

  return { nodes, edges }
}

export async function getStructuredGraphForFile(filePath: string, options: StructuredGraphOptions = {}) {
  const bundle = await getStructuredDocumentBundleByPath(filePath)
  if (!bundle) return { nodes: [], edges: [] }
  return buildStructuredGraphForBundle(bundle, options)
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in `graph-adapter.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/structured-knowledge/graph-adapter.ts scripts/structured-knowledge-tests.mjs
git commit -m "feat(graph): adapt structured markdown into graph data"
```

---

### Task 9: Add Agent structured knowledge tools

**Files:**
- Create: `src/lib/agent/tools/structured-knowledge-tools.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `scripts/agent-core-tests.mjs` or add a lightweight tool exposure assertion if the existing script has tool exposure tests.

**Interfaces:**
- Consumes: sync, DB bundle, evidence, semantic extractor, graph adapter.
- Produces: `structuredKnowledgeTools: Tool[]` containing `get_structured_note`, `rebuild_structured_knowledge`, `find_evidence_blocks`, `extract_note_semantics`, `link_note_to_graph`.

- [ ] **Step 1: Create tool file**

Create `src/lib/agent/tools/structured-knowledge-tools.ts`:

```ts
import type { Tool, ToolResult } from '../types'

function compact(value: string, maxLength = 240) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

export const getStructuredNoteTool: Tool = {
  name: 'get_structured_note',
  description: 'Get structured Markdown note context: outline, blocks, wikilinks, tags, entities, and relations. Use for precise evidence-aware note understanding.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'includeBlocks', type: 'boolean', required: false, description: 'Include bounded structured blocks.' },
    { name: 'includeEntities', type: 'boolean', required: false, description: 'Include extracted entities.' },
    { name: 'includeRelations', type: 'boolean', required: false, description: 'Include extracted semantic relations.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = String(params.filePath || '').trim()
      if (!filePath) return { success: false, error: 'Missing filePath' }
      const { getStructuredDocumentBundleByPath } = await import('@/db/structured-knowledge')
      const bundle = await getStructuredDocumentBundleByPath(filePath)
      if (!bundle) return { success: false, error: `No structured note found for ${filePath}. Run rebuild_structured_knowledge first.` }
      const outline = bundle.document.headings.map(h => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`).join('\n')
      const blockLines = params.includeBlocks === true
        ? bundle.blocks.slice(0, 20).map(block => `- ${block.id} [${block.headingPath.join(' / ') || 'root'}] ${compact(block.text, 180)}`)
        : []
      const entityLines = params.includeEntities === true
        ? bundle.entities.slice(0, 30).map(entity => `- ${entity.name} (${entity.type}, confidence=${entity.confidence.toFixed(2)})`)
        : []
      const relationLines = params.includeRelations === true
        ? bundle.relations.slice(0, 30).map(relation => `- ${relation.sourceEntityId} ${relation.relationType} ${relation.targetEntityId} confidence=${relation.confidence.toFixed(2)}`)
        : []
      return {
        success: true,
        message: [
          `Structured note: ${bundle.document.title} (${bundle.document.filePath})`,
          `Blocks: ${bundle.blocks.length}; Headings: ${bundle.document.headings.length}; Entities: ${bundle.entities.length}; Relations: ${bundle.relations.length}`,
          outline ? `Outline:\n${outline}` : 'Outline: none',
          blockLines.length ? `Blocks:\n${blockLines.join('\n')}` : '',
          entityLines.length ? `Entities:\n${entityLines.join('\n')}` : '',
          relationLines.length ? `Relations:\n${relationLines.join('\n')}` : '',
        ].filter(Boolean).join('\n'),
        data: bundle,
      }
    } catch (error) {
      return { success: false, error: `get_structured_note failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const rebuildStructuredKnowledgeTool: Tool = {
  name: 'rebuild_structured_knowledge',
  description: 'Rebuild local structured Markdown index for a file. This is deterministic and does not call an LLM.',
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'content', type: 'string', required: true, description: 'Markdown content to structure. Agent should read the file first.' },
    { name: 'force', type: 'boolean', required: false, description: 'Force rebuild even when content hash is unchanged.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const filePath = String(params.filePath || '').trim()
      const content = String(params.content || '')
      if (!filePath) return { success: false, error: 'Missing filePath' }
      const { syncStructuredMarkdownContent } = await import('@/lib/structured-knowledge/sync')
      const result = await syncStructuredMarkdownContent({ filePath, content, force: params.force === true })
      return { success: true, message: `Structured ${filePath}: blocks=${result.blockCount}, headings=${result.headingCount}, entities=${result.entityCount}, skipped=${result.skipped}`, data: result }
    } catch (error) {
      return { success: false, error: `rebuild_structured_knowledge failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const findEvidenceBlocksTool: Tool = {
  name: 'find_evidence_blocks',
  description: 'Find structured Markdown evidence blocks by query inside a structured note.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'query', type: 'string', required: true, description: 'Evidence query.' },
    { name: 'limit', type: 'number', required: false, description: 'Maximum evidence blocks, default 8.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { findEvidenceBlocks, formatEvidenceBlock } = await import('@/lib/structured-knowledge/evidence')
      const results = await findEvidenceBlocks({ filePath: String(params.filePath || ''), query: String(params.query || ''), limit: Number(params.limit) || 8 })
      return {
        success: true,
        message: results.length ? results.map(formatEvidenceBlock).join('\n') : 'No evidence blocks found.',
        data: results,
      }
    } catch (error) {
      return { success: false, error: `find_evidence_blocks failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const extractNoteSemanticsTool: Tool = {
  name: 'extract_note_semantics',
  description: 'Manually trigger LLM extraction of entities and evidence-bound relations for a structured Markdown note.',
  category: 'note',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['read', 'write'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path already present in structured index.' },
    { name: 'mode', type: 'string', required: false, description: 'entities, relations, or both. Default both.' },
    { name: 'maxBlocks', type: 'number', required: false, description: 'Maximum blocks to send to LLM, default 40.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { extractNoteSemantics } = await import('@/lib/structured-knowledge/semantic-extractor')
      const mode = ['entities', 'relations', 'both'].includes(String(params.mode)) ? String(params.mode) as 'entities' | 'relations' | 'both' : 'both'
      const result = await extractNoteSemantics({ filePath: String(params.filePath || ''), mode, maxBlocks: Number(params.maxBlocks) || 40 })
      return {
        success: true,
        message: `Extracted semantics for ${result.filePath}: entities=${result.entities.length}, relations=${result.relations.length}, discardedRelations=${result.discardedRelations}${result.warnings.length ? `\nWarnings: ${result.warnings.join('; ')}` : ''}`,
        data: result,
      }
    } catch (error) {
      return { success: false, error: `extract_note_semantics failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const linkNoteToGraphTool: Tool = {
  name: 'link_note_to_graph',
  description: 'Build graph nodes and edges from a structured Markdown note. Use this to inspect what will enter the knowledge graph.',
  category: 'note',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Workspace-relative Markdown file path.' },
    { name: 'includeHeadings', type: 'boolean', required: false, description: 'Include heading nodes.' },
    { name: 'includeEvidenceBlocks', type: 'boolean', required: false, description: 'Include evidence block nodes for local inspection.' },
    { name: 'minConfidence', type: 'number', required: false, description: 'Minimum entity/relation confidence, default 0.7.' },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { getStructuredGraphForFile } = await import('@/lib/structured-knowledge/graph-adapter')
      const graph = await getStructuredGraphForFile(String(params.filePath || ''), {
        includeHeadings: params.includeHeadings === true,
        includeEvidenceBlocks: params.includeEvidenceBlocks === true,
        minConfidence: Number(params.minConfidence) || 0.7,
      })
      return { success: true, message: `Structured graph: nodes=${graph.nodes.length}, edges=${graph.edges.length}`, data: graph }
    } catch (error) {
      return { success: false, error: `link_note_to_graph failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const structuredKnowledgeTools: Tool[] = [
  getStructuredNoteTool,
  rebuildStructuredKnowledgeTool,
  findEvidenceBlocksTool,
  extractNoteSemanticsTool,
  linkNoteToGraphTool,
]
```

- [ ] **Step 2: Register tools**

Modify `src/lib/agent/tools/index.ts`:

Add import:

```ts
import { structuredKnowledgeTools } from './structured-knowledge-tools'
```

Add to `allTools` after `knowledgeObjectTools`:

```ts
...structuredKnowledgeTools,
```

- [ ] **Step 3: Run agent tests and typecheck**

Run: `pnpm test:agent`

Expected: PASS or only existing unrelated failures. Tool registry must not fail due to duplicate names or invalid schema.

Run: `pnpm typecheck`

Expected: no new errors in `structured-knowledge-tools.ts` or `index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/tools/structured-knowledge-tools.ts src/lib/agent/tools/index.ts
git commit -m "feat(agent): expose structured markdown knowledge tools"
```

---

### Task 10: Integrate structured graph data into graph store

**Files:**
- Modify: `src/app/core/main/knowledge/store/graph-store.ts`

**Interfaces:**
- Consumes: `getStructuredGraphForFile` or bulk graph adapter helpers.
- Produces: Existing graph store includes structured entity/relation graph nodes for Markdown notes where structured data exists.

- [ ] **Step 1: Inspect graph node/edge internal shapes**

Open `src/app/core/main/knowledge/store/graph-store.ts` and identify the internal node/edge interfaces and the function that assembles note graph data. Record the exact local names before editing.

- [ ] **Step 2: Add a small adapter function inside graph-store**

Near the existing graph assembly helpers, add a function that maps structured adapter output to the graph store's existing node/edge shape. Use the actual graph store type names discovered in Step 1. The mapping should preserve:

```ts
// conceptual mapping; adapt field names to graph-store's existing interfaces
{
  id: structuredNode.id,
  name: structuredNode.label,
  type: structuredNode.type,
  category: structuredNode.type,
  filePath: structuredNode.filePath,
  metadata: structuredNode.metadata,
}

{
  id: structuredEdge.id,
  source: structuredEdge.source,
  target: structuredEdge.target,
  type: structuredEdge.type,
  label: structuredEdge.label || structuredEdge.type,
  weight: structuredEdge.confidence || 1,
  metadata: { evidenceBlockIds: structuredEdge.evidenceBlockIds, ...structuredEdge.metadata },
}
```

- [ ] **Step 3: Merge structured graph data in local note graph path**

In the local/current-note graph build path, after the base note graph is built, call:

```ts
const { getStructuredGraphForFile } = await import('@/lib/structured-knowledge/graph-adapter')
const structured = await getStructuredGraphForFile(currentFilePath, {
  includeHeadings: true,
  includeEvidenceBlocks: false,
  minConfidence: 0.7,
})
```

Merge mapped nodes and edges by unique ID. If the graph store build function is synchronous, create a separate async enrichment path matching the existing store pattern rather than blocking sync code.

- [ ] **Step 4: Merge high-confidence structured data in global graph path**

For global graph, include only:

```ts
{
  includeHeadings: false,
  includeEvidenceBlocks: false,
  minConfidence: 0.78,
}
```

This enforces the no-node-explosion constraint.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`

Expected: no new errors in `graph-store.ts`.

- [ ] **Step 6: Manual smoke test graph behavior**

Run the app with `pnpm dev` or the project's usual dev command. Open a Markdown note, use Agent/tool or console path to structure it, then open the knowledge graph. Expected:

- Existing note graph still renders.
- Structured entity nodes appear only for structured notes.
- Block nodes do not appear in global graph.
- No graph render crash when structured DB is empty.

- [ ] **Step 7: Commit**

```bash
git add src/app/core/main/knowledge/store/graph-store.ts
git commit -m "feat(graph): include structured markdown entities"
```

---

### Task 11: Hook structured indexing into Markdown RAG/reindex flow

**Files:**
- Modify: `src/lib/rag.ts`
- Possibly modify: `src/lib/knowledge/reindex.ts` if that is the current central reindex entrypoint after inspection.

**Interfaces:**
- Consumes: `syncStructuredMarkdownContent`, `buildStructuredRagChunks`, metadata-aware vector writes.
- Produces: Markdown RAG chunks include structured metadata when structured parsing succeeds; fallback to old RAG behavior on error.

- [ ] **Step 1: Locate Markdown file indexing function**

In `src/lib/rag.ts`, find the function that reads a Markdown file, chunks it, embeds it, and calls `replaceVectorDocumentsForFile`. It may be named `processMarkdownFile` or similar. Record the exact function name.

- [ ] **Step 2: Add structured sync before chunk creation**

Inside the Markdown processing function, after content is read and before old chunks are finalized, add:

```ts
let structuredChunks: Array<{ chunkId: number; content: string; metadata: Record<string, unknown> }> | null = null
try {
  const { syncStructuredMarkdownContent } = await import('@/lib/structured-knowledge/sync')
  const { getStructuredDocumentBundleByPath } = await import('@/db/structured-knowledge')
  const { buildStructuredRagChunks } = await import('@/lib/structured-knowledge/rag-adapter')
  await syncStructuredMarkdownContent({ filePath: filename, content, updateKnowledgeObject: true })
  const bundle = await getStructuredDocumentBundleByPath(filename)
  if (bundle) {
    structuredChunks = buildStructuredRagChunks(bundle.document, bundle.blocks).map(chunk => ({
      chunkId: chunk.chunkId,
      content: chunk.content,
      metadata: chunk.metadata,
    }))
  }
} catch (error) {
  console.warn('[RAG] structured markdown indexing failed, falling back to legacy chunks:', error)
}
```

Adapt `filename` and `content` variable names to the function.

- [ ] **Step 3: Use structured chunks when available**

Where docs are prepared for `replaceVectorDocumentsForFile`, use structured chunks if present:

```ts
const sourceChunks = structuredChunks?.length
  ? structuredChunks
  : chunks.map((chunk, index) => ({ chunkId: index, content: chunk, metadata: undefined }))
```

When creating vector documents, include:

```ts
metadata: item.metadata ? JSON.stringify(item.metadata) : null
```

- [ ] **Step 4: Preserve fallback behavior**

If structured sync fails or returns zero chunks, the old chunking path must still run exactly as before.

- [ ] **Step 5: Run RAG-related tests and typecheck**

Run: `pnpm test:structured-knowledge`

Expected: PASS.

Run: `pnpm typecheck`

Expected: no new errors in `rag.ts`.

If available and safe, run: `pnpm test:agent`

Expected: PASS or no structured-related failures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rag.ts
git commit -m "feat(rag): index markdown with structured metadata"
```

---

### Task 12: Final verification and documentation update

**Files:**
- Modify: `docs/superpowers/specs/2026-07-01-structured-markdown-knowledge-design.md` only if implementation intentionally differs from the spec.
- Modify: relevant README or internal docs only if the project has an existing feature documentation location for knowledge/agent tools.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified feature branch with tests and documented deviations.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test:structured-knowledge
pnpm test:agent
pnpm typecheck
```

Expected:

- `test:structured-knowledge`: PASS.
- `test:agent`: PASS or existing unrelated failures documented.
- `typecheck`: PASS or existing unrelated failures documented.

- [ ] **Step 2: Run broader check if time allows**

Run:

```bash
pnpm check
```

Expected: PASS or existing unrelated failures documented with exact output.

- [ ] **Step 3: Manual smoke test**

Use a Markdown file containing headings, wikilinks, tags, and several paragraphs.

Expected workflow:

1. Rebuild structured knowledge via Agent tool `rebuild_structured_knowledge` with file path and content.
2. Read it via `get_structured_note`.
3. Search evidence via `find_evidence_blocks`.
4. Trigger `extract_note_semantics` only if AI config is available and user confirms.
5. Inspect graph output via `link_note_to_graph`.

Expected results:

- Structured note has headings and blocks.
- Evidence blocks cite file path, heading path, and block ID.
- LLM relations without evidence are discarded.
- Graph output includes note/entity/relation nodes but not every block by default.

- [ ] **Step 4: Record known limitations**

If no existing docs file is appropriate, append a short note to the design spec under an `Implementation Notes` heading:

```md
## Implementation Notes

- This phase indexes Markdown only.
- `rebuild_structured_knowledge` requires the caller to provide file content; automatic editor-save wiring can be added in a later UI task.
- Global graph integration includes only high-confidence structured entities and semantic relations.
```

- [ ] **Step 5: Commit final docs if changed**

```bash
git add docs/superpowers/specs/2026-07-01-structured-markdown-knowledge-design.md package.json
git commit -m "docs: document structured markdown knowledge implementation"
```

Skip this commit if no docs changed.

---

## Self-Review

### Spec coverage

- Markdown-only scope: covered in Global Constraints and all tasks.
- Local deterministic structuring: Tasks 2, 3, 4, and 11.
- Dedicated persistence tables: Task 3.
- KnowledgeObject metadata: Task 4.
- RAG metadata: Task 5 and Task 11.
- Evidence lookup: Task 6 and Agent tool in Task 9.
- Manual LLM extraction: Task 7 and Agent tool in Task 9.
- Graph adapter and integration: Tasks 8 and 10.
- No top-level document type: Global Constraints and Task 4 metadata-only integration.
- Tests: Tasks 2-8 include script tests; Tasks 9-12 include agent/typecheck/manual verification.

### Placeholder scan

The plan avoids TBD/TODO placeholders. Task 10 and Task 11 require inspecting existing large files before exact insertion because local graph-store/RAG function names must be preserved; both tasks give concrete code fragments and exact acceptance checks.

### Type consistency

The same names are used throughout:

- `StructuredMarkdownDocument`, `StructuredHeading`, `StructuredBlock`, `ExtractedEntity`, `ExtractedRelation`.
- `parseStructuredMarkdown`, `syncStructuredMarkdownContent`, `buildStructuredRagChunks`, `findEvidenceBlocks`, `extractNoteSemantics`, `buildStructuredGraphForBundle`.
- Agent tools: `get_structured_note`, `rebuild_structured_knowledge`, `find_evidence_blocks`, `extract_note_semantics`, `link_note_to_graph`.
