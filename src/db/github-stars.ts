import { getDb, serializedWrite } from './index'
import type {
  GithubStarAnalysisResult,
  GithubStarCustomCategory,
  GithubStarForkParent,
  GithubStarForkRepository,
  GithubStarForkSource,
  GithubStarRelease,
  GithubStarReleaseAsset,
  GithubStarRepository,
  GithubStarRepositoryUpdate,
} from '@/types/github-stars'

interface GithubStarRepositoryRow {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  stargazers_count: number | null
  forks_count: number | null
  language: string | null
  created_at: string | null
  updated_at: string | null
  pushed_at: string | null
  starred_at: string | null
  owner_login: string
  owner_avatar_url: string | null
  topics: string | null
  ai_summary: string | null
  ai_tags: string | null
  ai_platforms: string | null
  analyzed_at: string | null
  analysis_failed: number | null
  custom_description: string | null
  custom_tags: string | null
  custom_category: string | null
  category_locked: number | null
  last_edited: string | null
  subscribed_to_releases: number | null
  last_release_fetch_time: string | null
  has_fetched_releases: number | null
  synced_at: number | null
  is_starred: number | null
  is_fork: number | null
}

interface GithubStarCategoryRow {
  name: string
  keywords: string | null
  icon: string | null
  created_at: string
}

interface GithubStarReleaseRow {
  id: number
  repo_id: number
  repo_full_name: string
  repo_name: string
  tag_name: string
  name: string | null
  body: string | null
  published_at: string
  html_url: string
  assets: string | null
  zipball_url: string | null
  tarball_url: string | null
  prerelease: number | null
  is_read: number | null
  fetched_at: number | null
}

interface GithubStarForkRow {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  stargazers_count: number | null
  forks_count: number | null
  language: string | null
  created_at: string | null
  updated_at: string | null
  pushed_at: string | null
  default_branch: string | null
  owner_login: string
  owner_avatar_url: string | null
  source_json: string | null
  parent_json: string | null
  synced_at: number | null
}

const GITHUB_STAR_REPOSITORY_UPSERT_COLUMN_COUNT = 18
const GITHUB_STAR_REPOSITORY_UPSERT_BATCH_SIZE = 50

// tauri-plugin-sql executes through a connection pool, so raw BEGIN/COMMIT
// statements are not reliable across multiple execute calls in this hot path.
async function serializedGithubStarsWrite<T>(
  fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>,
): Promise<T> {
  return serializedWrite(async () => {
    const db = await getDb()
    return fn(db)
  })
}

async function addColumnIfMissing(table: string, column: string, definition: string) {
  const db = await getDb()
  const columns = await db.select<Array<{ name: string }>>(`pragma table_info(${table})`)
  if (!columns.some(item => item.name === column)) {
    await db.execute(`alter table ${table} add column ${column} ${definition}`)
  }
}

function stringifyArray(value: string[]) {
  return JSON.stringify(value.filter(Boolean))
}

function parseArray(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value)
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapRepositoryRow(row: GithubStarRepositoryRow): GithubStarRepository {
  return {
    id: row.id,
    name: row.name,
    fullName: row.full_name,
    description: row.description,
    htmlUrl: row.html_url,
    stargazersCount: Number(row.stargazers_count || 0),
    forksCount: Number(row.forks_count || 0),
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pushedAt: row.pushed_at,
    starredAt: row.starred_at,
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url,
    topics: parseArray(row.topics),
    aiSummary: row.ai_summary,
    aiTags: parseArray(row.ai_tags),
    aiPlatforms: parseArray(row.ai_platforms),
    analyzedAt: row.analyzed_at,
    analysisFailed: Boolean(row.analysis_failed),
    customDescription: row.custom_description,
    customTags: parseArray(row.custom_tags),
    customCategory: row.custom_category,
    categoryLocked: Boolean(row.category_locked),
    lastEdited: row.last_edited,
    subscribedToReleases: Boolean(row.subscribed_to_releases),
    lastReleaseFetchTime: row.last_release_fetch_time,
    hasFetchedReleases: Boolean(row.has_fetched_releases),
    syncedAt: Number(row.synced_at || 0),
    isStarred: row.is_starred !== 0,
    isFork: row.is_fork === 1,
  }
}

function mapCategoryRow(row: GithubStarCategoryRow): GithubStarCustomCategory {
  return {
    name: row.name,
    keywords: parseArray(row.keywords),
    icon: row.icon,
    createdAt: row.created_at,
  }
}

