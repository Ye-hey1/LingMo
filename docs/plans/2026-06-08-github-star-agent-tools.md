# GitHub Star Agent Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build agent tools that let LingMo summarize and manage the user's GitHub starred repositories through the configured GitHub token.

**Architecture:** Add a pure summary helper for testable date filtering and grouping, then add a GitHub Stars agent service that reuses the existing API and database modules. Expose the service through a focused agent tool module, register those tools with the existing tool registry, and classify read/write/destructive risk in the existing policy layer.

**Tech Stack:** TypeScript, Next.js app code, Tauri store/http/sql wrappers already used by `src/lib/github-stars`, Node assertion scripts, existing `pnpm typecheck` and `pnpm test:agent`.

---

Reference: @writing-plans

## Task 1: Add Failing Tests For Recent Star Summary Helpers

**Files:**
- Create: `scripts/github-star-agent-service-tests.mjs`
- Later create: `src/lib/github-stars/agent-summary.ts`

**Step 1: Write the failing test**

Create `scripts/github-star-agent-service-tests.mjs` with this content:

```js
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-github-star-agent-tests-'))
const compiledModules = new Set()

function toMjsRelativePath(relativePath) {
  return relativePath.replace(/\.tsx?$/, '.mjs')
}

function resolveRelativeDependency(currentRelativePath, specifier) {
  const currentDir = dirname(join(repoRoot, currentRelativePath))
  const basePath = resolve(currentDir, specifier)
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ]

  const dependencyPath = candidates.find(candidate => existsSync(candidate))
  if (!dependencyPath) return null
  return resolve(dependencyPath).replace(resolve(repoRoot), '').replace(/^[/\\]/, '')
}

function rewriteSpecifier(currentRelativePath, dependencyRelativePath) {
  const currentOutDir = dirname(toMjsRelativePath(currentRelativePath))
  const dependencyOutPath = toMjsRelativePath(dependencyRelativePath)
  let relativeSpecifier = dependencyOutPath

  if (currentOutDir && currentOutDir !== '.') {
    const currentParts = currentOutDir.split(/[\\/]/).filter(Boolean)
    const dependencyParts = dependencyOutPath.split(/[\\/]/).filter(Boolean)
    while (currentParts.length && dependencyParts.length && currentParts[0] === dependencyParts[0]) {
      currentParts.shift()
      dependencyParts.shift()
    }
    relativeSpecifier = [...currentParts.map(() => '..'), ...dependencyParts].join('/')
  }

  return relativeSpecifier.startsWith('.') ? relativeSpecifier : `./${relativeSpecifier}`
}

async function rewriteLocalImports(output, relativePath) {
  const dependencies = new Set()
  const rewrite = (match, prefix, specifier, suffix) => {
    if (!specifier.startsWith('.')) return match
    const dependencyRelativePath = resolveRelativeDependency(relativePath, specifier)
    if (!dependencyRelativePath) return match
    dependencies.add(dependencyRelativePath)
    return `${prefix}${rewriteSpecifier(relativePath, dependencyRelativePath)}${suffix}`
  }

  let rewritten = output.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, rewrite)
  rewritten = rewritten.replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, rewrite)

  for (const dependency of dependencies) {
    await compileTsModule(dependency)
  }

  return rewritten
}

async function compileTsModule(relativePath) {
  if (compiledModules.has(relativePath)) return
  compiledModules.add(relativePath)

  const sourcePath = join(repoRoot, relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const output = await rewriteLocalImports(ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText, relativePath)

  const outPath = join(tempDir, toMjsRelativePath(relativePath))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
}

async function importTsModule(relativePath) {
  await compileTsModule(relativePath)
  return import(pathToFileURL(join(tempDir, toMjsRelativePath(relativePath))).href)
}

function repo(overrides) {
  return {
    id: 1,
    name: 'demo',
    fullName: 'owner/demo',
    description: null,
    htmlUrl: 'https://github.com/owner/demo',
    stargazersCount: 0,
    forksCount: 0,
    language: null,
    createdAt: null,
    updatedAt: null,
    pushedAt: null,
    starredAt: null,
    ownerLogin: 'owner',
    ownerAvatarUrl: null,
    topics: [],
    isFork: false,
    aiSummary: null,
    aiTags: [],
    aiPlatforms: [],
    analyzedAt: null,
    analysisFailed: false,
    customDescription: null,
    customTags: [],
    customCategory: null,
    categoryLocked: false,
    lastEdited: null,
    subscribedToReleases: false,
    lastReleaseFetchTime: null,
    hasFetchedReleases: false,
    syncedAt: 0,
    isStarred: true,
    ...overrides,
  }
}

try {
  const {
    buildRecentStarsSummary,
    filterStarredRepositories,
    isValidGithubFullName,
  } = await importTsModule('src/lib/github-stars/agent-summary.ts')

  const now = new Date('2026-06-08T12:00:00.000Z')
  const repositories = [
    repo({
      id: 1,
      name: 'alpha',
      fullName: 'acme/alpha',
      description: 'Agent toolkit',
      stargazersCount: 1200,
      forksCount: 80,
      language: 'TypeScript',
      topics: ['ai', 'agent'],
      starredAt: '2026-06-07T09:00:00.000Z',
      customCategory: 'AI',
      aiSummary: 'Builds AI agents',
    }),
    repo({
      id: 2,
      name: 'beta',
      fullName: 'acme/beta',
      description: 'Vector database',
      stargazersCount: 800,
      forksCount: 30,
      language: 'Rust',
      topics: ['database', 'vector'],
      starredAt: '2026-06-03T09:00:00.000Z',
      customCategory: 'Database',
    }),
    repo({
      id: 3,
      name: 'old',
      fullName: 'acme/old',
      language: 'Go',
      starredAt: '2026-05-01T09:00:00.000Z',
      customCategory: 'Archive',
    }),
    repo({
      id: 4,
      name: 'unstarred',
      fullName: 'acme/unstarred',
      language: 'Python',
      starredAt: '2026-06-07T09:00:00.000Z',
      isStarred: false,
    }),
  ]

  const filtered = filterStarredRepositories(repositories, {
    query: 'agent',
    language: 'TypeScript',
    category: 'AI',
  })
  assert.deepEqual(filtered.map(item => item.fullName), ['acme/alpha'])

  const summary = buildRecentStarsSummary(repositories, {
    now,
    rangeDays: 7,
    categoryResolver: item => item.customCategory || '未分类',
  })

  assert.equal(summary.total, 2)
  assert.deepEqual(summary.repositories.map(item => item.fullName), ['acme/alpha', 'acme/beta'])
  assert.deepEqual(summary.languages, [
    { name: 'TypeScript', count: 1 },
    { name: 'Rust', count: 1 },
  ])
  assert.deepEqual(summary.categories, [
    { name: 'AI', count: 1 },
    { name: 'Database', count: 1 },
  ])
  assert.deepEqual(summary.topics.slice(0, 4), [
    { name: 'ai', count: 1 },
    { name: 'agent', count: 1 },
    { name: 'database', count: 1 },
    { name: 'vector', count: 1 },
  ])
  assert.deepEqual(summary.noteworthy.map(item => item.fullName), ['acme/alpha', 'acme/beta'])

  assert.equal(isValidGithubFullName('owner/repo'), true)
  assert.equal(isValidGithubFullName('owner-name/repo.name'), true)
  assert.equal(isValidGithubFullName('bad'), false)
  assert.equal(isValidGithubFullName('owner/repo/extra'), false)

  console.log('github star agent service tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
node scripts/github-star-agent-service-tests.mjs
```

