/**
 * 运行时验证：import utils.ts(facade)，实际调用各职责的关键函数，
 * 确认拆分后功能完整、依赖分析无遗漏。
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-verify-utils-'))
const transpiled = new Set()

function posixDirname(p) { const n = p.replace(/\\/g, '/'); const i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i) }
function posixResolve(b, s) { const parts = [...(b ? b.split('/') : []), ...s.split('/')]; const r = []; for (const p of parts) { if (p === '' || p === '.') continue; if (p === '..') { r.pop(); continue } r.push(p) } return r.join('/') }

function resolveSpec(spec, currentRel) {
  let target
  if (spec.startsWith('@/')) target = 'src/' + spec.slice(2)
  else if (spec.startsWith('./') || spec.startsWith('../')) target = posixResolve(posixDirname(currentRel), spec)
  else return null
  return target.replace(/\.(tsx?|mjs)$/i, '')
}

async function resolveFile(target) {
  for (const c of [target + '.ts', target + '.tsx', target + '/index.ts', target + '/index.tsx']) {
    try { await readFile(join(repoRoot, c), 'utf8'); return c } catch { /* try next */ }
  }
  return null
}

async function ensure(relativePath) {
  if (transpiled.has(relativePath)) return
  transpiled.add(relativePath)
  const src = await readFile(join(repoRoot, relativePath), 'utf8')
  const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, esModuleInterop: true, strict: true } }).outputText
  // 先把所有 import spec 解析到确定的文件（支持 @/alias 与目录 index），递归 ensure
  const specToFile = new Map()
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const target = resolveSpec(m[1], relativePath)
    if (!target) continue
    const fileRel = await resolveFile(target)
    if (fileRel) { specToFile.set(m[1], fileRel); await ensure(fileRel) }
  }
  // 重写 spec 为对应 tempDir .mjs 的绝对 file URL
  const rewritten = out.replace(/(from\s+["'])([^"']+)(["'])/g, (_f, pre, spec, post) => {
    const fileRel = specToFile.get(spec)
    if (!fileRel) return `${pre}${spec}${post}`
    return `${pre}${pathToFileURL(join(tempDir, fileRel.replace(/\.tsx?$/, '.mjs'))).href}${post}`
  })
  const outPath = join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, rewritten, 'utf8')
}
async function imp(relativePath) { await ensure(relativePath); return import(pathToFileURL(join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))).href) }

const mod = await imp('src/components/output-workshop/utils.ts')
const results = []
const tryTest = (name, fn) => { try { results.push([name, fn()]) } catch (e) { results.push([name, false, e.message]) } }

// prompts
tryTest('EXTRACTION_PROMPT', () => typeof mod.EXTRACTION_PROMPT === 'string' && mod.EXTRACTION_PROMPT.length > 50)
tryTest('CREATIVE_DESIGN_PROMPT', () => typeof mod.CREATIVE_DESIGN_PROMPT === 'string' && mod.CREATIVE_DESIGN_PROMPT.length > 50)
tryTest('REFINE_PROMPT', () => typeof mod.REFINE_PROMPT === 'string' && mod.REFINE_PROMPT.length > 50)
// html-cleaning
tryTest('cleanStreamingHtml', () => { const c = mod.cleanStreamingHtml('```html\n<html><body>hi</body></html>\n```'); return typeof c === 'string' && c.length > 0 })
tryTest('repairTruncatedHtml', () => typeof mod.repairTruncatedHtml('<html><body><p>x') === 'string')
tryTest('prepareOutputHtml', () => typeof mod.prepareOutputHtml('text') === 'string')
// content-analyzer
tryTest('splitContentIntoSections', () => Array.isArray(mod.splitContentIntoSections('# 标题\n正文\n## 子标题\n更多内容')))
// status
tryTest('getStatusText', () => typeof mod.getStatusText('done') === 'string')
// template-preview（需 mock OutputTemplate）
tryTest('buildTemplatePreviewHtml(article)', () => {
  const tpl = { id: 'article-editorial', name: 'T', nameEn: 'T', mode: 'article', scenario: 'read', description: 'd', icon: 'i', designConstraints: '', outputHint: '', bestFor: '' }
  const h = mod.buildTemplatePreviewHtml(tpl)
  return typeof h === 'string' && h.length > 50
})
tryTest('buildTemplatePreviewHtml(moka)', () => {
  const tpl = { id: 'moka-ai-single', name: 'M', nameEn: 'M', mode: 'moka', scenario: 'social', description: 'd', icon: 'i', designConstraints: '', outputHint: '', bestFor: '' }
  return typeof mod.buildTemplatePreviewHtml(tpl) === 'string'
})

let ok = 0, fail = 0
for (const [name, passed, err] of results) {
  if (passed) ok++; else { console.log(`✗ ${name}: ${err || '输出异常'}`); fail++ }
}
console.log(`\nutils 运行时验证: ${ok}/${results.length} 正确, ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
