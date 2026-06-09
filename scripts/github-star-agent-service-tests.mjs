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