Expected: FAIL because `src/lib/github-stars/agent-summary.ts` does not exist yet.

**Step 3: Commit only the failing test**

```bash
git add scripts/github-star-agent-service-tests.mjs
git commit -m "Test why GitHub Star agent summaries need pure helpers" \
  -m "Constraint: Keep tests dependency-free and aligned with the existing Node assertion style." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: node scripts/github-star-agent-service-tests.mjs fails because agent-summary.ts is missing."
```

## Task 2: Implement Pure Summary And Filter Helpers

**Files:**
- Create: `src/lib/github-stars/agent-summary.ts`
- Modify: `package.json`

**Step 1: Implement `src/lib/github-stars/agent-summary.ts`**

```ts
import type { GithubStarRepository } from '@/types/github-stars'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 50

export interface GithubStarAgentListFilters {
  query?: string
  language?: string
  category?: string
  analysis?: 'all' | 'analyzed' | 'pending' | 'failed'
  from?: string
  to?: string
  limit?: number
  categoryResolver?: (repo: GithubStarRepository) => string
}

export interface GithubStarRecentSummaryOptions {
  now?: Date
  rangeDays?: number
  limit?: number
  categoryResolver?: (repo: GithubStarRepository) => string
}

export interface GithubStarAgentRepositoryItem {
  id: number
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  stars: number
  forks: number
  language: string | null
  topics: string[]
  category: string
  starredAt: string | null
  updatedAt: string | null
  pushedAt: string | null
  aiSummary: string | null
  customDescription: string | null
  customTags: string[]
}

export interface GithubStarRecentSummary {
  rangeDays: number
  from: string
  to: string
  total: number
  repositories: GithubStarAgentRepositoryItem[]
  languages: Array<{ name: string; count: number }>
  categories: Array<{ name: string; count: number }>
  topics: Array<{ name: string; count: number }>
  noteworthy: GithubStarAgentRepositoryItem[]
}

function clampCount(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), max)
}

function toTime(value: string | null | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function defaultCategoryResolver(repo: GithubStarRepository) {
  return repo.customCategory || '未分类'
}

function resolveCategory(repo: GithubStarRepository, resolver?: (repo: GithubStarRepository) => string) {
  return (resolver?.(repo) || defaultCategoryResolver(repo)).trim() || '未分类'
}

function toRepositoryItem(
  repo: GithubStarRepository,
  categoryResolver?: (repo: GithubStarRepository) => string,
): GithubStarAgentRepositoryItem {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description,
    htmlUrl: repo.htmlUrl,
    stars: repo.stargazersCount,
    forks: repo.forksCount,
    language: repo.language,
    topics: repo.topics,
    category: resolveCategory(repo, categoryResolver),
    starredAt: repo.starredAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
    aiSummary: repo.aiSummary,
    customDescription: repo.customDescription,
    customTags: repo.customTags,
  }
}

function countValues(values: string[], limit = 12) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const name = value.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function matchesQuery(repo: GithubStarRepository, query: string) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = [
    repo.name,
    repo.fullName,
    repo.description || '',
    repo.language || '',
    repo.ownerLogin,
    repo.aiSummary || '',
    repo.customDescription || '',
    ...repo.topics,
    ...repo.aiTags,
    ...repo.aiPlatforms,
    ...repo.customTags,
  ].join(' ').toLowerCase()

  return words.every(word => haystack.includes(word))
}

export function isValidGithubFullName(value: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim())
}

export function filterStarredRepositories(
  repositories: GithubStarRepository[],
  filters: GithubStarAgentListFilters = {},
) {
  const fromTime = toTime(filters.from)
  const toFilterTime = toTime(filters.to)
  const limit = clampCount(filters.limit, DEFAULT_LIMIT, 500)
  const categoryFilter = filters.category && filters.category !== 'all' ? normalizeText(filters.category) : ''
  const languageFilter = filters.language && filters.language !== 'all' ? normalizeText(filters.language) : ''
  const analysis = filters.analysis || 'all'

  return repositories
    .filter(repo => repo.isStarred !== false)
    .filter(repo => !filters.query || matchesQuery(repo, filters.query))
    .filter(repo => !languageFilter || normalizeText(repo.language || '') === languageFilter)
    .filter(repo => !categoryFilter || normalizeText(resolveCategory(repo, filters.categoryResolver)) === categoryFilter)
    .filter(repo => {
      if (analysis === 'analyzed') return Boolean(repo.aiSummary)
      if (analysis === 'pending') return !repo.aiSummary && !repo.analysisFailed
      if (analysis === 'failed') return repo.analysisFailed
      return true
    })
    .filter(repo => {
      const starredTime = toTime(repo.starredAt)
      if (fromTime !== null && (starredTime === null || starredTime < fromTime)) return false
      if (toFilterTime !== null && (starredTime === null || starredTime > toFilterTime)) return false
      return true
    })
    .sort((a, b) => (toTime(b.starredAt) || 0) - (toTime(a.starredAt) || 0))
    .slice(0, limit)
}

export function buildRecentStarsSummary(
  repositories: GithubStarRepository[],
  options: GithubStarRecentSummaryOptions = {},
): GithubStarRecentSummary {
  const rangeDays = clampCount(options.rangeDays, 7, 365)
  const limit = clampCount(options.limit, DEFAULT_LIMIT, 200)
  const now = options.now || new Date()
  const to = now.toISOString()
  const from = new Date(now.getTime() - rangeDays * DAY_MS).toISOString()
  const recentRepos = filterStarredRepositories(repositories, {
    from,
    to,
    limit,
    categoryResolver: options.categoryResolver,
  })
  const items = recentRepos.map(repo => toRepositoryItem(repo, options.categoryResolver))

  return {
    rangeDays,
    from,
    to,
    total: items.length,
    repositories: items,
    languages: countValues(items.map(item => item.language || 'Unknown')),
    categories: countValues(items.map(item => item.category)),
    topics: countValues(items.flatMap(item => item.topics)),
    noteworthy: [...items]
      .sort((a, b) => (b.stars + b.forks) - (a.stars + a.forks) || a.fullName.localeCompare(b.fullName))
      .slice(0, 5),
  }
}

export function toGithubStarAgentRepositoryItems(
  repositories: GithubStarRepository[],
  categoryResolver?: (repo: GithubStarRepository) => string,
) {
  return repositories.map(repo => toRepositoryItem(repo, categoryResolver))
}
```

