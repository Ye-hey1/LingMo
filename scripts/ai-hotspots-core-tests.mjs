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
    signalSummary: null,
    signalEssence: null,
    impactAudience: [],
    suggestedAction: null,
    relatedSignalIds: [],
    isIgnored: false,
    deletedAt: null,
    digestStatus: 'none',
    snapshotId: null,
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
    filterHotspotsByWindow,
    isAiHotspotRelated,
    scoreHotspotItem,
  } = await importTsModule('src/lib/ai-hotspots/rules.ts')
  const {
    buildHotspotDigestMarkdown,
  } = await importTsModule('src/lib/ai-hotspots/digest.ts')
  const {
    shouldAutoRefreshAiHotspots,
  } = await importTsModule('src/lib/ai-hotspots/refresh-policy.ts')
  const {
    DEFAULT_RSS_FEEDS,
    AI_HOT_ALL_FEED_URL,
    AI_HOT_DAILY_FEED_URL,
    AI_HOT_FEATURED_FEED_URL,
    AI_HOT_RSS_SOURCE_ID,
    getDefaultRssFeedRole,
  } = await importTsModule('src/lib/ai-hotspots/feeds.ts')
  const {
    parseRssItems,
  } = await importTsModule('src/lib/ai-hotspots/rss.ts')
  const {
    parseAiHotDailyPage,
  } = await importTsModule('src/lib/ai-hotspots/daily-page.ts')

  assert.equal(normalizeHotspotUrl('https://example.com/a?utm_source=x#top'), 'https://example.com/a')
  assert.equal(normalizeHotspotTitle('  GPT-5  发布！ '), 'gpt5发布')
  assert.equal(isAiHotspotRelated({ siteId: 'aihot', title: 'anything', source: '', siteName: '', url: '' }), true)
  assert.equal(isAiHotspotRelated({ siteId: 'news', title: 'OpenAI releases new agent model', source: '', siteName: '', url: '' }), true)
  assert.equal(isAiHotspotRelated({ siteId: 'news', title: '明星八卦和足球彩票', source: '', siteName: '', url: '' }), false)
  assert.deepEqual(dedupeHotspotItems([
    item({ id: 'old', title: 'OpenAI update', url: 'https://x.com/a', publishedAt: '2026-06-08T00:00:00.000Z' }),
    item({ id: 'new', title: 'OpenAI update', url: 'https://x.com/a?utm_source=rss', publishedAt: '2026-06-09T00:00:00.000Z' }),
  ]).map(item => item.id), ['new'])
  assert.deepEqual(dedupeHotspotItems([
    item({ id: 'old-title', title: '  GPT-5  发布！ ', url: 'https://source-a.example/news', publishedAt: '2026-06-08T00:00:00.000Z' }),
    item({ id: 'new-title', title: 'GPT5发布', url: 'https://source-b.example/item', publishedAt: '2026-06-09T00:00:00.000Z' }),
  ]).map(item => item.id), ['new-title'])
  assert.deepEqual(dedupeHotspotItems([
    item({
      id: 'daily-2026-06-09',
      feedName: 'AI HOT 日报明细 · 2026-06-09 · 模型发布 · 官方',
      title: 'Claude Fable 5 和 Claude Mythos 5',
      url: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
      publishedAt: '2026-06-09T00:00:01.000Z',
      lastSeenAt: '2026-06-09T00:00:01.000Z',
      meta: {
        feedRole: 'daily-article',
        dailyIssueDate: '2026-06-09',
        dailyArticleIndex: 1,
        dailyArticleKey: '2026-06-09:1:1:claude-fable-5',
      },
    }),
    item({
      id: 'daily-2026-06-10',
      feedName: 'AI HOT 日报明细 · 2026-06-10 · 模型发布 · 官方',
      title: 'Claude Fable 5 和 Claude Mythos 5',
      url: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
      publishedAt: '2026-06-10T00:00:01.000Z',
      lastSeenAt: '2026-06-10T00:00:01.000Z',
      meta: {
        feedRole: 'daily-article',
        dailyIssueDate: '2026-06-10',
        dailyArticleIndex: 1,
        dailyArticleKey: '2026-06-10:1:1:claude-fable-5',
      },
    }),
  ]).map(item => item.id), ['daily-2026-06-10', 'daily-2026-06-09'])
  assert.deepEqual(dedupeHotspotItems([
    item({ id: 'empty-a', title: '', url: '', publishedAt: '2026-06-08T00:00:00.000Z', lastSeenAt: '2026-06-08T00:00:00.000Z' }),
    item({ id: 'empty-b', title: '   ', url: '   ', publishedAt: '2026-06-09T00:00:00.000Z', lastSeenAt: '2026-06-09T00:00:00.000Z' }),
  ]).map(item => item.id), ['empty-b', 'empty-a'])
  assert.deepEqual(classifyHotspotTags('OpenAI 发布新模型和 Agent SDK'), ['AI模型', '产品应用', '行业动态'])
  assert.equal(scoreHotspotItem(item({
    sourceId: 'aihot',
    title: 'OpenAI releases new GPT agent model',
    tags: ['模型发布', '开发工具'],
  })) > scoreHotspotItem(item({
    sourceId: 'generic',
    title: 'General technology market note',
    tags: [],
  })), true)

  const now = new Date('2026-06-09T12:00:00.000Z')
  const windowItems = [
    item({ id: 'recent', publishedAt: '2026-06-09T00:00:00.000Z', lastSeenAt: '2026-06-09T00:00:00.000Z' }),
    item({ id: 'week', publishedAt: '2026-06-04T12:00:00.000Z', lastSeenAt: '2026-06-04T12:00:00.000Z' }),
    item({ id: 'stale', publishedAt: '2026-05-30T12:00:00.000Z', lastSeenAt: '2026-05-30T12:00:00.000Z' }),
    item({ id: 'future', publishedAt: '2026-06-10T12:00:00.000Z', lastSeenAt: '2026-06-10T12:00:00.000Z' }),
  ]
  assert.deepEqual(filterHotspotsByWindow(windowItems, '24h', now).map(item => item.id), ['recent'])
  assert.deepEqual(filterHotspotsByWindow(windowItems, '7d', now).map(item => item.id), ['recent', 'week'])

  assert.equal(shouldAutoRefreshAiHotspots({
    autoRefreshOnOpen: false,
    lastRefreshAt: null,
    cooldownMinutes: 30,
    now,
  }), false)
  assert.equal(shouldAutoRefreshAiHotspots({
    autoRefreshOnOpen: true,
    lastRefreshAt: null,
    cooldownMinutes: 30,
    now,
  }), true)
  assert.equal(shouldAutoRefreshAiHotspots({
    autoRefreshOnOpen: true,
    lastRefreshAt: '2026-06-09T11:45:00.000Z',
    cooldownMinutes: 30,
    now,
  }), false)
  assert.equal(shouldAutoRefreshAiHotspots({
    autoRefreshOnOpen: true,
    lastRefreshAt: '2026-06-09T11:00:00.000Z',
    cooldownMinutes: 30,
    now,
  }), true)

  assert.deepEqual(DEFAULT_RSS_FEEDS.map(feed => feed.url), [
    AI_HOT_FEATURED_FEED_URL,
    AI_HOT_ALL_FEED_URL,
    AI_HOT_DAILY_FEED_URL,
  ])
  assert.deepEqual(DEFAULT_RSS_FEEDS.map(feed => feed.role), ['featured', 'all', 'daily'])
  assert.equal(getDefaultRssFeedRole({ title: 'AI HOT 日报', feedUrl: AI_HOT_DAILY_FEED_URL }), 'daily')
  assert.equal(getDefaultRssFeedRole({ title: 'AI HOT 全部动态', feedUrl: AI_HOT_ALL_FEED_URL }), 'all')
  assert.equal(getDefaultRssFeedRole({ title: 'AI HOT 精选', feedUrl: AI_HOT_FEATURED_FEED_URL }), 'featured')

  const featuredRssItems = parseRssItems(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[mlx-vlm v0.6.3 发布，Day-0 支持 DiffusionGemma]]></title>
          <link>https://x.com/berryxia/status/2064875107278098769</link>
          <description><![CDATA[mlx-vlm v0.6.3 上线，首发支持 DiffusionGemma。]]></description>
          <pubDate>Thu, 11 Jun 2026 00:59:23 GMT</pubDate>
          <guid isPermaLink="false">cmq8svjva05grslldediy0tpk</guid>
          <author>noreply@aihot.virxact.com (X：Berry Xia (@berryxia))</author>
        </item>
      </channel>
    </rss>`, {
    sourceId: AI_HOT_RSS_SOURCE_ID,
    sourceName: 'AI HOT RSS',
    feedName: 'AI HOT 精选',
    feedUrl: AI_HOT_FEATURED_FEED_URL,
    feedRole: 'featured',
  })
  assert.equal(featuredRssItems.length, 1)
  assert.equal(featuredRssItems[0].meta.summary, 'mlx-vlm v0.6.3 上线，首发支持 DiffusionGemma。')
  assert.equal(featuredRssItems[0].meta.feedRole, 'featured')
  assert.equal(featuredRssItems[0].meta.author, 'noreply@aihot.virxact.com (X：Berry Xia (@berryxia))')

  const rssItems = parseRssItems(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[AI HOT 日报 · 2026-06-10 — Claude Fable 5]]></title>
          <link>https://aihot.virxact.com/daily/2026-06-10</link>
          <description><![CDATA[Claude Fable 5 — 点击查看完整日报]]></description>
          <pubDate>Wed, 10 Jun 2026 00:00:00 GMT</pubDate>
          <guid isPermaLink="false">daily-2026-06-10</guid>
          <author>noreply@aihot.virxact.com (AI HOT)</author>
        </item>
      </channel>
    </rss>`, {
    sourceId: AI_HOT_RSS_SOURCE_ID,
    sourceName: 'AI HOT RSS',
    feedName: 'AI HOT 日报',
    feedUrl: AI_HOT_DAILY_FEED_URL,
    feedRole: 'daily',
  })
  assert.equal(rssItems.length, 1)
  assert.equal(rssItems[0].meta.summary, 'Claude Fable 5 — 点击查看完整日报')
  assert.equal(rssItems[0].meta.feedRole, 'daily')
  assert.equal(rssItems[0].meta.guid, 'daily-2026-06-10')

  const dailyFlight = [
    [1, `1:${JSON.stringify([
      '$',
      'section',
      '模型发布/更新',
      {
        className: 'daily-section',
        children: [
          [
            '$',
            'header',
            null,
            {
              className: 'daily-section-header',
              children: [
                ['$', 'h2', null, { className: 'daily-section-title', children: '模型发布/更新' }],
                ['$', 'span', null, { className: 'daily-section-subtitle', children: 'Model Releases' }],
              ],
            },
          ],
          [
            '$',
            'div',
            null,
            {
              className: 'daily-section-articles',
              children: [
                [
                  '$',
                  'article',
                  'article-1',
                  {
                    className: 'daily-article',
                    children: [
                      [
                        '$',
                        'h3',
                        null,
                        {
                          className: 'daily-article-title',
                          children: ['$', 'a', null, { href: 'https://example.com/claude', children: 'Claude Fable 5 和 Claude Mythos 5' }],
                        },
                      ],
                      [
                        '$',
                        'div',
                        null,
                        {
                          className: 'daily-article-source',
                          children: [
                            ['$', 'span', null, { className: 'role-tag', children: '官方' }],
                            ['$', 'span', null, { children: 'Anthropic：Newsroom（网页）' }],
                          ],
                        },
                      ],
                      ['$', 'p', null, { className: 'daily-article-summary', children: 'Anthropic 今日推出 Claude Fable 5。' }],
                    ],
                  },
                ],
              ],
            },
          ],
        ],
      },
    ])}\n`],
  ]
  const dailyHtml = dailyFlight
    .map(payload => `<script>self.__next_f.push(${JSON.stringify(payload)})</script>`)
    .join('')
  const dailyPage = parseAiHotDailyPage(dailyHtml)
  assert.equal(dailyPage.articleCount, 1)
  assert.equal(dailyPage.sections[0].title, '模型发布/更新')
  assert.equal(dailyPage.sections[0].subtitle, 'Model Releases')
  assert.equal(dailyPage.sections[0].articles[0].title, 'Claude Fable 5 和 Claude Mythos 5')
  assert.equal(dailyPage.sections[0].articles[0].role, '官方')
  assert.equal(dailyPage.sections[0].articles[0].source, 'Anthropic：Newsroom（网页）')
  assert.equal(dailyPage.sections[0].articles[0].summary, 'Anthropic 今日推出 Claude Fable 5。')

  const digestMarkdown = buildHotspotDigestMarkdown({
    date: '2026-06-09',
    title: 'AI 热点日报',
    items: [
      item({ title: 'OpenAI 发布新模型', url: 'https://openai.com/news', sourceName: 'OpenAI', tags: ['模型发布'] }),
      item({ title: 'Agent SDK 更新', url: 'https://example.com/sdk', sourceName: 'SDK News', tags: ['开发工具'] }),
    ],
  })
  assert.match(digestMarkdown, /^# AI 热点日报 2026-06-09/m)
  assert.match(digestMarkdown, /^## 精选速览$/m)
  assert.match(digestMarkdown, /^- \[OpenAI 发布新模型\]\(https:\/\/openai\.com\/news\)$/m)
  assert.match(digestMarkdown, /^  来源：OpenAI$/m)
  assert.match(digestMarkdown, /^## 模型发布$/m)
  assert.match(digestMarkdown, /^## 开发工具$/m)
  assert.match(digestMarkdown, /^## 来源$/m)

  console.log('ai hotspots core tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
