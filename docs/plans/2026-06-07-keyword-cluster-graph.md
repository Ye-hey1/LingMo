# Keyword Cluster Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `关键词聚类` view inside the existing Knowledge Graph tab using the local `note_topics` keyword index.

**Architecture:** Keep the current relation graph as the default mode and add a second keyword-cluster mode. Put clustering in a pure utility module, render the topology in a dedicated canvas component, and use a separate detail panel for cluster/keyword drill-down. Do not add dependencies, vector clustering, or LLM naming in the first version.

**Tech Stack:** Next.js client components, React, TypeScript, Zustand stores, Tauri SQLite helpers, existing canvas rendering patterns, existing `note_topics` keyword data.

---

## Pre-Implementation Checks

Before starting code changes:

- Read `docs/plans/2026-06-07-keyword-cluster-graph-design.md`.
- Read `src/app/core/main/knowledge/knowledge-graph.tsx`.
- Read `src/app/core/main/knowledge/detail-panel.tsx`.
- Read `src/db/note-topics.ts`.
- Read `src/stores/article.ts` around `scheduleTopicExtraction`.
- Run `git status --short` and do not touch unrelated dirty files.

---

### Task 1: Add Pure Keyword Cluster Data Builder

**Files:**

- Create: `src/app/core/main/knowledge/keyword-cluster-data.ts`
- Create: `src/app/core/main/knowledge/keyword-cluster-data.spec.mjs`

**Step 1: Write the failing test**

Create `src/app/core/main/knowledge/keyword-cluster-data.spec.mjs` with Node's built-in test runner. Import the utility from the compiled-adjacent JS bridge only if the project already uses that pattern; otherwise write the test as an executable spec that can be adapted to the project's TypeScript test flow.

Minimum test cases:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildKeywordClusterGraph,
  collectMarkdownFilePaths,
} from './keyword-cluster-data.js'