**Step 2: Add a package script**

In `package.json`, add this script near `test:agent`:

```json
"test:github-stars-agent": "node scripts/github-star-agent-service-tests.mjs",
```

**Step 3: Run test to verify it passes**

Run:

```bash
pnpm test:github-stars-agent
```

Expected: PASS with `github star agent service tests passed`.

**Step 4: Commit**

```bash
git add package.json scripts/github-star-agent-service-tests.mjs src/lib/github-stars/agent-summary.ts
git commit -m "Add testable GitHub Star agent summaries" \
  -m "Constraint: Keep summary logic pure so agent behavior can be tested without Tauri or GitHub network calls." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: pnpm test:github-stars-agent"
```

## Task 3: Add GitHub Stars Agent Service

**Files:**
- Create: `src/lib/github-stars/agent-service.ts`

**Step 1: Create service implementation**

Create `src/lib/github-stars/agent-service.ts`:

```ts
import {
  finishGithubStarSync,
  getGithubStarCustomCategories,
  getGithubStarForkRepositories,
  getGithubStarReleases,
  getGithubStarRepositories,
  initGithubStarsDb,
  markGithubStarReleaseRead,
  markGithubStarRepositoryUnstarred,
  updateGithubStarCategory,
  updateGithubStarReleaseSubscription,
  updateGithubStarRepositoryDetails,
  upsertGithubStarForkRepositories,
  upsertGithubStarRepositoriesBatch,
  upsertGithubStarReleases,
} from '@/db/github-stars'
import {
  fetchReleasesForRepositories,
  fetchStarredRepositoriesPage,
  fetchUserForks,
  searchGithubRepositories,
  starGithubRepository,
  unstarGithubRepository,
} from '@/lib/github-stars/api'
import { GITHUB_STAR_DEFAULT_CATEGORIES, resolveGithubStarCategory } from '@/lib/github-stars/categories'
import type { GithubStarRepository, GithubStarRepositoryUpdate } from '@/types/github-stars'
import {
  buildRecentStarsSummary,
  filterStarredRepositories,
  isValidGithubFullName,
  toGithubStarAgentRepositoryItems,
  type GithubStarAgentListFilters,
  type GithubStarRecentSummaryOptions,
} from './agent-summary'

const SYNC_PAGE_DELAY_MS = 120

function delay(ms: number) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

function createCategoryResolver(customCategories: Awaited<ReturnType<typeof getGithubStarCustomCategories>>) {
  const categoryRules = [
    ...customCategories.map(category => ({
      id: `custom:${category.name}`,
      name: category.name,
      keywords: category.keywords,
      icon: category.icon,
      custom: true,
    })),
    ...GITHUB_STAR_DEFAULT_CATEGORIES,
  ]
  return (repo: GithubStarRepository) => resolveGithubStarCategory(repo, categoryRules)
}

function assertFullName(fullName: string) {
  const normalized = fullName.trim()
  if (!isValidGithubFullName(normalized)) {
    throw new Error('仓库名称格式无效，请使用 owner/repo，例如 facebook/react')
  }
  return normalized
}

async function loadRepositoriesWithCategories() {
  await initGithubStarsDb()
  const [repositories, customCategories] = await Promise.all([
    getGithubStarRepositories(),
    getGithubStarCustomCategories(),
  ])
  return {
    repositories,
    categoryResolver: createCategoryResolver(customCategories),
  }
}

async function findLocalRepositoryByFullName(fullName: string) {
  await initGithubStarsDb()
  const normalized = fullName.toLowerCase()
  const repositories = await getGithubStarRepositories()
  return repositories.find(repo => repo.fullName.toLowerCase() === normalized) || null
}

export async function syncGithubStarredForAgent(options: { maxPages?: number; signal?: AbortSignal } = {}) {
  await initGithubStarsDb()
  const syncedAt = Date.now()
  const maxPages = Math.max(Number(options.maxPages) || 0, 0)
  let page = 1
  let fetched = 0
  let totalPages: number | undefined

  while (true) {
    if (options.signal?.aborted) {
      throw new Error('GitHub Star 同步已取消')
    }

    const result = await fetchStarredRepositoriesPage(page, { signal: options.signal })
    fetched += result.repositories.length
    totalPages = result.lastPage || totalPages

    await upsertGithubStarRepositoriesBatch(result.repositories, syncedAt)

    const reachedExplicitLimit = maxPages > 0 && page >= maxPages
    const reachedLastPage = result.lastPage ? page >= result.lastPage : !result.hasMore
    if (reachedExplicitLimit || reachedLastPage) break

    page += 1
    await delay(SYNC_PAGE_DELAY_MS)
  }

  if (maxPages === 0 || !totalPages || page >= totalPages) {
    await finishGithubStarSync(syncedAt)
  }

  const repositories = await getGithubStarRepositories()
  return {
    fetched,
    pages: page,
    totalPages,
    syncedAt,
    localTotal: repositories.length,
    complete: maxPages === 0 || !totalPages || page >= totalPages,
  }
}

export async function listGithubStarredForAgent(filters: GithubStarAgentListFilters = {}) {
  const { repositories, categoryResolver } = await loadRepositoriesWithCategories()
  const filtered = filterStarredRepositories(repositories, {
    ...filters,
    categoryResolver,
  })

  return {
    total: filtered.length,
    repositories: toGithubStarAgentRepositoryItems(filtered, categoryResolver),
  }
}

export async function summarizeRecentGithubStarsForAgent(options: GithubStarRecentSummaryOptions = {}) {
  const { repositories, categoryResolver } = await loadRepositoriesWithCategories()
  return buildRecentStarsSummary(repositories, {
    ...options,
    categoryResolver,
  })
}

export async function searchMyGithubStarsForAgent(query: string, options: Omit<GithubStarAgentListFilters, 'query'> = {}) {
  return listGithubStarredForAgent({
    ...options,
    query,
  })
}

export async function listGithubStarReleasesForAgent(options: {
  repoFullName?: string
  unreadOnly?: boolean
  from?: string
  to?: string
  limit?: number
} = {}) {
  await initGithubStarsDb()
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 200)
  const fromTime = options.from ? new Date(options.from).getTime() : null
  const toTime = options.to ? new Date(options.to).getTime() : null
  const repoFilter = options.repoFullName?.trim().toLowerCase()
  const releases = await getGithubStarReleases()

  const filtered = releases
    .filter(release => !repoFilter || release.repository.fullName.toLowerCase() === repoFilter)
    .filter(release => !options.unreadOnly || !release.isRead)
    .filter(release => {
      const publishedTime = new Date(release.publishedAt).getTime()
      if (fromTime !== null && publishedTime < fromTime) return false
      if (toTime !== null && publishedTime > toTime) return false
      return true
    })
    .slice(0, limit)

  return {
    total: filtered.length,
    releases: filtered,
  }
}

export async function refreshGithubStarReleasesForAgent(options: {
  repoFullName?: string
  includePrerelease?: boolean
} = {}) {
  const { repositories } = await loadRepositoriesWithCategories()
  const selected = options.repoFullName
    ? repositories.filter(repo => repo.fullName.toLowerCase() === options.repoFullName?.toLowerCase())
    : repositories.filter(repo => repo.subscribedToReleases)

  const result = await fetchReleasesForRepositories(selected, {
    includePrerelease: options.includePrerelease,
  })
  await upsertGithubStarReleases(result.releases)

  return {
    repositories: selected.length,
    releases: result.releases.length,
    failedRepositories: result.failedRepositories,
  }
}

export async function listMyGithubForksForAgent(options: { refresh?: boolean } = {}) {
  await initGithubStarsDb()
  if (options.refresh) {
    const forks = await fetchUserForks()
    await upsertGithubStarForkRepositories(forks)
  }

  const forks = await getGithubStarForkRepositories()
  return {
    total: forks.length,
    forks,
  }
}

export async function starGithubRepositoryForAgent(fullName: string) {
  const normalized = assertFullName(fullName)
  await starGithubRepository(normalized)

  const discovered = await searchGithubRepositories(`repo:${normalized}`, {
    perPage: 1,
    sortBy: 'BestMatch',
  })
  const repo = discovered.repos[0]
  if (!repo) {
    return {
      fullName: normalized,
      localUpdated: false,
      message: 'GitHub Star 已添加，但本地未找到仓库详情；下次同步会补齐。',
    }
  }

  const syncedAt = Date.now()
  await upsertGithubStarRepositoriesBatch([{
    ...repo,
    isStarred: true,
    starredAt: new Date().toISOString(),
    syncedAt,
  }], syncedAt)

  return {
    fullName: normalized,
    localUpdated: true,
  }
}

export async function unstarGithubRepositoryForAgent(fullName: string) {
  const normalized = assertFullName(fullName)
  await unstarGithubRepository(normalized)

  const localRepo = await findLocalRepositoryByFullName(normalized)
  if (localRepo) {
    await markGithubStarRepositoryUnstarred(localRepo.id)
  }

  return {
    fullName: normalized,
    localUpdated: Boolean(localRepo),
  }
}

export async function updateGithubStarCategoryForAgent(fullName: string, category: string | null) {
  const repo = await findLocalRepositoryByFullName(assertFullName(fullName))
  if (!repo) throw new Error('本地 Star 列表中找不到该仓库，请先同步 GitHub Stars')
  await updateGithubStarCategory(repo.id, category)
  return { fullName: repo.fullName, category }
}

export async function updateGithubStarNotesTagsForAgent(fullName: string, update: GithubStarRepositoryUpdate) {
  const repo = await findLocalRepositoryByFullName(assertFullName(fullName))
  if (!repo) throw new Error('本地 Star 列表中找不到该仓库，请先同步 GitHub Stars')
  await updateGithubStarRepositoryDetails(repo.id, update)
  return { fullName: repo.fullName, update }
}

export async function toggleGithubStarReleaseSubscriptionForAgent(fullName: string, subscribed: boolean) {
  const repo = await findLocalRepositoryByFullName(assertFullName(fullName))
  if (!repo) throw new Error('本地 Star 列表中找不到该仓库，请先同步 GitHub Stars')
  await updateGithubStarReleaseSubscription(repo.id, subscribed)
  return { fullName: repo.fullName, subscribed }
}

export async function markGithubStarReleaseReadForAgent(releaseId: number) {
  if (!Number.isFinite(Number(releaseId))) {
    throw new Error('releaseId 必须是数字')
  }
  await markGithubStarReleaseRead(Number(releaseId))
  return { releaseId: Number(releaseId), isRead: true }
}
```

**Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS. If it fails because of unrelated pre-existing workspace changes, record the unrelated error and still fix any errors from `src/lib/github-stars/agent-service.ts`.

**Step 3: Commit**

```bash
git add src/lib/github-stars/agent-service.ts
git commit -m "Add GitHub Star service for agent workflows" \
  -m "Constraint: Reuse existing GitHub API and database modules instead of adding another GitHub client." \
  -m "Rejected: Import Zustand store actions | UI state orchestration is harder to test and unnecessary for agent tools." \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: pnpm typecheck"
```

## Task 4: Add Failing Risk Policy Tests

**Files:**
- Modify: `scripts/agent-core-tests.mjs`
- Later modify: `src/lib/agent/tool-policy.ts`

**Step 1: Add assertions near existing `getToolRiskLevel` assertions**

Add these lines after the existing `safe_write_file` risk assertion:

```js
  assert.equal(getToolRiskLevel('github_sync_starred', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_list_starred', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_summarize_recent_stars', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_search_my_stars', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_list_star_releases', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_list_my_forks', 'web'), 'low')
  assert.equal(getToolRiskLevel('github_star_repo', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_update_star_category', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_update_star_notes_tags', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_subscribe_star_releases', 'web'), 'medium')
  assert.equal(getToolRiskLevel('github_unstar_repo', 'web'), 'high')
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test:agent
```

