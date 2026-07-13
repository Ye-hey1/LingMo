import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function loadTsCommonJs(relativePath, mocks = {}) {
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

  const module = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    throw new Error(`Unexpected dependency while loading ${relativePath}: ${specifier}`)
  }
  const evaluate = new Function('require', 'module', 'exports', output)
  evaluate(localRequire, module, module.exports)
  return module.exports
}

function createLinkMark(overrides = {}) {
  return {
    id: 101,
    tagId: 7,
    type: 'link',
    content: '',
    desc: '示例来源',
    url: 'https://example.com/article',
    deleted: 0,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

const markMarkdown = await loadTsCommonJs('src/lib/mark-to-markdown.ts')
const recordToNote = await loadTsCommonJs('src/lib/record-to-note.ts', {
  '@tauri-apps/plugin-fs': {
    exists: async () => false,
    readTextFile: async () => '',
    writeTextFile: async () => {},
  },
  '@/lib/mark-to-markdown': markMarkdown,
  '@/lib/sync/filename-utils': { sanitizeFileName: (value) => value },
  '@/lib/workspace': {
    getFilePathOptions: async (path) => ({ path }),
    getWorkspacePath: async () => ({ isCustom: true }),
  },
  '@/lib/github-project': {
    buildGitHubProjectsCollectionMarkdown: () => '# GitHub projects',
    buildGitHubProjectsComparisonMarkdown: () => '# GitHub comparison',
    isGitHubProjectMark: () => false,
  },
})

const tests = []
function test(name, run) {
  tests.push({ name, run })
}

const organizedBody = [
  '# AI 整理结果',
  '',
  '## 核心结论',
  '',
  '链接正文中的关键知识必须进入正式笔记。',
].join('\n')

test('普通链接转 Markdown 时保留来源链接和已抓取/AI 整理正文', () => {
  const markdown = markMarkdown.markToMarkdown(createLinkMark({ content: organizedBody }))

  assert.match(markdown, /https:\/\/example\.com\/article/, '转换结果应保留来源链接')
  assert.match(markdown, /链接正文中的关键知识必须进入正式笔记/, '转换结果不应丢失链接正文')
})

test('普通链接转正式笔记时包含已抓取/AI 整理正文', () => {
  const note = recordToNote.buildRecordsMarkdown([
    createLinkMark({ content: organizedBody }),
  ])

  assert.match(note, /^# 示例来源$/m)
  assert.match(note, /https:\/\/example\.com\/article/, '正式笔记应保留来源链接')
  assert.match(note, /## 核心结论/, '正式笔记应包含 AI 整理后的正文结构')
  assert.match(note, /链接正文中的关键知识必须进入正式笔记/)
})

test('GitHub 专用 Markdown 格式保持原样兼容', () => {
  const githubContent = [
    '<!-- lingmo:github-project {"fullName":"guyue356/Video2TechBlog"} -->',
    '# guyue356/Video2TechBlog',
    '',
    '## 项目摘要',
    '',
    '用于将视频整理为技术博客。',
  ].join('\n')

  const markdown = markMarkdown.markToMarkdown(createLinkMark({
    url: 'https://github.com/guyue356/Video2TechBlog',
    content: githubContent,
  }))

  assert.equal(markdown, githubContent)
})

test('普通链接正文为空时仍生成来源链接', () => {
  const markdown = markMarkdown.markToMarkdown(createLinkMark({ content: '' }))

  assert.equal(markdown, '[示例来源](https://example.com/article)')
})

test('正文已包含来源 URL 时不重复追加原链接', () => {
  const contentWithSource = `${organizedBody}\n\n来源：https://example.com/article`
  const markdown = markMarkdown.markToMarkdown(createLinkMark({ content: contentWithSource }))

  assert.equal(markdown, contentWithSource)
  assert.equal(markdown.match(/https:\/\/example\.com\/article/g)?.length, 1)
})

test('追加到现有笔记时同样保留链接正文', () => {
  const appended = recordToNote.buildRecordsAppendMarkdown([
    createLinkMark({ content: organizedBody }),
  ])

  assert.match(appended, /## 核心结论/)
  assert.match(appended, /https:\/\/example\.com\/article/)
})

let passed = 0
const failures = []

for (const { name, run } of tests) {
  try {
    await run()
    passed += 1
    process.stdout.write(`\u2713 ${name}\n`)
  } catch (error) {
    failures.push({ name, error })
    process.stderr.write(`\u2717 ${name}\n  ${error.message}\n`)
  }
}

process.stdout.write(`\nlink-record-upgrade tests: ${passed}/${tests.length} passed\n`)

if (failures.length > 0) {
  process.exitCode = 1
}