function mapReleaseRow(row: GithubStarReleaseRow): GithubStarRelease {
  return {
    id: row.id,
    tagName: row.tag_name,
    name: row.name,
    body: row.body,
    publishedAt: row.published_at,
    htmlUrl: row.html_url,
    assets: parseJson<GithubStarReleaseAsset[]>(row.assets, []),
    zipballUrl: row.zipball_url,
    tarballUrl: row.tarball_url,
    prerelease: Boolean(row.prerelease),
    repository: {
      id: row.repo_id,
      fullName: row.repo_full_name,
      name: row.repo_name,
    },
    isRead: Boolean(row.is_read),
    fetchedAt: Number(row.fetched_at || 0),
  }
}

function mapForkRow(row: GithubStarForkRow): GithubStarForkRepository {
  return {
    id: row.id,
    name: row.name,
    fullName: row.full_name,
    description: row.description,
    htmlUrl: row.html_url,
    stargazersCount: Number(row.stargazers_count || 0),
    forksCount: Number(row.forks_count || 0),
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pushedAt: row.pushed_at,
    defaultBranch: row.default_branch || 'main',
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url,
    source: parseJson<GithubStarForkSource | null>(row.source_json, null),
    parent: parseJson<GithubStarForkParent | null>(row.parent_json, null),
    syncedAt: Number(row.synced_at || 0),
  }
}

async function upsertGithubStarRepositoriesWithDb(
  db: Awaited<ReturnType<typeof getDb>>,
  repositories: GithubStarRepository[],
  syncedAt: number,
) {
  for (let start = 0; start < repositories.length; start += GITHUB_STAR_REPOSITORY_UPSERT_BATCH_SIZE) {
    const batch = repositories.slice(start, start + GITHUB_STAR_REPOSITORY_UPSERT_BATCH_SIZE)
    const placeholders = batch.map((_, rowIndex) => {
      const offset = rowIndex * GITHUB_STAR_REPOSITORY_UPSERT_COLUMN_COUNT
      return `(${Array.from(
        { length: GITHUB_STAR_REPOSITORY_UPSERT_COLUMN_COUNT },
        (_, columnIndex) => `$${offset + columnIndex + 1}`,
      ).join(',')})`
    }).join(',')
    const params = batch.flatMap(repo => [
      repo.id,
      repo.name,
      repo.fullName,
      repo.description,
      repo.htmlUrl,
      repo.stargazersCount,
      repo.forksCount,
      repo.language,
      repo.createdAt,
      repo.updatedAt,
      repo.pushedAt,
      repo.starredAt,
      repo.ownerLogin,
      repo.ownerAvatarUrl,
      stringifyArray(repo.topics),
      syncedAt,
      1,
      repo.isFork ? 1 : 0,
    ])

    await db.execute(
      `insert into github_star_repositories
        (id, name, full_name, description, html_url, stargazers_count, forks_count, language,
         created_at, updated_at, pushed_at, starred_at, owner_login, owner_avatar_url, topics,
          synced_at, is_starred, is_fork)
       values ${placeholders}
       on conflict(id) do update set
         name = excluded.name,
         full_name = excluded.full_name,
         description = excluded.description,
         html_url = excluded.html_url,
         stargazers_count = excluded.stargazers_count,
         forks_count = excluded.forks_count,
         language = excluded.language,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         pushed_at = excluded.pushed_at,
         starred_at = excluded.starred_at,
         owner_login = excluded.owner_login,
         owner_avatar_url = excluded.owner_avatar_url,
         topics = excluded.topics,
         synced_at = excluded.synced_at,
         is_starred = 1,
         is_fork = excluded.is_fork`,
      params,
    )
  }
}