Expected: FAIL because write/destructive GitHub Star tool names are not explicitly classified yet.

**Step 3: Commit the failing test**

```bash
git add scripts/agent-core-tests.mjs
git commit -m "Test why GitHub Star tools need explicit risk policy" \
  -m "Constraint: Agent write tools must request confirmation before remote GitHub mutations." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: pnpm test:agent fails on GitHub Star policy assertions."
```

## Task 5: Classify GitHub Star Tool Risk

**Files:**
- Modify: `src/lib/agent/tool-policy.ts`

**Step 1: Update risk sets**

Add `github_unstar_repo` to `HIGH_RISK_TOOLS`:

```ts
  'github_unstar_repo',
```

Add these entries to `MEDIUM_RISK_TOOLS`:

```ts
  'github_star_repo',
  'github_update_star_category',
  'github_update_star_notes_tags',
  'github_subscribe_star_releases',
```

Add these entries to `READ_ONLY_TOOLS`:

```ts
  'github_sync_starred',
  'github_list_starred',
  'github_summarize_recent_stars',
  'github_search_my_stars',
  'github_list_star_releases',
  'github_list_my_forks',
```

**Step 2: Run agent tests**

Run:

```bash
pnpm test:agent
```

Expected: PASS with `agent core tests passed`.

**Step 3: Commit**

```bash
git add src/lib/agent/tool-policy.ts
git commit -m "Classify GitHub Star agent tool risk" \
  -m "Constraint: Remote star mutations and local Star metadata edits must flow through confirmation policy." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: pnpm test:agent"
```

## Task 6: Add Agent Tool Definitions

**Files:**
- Create: `src/lib/agent/tools/github-star-tools.ts`

**Step 1: Create helper formatting functions and tool definitions**

Create `src/lib/agent/tools/github-star-tools.ts`:

```ts
import { Tool, ToolResult } from '../types'

function asErrorResult(prefix: string, error: unknown): ToolResult {
  return {
    success: false,
    error: `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  }
}

