# AI Hotspots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a native LingMo `AI 热点` workspace that auto-refreshes AI news on open, supports manual refresh, filters and caches multi-source items, and lets users save valuable items or digests as Markdown notes.

**Architecture:** Add a cache-first feature slice: pure `src/lib/ai-hotspots` utilities and fetchers feed a SQLite-backed `src/db/ai-hotspots.ts` layer, which is exposed through `src/stores/ai-hotspots.ts` and rendered in a new `lingmo://ai-hotspots` editor workspace. The refresh chain must use rule-based filtering by default; model-heavy research is only triggered by explicit user actions.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand, Tauri v2 plugin HTTP/FS/SQL/Store, SQLite, existing LingMo UI primitives, lucide-react.

---

## Implementation Notes

- Keep the first implementation native to LingMo. Do not embed the `ai-news-aggregator/web` Vite app.
- Avoid new dependencies unless a later task explicitly approves them. Use existing browser/Tauri APIs and small local helpers.
- The feature should render cached data before network refresh finishes.
- A failed source must not fail the whole refresh.
- Do not use AI calls in the default refresh pipeline.
- Prefer pure functions for normalization, filtering, scoring, and digest building so they can be tested with Node scripts.

## Task 1: Add Pure Core Tests

**Files:**
- Create: `scripts/ai-hotspots-core-tests.mjs`
- Create later in Task 2: `src/lib/ai-hotspots/rules.ts`
- Create later in Task 2: `src/lib/ai-hotspots/normalize.ts`
- Create later in Task 2: `src/lib/ai-hotspots/digest.ts`
- Modify later in Task 12: `package.json`

**Step 1: Create the failing test script**

Create `scripts/ai-hotspots-core-tests.mjs` based on the local TypeScript transpile pattern used by `scripts/github-star-agent-service-tests.mjs`.

The test cases must cover:

```js
assert.equal(normalizeHotspotUrl('https://example.com/a?utm_source=x#top'), 'https://example.com/a')
assert.equal(normalizeHotspotTitle('  GPT-5  发布！ '), 'gpt5发布')
assert.equal(isAiHotspotRelated({ siteId: 'aihot', title: 'anything', source: '', siteName: '', url: '' }), true)
assert.equal(isAiHotspotRelated({ siteId: 'news', title: 'OpenAI releases new agent model', source: '', siteName: '', url: '' }), true)
assert.equal(isAiHotspotRelated({ siteId: 'news', title: '明星八卦和足球彩票', source: '', siteName: '', url: '' }), false)
assert.deepEqual(dedupeHotspotItems([
  item({ id: 'old', title: 'OpenAI update', url: 'https://x.com/a', publishedAt: '2026-06-08T00:00:00.000Z' }),
  item({ id: 'new', title: 'OpenAI update', url: 'https://x.com/a?utm_source=rss', publishedAt: '2026-06-09T00:00:00.000Z' }),
]).map(item => item.id), ['new'])
assert.deepEqual(classifyHotspotTags('OpenAI 发布新模型和 Agent SDK'), ['模型发布', '开发工具'])
assert.equal(buildHotspotDigestMarkdown({
  date: '2026-06-09',
  title: 'AI 热点日报',
  items: [item({ title: 'OpenAI 发布新模型', url: 'https://openai.com/news', sourceName: 'OpenAI' })],
}).includes('[OpenAI 发布新模型](https://openai.com/news)'), true)
```

**Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/ai-hotspots-core-tests.mjs
```

Expected: FAIL because `src/lib/ai-hotspots/*` modules do not exist.

**Step 3: Commit only the failing test**

```bash
git add scripts/ai-hotspots-core-tests.mjs
git commit -m "Test why AI hotspots core rules need contracts" \
  -m "Constraint: Add tests before implementation for the pure normalization, filtering, dedupe, tagging, and digest logic
Confidence: high
Scope-risk: narrow
Tested: node scripts/ai-hotspots-core-tests.mjs fails because implementation modules are missing"
```

## Task 2: Implement Pure Core Utilities

**Files:**
- Create: `src/lib/ai-hotspots/types.ts`
- Create: `src/lib/ai-hotspots/config.ts`
- Create: `src/lib/ai-hotspots/normalize.ts`
- Create: `src/lib/ai-hotspots/rules.ts`
- Create: `src/lib/ai-hotspots/digest.ts`
- Create: `src/lib/ai-hotspots/index.ts`

**Step 1: Add shared types**

Create `src/lib/ai-hotspots/types.ts`:

```ts
export type AiHotspotTimeRange = '24h' | '7d'
export type AiHotspotView = 'latest' | 'favorites' | 'digest' | 'sources'
export type AiHotspotSourceKind = 'default' | 'rss' | 'opml'

export interface AiHotspotRawItem {
  sourceId: string
  sourceName: string
  feedName: string
  title: string
  url: string
  publishedAt: Date | null
  meta: Record<string, unknown>
}

export interface AiHotspotItem {
  id: string
  sourceId: string
  sourceName: string
  feedName: string
  title: string
  titleOriginal: string | null
  titleEn: string | null
  titleZh: string | null
  url: string
  publishedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  summary: string | null
  tags: string[]
  score: number
  isFavorite: boolean
  isRead: boolean
  savedNotePath: string | null
}

export interface AiHotspotSourceStatus {
  sourceId: string
  sourceName: string
  kind: AiHotspotSourceKind
  enabled: boolean
  ok: boolean
  itemCount: number
  durationMs: number
  lastOkAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface AiHotspotUserFeed {
  id: string
  title: string
  feedUrl: string
  groupName: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AiHotspotFilters {
  query: string
  timeRange: AiHotspotTimeRange
  sourceId: string
  status: 'all' | 'unread' | 'favorite' | 'saved'
}
```

**Step 2: Add config**

Create `src/lib/ai-hotspots/config.ts` with keyword lists adapted from `ai-news-aggregator`, keeping them small enough for first release:

```ts
export const AI_HOTSPOT_CONFIG = {
  refresh: {
    defaultCooldownMinutes: 30,
    archiveDays: 20,
    defaultTranslateMaxNew: 80,
  },
  http: {
    timeoutMs: 45000,
    retries: 2,
    retryDelayMs: 800,
    userAgent: 'Mozilla/5.0 (LingMo AI Hotspots)',
  },
  rss: {
    maxConcurrency: 8,
  },
  filter: {
    aiKeywords: ['aigc', 'llm', 'gpt', 'claude', 'gemini', 'deepseek', 'openai', 'anthropic', 'hugging face', 'transformer', 'prompt', 'diffusion', 'agent', '多模态', '大模型', '人工智能', '机器学习', '深度学习', '智能体', '算力', '推理', '微调'],
    techKeywords: ['robot', 'robotics', 'embodied', 'vision', 'chip', 'gpu', 'cuda', 'developer', 'open source', '开源', '技术', '编程', '芯片', '机器人', '具身'],
    noiseKeywords: ['娱乐', '明星', '八卦', '足球', '篮球', '彩票', '旅游', '美食'],
    commerceNoiseKeywords: ['淘宝', '天猫', '京东', '拼多多', '促销', '优惠', '补贴', '下单'],
    trustedAiSourceIds: ['aihot', 'aibase', 'aihubtoday'],
    enSignalPattern: /(?<![a-z0-9])(ai|aigc|llm|gpt|openai|anthropic|deepseek|gemini|claude|robot|robotics|machine learning|artificial intelligence|transformer|diffusion|agent)(?![a-z0-9])/i,
  },
}
```

**Step 3: Add normalization and rules**

Create `normalize.ts` with:

- `normalizeHotspotUrl(url: string): string`
- `normalizeHotspotTitle(title: string): string`
- `createHotspotId(sourceId: string, feedName: string, title: string, url: string): string`
- `toIsoString(date: Date | null): string | null`

Create `rules.ts` with:

- `isAiHotspotRelated(record)`
- `dedupeHotspotItems(items)`
- `classifyHotspotTags(text)`
- `scoreHotspotItem(item)`
- `filterHotspotsByWindow(items, timeRange, now)`

Use `crypto.subtle.digest` only if available. For simpler browser and test compatibility, a deterministic string hash is enough:

```ts
export function hashString(input: string) {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
```

**Step 4: Add digest builder**

Create `digest.ts`:

```ts
export function buildHotspotDigestMarkdown(params: {
  date: string
  title: string
  items: Array<Pick<AiHotspotItem, 'title' | 'url' | 'sourceName' | 'publishedAt' | 'tags'>>
}) {
  const grouped = groupItemsByPrimaryTag(params.items)
  return [
    `# ${params.title} ${params.date}`,
    '',
    '## 速览',
    '',
    ...params.items.slice(0, 5).map(item => `- [${item.title}](${item.url}) - ${item.sourceName}`),
    '',
    ...Object.entries(grouped).flatMap(([tag, items]) => [
      `## ${tag}`,
      '',
      ...items.map(item => `- [${item.title}](${item.url}) - ${item.sourceName}`),
      '',
    ]),
    '## 来源',
    '',
    ...params.items.map(item => `- [${item.title}](${item.url}) - ${item.sourceName}`),
    '',
  ].join('\n')
}
```

**Step 5: Run tests**

Run:

```bash
node scripts/ai-hotspots-core-tests.mjs
pnpm typecheck
```

Expected: core tests PASS; typecheck has no new AI hotspot errors.

**Step 6: Commit**

```bash
git add src/lib/ai-hotspots scripts/ai-hotspots-core-tests.mjs
git commit -m "Build the rule core for AI hotspot triage" \
  -m "Constraint: Default refresh must stay fast and avoid model calls
Rejected: Model-scoring every item | It would make routine refresh slow and costly
Confidence: high
Scope-risk: narrow
Tested: node scripts/ai-hotspots-core-tests.mjs; pnpm typecheck"
```

## Task 3: Add SQLite Data Layer

**Files:**
- Create: `src/db/ai-hotspots.ts`
- Modify: `src/db/index.ts`

**Step 1: Implement database init**

Create `initAiHotspotsDb()` with four tables:

- `ai_hotspot_items`
- `ai_hotspot_sources`
- `ai_hotspot_user_feeds`
- `ai_hotspot_snapshots`

Include indexes:

```sql
create index if not exists idx_ai_hotspot_items_published_at on ai_hotspot_items(published_at desc);
create index if not exists idx_ai_hotspot_items_last_seen_at on ai_hotspot_items(last_seen_at desc);
create index if not exists idx_ai_hotspot_items_source on ai_hotspot_items(source_id);
create index if not exists idx_ai_hotspot_items_favorite on ai_hotspot_items(is_favorite);
```

**Step 2: Add row mappers**

Add row types and mappers:

- `mapItemRow(row): AiHotspotItem`
- `mapSourceRow(row): AiHotspotSourceStatus`
- `mapFeedRow(row): AiHotspotUserFeed`
- `stringifyArray(value: string[])`
- `parseArray(value)`

Use the same JSON parse pattern as `src/db/github-stars.ts`.

**Step 3: Add CRUD functions**

Implement:

- `getAiHotspotItems()`
- `upsertAiHotspotItems(items: AiHotspotItem[])`
- `getAiHotspotSourceStatuses()`
- `upsertAiHotspotSourceStatuses(statuses: AiHotspotSourceStatus[])`
- `insertAiHotspotSnapshot(snapshot)`
- `getAiHotspotUserFeeds()`
- `addAiHotspotUserFeed(input)`
- `updateAiHotspotUserFeed(id, patch)`
- `deleteAiHotspotUserFeed(id)`
- `setAiHotspotFavorite(id, favorite)`
- `setAiHotspotRead(id, read)`
- `setAiHotspotSavedNotePath(id, path)`
- `pruneAiHotspotItems(keepAfterIso)`

All writes must use `serializedWrite`.

**Step 4: Register DB init**

Modify `src/db/index.ts`:

```ts
const { initAiHotspotsDb } = await import('./ai-hotspots')
...
await initAiHotspotsDb()
```

**Step 5: Verify**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/db/ai-hotspots.ts src/db/index.ts
git commit -m "Persist AI hotspots as first-class local data" \
  -m "Constraint: LingMo stores local feature state in SQLite
Rejected: JSON-only snapshots | They would make favorites, read state, and note paths awkward
Confidence: medium
Scope-risk: moderate
Tested: pnpm typecheck"
```

## Task 4: Add HTTP, RSS, OPML, and Default Fetchers

**Files:**
- Create: `src/lib/ai-hotspots/http.ts`
- Create: `src/lib/ai-hotspots/rss.ts`
- Create: `src/lib/ai-hotspots/fetchers/base.ts`
- Create: `src/lib/ai-hotspots/fetchers/aihot.ts`
- Create: `src/lib/ai-hotspots/fetchers/newsnow.ts`
- Create: `src/lib/ai-hotspots/fetchers/youtube.ts`
- Create: `src/lib/ai-hotspots/fetchers/default-rss.ts`
- Create: `src/lib/ai-hotspots/fetchers/user-rss.ts`
- Create: `src/lib/ai-hotspots/fetchers/index.ts`

**Step 1: Add HTTP helper**

Use `@tauri-apps/plugin-http` fetch first. Fall back to global `fetch` only when the plugin call fails in web dev mode.

Functions:

- `fetchHotspotText(url, options)`
- `fetchHotspotJson<T>(url, options)`
- `fetchHotspotWithRetry(url, options)`

Add timeout with `AbortController` and retry only transient statuses: `429`, `500`, `502`, `503`, `504`.

**Step 2: Add simple XML helpers**

Create `rss.ts` with:

- `decodeXmlEntities(text)`
- `extractXmlTag(block, tagName)`
- `parseRssItems(xml, source)`
- `parseOpmlFeeds(opmlContent)`

Keep the parser intentionally small. It only needs RSS/Atom title, link, pubDate/published/updated, and OPML outline `xmlUrl`/`title`.

**Step 3: Add fetcher base**

```ts
export interface AiHotspotFetcher {
  sourceId: string
  sourceName: string
  kind: AiHotspotSourceKind
  fetch(now: Date): Promise<AiHotspotRawItem[]>
}

export async function runAiHotspotFetcher(fetcher: AiHotspotFetcher, now: Date) {
  const startedAt = performance.now()
  try {
    const items = await fetcher.fetch(now)
    return { items, status: successStatus(fetcher, items.length, startedAt) }
  } catch (error) {
    return { items: [], status: failureStatus(fetcher, error, startedAt) }
  }
}
```

**Step 4: Implement stable default sources**

First implementation should include at least four sources:

- `AiHotFetcher`: port the regex/Next payload extraction approach from `ai-news-aggregator/src/fetchers/aihot.ts`.
- `NewsNowFetcher`: port the API endpoint approach from `ai-news-aggregator/src/fetchers/newsnow.ts`, using regex to locate the bundle script instead of Cheerio.
- `YouTubeFetcher`: port the YouTube RSS parser for the existing three channels.
- `DefaultRssFetcher`: include a small default RSS list such as OpenAI blog, Anthropic news, Google DeepMind blog, Hugging Face blog, and DeepLearning.AI.

Keep `AIbase` and `AIHubToday` as follow-up fetchers if the first four are enough to satisfy the first release.

**Step 5: Implement user RSS fetcher**

`UserRssFetcher` receives enabled `AiHotspotUserFeed[]` from the store/service and fetches them with concurrency limit `AI_HOTSPOT_CONFIG.rss.maxConcurrency`.

**Step 6: Verify**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

Manual smoke in dev console later should confirm each source returns statuses, but do not block this task on external network.

**Step 7: Commit**

```bash
git add src/lib/ai-hotspots
git commit -m "Fetch AI hotspots through isolated source adapters" \
  -m "Constraint: External sources are unstable and must fail independently
Rejected: One monolithic scraper | A single failure would hide usable sources
Confidence: medium
Scope-risk: moderate
Tested: pnpm typecheck
Not-tested: Live source smoke deferred to workspace integration"
```

## Task 5: Add Refresh Service

**Files:**
- Create: `src/lib/ai-hotspots/service.ts`
- Modify: `src/lib/ai-hotspots/index.ts`

**Step 1: Implement raw-to-item conversion**

Add:

- `rawItemToHotspotItem(raw, now, existing?)`
- `mergeHotspotItems(existingItems, rawItems, now)`

Preserve local fields from existing rows:

- `isFavorite`
- `isRead`
- `savedNotePath`
- `summary`

**Step 2: Implement refresh**

```ts
export async function refreshAiHotspots(options: {
  includeUserFeeds?: boolean
  signal?: AbortSignal
} = {}): Promise<AiHotspotRefreshResult>
```

Flow:

1. `initAiHotspotsDb()`.
2. Load current items and user feeds.
3. Build default fetchers and user RSS fetcher.
4. Run all fetchers with a small concurrency limit.
5. Normalize, filter, dedupe, tag, score.
6. Upsert items.
7. Upsert source statuses.
8. Insert snapshot.
9. Prune old items.
10. Return `{ items, statuses, snapshot }`.

**Step 3: Add refresh cooldown helper**

Add:

```ts
export function shouldAutoRefreshAiHotspots(params: {
  autoRefreshOnOpen: boolean
  lastRefreshAt: string | null
  cooldownMinutes: number
  now?: Date
})
```

**Step 4: Verify**

Run:

```bash
pnpm typecheck
node scripts/ai-hotspots-core-tests.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/ai-hotspots
git commit -m "Orchestrate AI hotspot refresh into the local cache" \
  -m "Constraint: The UI must render cached data while refresh runs in the background
Rejected: Direct fetches from React components | They would duplicate persistence and failure handling
Confidence: medium
Scope-risk: moderate
Tested: node scripts/ai-hotspots-core-tests.mjs; pnpm typecheck"
```

## Task 6: Add Zustand Store

**Files:**
- Create: `src/stores/ai-hotspots.ts`

**Step 1: Implement state**

State must include:

- `view`
- `items`
- `filteredItems`
- `sources`
- `userFeeds`
- `filters`
- `isLoading`
- `isRefreshing`
- `lastRefreshAt`
- `error`
- `refreshProgress`

Actions:

- `load()`
- `refresh(options?: { force?: boolean })`
- `setView(view)`
- `setFilters(partial)`
- `toggleFavorite(id)`
- `markRead(id, read)`
- `saveItemAsNote(id)`
- `generateDigest(scope)`
- `addUserFeed(input)`
- `updateUserFeed(id, patch)`
- `deleteUserFeed(id)`

**Step 2: Persist settings in Tauri Store**

Use `Store.load('store.json')` and keys:

- `aiHotspotsAutoRefreshOnOpen`
- `aiHotspotsRefreshCooldownMinutes`
- `aiHotspotsDefaultTimeRange`
- `aiHotspotsTranslateTitles`
- `aiHotspotsTranslateMaxNew`

**Step 3: Implement derived filtering**

Filter by:

- time range
- source
- status
- query

Sort by:

- score desc for same day
- published time desc as primary fallback

**Step 4: Verify**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/stores/ai-hotspots.ts
git commit -m "Expose AI hotspot cache through a workspace store" \
  -m "Constraint: LingMo feature workspaces use Zustand for view state and async actions
Rejected: Keeping state inside the page component | It would make refresh, settings, and note generation hard to reuse
Confidence: medium
Scope-risk: moderate
Tested: pnpm typecheck"
```

## Task 7: Add Workspace Entry and Virtual Tab

**Files:**
- Create: `src/app/core/main/ai-hotspots/ai-hotspots-constants.ts`
- Create: `src/app/core/main/ai-hotspots/ai-hotspots-workspace.tsx`
- Modify: `src/app/core/main/left-sidebar.tsx`
- Modify: `src/app/core/main/editor/editor-layout.tsx`

**Step 1: Add constants**

```ts
export const AI_HOTSPOTS_TAB_ID = 'workspace-ai-hotspots'
export const AI_HOTSPOTS_TAB_PATH = 'lingmo://ai-hotspots'
export const AI_HOTSPOTS_TAB_NAME = 'AI 热点'

export function isAiHotspotsTabPath(path: string) {
  return path === AI_HOTSPOTS_TAB_PATH
}
```

**Step 2: Add placeholder workspace**

Create `AiHotspotsWorkspace` with header, refresh button, and an empty list placeholder wired to `useAiHotspotsStore().load()`.

**Step 3: Add rail button**

Modify `left-sidebar.tsx`:

- Import a lucide icon such as `Radar` or `Newspaper`.
- Import constants.
- Add `openAiHotspots()` using `setActiveFilePath(AI_HOTSPOTS_TAB_PATH)`.
- Add a `SidebarRailButton` near GitHub 管理.

**Step 4: Add editor routing**

Modify `editor-layout.tsx`:

- Import constants.
- Dynamic import workspace.
- Extend `getItemType` with `'aiHotspots'`.
- Add persistent tab behavior.
- Add tab creation name/id.
- Render `AiHotspotsWorkspace`.
- Treat AI hotspots tab as valid during cleanup.

**Step 5: Verify**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/app/core/main/ai-hotspots src/app/core/main/left-sidebar.tsx src/app/core/main/editor/editor-layout.tsx
git commit -m "Open AI hotspots as a native LingMo workspace" \
  -m "Constraint: The feature must feel native rather than embedded
Rejected: Separate route or iframe | It would bypass the existing virtual tab model
Confidence: high
Scope-risk: moderate
Tested: pnpm typecheck"
```

## Task 8: Build Feed UI

**Files:**
- Modify: `src/app/core/main/ai-hotspots/ai-hotspots-workspace.tsx`
- Create: `src/app/core/main/ai-hotspots/hotspot-filter-bar.tsx`
- Create: `src/app/core/main/ai-hotspots/hotspot-list.tsx`
- Create: `src/app/core/main/ai-hotspots/hotspot-item.tsx`
- Create: `src/app/core/main/ai-hotspots/hotspot-utils.ts`

**Step 1: Implement header**

Header should include:

- Icon and `AI 热点`.
- View pills: `最新`, `收藏`, `日报`, `来源`.
- Last refresh text.
- Refresh button with spinner.
- Settings button.

**Step 2: Implement filter bar**

Use existing `Button`, `Input`, `Select`, `Tabs` or compact custom pills. Keep height tight.

Controls:

- time range `24h` / `7d`
- source select
- status select
- search input
- clear filters button

**Step 3: Implement list and item**

`HotspotItem` props:

```ts
{
  item: AiHotspotItem
  onToggleFavorite(id: string): void
  onMarkRead(id: string, read: boolean): void
  onSaveAsNote(id: string): void
  onSendToChat(id: string): void
  onDeepDive(id: string): void
}
```

Actions:

- external link
- favorite
- read/unread
- send to chat
- save note
- deep dive

Use lucide icons, icon buttons, and tooltips.

**Step 4: Add empty and loading states**

States:

- first load
- no cached data
- no matches after filters
- refreshing with cached data
- all sources failed but cache available

**Step 5: Verify visually**

Run:

```bash
pnpm dev
```

Open LingMo dev target and click `AI 热点`.

Expected:

- Workspace opens.
- Header and filters render.
- Empty state is readable.
- Refresh button shows a spinner while running.

**Step 6: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/app/core/main/ai-hotspots
git commit -m "Render a quiet AI hotspot feed workspace" \
  -m "Constraint: LingMo UI should stay compact and content-first
Rejected: Porting the standalone aggregator dashboard styling | It is too card-heavy for LingMo
Confidence: medium
Scope-risk: moderate
Tested: pnpm typecheck; manual dev smoke opened AI 热点 workspace"
```

## Task 9: Build Sources and Settings UI

**Files:**
- Create: `src/app/core/main/ai-hotspots/hotspot-source-view.tsx`
- Create: `src/app/core/main/ai-hotspots/hotspot-settings-dialog.tsx`
- Modify: `src/app/core/main/ai-hotspots/ai-hotspots-workspace.tsx`

**Step 1: Implement source view**

Show:

- source name
- kind
- enabled state
- last status
- item count
- duration
- last error, collapsed by default

**Step 2: Implement settings dialog**

Use existing `Dialog`, `Switch`, `Input`, and `Button`.

Settings:

- auto refresh on open
- cooldown minutes
- default time range
- title translation enabled
- max translations

RSS management:

- add RSS title + URL
- enable/disable
- delete
- import OPML text area or file picker, whichever is easier with existing Tauri APIs

**Step 3: Wire settings to store**

Add missing store actions:

- `loadSettings()`
- `saveSettings(patch)`
- `importOpml(content)`

**Step 4: Verify**

Run:

```bash
pnpm typecheck
```

Manual:

- Add a RSS feed.
- Disable it.
- Re-enable it.
- Delete it.

Expected: state persists after closing and reopening the workspace.

**Step 5: Commit**

```bash
git add src/app/core/main/ai-hotspots src/stores/ai-hotspots.ts
git commit -m "Let users inspect and tune AI hotspot sources" \
  -m "Constraint: First release needs stable defaults plus configurable RSS and OPML
Rejected: Source marketplace in v1 | It adds too much surface before the core flow is proven
Confidence: medium
Scope-risk: moderate
Tested: pnpm typecheck; manual RSS settings smoke"
```

## Task 10: Implement Save to Note, Send to Chat, and Digest

**Files:**
- Modify: `src/stores/ai-hotspots.ts`
- Create: `src/app/core/main/ai-hotspots/hotspot-digest-view.tsx`
- Modify: `src/app/core/main/ai-hotspots/ai-hotspots-workspace.tsx`
- Modify: `src/app/core/main/ai-hotspots/hotspot-item.tsx`

**Step 1: Save single item as note**

Use existing workspace helpers from `src/lib/workspace.ts` and Tauri FS utilities, following patterns in `src/stores/article.ts`.

Default path:

```text
AI热点/YYYY-MM-DD-<safe-title>.md
```

After writing:

- set `savedNotePath`
- refresh file tree if needed
- toast success
- optionally set active file path to the saved note

**Step 2: Send item to chat**

Emit an event similar to GitHub Stars:

```ts
emitter.emit('ai-hotspot-send-to-chat', {
  prompt,
  quoteData,
})
```

Then add a listener in chat if there is no generic listener. Prefer reusing the existing quote/prompt pattern from `github-stars-send-to-chat`.

**Step 3: Implement digest view**

`HotspotDigestView` lets users choose:

- `24h` or `7d`
- current filters / favorites / unread
- generate daily or weekly title

It calls `generateDigest`, writes the Markdown file, and stores no duplicate digest table.

**Step 4: Deep dive action**

For v1, `Deep dive` should send a structured prompt to the chat asking LingMo to research the item. Do not run Deep Research automatically until the user confirms from chat.

**Step 5: Verify**

Run:

```bash
pnpm typecheck
```

Manual:

- Save one hotspot as note.
- Open the saved note.
- Generate a digest from current list.
- Send one hotspot to chat.

Expected:

- Files appear in workspace.
- Saved item shows saved path.
- Chat receives useful context.

**Step 6: Commit**

```bash
git add src/stores/ai-hotspots.ts src/app/core/main/ai-hotspots
git commit -m "Turn AI hotspots into reusable LingMo notes" \
  -m "Constraint: The module must support both realtime reading and knowledge capture
Rejected: Read-only feed | It would not match LingMo's note-first product purpose
Confidence: medium
Scope-risk: moderate
Tested: pnpm typecheck; manual save-note, digest, and send-to-chat smoke"
```

## Task 11: Add Package Script and Integration Tests

**Files:**
- Modify: `package.json`
- Modify: `scripts/ai-hotspots-core-tests.mjs`
- Optional create: `scripts/ai-hotspots-refresh-smoke.mjs`

**Step 1: Add script**

Add:

```json
"test:ai-hotspots": "node scripts/ai-hotspots-core-tests.mjs"
```

**Step 2: Expand pure tests**

Add tests for:

- `shouldAutoRefreshAiHotspots`
- digest grouping
- score ordering
- filter by time range

**Step 3: Add optional refresh smoke**

Only if it can run without Tauri SQLite. If not, skip and document that live refresh is validated manually through the app.

**Step 4: Run**

```bash
pnpm test:ai-hotspots
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json scripts/ai-hotspots-core-tests.mjs
git commit -m "Keep AI hotspot rules covered by a focused test command" \
  -m "Constraint: The high-risk logic is pure and should be runnable outside Tauri
Confidence: high
Scope-risk: narrow
Tested: pnpm test:ai-hotspots; pnpm typecheck"
```

## Task 12: Final Verification and Polish

**Files:**
- Review all files touched by Tasks 1-11.

**Step 1: Run full static verification**

```bash
pnpm test:ai-hotspots
pnpm typecheck
pnpm lint
```

Expected: PASS or only pre-existing unrelated lint failures. If lint fails, fix AI-hotspots-related failures.

**Step 2: Run dev app smoke**

```bash
pnpm dev
```

Manual smoke:

1. Open `AI 热点`.
2. Confirm cached state renders before refresh finishes.
3. Trigger manual refresh.
4. Confirm at least four source statuses appear.
5. Filter by `24h`, `7d`, source, favorite, unread.
6. Favorite an item and switch to `收藏`.
7. Mark item read/unread.
8. Save item as note.
9. Generate a digest.
10. Inspect source failures.

**Step 3: Check git diff**

```bash
git status --short
git diff --stat
```

Expected: only AI hotspot files, planned integrations, package script, and tests.

**Step 4: Commit final fixes if needed**

Use a Lore message:

```bash
git add <fixed-files>
git commit -m "Stabilize the AI hotspots workspace for first use" \
  -m "Constraint: Final polish after running focused tests and app smoke
Confidence: medium
Scope-risk: narrow
Tested: pnpm test:ai-hotspots; pnpm typecheck; pnpm lint; manual workspace smoke
Not-tested: Long-running source reliability across multiple days"
```

## Definition of Done

- `AI 热点` appears in the left rail and opens as a virtual LingMo tab.
- Opening the workspace renders cached items first and auto-refreshes in the background when allowed.
- Manual refresh works and is concurrency-safe.
- At least four default sources return independent statuses.
- User RSS feed CRUD is available.
- OPML import is available.
- 24h/7d, source, status, and query filters work.
- Favorite and read state persist.
- Single-item note saving works.
- Digest generation writes Markdown into the workspace.
- Send-to-chat passes useful hotspot context.
- Source failures are visible without interrupting the feed.
- `pnpm test:ai-hotspots` passes.
- `pnpm typecheck` passes.
- AI-hotspots-related lint issues are resolved.
