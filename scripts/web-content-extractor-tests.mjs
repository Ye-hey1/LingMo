import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(repoRoot, '.tmp'), { recursive: true })
const tempDir = await mkdtemp(join(repoRoot, '.tmp', 'lingmo-web-content-tests-'))
const require = createRequire(import.meta.url)

async function importTsCommonJs(relativePath) {
  const sourcePath = join(repoRoot, relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText

  const outPath = join(tempDir, relativePath.replace(/\.tsx?$/, '.cjs'))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
  return require(outPath)
}

try {
  const source = await readFile(join(repoRoot, 'src/lib/web/content-extractor.ts'), 'utf8')
  assert.match(source, /const NOISY_SELECTOR = \[/)
  for (const tag of ['"header"', '"footer"', '"aside"', '"nav"', '"form"', '"button"', '"input"', '"select"', '"textarea"']) {
    assert.match(source, new RegExp(tag), `${tag} should be stripped from extracted pages`)
  }
  assert.match(source, /FOCUSED_CONTENT_SELECTOR/)
  assert.match(source, /\.topic-post:first-of-type \.cooked/)
  assert.match(source, /formatExtractedWebMarkdown/)
  assert.match(source, /buildReadableWebMarkdown/)

  const {
    buildReadableWebMarkdown,
    formatExtractedWebMarkdown,
  } = await importTsCommonJs('src/lib/web/content-extractor.ts')

  const messyForumMarkdown = [
    '# Vibe coding需要知道的设计术语——布局排版',
    '',
    '搞七捻三',
    '',
    '纯水',
    '',
    'You have selected 0 posts.',
    '',
    'select all',
    '',
    'cancel selecting',
    '',
    'Jun 26',
    '',
    '1 / 44',
    '',
    '1h ago',
    '',
    'post by Henry_He 18 hours ago',
    '',
    '布局排版是界面设计里最基础的骨架，它决定内容的阅读顺序、层级和节奏。',
    '',
    '## 栅格系统',
    '',
    '通过列、间距和对齐规则约束页面，避免内容随意漂移。',
    '',
    '1.1k views 240 likes 2 links 38 users',
    '',
    'read 4 min',
    '',
    'post by Northam 18 hours ago',
    '',
    '强强',
    '',
    'post by kuschzzp 18 hours ago',
    '',
    '太棒了',
    '',
    'post by leibi 18 hours ago',
    '',
    'post by ChatAI 18 hours ago',
  ].join('\n')

  const cleaned = formatExtractedWebMarkdown(messyForumMarkdown)
  assert.match(cleaned, /Vibe coding需要知道的设计术语/)
  assert.match(cleaned, /布局排版是界面设计里最基础的骨架/)
  assert.match(cleaned, /## 栅格系统/)
  assert.match(cleaned, /避免内容随意漂移/)
  assert.doesNotMatch(cleaned, /You have selected 0 posts/i)
  assert.doesNotMatch(cleaned, /select all/i)
  assert.doesNotMatch(cleaned, /cancel selecting/i)
  assert.doesNotMatch(cleaned, /1 \/ 44/)
  assert.doesNotMatch(cleaned, /post by Henry_He/i)
  assert.doesNotMatch(cleaned, /post by Northam/i)
  assert.doesNotMatch(cleaned, /1\.1k views/i)
  assert.doesNotMatch(cleaned, /read 4 min/i)
  assert.doesNotMatch(cleaned, /^强强$/m)

  const readable = buildReadableWebMarkdown({
    title: 'Vibe coding需要知道的设计术语——布局排版',
    url: 'https://example.com/topic/44',
    metaDesc: '设计术语整理',
    content: messyForumMarkdown,
  })
  assert.match(readable, /^# Vibe coding需要知道的设计术语——布局排版/m)
  assert.match(readable, /^> 来源：https:\/\/example\.com\/topic\/44/m)
  assert.match(readable, /^> 摘要：设计术语整理/m)
  assert.match(readable, /^## 正文/m)
  assert.equal(
    (readable.match(/^# Vibe coding需要知道的设计术语——布局排版$/gm) || []).length,
    1,
    'structured record should not duplicate the source H1',
  )
  assert.doesNotMatch(readable, /post by ChatAI/i)

  process.stdout.write('web-content-extractor tests passed\n')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
