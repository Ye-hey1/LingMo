import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-output-workshop-tests-'))

async function importTsModule(relativePath) {
  const sourcePath = join(repoRoot, relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText
  const outPath = join(tempDir, relativePath.replace(/[\\/]/g, '__').replace(/\.ts$/, '.mjs'))
  await writeFile(outPath, output, 'utf8')
  return import(pathToFileURL(outPath).href)
}

try {
  const {
    parseOutputExtractionResult,
  } = await importTsModule('src/lib/output-workshop/extraction.ts')
  const {
    getOutputTitleFromPath,
  } = await importTsModule('src/lib/output-workshop/path-utils.ts')
  const {
    buildGuizangDeck,
    buildGuizangSocialCard,
    buildXiaohongshuStyle,
  } = await importTsModule('src/lib/output-workshop/html-builders.ts')
  const {
    normalizeOutputWorkshopHtml,
  } = await importTsModule('src/lib/output-workshop/html-normalizer.ts')

  const parsed = parseOutputExtractionResult(
    '```json\n{"title":"标题","subtitle":"副标题","sections":[{"title":"一","bullets":["a"]}]}\n```',
    '# fallback\n正文',
  )
  assert.equal(parsed.title, '标题')
  assert.equal(parsed.subtitle, '副标题')
  assert.deepEqual(parsed.sections, [{ title: '一', body: undefined, bullets: ['a'] }])
  assert.equal(parsed.usedFallback, false)

  const fallback = parseOutputExtractionResult('not json', '# 第一节\n正文\n## 第二节\n更多', '默认标题')
  assert.equal(fallback.title, '默认标题')
  assert.equal(fallback.usedFallback, true)
  assert.equal(fallback.sections.length, 2)
  assert.equal(fallback.sections[0].title, '第一节')

  assert.equal(getOutputTitleFromPath('notes/research.md'), 'research')
  assert.equal(getOutputTitleFromPath('C:\\Users\\colin\\demo.report.html'), 'demo.report')
  assert.equal(getOutputTitleFromPath(null), '')

  const sampleOptions = {
    title: 'AI 产品方法论',
    subtitle: '从问题定义到可验证结果',
    sourceLabel: 'Output Workshop',
    generatedAt: '2026-05-29 09:00',
    sections: [
      {
        title: '先收敛问题',
        body: '把模糊需求拆成可观察的输入、约束和验收标准。',
        bullets: ['每页只讲一个核心观点', '用证据区承载细节'],
      },
      {
        title: '再组织证据',
        body: '通过编号、网格和安全区保证导出后仍然可读。',
        bullets: ['保留模板编号', '限制色彩层级'],
      },
    ],
  }

  const deckHtml = buildGuizangDeck(sampleOptions)
  assert.match(deckHtml, /template-code">S01/)
  assert.match(deckHtml, /template-code">S02/)
  assert.match(deckHtml, /template-code">S22/)
  assert.match(deckHtml, /class="gz-deck-slide/)
  assert.match(deckHtml, /16 Columns/)

  const socialHtml = buildGuizangSocialCard(sampleOptions)
  assert.match(socialHtml, /template-code">M01/)
  assert.match(socialHtml, /template-code">S03/)
  assert.match(socialHtml, /class="gz-social-card cover-card/)
  assert.match(socialHtml, /class="gz-social-card detail-card/)
  assert.match(socialHtml, /1080 × 1440 · 3:4/)

  const xhsHtml = buildXiaohongshuStyle({
    ...sampleOptions,
    sourceLabel: 'AI产品经理发展史.md',
  })
  assert.match(xhsHtml, /AI产品经理发展史/)
  assert.match(xhsHtml, /产品洞察|技术笔记|研究摘要/)
  assert.doesNotMatch(xhsHtml, /CLAUDE|LingMo输出工坊|LingMo Studio|LINGMO\.STUDIO/)

  const leakedCssHtml = normalizeOutputWorkshopHtml('.canvas { color: #fff; }\n.safe-area { display: flex; }')
  assert.match(leakedCssHtml, /<style>\.canvas \{ color: #fff; \}/)
  assert.match(leakedCssHtml, /id="lingmo-output-workshop-layout-guard"/)
  assert.doesNotMatch(leakedCssHtml, /<body>\.canvas/)

  const fragmentHtml = normalizeOutputWorkshopHtml('<section><h1>标题</h1><p>正文</p></section>')
  assert.match(fragmentHtml, /<!DOCTYPE html>/)
  assert.match(fragmentHtml, /<body><section>/)
  assert.match(fragmentHtml, /<meta name="viewport"/)

  console.log('output workshop tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