export async function initGithubStarsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists github_star_repositories (
      id integer primary key,
      name text not null,
      full_name text not null unique,
      description text,
      html_url text not null,
      stargazers_count integer default 0,
      forks_count integer default 0,
      language text,
      created_at text,
      updated_at text,
      pushed_at text,
      starred_at text,
      owner_login text not null,
      owner_avatar_url text,
      topics text,
      ai_summary text,
      ai_tags text,
      ai_platforms text,
      analyzed_at text,
      analysis_failed integer default 0,
      custom_description text,
      custom_tags text,
      custom_category text,
      category_locked integer default 0,
      last_edited text,
      subscribed_to_releases integer default 0,
      last_release_fetch_time text,
      has_fetched_releases integer default 0,
      synced_at integer not null,
      is_starred integer default 1,
      is_fork integer default 0
    )
  `)

  await db.execute(`
    create table if not exists github_star_categories (
      name text primary key,
      keywords text,
      icon text,
      created_at text not null
    )
  `)

  await db.execute(`
    create table if not exists github_star_releases (
      id integer primary key,
      repo_id integer not null,
      repo_full_name text not null,
      repo_name text not null,
      tag_name text not null,
      name text,
      body text,
      published_at text not null,
      html_url text not null,
      assets text,
      zipball_url text,
      tarball_url text,
      prerelease integer default 0,
      is_read integer default 0,
      fetched_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists github_star_forks (
      id integer primary key,
      name text not null,
      full_name text not null unique,
      description text,
      html_url text not null,
      stargazers_count integer default 0,
      forks_count integer default 0,
      language text,
      created_at text,
      updated_at text,
      pushed_at text,
      default_branch text,
      owner_login text not null,
      owner_avatar_url text,
      source_json text,
      parent_json text,
      synced_at integer not null
    )
  `)

  await addColumnIfMissing('github_star_repositories', 'last_release_fetch_time', 'text')
  await addColumnIfMissing('github_star_repositories', 'has_fetched_releases', 'integer default 0')
  await addColumnIfMissing('github_star_repositories', 'synced_at', 'integer default 0')
  await addColumnIfMissing('github_star_repositories', 'is_starred', 'integer default 1')
  await addColumnIfMissing('github_star_repositories', 'is_fork', 'integer default 0')

  await db.execute('create index if not exists idx_github_star_repositories_starred_at on github_star_repositories(starred_at desc)')
  await db.execute('create index if not exists idx_github_star_repositories_language on github_star_repositories(language)')
  await db.execute('create index if not exists idx_github_star_repositories_category on github_star_repositories(custom_category)')
  await db.execute('create index if not exists idx_github_star_releases_published_at on github_star_releases(published_at desc)')
  await db.execute('create index if not exists idx_github_star_releases_repo on github_star_releases(repo_id)')
  await db.execute('create index if not exists idx_github_star_forks_updated_at on github_star_forks(updated_at desc)')
}

export async function getGithubStarRepositories() {
  const db = await getDb()
  const rows = await db.select<GithubStarRepositoryRow[]>(
    `select * from github_star_repositories
     where is_starred = 1
     order by coalesce(starred_at, updated_at, created_at) desc`,
  )
  return rows.map(mapRepositoryRow)
}

export async function getGithubStarCustomCategories() {
  const db = await getDb()
  const rows = await db.select<GithubStarCategoryRow[]>(
    'select name, keywords, icon, created_at from github_star_categories order by created_at asc',
  )
  return rows.map(mapCategoryRow)
}

export async function getGithubStarReleases() {
  const db = await getDb()
  const rows = await db.select<GithubStarReleaseRow[]>(
    `select * from github_star_releases
     order by published_at desc`,
  )
  return rows.map(mapReleaseRow)
}

export async function getGithubStarForkRepositories() {
  const db = await getDb()
  const rows = await db.select<GithubStarForkRow[]>(
    `select * from github_star_forks
     order by coalesce(updated_at, pushed_at, created_at) desc`,
  )
  return rows.map(mapForkRow)
}

export async function upsertGithubStarRepositories(repositories: GithubStarRepository[]) {
  const syncedAt = Date.now()

  await serializedGithubStarsWrite(async (db) => {
    await upsertGithubStarRepositoriesWithDb(db, repositories, syncedAt)
    await db.execute('update github_star_repositories set is_starred = 0 where synced_at <> $1', [syncedAt])
  })
}

export async function upsertGithubStarRepositoriesBatch(
  repositories: GithubStarRepository[],
  syncedAt: number,
  options: { finishSync?: boolean } = {},
) {
  if (repositories.length === 0 && !options.finishSync) return

  await serializedGithubStarsWrite(async (db) => {
    if (repositories.length > 0) {
      await upsertGithubStarRepositoriesWithDb(db, repositories, syncedAt)
    }
    if (options.finishSync) {
      await db.execute('update github_star_repositories set is_starred = 0 where synced_at <> $1', [syncedAt])
    }
  })
}

export async function upsertGithubStarReleases(releases: GithubStarRelease[]) {
  if (releases.length === 0) return

  await serializedGithubStarsWrite(async (db) => {
    for (const release of releases) {
      await db.execute(
        `insert into github_star_releases
            (id, repo_id, repo_full_name, repo_name, tag_name, name, body, published_at, html_url,
             assets, zipball_url, tarball_url, prerelease, is_read, fetched_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           on conflict(id) do update set
             repo_id = excluded.repo_id,
             repo_full_name = excluded.repo_full_name,
             repo_name = excluded.repo_name,
             tag_name = excluded.tag_name,
             name = excluded.name,
             body = excluded.body,
             published_at = excluded.published_at,
             html_url = excluded.html_url,
             assets = excluded.assets,
             zipball_url = excluded.zipball_url,
             tarball_url = excluded.tarball_url,
             prerelease = excluded.prerelease,
             fetched_at = excluded.fetched_at`,
        [
          release.id,
          release.repository.id,
          release.repository.fullName,
          release.repository.name,
          release.tagName,
          release.name,
          release.body,
          release.publishedAt,
          release.htmlUrl,
          stringifyJson(release.assets),
          release.zipballUrl,
          release.tarballUrl,
          Number(release.prerelease),
          Number(release.isRead),
          release.fetchedAt,
        ],
      )
    }
  })
}

export async function upsertGithubStarForkRepositories(forks: GithubStarForkRepository[]) {
  const syncedAt = Date.now()

  await serializedGithubStarsWrite(async (db) => {
    for (const fork of forks) {
      await db.execute(
        `insert into github_star_forks
            (id, name, full_name, description, html_url, stargazers_count, forks_count, language,
             created_at, updated_at, pushed_at, default_branch, owner_login, owner_avatar_url,
             source_json, parent_json, synced_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           on conflict(id) do update set
             name = excluded.name,
             full_name = excluded.full_name,
             description = excluded.description,
             html_url = excluded.html_url,
             stargazers_count = excluded.stargazers_count,
             forks_count = excluded.forks_count,
             language = excluded.language,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             pushed_at = excluded.pushed_at,
             default_branch = excluded.default_branch,
             owner_login = excluded.owner_login,
             owner_avatar_url = excluded.owner_avatar_url,
             source_json = excluded.source_json,
             parent_json = excluded.parent_json,
             synced_at = excluded.synced_at`,
        [
          fork.id,
          fork.name,
          fork.fullName,
          fork.description,
          fork.htmlUrl,
          fork.stargazersCount,
          fork.forksCount,
          fork.language,
          fork.createdAt,
          fork.updatedAt,
          fork.pushedAt,
          fork.defaultBranch,
          fork.ownerLogin,
          fork.ownerAvatarUrl,
          stringifyJson(fork.source),
          stringifyJson(fork.parent),
          syncedAt,
        ],
      )
    }

    await db.execute('delete from github_star_forks where synced_at <> $1', [syncedAt])
  })
}

export async function finishGithubStarSync(syncedAt: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update github_star_repositories set is_starred = 0 where synced_at <> $1', [syncedAt])
  })
}

export async function updateGithubStarReleaseSubscription(repoId: number, subscribed: boolean) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update github_star_repositories
       set subscribed_to_releases = $1,
           last_edited = $2
       where id = $3`,
      [Number(subscribed), new Date().toISOString(), repoId],
    )
  })
}

