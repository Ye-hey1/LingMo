# Structured Markdown Knowledge Design

Date: 2026-07-01

## Summary

LingMo will enhance its Markdown-first knowledge system with a structured knowledge pipeline:

```txt
Markdown file
  -> structured document object
  -> Wiki/Note summary metadata
  -> RAG metadata
  -> multi-layer knowledge graph
  -> Agent tool loop
```

PDF, OCR, Office, and image processing are explicitly out of scope for this phase. The implementation targets Markdown notes and compatible Markdown-like files already supported by the app.

The selected approach is a medium-enhancement loop with hybrid triggering:

- Saving or reindexing Markdown runs fast local structuring only.
- LLM entity and relation extraction runs only when manually triggered by a user or Agent tool.

## Goals

1. Parse Markdown notes into structured documents, headings, blocks, links, tags, and local lightweight entities.
2. Persist structured results in dedicated SQLite tables.
3. Synchronize structured status into existing `knowledge_objects` metadata.
4. Enhance RAG chunks with structured metadata such as block IDs and heading paths.
5. Expose structured note context and evidence lookup through Agent tools.
6. Support manually triggered LLM extraction of entities and semantic relations.
7. Feed high-confidence entities and relations into the knowledge graph without creating node explosion.
8. Preserve existing Markdown editing, note indexing, RAG, graph, and Agent behavior.

## Non-goals

1. PDF parsing or OCR.
2. Image, Office, or webpage document intelligence.
3. Automatic generation of large numbers of `entities/`, `concepts/`, or `synthesis/` notes.
4. Replacing the current vector store with LanceDB or sqlite-vec.
5. Full review queue implementation for extracted relations.
6. Broad UI redesign.

## Existing integration points

The design reuses existing LingMo infrastructure:

- `src/lib/knowledge/object-registry.ts` for unified knowledge object registration.
- `src/db/knowledge-objects.ts` for top-level object metadata.
- `src/lib/rag.ts` and `src/db/vector.ts` for Markdown RAG and embeddings.
- `src/app/core/main/knowledge/store/graph-store.ts` for graph consumption.
- `src/lib/agent/tools/knowledge-object-tools.ts` and related Agent tool registry files for tool exposure.

This feature should be implemented as an additive layer instead of a rewrite.

## Architecture

Add a new module:

```txt
src/lib/structured-knowledge/
  types.ts
  markdown-parser.ts
  persistence.ts
  sync.ts
  rag-adapter.ts
  graph-adapter.ts
  semantic-extractor.ts
  evidence.ts
```

Responsibilities:

- `types.ts`: shared TypeScript types.
- `markdown-parser.ts`: local Markdown parsing, no LLM calls.
- `persistence.ts`: SQLite read/write helpers.
- `sync.ts`: orchestration from file content to structured records, knowledge object metadata, RAG metadata, and graph invalidation.
- `rag-adapter.ts`: convert structured blocks into RAG chunks with metadata.
- `graph-adapter.ts`: expose structured graph nodes and edges for the existing graph store.
- `semantic-extractor.ts`: manually triggered LLM entity/relation extraction with evidence validation.
- `evidence.ts`: evidence block lookup and citation formatting.

## Data flow

### Local automatic path

This path runs on Markdown save, reindex, explicit Agent rebuild, or app startup repair. It does not call an LLM.

```txt
filePath
  -> read Markdown
  -> compute contentHash
  -> skip if unchanged
  -> parse frontmatter, headings, blocks, wikilinks, tags
  -> upsert structured_documents
  -> replace structured_blocks
  -> upsert local entities from wikilinks, tags, and headings
  -> update knowledge_objects.metadata.structuredKnowledge
  -> optionally update structured RAG metadata
  -> invalidate graph/cache as needed
```

The path must be idempotent. Re-running it should not duplicate blocks, entities, or relations.

### Manual semantic path

This path is triggered only by the user or Agent.

```txt
documentId or filePath
  -> load structured document and blocks
  -> choose candidate blocks
  -> call LLM with strict JSON schema
  -> parse and validate JSON
  -> verify evidenceBlockIds exist
  -> normalize and merge entities
  -> filter or discard invalid relations
  -> upsert structured_entities and structured_relations
  -> update knowledge object metadata
  -> invalidate graph/cache as needed
```

LLM-generated relations without valid evidence blocks must not enter the primary graph.

## Core types

### StructuredMarkdownDocument

```ts
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
```

### StructuredHeading

```ts
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
```

### StructuredBlock

```ts
export interface StructuredBlock {
  id: string
  documentId: string
  headingId?: string
  type: 'paragraph' | 'list' | 'quote' | 'code' | 'table' | 'heading' | 'html' | 'math'
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
```

### ExtractedEntity