function numberParam(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

function stringParam(value: unknown) {
  return String(value || '').trim()
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function formatRepositoryRows(repositories: Array<{
  fullName: string
  description: string | null
  stars: number
  forks: number
  language: string | null
  htmlUrl: string
  starredAt?: string | null
  category?: string
}>) {
  if (repositories.length === 0) return '没有找到匹配的 GitHub Star 项目。'

  return repositories.map((repo, index) => {
    const meta = [
      repo.language || 'Unknown',
      `⭐ ${formatCount(repo.stars)}`,
      `🍴 ${formatCount(repo.forks)}`,
      repo.category,
      repo.starredAt ? `Starred: ${repo.starredAt.slice(0, 10)}` : '',
    ].filter(Boolean).join(' · ')

    return [
      `${index + 1}. **${repo.fullName}**`,
      `   ${meta}`,
      `   ${repo.description || '(无描述)'}`,
      `   ${repo.htmlUrl}`,
    ].join('\n')
  }).join('\n\n')
}

function formatRecentSummary(summary: {
  rangeDays: number
  from: string
  to: string
  total: number
  repositories: any[]
  languages: Array<{ name: string; count: number }>
  categories: Array<{ name: string; count: number }>
  topics: Array<{ name: string; count: number }>
  noteworthy: any[]
}) {
  const lines = [
    `## 最近 ${summary.rangeDays} 天新增 Star 项目`,
    '',
    `范围: ${summary.from.slice(0, 10)} 至 ${summary.to.slice(0, 10)}`,
    `总数: ${summary.total}`,
    '',
  ]

  if (summary.total === 0) {
    lines.push('这段时间没有同步到新增 Star 项目。')
    return lines.join('\n')
  }

  lines.push('### 新增项目', formatRepositoryRows(summary.repositories.slice(0, 20)), '')
  lines.push(`### 语言分布\n${summary.languages.map(item => `- ${item.name}: ${item.count}`).join('\n') || '- 无'}`, '')
  lines.push(`### 分类分布\n${summary.categories.map(item => `- ${item.name}: ${item.count}`).join('\n') || '- 无'}`, '')
  lines.push(`### 高频主题\n${summary.topics.slice(0, 10).map(item => `- ${item.name}: ${item.count}`).join('\n') || '- 无'}`, '')
  lines.push('### 值得关注', formatRepositoryRows(summary.noteworthy))
  return lines.join('\n')
}

export const githubSyncStarredTool: Tool = {
  name: 'github_sync_starred',
  description: 'Sync the authenticated user GitHub starred repositories into LingMo local storage. Use before personal Star summaries when local data may be empty or stale.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    {
      name: 'max_pages',
      type: 'number',
      description: 'Optional max pages to sync. Leave empty or 0 to sync all pages.',
      required: false,
      default: 0,
    },
  ],
  execute: async (params, context) => {
    try {
      const { syncGithubStarredForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await syncGithubStarredForAgent({
        maxPages: numberParam(params.max_pages, 0, 0, 1000),
        signal: context?.abortSignal,
      })
      return {
        success: true,
        data: result,
        message: `GitHub Star 同步完成：拉取 ${result.fetched} 个仓库，本地 Star 总数 ${result.localTotal}。`,
      }
    } catch (error) {
      return asErrorResult('GitHub Star 同步失败', error)
    }
  },
}

export const githubListStarredTool: Tool = {
  name: 'github_list_starred',
  description: 'List the user personal GitHub starred repositories from LingMo local storage with filters for query, language, category, analysis state, and date range.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'query', type: 'string', description: 'Optional text query.', required: false },
    { name: 'language', type: 'string', description: 'Optional language filter.', required: false },
    { name: 'category', type: 'string', description: 'Optional category filter.', required: false },
    { name: 'analysis', type: 'string', description: 'Optional analysis filter: all, analyzed, pending, failed.', required: false, default: 'all' },
    { name: 'from', type: 'string', description: 'Optional starred-at start date ISO string.', required: false },
    { name: 'to', type: 'string', description: 'Optional starred-at end date ISO string.', required: false },
    { name: 'limit', type: 'number', description: 'Max repositories to return. Default 30, max 200.', required: false, default: 30 },
  ],
  execute: async (params) => {
    try {
      const { listGithubStarredForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await listGithubStarredForAgent({
        query: stringParam(params.query),
        language: stringParam(params.language) || undefined,
        category: stringParam(params.category) || undefined,
        analysis: ['analyzed', 'pending', 'failed'].includes(params.analysis) ? params.analysis : 'all',
        from: stringParam(params.from) || undefined,
        to: stringParam(params.to) || undefined,
        limit: numberParam(params.limit, 30, 1, 200),
      })
      return {
        success: true,
        data: result,
        message: formatRepositoryRows(result.repositories),
      }
    } catch (error) {
      return asErrorResult('读取 GitHub Star 列表失败', error)
    }
  },
}

export const githubSummarizeRecentStarsTool: Tool = {
  name: 'github_summarize_recent_stars',
  description: 'Summarize personal GitHub repositories starred in the last N days. Use for questions like "最近一周我 Star 了哪些 GitHub 项目".',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'range_days', type: 'number', description: 'Recent range in days. Default 7.', required: false, default: 7 },
    { name: 'limit', type: 'number', description: 'Max repositories included in summary. Default 50, max 200.', required: false, default: 50 },
  ],
  execute: async (params) => {
    try {
      const { summarizeRecentGithubStarsForAgent } = await import('@/lib/github-stars/agent-service')
      const summary = await summarizeRecentGithubStarsForAgent({
        rangeDays: numberParam(params.range_days, 7, 1, 365),
        limit: numberParam(params.limit, 50, 1, 200),
      })
      return {
        success: true,
        data: summary,
        message: formatRecentSummary(summary),
      }
    } catch (error) {
      return asErrorResult('总结最近 GitHub Star 失败', error)
    }
  },
}

export const githubSearchMyStarsTool: Tool = {
  name: 'github_search_my_stars',
  description: 'Search within the user personal GitHub starred repositories stored in LingMo.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'query', type: 'string', description: 'Search query.', required: true },
    { name: 'limit', type: 'number', description: 'Max results. Default 20, max 100.', required: false, default: 20 },
  ],
  execute: async (params) => {
    try {
      const query = stringParam(params.query)
      if (!query) return { success: false, error: '请提供搜索关键词 query' }
      const { searchMyGithubStarsForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await searchMyGithubStarsForAgent(query, {
        limit: numberParam(params.limit, 20, 1, 100),
      })
      return {
        success: true,
        data: result,
        message: formatRepositoryRows(result.repositories),
      }
    } catch (error) {
      return asErrorResult('搜索个人 GitHub Star 失败', error)
    }
  },
}

export const githubListStarReleasesTool: Tool = {
  name: 'github_list_star_releases',
  description: 'List locally cached releases for starred repositories, optionally filtered by repository, read state, and date range.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    { name: 'repo_full_name', type: 'string', description: 'Optional repository full name owner/repo.', required: false },
    { name: 'unread_only', type: 'boolean', description: 'Only include unread releases.', required: false, default: false },
    { name: 'from', type: 'string', description: 'Optional published-at start date ISO string.', required: false },
    { name: 'to', type: 'string', description: 'Optional published-at end date ISO string.', required: false },
    { name: 'limit', type: 'number', description: 'Max releases. Default 30, max 200.', required: false, default: 30 },
  ],
  execute: async (params) => {
    try {
      const { listGithubStarReleasesForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await listGithubStarReleasesForAgent({
        repoFullName: stringParam(params.repo_full_name) || undefined,
        unreadOnly: Boolean(params.unread_only),
        from: stringParam(params.from) || undefined,
        to: stringParam(params.to) || undefined,
        limit: numberParam(params.limit, 30, 1, 200),
      })
      const message = result.releases.length === 0
        ? '没有找到匹配的 GitHub Star release。'
        : result.releases.map((release, index) => `${index + 1}. **${release.repository.fullName}** ${release.tagName} · ${release.publishedAt.slice(0, 10)}\n   ${release.htmlUrl}`).join('\n\n')
      return { success: true, data: result, message }
    } catch (error) {
      return asErrorResult('读取 GitHub Star release 失败', error)
    }
  },
}

