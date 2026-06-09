import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-ai-hotspots-core-tests-'))
const compiledModules = new Set()

function toMjsRelativePath(relativePath) {
  return relativePath.replace(/\.tsx?$/, '.mjs')
}

function resolveRelativeDependency(currentRelativePath, specifier) {
  const currentDir = dirname(join(repoRoot, currentRelativePath))
  const basePath = resolve(currentDir, specifier)
  return resolveDependencyPath(basePath)
}

function resolveAliasDependency(specifier) {
  if (!specifier.startsWith('@/')) return null
  return resolveDependencyPath(resolve(repoRoot, 'src', specifier.slice(2)))
}

function resolveDependencyPath(basePath) {
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
    const dependencyRelativePath = specifier.startsWith('.')
      ? resolveRelativeDependency(relativePath, specifier)
      : resolveAliasDependency(specifier)
    if (!dependencyRelativePath) return match
    dependencies.add(dependencyRelativePath)
    return `${prefix}${rewriteSpecifier(relativePath, dependencyRelativePath)}${suffix}`
  }

  let rewritten = output.replace(/(from\s+['"])(\.{1,2}\/[^'"]+|@\/[^'"]+)(['"])/g, rewrite)
  rewritten = rewritten.replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"]+|@\/[^'"]+)(['"]\s*\))/g, rewrite)

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

function item(overrides) {
  return {
    id: 'item-1',
    sourceId: 'default',
    sourceName: 'Default',
    feedName: 'Default',
    title: 'OpenAI update',
    titleOriginal: null,
    titleEn: null,
    titleZh: null,
    url: 'https://example.com/item',
    publishedAt: '2026-06-09T00:00:00.000Z',
    firstSeenAt: '2026-06-09T00:00:00.000Z',
    lastSeenAt: '2026-06-09T00:00:00.000Z',
    summary: null,
    tags: [],
    score: 0,
    isFavorite: false,
    isRead: false,
    savedNotePath: null,
    ...overrides,
  }
}

try {
  const {
    normalizeHotspotTitle,
    normalizeHotspotUrl,
  } = await importTsModule('src/lib/ai-hotspots/normalize.ts')
  const {
    classifyHotspotTags,
    dedupeHotspotItems,
    isAiHotspotRelated,
  } = await importTsModule('src/lib/ai-hotspots/rules.ts')
  const {
    buildHotspotDigestMarkdown,
  } = await importTsModule('src/lib/ai-hotspots/digest.ts')

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
  const digestMarkdown = buildHotspotDigestMarkdown({
    date: '2026-06-09',
    title: 'AI 热点日报',
    items: [item({ title: 'OpenAI 发布新模型', url: 'https://openai.com/news', sourceName: 'OpenAI' })],
  })
  assert.match(digestMarkdown, /^# AI 热点日报 2026-06-09/m)
  assert.match(digestMarkdown, /^## 速览$/m)
  assert.match(digestMarkdown, /^- \[OpenAI 发布新模型\]\(https:\/\/openai\.com\/news\) - OpenAI$/m)
  assert.match(digestMarkdown, /^## 来源$/m)

  console.log('ai hotspots core tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