```ts
export interface ExtractedEntity {
  id: string
  documentId: string
  name: string
  normalizedName: string
  type: 'concept' | 'person' | 'organization' | 'method' | 'tool' | 'claim' | 'metric' | 'project' | 'other'
  aliases: string[]
  evidenceBlockIds: string[]
  confidence: number
  extractionMethod: 'local' | 'llm' | 'manual'
  createdAt: number
  updatedAt: number
}
```

### ExtractedRelation

```ts
export interface ExtractedRelation {
  id: string
  documentId: string
  sourceEntityId: string
  targetEntityId: string
  relationType: 'supports' | 'contradicts' | 'extends' | 'references' | 'defines' | 'uses' | 'part_of' | 'causes' | 'improves' | 'related'
  evidenceBlockIds: string[]
  confidence: number
  extractionMethod: 'llm' | 'manual' | 'inferred'
  createdAt: number
  updatedAt: number
}
```

## Database design

Add dedicated structured-knowledge tables instead of storing all data in `knowledge_objects.metadata`.

### structured_documents

```sql
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
);
```

### structured_blocks

```sql
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
);

create index if not exists idx_structured_blocks_document
on structured_blocks(document_id, block_order);

create index if not exists idx_structured_blocks_heading
on structured_blocks(document_id, heading_id);
```

### structured_entities

```sql
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
);

create index if not exists idx_structured_entities_document
on structured_entities(document_id);

create index if not exists idx_structured_entities_normalized_name
on structured_entities(normalized_name);
```

### structured_relations

```sql
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
);

create index if not exists idx_structured_relations_document
on structured_relations(document_id);

create index if not exists idx_structured_relations_source
on structured_relations(source_entity_id);

create index if not exists idx_structured_relations_target
on structured_relations(target_entity_id);
```

## KnowledgeObject integration

For this phase, Markdown files remain top-level `note` objects. Do not introduce a new top-level `document` type yet.

Enhance note metadata with:

```ts
{
  structuredKnowledge: {
    documentId: string,
    documentKind: 'markdown',
    blockCount: number,
    headingCount: number,
    entityCount: number,
    relationCount: number,
    lastStructuredAt: number,
    lastSemanticExtractedAt?: number
  }
}
```

This keeps existing search, graph, and Agent tools compatible while allowing future migration to a dedicated `document` type.

## RAG integration

Do not rewrite the current RAG system. Add a structured adapter that maps `StructuredBlock[]` to existing vector writes.

If `src/db/vector.ts` does not already support metadata, add a nullable `metadata text` column to vector documents. Store JSON such as:

```ts
{
  sourceObjectId: string
  structuredDocumentId: string
  blockIds: string[]
  headingPath: string[]
  wikilinks: string[]
  tags: string[]
  chunkType: 'structured_markdown'
}
```

Chunking rules:

1. Aggregate short adjacent blocks under the same heading.
2. Preserve code, quote, and table blocks where practical.
3. Keep target chunk size around the existing RAG defaults.
4. Every chunk must retain source block IDs.

## Graph integration

Add graph adapter output for the existing graph store. The graph should support multiple layers but avoid rendering every block by default.

Node types:

- `note`
- `heading`
- `entity`
- `claim`

Edge types:

- `contains`: note -> heading
- `mentions`: note/heading/block -> entity
- `links_to`: note -> note
- semantic relation edges: `supports`, `contradicts`, `defines`, `uses`, `improves`, etc.
- `evidenced_by`: relation/claim -> block, used for drill-down rather than default global rendering

Default global graph should show notes, high-confidence entities, wikilinks, and high-confidence semantic relations. Local graph can expand headings and evidence blocks for the selected note or relation.

## Agent tools

Add:

```txt
src/lib/agent/tools/structured-knowledge-tools.ts
```

Tools:

### get_structured_note

Read structured context for a Markdown note.

Parameters:

- `filePath?`
- `includeBlocks?`
- `includeEntities?`
- `includeRelations?`

Returns title, outline, tags, wikilinks, summary, selected blocks, entities, and relations.

### rebuild_structured_knowledge

Rebuild local structured indexes.

Parameters:

- `scope`: `current | file | folder | all`
- `path?`
- `updateRag?`

This tool does not call an LLM.

### extract_note_semantics

Manually trigger LLM entity/relation extraction.

Parameters:

- `filePath`
- `mode`: `entities | relations | both`
- `maxBlocks?`
- `overwrite?`

The tool validates evidence and returns created, updated, discarded, and warning counts.

### find_evidence_blocks

Find source blocks for a query, entity, or relation.

Parameters:

- `query`
- `filePath?`
- `entityName?`
- `limit?`

Returns evidence blocks with file path, heading path, block ID, and excerpt.

### link_note_to_graph

Synchronize structured note data into graph-consumable form.

Parameters:

- `filePath?`
- `includeSemanticRelations?`
- `minConfidence?`

## Error handling

### Markdown parsing failures

- Frontmatter parse failure falls back to empty metadata and adds a warning.
- Unsupported MDX or HTML is kept as text/html blocks where possible.
- Code blocks should be preserved even if surrounding Markdown is malformed.
- A single parsing warning should not stop structuring the note.

### LLM JSON failures

- Attempt to extract fenced JSON.
- Attempt simple JSON cleanup for markdown wrappers and trailing commas.
- If validation still fails, do not write entities or relations.
- Return an explicit error to the Agent/UI.

### Evidence validation failures

- Entities may be kept as low-confidence candidates if useful.
- Relations without valid evidence block IDs are discarded from the primary graph.
- Tool output must report discarded relation counts.

### Incremental update conflicts

- Use document-level `contentHash` to skip unchanged files.
- Use block-level `contentHash` for future incremental optimizations.
- On document changes, replace blocks for that document.
- Existing LLM relations whose evidence blocks no longer exist should be treated as stale or excluded from graph output.

### Batch failures

- A failed file must not stop a folder/all rebuild.
- Return `completed`, `skipped`, and `failed` counts with file-level warnings.

## Performance strategy

1. Local structuring should be fast and deterministic.
2. LLM extraction should default to low concurrency and bounded block counts.
3. File content hash skips unchanged work.
4. RAG chunks aggregate blocks to prevent embedding explosion.
5. Graph output uses global overview and local expansion to avoid node explosion.

## Testing strategy

### Unit tests

- Markdown parser: headings, heading tree, frontmatter fallback, wikilinks, tags, block splitting, code preservation.
- Persistence: document upsert, block replacement, entity/relation upserts, stale evidence handling.
- Evidence: query matching and citation formatting.
- Semantic extractor: JSON parsing and evidence validation using mocked LLM output.

### Integration tests

- Markdown file -> structured document and blocks.
- Structured document -> knowledge object metadata.
- Structured blocks -> RAG chunk metadata.
- Local entities -> graph adapter output.
- Mock semantic response -> entities and relations in storage.
- Agent tools can read structured note context and evidence blocks.

### Regression tests

Verify existing behavior remains intact:

- Markdown editing.
- Existing note index and wikilinks.
- Existing RAG search.
- Existing graph overview.
- Existing Agent knowledge tools.
- Existing diagram tools.

## Acceptance criteria

1. A Markdown file can be parsed into a structured document with headings, blocks, tags, and wikilinks.
2. Structured data is persisted and can be queried by file path or document ID.
3. `knowledge_objects.metadata` reflects structured status for the note.
4. RAG chunks can carry `headingPath` and `blockIds` metadata.
5. Agent can call a tool to retrieve structured note context.
6. Agent can call a tool to find evidence blocks.
7. Agent/user can manually trigger LLM entity and relation extraction.
8. LLM relations without valid evidence are rejected or excluded from the primary graph.
9. Graph output can include high-confidence entities and relations without rendering every block globally.
10. Existing Markdown, RAG, graph, and Agent features continue to work.

## Implementation order

1. Add structured knowledge types and parser.
2. Add database initialization and persistence helpers.
3. Implement sync from Markdown to structured document.
4. Sync structured status into `KnowledgeObject` metadata.
5. Add RAG metadata adapter and vector metadata storage if needed.
6. Add read-only Agent tools: `get_structured_note`, `find_evidence_blocks`.
7. Implement semantic extractor with mocked-testable LLM boundary.
8. Add write/LLM Agent tool: `extract_note_semantics`.
9. Add graph adapter and connect it to existing graph data flow.
10. Add unit, integration, and regression tests.

## Risks and mitigations

### Risk: schema overreach

Mitigation: keep this phase Markdown-only and use four focused structured tables.

### Risk: LLM hallucinated relations

Mitigation: require valid evidence block IDs and confidence. Exclude unsupported relations from the primary graph.

### Risk: graph node explosion

Mitigation: default global graph shows notes and high-confidence entities/relations only. Headings and blocks appear in local expansion.

### Risk: RAG chunk explosion

Mitigation: aggregate adjacent blocks by heading and preserve source block IDs in metadata.

### Risk: existing behavior regressions

Mitigation: additive architecture, dedicated tests, and no top-level `document` type migration in this phase.

## Implementation Notes

- This phase indexes Markdown only; non-Markdown document intelligence remains out of scope.
- `rebuild_structured_knowledge` is currently file-scoped and requires the caller to provide `filePath` and Markdown `content`; broader folder/all rebuild and automatic editor-save wiring can be added in a later UI task.
- Global graph integration includes note/entity/semantic relation data by default; headings and evidence blocks are opt-in for local inspection to avoid graph node explosion.