export const githubListMyForksTool: Tool = {
  name: 'github_list_my_forks',
  description: 'List the user fork repositories from LingMo local storage, optionally refreshing from GitHub.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read', 'network'],
  parameters: [
    { name: 'refresh', type: 'boolean', description: 'Refresh fork list from GitHub before listing.', required: false, default: false },
  ],
  execute: async (params) => {
    try {
      const { listMyGithubForksForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await listMyGithubForksForAgent({ refresh: Boolean(params.refresh) })
      const message = result.forks.length === 0
        ? '没有找到 fork 仓库。'
        : result.forks.slice(0, 30).map((fork, index) => `${index + 1}. **${fork.fullName}** · ${fork.language || 'Unknown'} · ⭐ ${formatCount(fork.stargazersCount)}\n   ${fork.description || '(无描述)'}\n   ${fork.htmlUrl}`).join('\n\n')
      return { success: true, data: result, message }
    } catch (error) {
      return asErrorResult('读取 GitHub fork 列表失败', error)
    }
  },
}

export const githubStarRepoTool: Tool = {
  name: 'github_star_repo',
  description: 'Star a GitHub repository for the authenticated user and update the local GitHub Stars cache. Requires explicit user intent and confirmation.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write', 'network'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
  ],
  execute: async (params) => {
    try {
      const fullName = stringParam(params.full_name)
      const { starGithubRepositoryForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await starGithubRepositoryForAgent(fullName)
      return { success: true, data: result, message: `已 Star ${fullName}。` }
    } catch (error) {
      return asErrorResult('添加 GitHub Star 失败', error)
    }
  },
}

export const githubUnstarRepoTool: Tool = {
  name: 'github_unstar_repo',
  description: 'Unstar a GitHub repository for the authenticated user and mark it unstarred locally. Destructive remote action; requires confirmation.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'high',
  capabilities: ['delete', 'network'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
  ],
  execute: async (params) => {
    try {
      const fullName = stringParam(params.full_name)
      const { unstarGithubRepositoryForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await unstarGithubRepositoryForAgent(fullName)
      return { success: true, data: result, message: `已取消 Star ${fullName}。` }
    } catch (error) {
      return asErrorResult('取消 GitHub Star 失败', error)
    }
  },
}

export const githubUpdateStarCategoryTool: Tool = {
  name: 'github_update_star_category',
  description: 'Update the local category for a starred GitHub repository. This changes LingMo local metadata only.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
    { name: 'category', type: 'string', description: 'New category. Empty clears category.', required: false },
  ],
  execute: async (params) => {
    try {
      const { updateGithubStarCategoryForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await updateGithubStarCategoryForAgent(
        stringParam(params.full_name),
        stringParam(params.category) || null,
      )
      return { success: true, data: result, message: `已更新 ${result.fullName} 的分类。` }
    } catch (error) {
      return asErrorResult('更新 GitHub Star 分类失败', error)
    }
  },
}

export const githubUpdateStarNotesTagsTool: Tool = {
  name: 'github_update_star_notes_tags',
  description: 'Update local custom description and tags for a starred GitHub repository.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
    { name: 'custom_description', type: 'string', description: 'Custom local description.', required: false },
    { name: 'custom_tags', type: 'array', description: 'Custom local tags.', required: false },
  ],
  execute: async (params) => {
    try {
      const { updateGithubStarNotesTagsForAgent } = await import('@/lib/github-stars/agent-service')
      const customTags = Array.isArray(params.custom_tags)
        ? params.custom_tags.map(item => String(item).trim()).filter(Boolean)
        : []
      const result = await updateGithubStarNotesTagsForAgent(stringParam(params.full_name), {
        customDescription: stringParam(params.custom_description) || null,
        customTags,
      })
      return { success: true, data: result, message: `已更新 ${result.fullName} 的备注和标签。` }
    } catch (error) {
      return asErrorResult('更新 GitHub Star 备注标签失败', error)
    }
  },
}

