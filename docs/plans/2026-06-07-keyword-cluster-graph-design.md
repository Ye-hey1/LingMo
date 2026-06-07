# Knowledge Graph Keyword Cluster View Design

Date: 2026-06-07
Status: Approved design
Scope: Add a keyword-cluster view inside the existing Knowledge Graph tab.

## Background

LingMo already has a Knowledge Graph page implemented as a special editor tab. The current graph is a canvas-based relation graph built from workspace files, wiki links, optional semantic edges, tag filters, a timeline scrubber, and a right-side detail panel.

The requested feature adds a new view inspired by a topology-style knowledge map: topic centers surrounded by related keyword satellites. The goal is to help users understand the themes emerging across all notes, then drill from themes and keywords back to concrete articles.

## Confirmed Product Direction

Add a compact view switcher at the top of the existing Knowledge Graph page:

```text
关系图谱 | 关键词聚类
```

The default view remains `关系图谱` to preserve current behavior. Selecting `关键词聚类` replaces the relation graph canvas with a topic-cluster topology.

The keyword-cluster view shows:

- Topic clusters as larger center nodes, each named from its strongest keywords.
- Keyword nodes as satellites around each topic cluster.
- Related articles in the right-side detail panel rather than as always-visible canvas nodes.
- A clear path from cluster -> keyword -> related notes -> open note.

The first version prioritizes exploration and traceability over a static poster-like image. Users should be able to answer:

- What are the main themes across my notes?
- Which keywords define each theme?
- Which notes support a theme or keyword?

## Chosen Approach

Use the existing local `note_topics` table as the only default data source.

Reasons:

- The app already extracts keywords after Markdown saves through `rank_keywords`.
- The data is local, fast, offline-capable, and explainable.
- No new NLP dependency is required.
- Vector and LLM enhancements can be added later without changing the first version's mental model.

Rejected first-version approaches:

- Vector-assisted clustering: more accurate in some cases, but requires embeddings to exist and introduces threshold tuning.
- LLM-generated cluster names: often nicer, but slower, less deterministic, and not local/offline by default.

## Data Sources

Primary source:

- `src/db/note-topics.ts`
  - `getAllTopics()`
  - `getTopicsForNote(filename)`
  - `note_topics(filename, keyword, weight, source, updated_at)`

Existing producer:

- `src/stores/article.ts`
  - `scheduleTopicExtraction(path, content)`
  - `extractAndStoreTopics(path, content)`

The cluster view should filter topics against the current workspace `fileTree`, so deleted or unavailable files do not appear even if topic rows remain in SQLite.

## Cluster Data Model

Introduce a view-specific data model, generated from `NoteTopic[]` plus the active `fileTree`.

```ts
interface KeywordClusterGraph {
  clusters: KeywordCluster[]
  keywordNodes: KeywordClusterKeyword[]
  edges: KeywordClusterEdge[]
  keywordIndex: Map<string, KeywordClusterKeyword>
  noteIndex: Map<string, KeywordClusterNoteRef>
}

interface KeywordCluster {
  id: string
  label: string
  color: string
  keywords: string[]
  notePaths: string[]
  totalWeight: number
  noteCount: number
  x: number
  y: number
  radius: number
}

interface KeywordClusterKeyword {
  id: string
  keyword: string
  clusterId: string
  notePaths: string[]
  totalWeight: number
  avgWeight: number
  noteCount: number
  x: number
  y: number
  radius: number
}

interface KeywordClusterNoteRef {
  path: string
  label: string
  keywords: Array<{ keyword: string; weight: number }>
  score: number
}

interface KeywordClusterEdge {
  source: string
  target: string
  type: 'cluster-keyword' | 'keyword-cooccurrence'
  weight: number
}
```

## Cluster Algorithm

The first version uses a lightweight local graph-clustering algorithm.

1. Read all topics with `getAllTopics()`.
2. Keep only topics whose `filename` exists in the current Markdown file set.
3. Group by keyword and compute:
   - `totalWeight`
   - `noteCount`
   - `avgWeight`
   - `notes[]`
   - `updatedAtMax`
4. For every note, take its top `topK = 12` keywords by weight.
5. Build keyword co-occurrence edges from keywords that appear in the same note.
   - Edge weight starts with `min(weightA, weightB)`.
   - Repeated co-occurrence across notes increases the edge weight.
6. Drop weak keyword edges below a dynamic threshold.
7. Build connected components from remaining keyword edges.
8. Normalize cluster count:
   - Target roughly 6-14 clusters.
   - Split oversized components by strongest seed keywords and nearest co-occurrence affinity.
   - Merge tiny components into their nearest larger component.
   - Put persistent isolated keywords into a fallback cluster named `零散主题`.
9. Name each cluster from the highest-scoring keywords:
   - Prefer high `noteCount`, high `totalWeight`, and readable length.
   - Canvas label shows one or two terms, for example `AI 写作` or `AI 写作 / 提示词`.
   - Detail panel shows the full keyword ranking.

The algorithm should be deterministic for the same topic rows and file tree.

## Layout

The keyword view keeps the existing canvas interaction model but uses a separate layout.

Cluster layout:

