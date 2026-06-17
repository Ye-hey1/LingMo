/**
 * 运行时验证：import html-builders facade，实际调用全部 19 个 build*，
 * 确认每个都输出合法 HTML（含 <html 或 <!DOCTYPE 且长度合理）。
 * 捕获任何依赖分析遗漏导致的 ReferenceError。
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-verify-builders-'))
const transpiled = new Set()

function posixDirname(p) { const n = p.replace(/\\/g, '/'); const i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i) }
function posixResolve(b, s) { const parts = [...(b ? b.split('/') : []), ...s.split('/')]; const r = []; for (const p of parts) { if (p === '' || p === '.') continue; if (p === '..') { r.pop(); continue } r.push(p) } return r.join('/') }

async function ensure(relativePath) {
  if (transpiled.has(relativePath)) return
  transpiled.add(relativePath)
  const src = await readFile(join(repoRoot, relativePath), 'utf8')
  const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, esModuleInterop: true, strict: true } }).outputText
  const rewritten = out.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (_f, p, s, e) => `${p}${s.replace(/\.(tsx?|mjs)$/i, '')}.mjs${e}`)
  const outPath = join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, rewritten, 'utf8')
  for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']+?)(?:\.tsx?)?["']/g)) {
    const base = posixResolve(posixDirname(relativePath), m[1])
    for (const ext of ['.ts', '.tsx']) {
      const c = base.endsWith(ext) ? base : base + ext
      try { await readFile(join(repoRoot, c), 'utf8'); await ensure(c); break } catch { /* try next */ }
    }
  }
}
async function imp(relativePath) { await ensure(relativePath); return import(pathToFileURL(join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))).href) }

const mod = await imp('src/lib/output-workshop/html-builders.ts')
const opts = { title: '测试标题', subtitle: '副标题', sections: [{ title: '章节一', body: '正文 **粗体** 与 *斜体*', bullets: ['要点一', '要点二'] }, { title: '章节二', body: '第二段正文' }], sourceLabel: '测试来源.md', generatedAt: '2026-06-14 12:00' }

const builders = ['buildEditorialArticle','buildKamiParchment','buildBrutalistStyle','buildGuizangDeck','buildTechSharing','buildMagazinePoster','buildHeroPoster','buildDataDashboard','buildInfographic','buildGuizangSocialCard','buildXiaohongshuStyle','buildLearningCards','buildMindmapStyle','buildWaterfallStyle','buildBentoStyle','buildBusinessReportStyle','buildLiquidGlassStyle','buildAccordionManualStyle','buildDarkTechStyle']

let ok = 0, fail = 0
for (const b of builders) {
  try {
    const html = mod[b](opts)
    if (html && html.length > 100 && (html.includes('<html') || html.includes('<!DOCTYPE'))) {
      ok++
    } else {
      console.log(`✗ ${b}: 输出异常 (len=${html ? html.length : 0})`); fail++
    }
  } catch (e) {
    console.log(`✗ ${b}: ${e.message}`); fail++
  }
}
// 验证 buildStyle 注册表分发（use-output-generation 已改用它替代 19-case switch）
let styleOk = 0, styleFail = 0
const regCount = mod.STYLE_BUILDERS ? Object.keys(mod.STYLE_BUILDERS).length : 0
if (typeof mod.buildStyle === 'function' && mod.STYLE_BUILDERS) {
  for (const id of Object.keys(mod.STYLE_BUILDERS)) {
    try {
      const html = mod.buildStyle(id, opts)
      if (html && html.length > 100 && (html.includes('<html') || html.includes('<!DOCTYPE'))) styleOk++
      else { console.log(`✗ buildStyle(${id}): 输出异常`); styleFail++ }
    } catch (e) { console.log(`✗ buildStyle(${id}): ${e.message}`); styleFail++ }
  }
  // 未知 id 回退测试（应回退到 buildEditorialArticle）
  const fallback = mod.buildStyle('__unknown_id__', opts)
  if (fallback && fallback.length > 100) styleOk++
  else { console.log('✗ buildStyle 未知 id 回退失败'); styleFail++ }
  console.log(`buildStyle 注册表: ${regCount} id + 1 回退, ${styleOk} 正确, ${styleFail} 失败`)
} else {
  console.log('✗ facade 未导出 buildStyle / STYLE_BUILDERS'); styleFail++
}

console.log(`\n运行时验证结果: build* ${ok}/19, buildStyle ${styleOk}/${regCount + 1}`)
process.exit(fail === 0 && styleFail === 0 ? 0 : 1)