export const githubSubscribeStarReleasesTool: Tool = {
  name: 'github_subscribe_star_releases',
  description: 'Toggle local release subscription for a starred GitHub repository.',
  category: 'web',
  requiresConfirmation: true,
  risk: 'medium',
  capabilities: ['write'],
  parameters: [
    { name: 'full_name', type: 'string', description: 'Repository full name owner/repo.', required: true },
    { name: 'subscribed', type: 'boolean', description: 'Whether to subscribe to releases.', required: true },
  ],
  execute: async (params) => {
    try {
      const { toggleGithubStarReleaseSubscriptionForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await toggleGithubStarReleaseSubscriptionForAgent(
        stringParam(params.full_name),
        Boolean(params.subscribed),
      )
      return { success: true, data: result, message: `${result.subscribed ? '已订阅' : '已取消订阅'} ${result.fullName} 的 release。` }
    } catch (error) {
      return asErrorResult('更新 GitHub Star release 订阅失败', error)
    }
  },
}

export const githubMarkReleaseReadTool: Tool = {
  name: 'github_mark_release_read',
  description: 'Mark a locally cached GitHub Star release as read.',
  category: 'web',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  parameters: [
    { name: 'release_id', type: 'number', description: 'Release id.', required: true },
  ],
  execute: async (params) => {
    try {
      const { markGithubStarReleaseReadForAgent } = await import('@/lib/github-stars/agent-service')
      const result = await markGithubStarReleaseReadForAgent(Number(params.release_id))
      return { success: true, data: result, message: `已标记 release ${result.releaseId} 为已读。` }
    } catch (error) {
      return asErrorResult('标记 GitHub Star release 已读失败', error)
    }
  },
}

export const githubStarTools: Tool[] = [
  githubSyncStarredTool,
  githubListStarredTool,
  githubSummarizeRecentStarsTool,
  githubSearchMyStarsTool,
  githubListStarReleasesTool,
  githubListMyForksTool,
  githubStarRepoTool,
  githubUnstarRepoTool,
  githubUpdateStarCategoryTool,
  githubUpdateStarNotesTagsTool,
  githubSubscribeStarReleasesTool,
  githubMarkReleaseReadTool,
]
```

**Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS, or only unrelated existing failures outside the files touched in this task.

**Step 3: Commit**

```bash
git add src/lib/agent/tools/github-star-tools.ts
git commit -m "Expose GitHub Star workflows as agent tools" \
  -m "Constraint: Keep agent tools thin and delegate GitHub/domain behavior to the service layer." \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: pnpm typecheck"
```

## Task 7: Register GitHub Star Tools

**Files:**
- Modify: `src/lib/agent/tools/index.ts`

**Step 1: Import and register the tool group**

In `src/lib/agent/tools/index.ts`, add the import:

```ts
import { githubStarTools } from './github-star-tools'
```

Add the spread near the existing GitHub trending tools:

```ts
  ...githubStarTools,
  ...githubTrendingTools,
```

Add the export:

```ts
export * from './github-star-tools'
```

**Step 2: Run typecheck and agent tests**

Run:

```bash
pnpm typecheck
pnpm test:agent
pnpm test:github-stars-agent
```

Expected: all PASS, or only unrelated existing typecheck failures outside the implementation files.

**Step 3: Commit**

```bash
git add src/lib/agent/tools/index.ts
git commit -m "Register GitHub Star tools with the agent" \
  -m "Constraint: Personal GitHub Star tools should sit beside public GitHub discovery tools without replacing them." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: pnpm typecheck; pnpm test:agent; pnpm test:github-stars-agent"
```

## Task 8: Add Tool Registration Smoke Test

**Files:**
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Add static file checks**

Because `src/lib/agent/tools/index.ts` imports browser/Tauri-facing modules through path aliases, avoid importing the whole tool registry in this Node test. Add a static check near the end of `scripts/agent-core-tests.mjs`:

```js
  const githubStarToolsSource = await readFile(join(repoRoot, 'src/lib/agent/tools/github-star-tools.ts'), 'utf8')
  for (const toolName of [
    'github_sync_starred',
    'github_list_starred',
    'github_summarize_recent_stars',
    'github_search_my_stars',
    'github_list_star_releases',
    'github_list_my_forks',
    'github_star_repo',
    'github_unstar_repo',
    'github_update_star_category',
    'github_update_star_notes_tags',
    'github_subscribe_star_releases',
    'github_mark_release_read',
  ]) {
    assert.match(githubStarToolsSource, new RegExp(`name:\\s*['"]${toolName}['"]`))
  }

  const toolIndexSource = await readFile(join(repoRoot, 'src/lib/agent/tools/index.ts'), 'utf8')
  assert.match(toolIndexSource, /import \{ githubStarTools \} from '\.\/github-star-tools'/)
  assert.match(toolIndexSource, /\.\.\.githubStarTools/)
```

**Step 2: Run tests**

Run:

```bash
pnpm test:agent
```

Expected: PASS.

**Step 3: Commit**

```bash
git add scripts/agent-core-tests.mjs
git commit -m "Smoke test GitHub Star agent tool registration" \
  -m "Constraint: Avoid importing browser-bound agent tools in the Node assertion harness." \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Tested: pnpm test:agent"
```

## Task 9: Final Verification

**Files:**
- Verify all touched files

**Step 1: Run automated checks**

Run:

```bash
pnpm test:github-stars-agent
pnpm test:agent
pnpm typecheck
```

Expected:

- `pnpm test:github-stars-agent`: PASS.
- `pnpm test:agent`: PASS.
- `pnpm typecheck`: PASS, unless unrelated dirty workspace changes already break typecheck. If so, include exact unrelated file paths in the final report.

**Step 2: Manual app smoke checks**

Start the app if needed:

```bash
pnpm dev
```

In the app chat, test:

```text
帮我总结最近一周 GitHub 上都添加了哪些星标开源项目
```

Expected:

- Agent uses `github_summarize_recent_stars`, or first uses `github_sync_starred` when local data is empty/stale.
- Final answer mentions total count, project list, language/category/topic distribution, and noteworthy projects.

Then test:

```text
在我的 GitHub Star 里搜索 agent framework
```

Expected:

- Agent uses `github_search_my_stars`.
- Final answer only discusses repositories from the user's personal Star cache.

Then test a write confirmation path:

```text
帮我 Star octocat/Hello-World
```

Expected:

- Agent chooses `github_star_repo`.
- UI requires confirmation before the tool runs.

Then test destructive confirmation:

```text
帮我取消 Star octocat/Hello-World
```

Expected:

- Agent chooses `github_unstar_repo`.
- UI treats it as high risk and requires confirmation.

**Step 3: Final commit if verification fixes were needed**

If verification required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "Verify GitHub Star agent tools end to end" \
  -m "Constraint: Keep fixes scoped to GitHub Star agent service, tools, tests, or policy." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: pnpm test:github-stars-agent; pnpm test:agent; pnpm typecheck"
```

## Completion Criteria

The implementation is complete when:

- The agent can summarize recent personal GitHub Stars from local synced data.
- The agent can list and search personal GitHub Stars.
- The agent can list releases and forks through the new tools.
- Star/unstar/category/tag/subscription/read-state actions exist with the intended risk levels.
- `pnpm test:github-stars-agent` passes.
- `pnpm test:agent` passes.
- `pnpm typecheck` passes or only reports documented unrelated pre-existing failures.