export async function markGithubStarRepositoryReleasesFetched(repoId: number, fetchedAt: string) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update github_star_repositories
       set last_release_fetch_time = $1,
           has_fetched_releases = 1
       where id = $2`,
      [fetchedAt, repoId],
    )
  })
}

export async function markGithubStarReleaseRead(releaseId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('update github_star_releases set is_read = 1 where id = $1', [releaseId])
  })
}

export async function updateGithubStarAnalysis(repoId: number, analysis: GithubStarAnalysisResult) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update github_star_repositories
       set ai_summary = $1,
           ai_tags = $2,
           ai_platforms = $3,
           analyzed_at = $4,
           analysis_failed = 0
       where id = $5`,
      [
        analysis.summary,
        stringifyArray(analysis.tags),
        stringifyArray(analysis.platforms),
        new Date().toISOString(),
        repoId,
      ],
    )
  })
}

export async function markGithubStarAnalysisFailed(repoId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'update github_star_repositories set analysis_failed = 1 where id = $1',
      [repoId],
    )
  })
}

export async function updateGithubStarCategory(repoId: number, category: string | null) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'update github_star_repositories set custom_category = $1, category_locked = $2, last_edited = $3 where id = $4',
      [category?.trim() || null, Boolean(category?.trim()), new Date().toISOString(), repoId],
    )
  })
}

export async function addGithubStarCustomCategory(category: Pick<GithubStarCustomCategory, 'name' | 'keywords' | 'icon'>) {
  const name = category.name.trim()
  if (!name) return

  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into github_star_categories (name, keywords, icon, created_at)
       values ($1, $2, $3, $4)
       on conflict(name) do update set
         keywords = excluded.keywords,
         icon = excluded.icon`,
      [
        name,
        stringifyArray(category.keywords),
        category.icon?.trim() || null,
        new Date().toISOString(),
      ],
    )
  })
}

export async function updateGithubStarRepositoryDetails(repoId: number, update: GithubStarRepositoryUpdate) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update github_star_repositories
       set custom_description = $1,
           custom_tags = $2,
           custom_category = $3,
           category_locked = $4,
           last_edited = $5
       where id = $6`,
      [
        update.customDescription?.trim() || null,
        stringifyArray(update.customTags || []),
        update.customCategory?.trim() || null,
        Boolean(update.customCategory?.trim()),
        new Date().toISOString(),
        repoId,
      ],
    )
  })
}

export async function deleteGithubStarCustomCategory(name: string) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('delete from github_star_categories where name = $1', [name.trim()])
  })
}

export async function markGithubStarRepositoryUnstarred(repoId: number) {
  await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      'update github_star_repositories set is_starred = 0, last_edited = $1 where id = $2',
      [new Date().toISOString(), repoId],
    )
  })
}