- Sort clusters by `noteCount` and `totalWeight`.
- Place the largest cluster near the canvas center.
- Place remaining clusters on a golden-angle spiral or balanced ring.
- Assign each cluster a reserved radius based on keyword count and label footprint.
- Run lightweight collision adjustment between cluster bounding circles.

Keyword layout:

- Place keywords radially around the cluster center.
- Higher-weight keywords sit closer to the topic center.
- Lower-weight keywords sit further out.
- Apply local label collision resolution within each cluster.

Edges:

- Always draw subtle cluster-to-keyword edges.
- Draw keyword-to-keyword co-occurrence edges only on hover or selection.
- Keep inactive clusters dimmed during focus states.

## Visual Design

Dark mode can use the reference image's topology feel:

- Colored topic rings.
- Subtle glow around selected clusters.
- Low-opacity radial edges.
- Keyword labels inheriting cluster color.

Light mode should keep readability first:

- Softer fills.
- Clear text contrast.
- Low-saturation cluster colors.
- Less glow and more border definition.

The view should not rely on decorative text explaining how it works. Controls and empty states should be concise and actionable.

## Interaction Design

Top-level controls:

- View switcher: `关系图谱 | 关键词聚类`.
- Existing graph controls remain available where applicable: zoom, reset, settings, detail panel toggle.

Keyword-cluster settings:

- Minimum note count per keyword.
- Maximum keywords per cluster.
- Maximum cluster count.
- Show or hide isolated keywords.
- Show or hide keyword labels.

Hover:

- Hovering a cluster highlights all keywords in that cluster.
- Hovering a keyword shows note count and total weight, and highlights strong co-occurring keywords.

Click:

- Clicking a cluster opens a cluster detail panel.
- Clicking a keyword opens a keyword detail panel.
- Clicking an article in the detail panel opens that note in the editor.

Cross-view behavior:

- Article list items can include an action to locate the article in `关系图谱`.
- That action switches the view to `关系图谱` and emits the existing `graph-locate-node` flow when possible.

## Detail Panel

The current `DetailPanel` is note-centric. Add a dedicated keyword-cluster detail panel instead of overloading note props.

Cluster detail shows:

- Cluster title.
- Article count.
- Keyword ranking.
- Top related notes with shared keywords and a score.
- Actions: open note, locate in relation graph.

Keyword detail shows:

- Keyword text.
- Note count.
- Total and average weight.
- Notes containing the keyword, sorted by weight.
- Co-occurring keywords.

## Empty States

If there are no usable topics:

- Show that no keyword index exists yet.
- Explain that keyword extraction currently happens after Markdown saves.
- Provide a safe first action: open or save a note to generate keywords.

A later implementation can add a "regenerate workspace keyword index" command, but first version should avoid adding a broad indexing workflow unless already supported safely.

## Engineering Plan

Add:

- `src/app/core/main/knowledge/keyword-cluster-data.ts`
  - Pure data transformation and clustering utilities.
  - Unit-testable without React or canvas.
- `src/app/core/main/knowledge/keyword-cluster-canvas.tsx`
  - Canvas rendering, hit testing, pan/zoom integration, hover and selection state.
- `src/app/core/main/knowledge/keyword-cluster-detail-panel.tsx`
  - Cluster and keyword detail UI.

Modify:

- `src/app/core/main/knowledge/knowledge-graph.tsx`
  - Add `viewMode: 'relations' | 'keywords'`.
  - Add segmented view control.
  - Keep current relation graph path unchanged as much as possible.
  - Render keyword-cluster components only in keyword mode.
- `src/db/note-topics.ts`
  - Optional helper: `getTopicsForFilenames(filenames)` if full-table filtering becomes a bottleneck.

Avoid:

- New dependencies.
- LLM calls in the default flow.
- Replacing the existing relation graph behavior.

## Testing And Verification

Data tests:

- Given small mocked topic sets, cluster output is deterministic.
- Deleted files are filtered out.
- Isolated keywords are handled correctly.
- Oversized and tiny clusters normalize into the target cluster range.
- Cluster names are stable and based on high-signal keywords.

UI smoke checks:

- Knowledge Graph opens in `关系图谱` by default.
- Switching to `关键词聚类` renders without errors.
- Empty topic data shows the empty state.
- Cluster click opens the cluster detail panel.
- Keyword click opens the keyword detail panel.
- Article click opens the target note.

Regression checks:

- Existing relation graph zoom, reset, detail panel, and locate-node behavior still work.
- Existing keyword extraction after Markdown save is unchanged.
- Existing settings and tag-group behavior are not broken.

Performance target:

- 500 notes with 20 keywords per note should remain responsive.
- Co-occurrence work should be bounded by per-note top-K keywords, not all keyword pairs globally.

## Iteration Plan

1. Build and test pure cluster data utilities.
2. Add the view switcher and keyword-cluster canvas.
3. Add cluster and keyword detail panel.
4. Tune collision, colors, labels, and empty states.
5. Later: add optional vector-assisted clustering.
6. Later: add optional AI cluster-name refinement.

## Open Risks

- Existing notes may not all have `note_topics` rows if they have not been saved since topic extraction was introduced.
- TextRank keyword quality may vary across short notes.
- Very large workspaces may need cached cluster results.
- Chinese and English mixed keywords may need normalization rules after real-world testing.