const fileTree = [
  { name: 'AI.md', isFile: true, isDirectory: false },
  { name: 'Product.md', isFile: true, isDirectory: false },
  { name: 'Archive', isFile: false, isDirectory: true, children: [
    { name: 'Old.md', isFile: true, isDirectory: false },
  ] },
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
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/app/core/main/knowledge/keyword-cluster-data.spec.mjs
```

Expected: FAIL because `keyword-cluster-data.js` or exported functions do not exist yet.

**Step 3: Write minimal implementation**

Create `src/app/core/main/knowledge/keyword-cluster-data.ts`.

Export these types and functions:

```ts
export interface KeywordClusterOptions {
  topKeywordsPerNote: number
  minKeywordNoteCount: number
  maxClusters: number
  maxKeywordsPerCluster: number
  includeIsolated: boolean
}

export interface KeywordClusterGraph {
  clusters: KeywordCluster[]
  keywordNodes: KeywordClusterKeyword[]
  edges: KeywordClusterEdge[]
  keywordIndex: Map<string, KeywordClusterKeyword>
  noteIndex: Map<string, KeywordClusterNoteRef>
}

export function collectMarkdownFilePaths(fileTree: DirTree[], prefix = ''): Set<string>
export function buildKeywordClusterGraph(topics: NoteTopic[], fileTree: DirTree[], options?: Partial<KeywordClusterOptions>): KeywordClusterGraph
```

Implementation notes:

- Reuse the existing `DirTree` type from `src/stores/article.ts`.
- Filter to `.md` and `.markdown` files.
- Normalize keyword text with `trim()` and lower-case only for comparison, not display.
- Group topics by note and keyword.
- For each note, keep top `topKeywordsPerNote`.
- Build co-occurrence edge weights only within each note's top keywords.
- Build connected components from co-occurrence edges.
- Create an isolated fallback cluster named `零散主题` when needed.
- Produce deterministic IDs:
  - Cluster: `cluster-${index}-${slug}`
  - Keyword: `keyword-${normalizedKeyword}`
- Assign initial layout coordinates in this module only as stable graph coordinates; rendering can later scale/pan them.

**Step 4: Add a temporary JS bridge only if needed**

If the project's Node spec cannot import `.ts` directly, create a tiny `keyword-cluster-data.js` using the same approach as existing `.mjs` specs in the repo, or adjust the test to use the project's available TypeScript runner. Do not introduce a new dependency.

**Step 5: Run test to verify it passes**

Run:

```bash
node --test src/app/core/main/knowledge/keyword-cluster-data.spec.mjs
```

Expected: PASS.

**Step 6: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS or only unrelated pre-existing failures. Record any unrelated failures before continuing.

**Step 7: Commit**

```bash
git add src/app/core/main/knowledge/keyword-cluster-data.ts src/app/core/main/knowledge/keyword-cluster-data.spec.mjs
git commit -m "Build local keyword cluster graph data"
```

Use the repository Lore commit trailer format.

---

### Task 2: Add Keyword Cluster Canvas Component

**Files:**

- Create: `src/app/core/main/knowledge/keyword-cluster-canvas.tsx`
- Modify: `src/app/core/main/knowledge/keyword-cluster-data.ts`

**Step 1: Write the component skeleton**

Create `KeywordClusterCanvas` with props:

```ts
interface KeywordClusterCanvasProps {
  graph: KeywordClusterGraph
  selectedId: string | null
  onSelect: (selection: KeywordClusterSelection | null) => void
  onOpenNote: (path: string) => void
  showLabels: boolean
}
```

Add selection type to `keyword-cluster-data.ts`:

```ts
export type KeywordClusterSelection =
  | { type: 'cluster'; id: string }
  | { type: 'keyword'; id: string }
```

**Step 2: Implement canvas rendering**

Follow existing canvas patterns from `knowledge-graph.tsx`:

- Use `useRef<HTMLCanvasElement>(null)`.
- Scale by `window.devicePixelRatio`.
- Clear canvas every frame.
- Draw cluster-to-keyword edges first.
- Draw clusters as colored rings with centered labels.
- Draw keywords as small points with optional labels.
- Draw selected or hovered cluster with stronger opacity.

**Step 3: Implement hit testing**

Implement pointer-to-world conversion and nearest node hit testing:

- Cluster hit radius: `cluster.radius + 8`.
- Keyword hit radius: `Math.max(keyword.radius + 6, 10)`.
- Prefer keyword hit over cluster hit if both match.

**Step 4: Implement pan and zoom**

Support:

- Mouse wheel zoom around pointer.
- Drag pan when not dragging a node.
- Double-click reset can be added later; first version can expose reset from parent.

Do not copy the full relation graph physics simulation. This view is deterministic and static after layout.

**Step 5: Manual smoke check in code**

Temporarily render the component from a small mock graph in isolation only if needed for debugging, then remove the mock before committing.

**Step 6: Run checks**

Run:

```bash
pnpm typecheck
```

Expected: PASS or only documented unrelated failures.

**Step 7: Commit**

```bash
git add src/app/core/main/knowledge/keyword-cluster-canvas.tsx src/app/core/main/knowledge/keyword-cluster-data.ts
git commit -m "Render keyword cluster topology canvas"
```

Use Lore commit trailers.

---

### Task 3: Add Keyword Cluster Detail Panel

**Files:**

- Create: `src/app/core/main/knowledge/keyword-cluster-detail-panel.tsx`
- Modify: `src/app/core/main/knowledge/keyword-cluster-data.ts`

**Step 1: Define detail helpers**

Add helpers in `keyword-cluster-data.ts`:

```ts
export function getClusterDetail(graph: KeywordClusterGraph, clusterId: string): KeywordCluster | null
export function getKeywordDetail(graph: KeywordClusterGraph, keywordId: string): KeywordClusterKeyword | null
export function getNotesForCluster(graph: KeywordClusterGraph, clusterId: string): KeywordClusterNoteRef[]
export function getNotesForKeyword(graph: KeywordClusterGraph, keywordId: string): KeywordClusterNoteRef[]
```

**Step 2: Create panel component**

Props:

```ts
interface KeywordClusterDetailPanelProps {
  graph: KeywordClusterGraph
  selection: KeywordClusterSelection | null
  onClose: () => void
  onOpenNote: (path: string) => void
  onLocateInRelationGraph: (path: string) => void
}
```

UI requirements:

- Match the existing right detail panel width and border style.
- Cluster view: title, note count, top keywords, note list.
- Keyword view: keyword, note count, total weight, average weight, co-occurring keywords, note list.
- Note rows show note label, matching keywords, and score.
- Use lucide icons where useful, such as `Hash`, `FileText`, `Network`, `X`.

**Step 3: Add empty selection state**

If `selection` is null, show a small hint panel or keep panel closed in the parent. Prefer keeping it closed until selection exists.

**Step 4: Run checks**

Run:

```bash
pnpm typecheck
```

Expected: PASS or only documented unrelated failures.

**Step 5: Commit**

```bash
git add src/app/core/main/knowledge/keyword-cluster-detail-panel.tsx src/app/core/main/knowledge/keyword-cluster-data.ts
git commit -m "Add keyword cluster detail panel"
```

Use Lore commit trailers.

---

### Task 4: Integrate View Mode Into Knowledge Graph Page

**Files:**

- Modify: `src/app/core/main/knowledge/knowledge-graph.tsx`
- Modify: `src/app/core/main/knowledge/knowledge-graph-constants.ts` only if a new constant is needed

**Step 1: Add view-mode state**

In `KnowledgeGraph`, add:

```ts
type KnowledgeGraphViewMode = 'relations' | 'keywords'
const [viewMode, setViewMode] = useState<KnowledgeGraphViewMode>('relations')
```

Keep relation graph as default.

**Step 2: Add segmented control**

Place a compact segmented control near existing graph toolbar controls:

```tsx
<div className="...">
  <button onClick={() => setViewMode('relations')}>关系图谱</button>
  <button onClick={() => setViewMode('keywords')}>关键词聚类</button>
</div>
```

Use existing visual language: small height, muted border, active foreground/background contrast.

**Step 3: Load keyword topics**

When `viewMode === 'keywords'`, load topics with:

```ts
const { getAllTopics } = await import('@/db/note-topics')
```

Store in local state:

```ts
const [keywordTopics, setKeywordTopics] = useState<NoteTopic[]>([])
const [keywordTopicsLoading, setKeywordTopicsLoading] = useState(false)
```

Reload when entering keyword mode and when `fileTree` changes.

**Step 4: Build keyword graph**

Use `useMemo`:

```ts
const keywordClusterGraph = useMemo(
  () => buildKeywordClusterGraph(keywordTopics, fileTree, keywordSettings),
  [keywordTopics, fileTree, keywordSettings],
)
```

Add first-version settings local to `knowledge-graph.tsx`:

```ts
const [keywordSettings, setKeywordSettings] = useState({
  topKeywordsPerNote: 12,
  minKeywordNoteCount: 1,
  maxClusters: 14,
  maxKeywordsPerCluster: 30,
  includeIsolated: true,
  showLabels: true,
})
```

**Step 5: Render by mode**

When `viewMode === 'relations'`, render the existing relation canvas and relation detail panel unchanged.

When `viewMode === 'keywords'`, render:

```tsx
<KeywordClusterCanvas
  graph={keywordClusterGraph}
  selectedId={keywordSelection ? keywordSelection.id : null}
  onSelect={setKeywordSelection}
  onOpenNote={handleOpenInEditor}
  showLabels={keywordSettings.showLabels}
/>
```

Render `KeywordClusterDetailPanel` when `keywordSelection` exists.

**Step 6: Implement relation-graph locate handoff**

In `onLocateInRelationGraph(path)`:

- `setViewMode('relations')`
- `setActiveFilePath(path)` only if this matches current graph behavior
- emit `graph-locate-node` after the relation graph has rendered:

```ts
requestAnimationFrame(() => {
  emitter.emit('graph-locate-node' as any, { path })
})
```

**Step 7: Run checks**

Run:

```bash
pnpm typecheck
```

Expected: PASS or only documented unrelated failures.

**Step 8: Commit**

```bash
git add src/app/core/main/knowledge/knowledge-graph.tsx
git commit -m "Add keyword cluster mode to knowledge graph"
```

Use Lore commit trailers.

---

### Task 5: Add Keyword Cluster Settings And Empty State

**Files:**

- Modify: `src/app/core/main/knowledge/knowledge-graph.tsx`
- Modify: `src/app/core/main/knowledge/keyword-cluster-canvas.tsx` if empty state is owned by canvas

**Step 1: Add keyword-specific settings section**

When `viewMode === 'keywords'`, the existing settings panel should show keyword-cluster settings instead of relation edge toggles:

- `最小文章数`
- `每簇关键词数`
- `主题数量上限`
- `显示零散主题`
- `显示关键词标签`

Reuse existing `ToggleRow` and `RangeRow` patterns in `knowledge-graph.tsx`.

**Step 2: Add empty state**

If not loading and `keywordClusterGraph.keywordNodes.length === 0`, render an empty state:

```text
还没有关键词索引
保存 Markdown 笔记后，LingMo 会自动提取关键词并用于聚类视图。
```

Do not add a full-workspace regeneration button in this first version unless an existing safe command already exists.

**Step 3: Preserve relation graph empty state**

Ensure the existing relation graph empty state still appears only in relation mode.

**Step 4: Run checks**

Run:

```bash
pnpm typecheck
```

Expected: PASS or only documented unrelated failures.

**Step 5: Commit**

```bash
git add src/app/core/main/knowledge/knowledge-graph.tsx src/app/core/main/knowledge/keyword-cluster-canvas.tsx
git commit -m "Tune keyword cluster graph controls"
```

Use Lore commit trailers.

---

### Task 6: Visual QA And Regression Verification

**Files:**

- Modify only files needed to fix issues found during verification.

**Step 1: Start dev server**

Run:

```bash
pnpm dev
```

Expected: Next dev server starts on the configured port.

**Step 2: Open the app**

Use the Codex in-app Browser plugin to open the local app URL. If the app requires the Tauri shell for file APIs, use the app's existing development launch command instead:

```bash
pnpm dev:launch
```

**Step 3: Verify relation mode**

Checklist:

- Knowledge Graph opens.
- Default mode is `关系图谱`.
- Existing nodes and edges render.
- Zoom and reset still work.
- Existing note detail panel still works.

**Step 4: Verify keyword mode**

Checklist:

- Switch to `关键词聚类`.
- If topics exist, clusters and keywords render.
- If topics do not exist, empty state renders.
- Hover highlights a cluster or keyword.
- Click cluster opens cluster detail.
- Click keyword opens keyword detail.
- Click article opens the note.
- Locate in relation graph switches back and focuses the note.

**Step 5: Run final checks**

Run:

```bash
pnpm typecheck
pnpm lint
node --test src/app/core/main/knowledge/keyword-cluster-data.spec.mjs
```

Expected: PASS or documented unrelated pre-existing failures.

**Step 6: Final commit if fixes were needed**

```bash
git add <changed-files>
git commit -m "Verify keyword cluster graph integration"
```

Use Lore commit trailers.

---

## Done Criteria

- The approved design remains implemented as a second view, not a replacement for the existing graph.
- No new dependencies are added.
- The first version uses `note_topics` only.
- The relation graph default path is preserved.
- Keyword clusters are traceable to notes.
- Data utility tests pass.
- Typecheck passes or unrelated failures are documented.
- Manual browser/app smoke checks are completed.
