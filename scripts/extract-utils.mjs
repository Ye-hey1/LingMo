/**
 * 一次性提取脚本：把 components/output-workshop/utils.ts(1036行/6职责) 拆分为
 * 同目录职责文件 + utils.ts(facade re-export)，调用方 import 路径不变。
 *
 *   - utils-prompts.ts          EXTRACTION/CREATIVE_DESIGN/REFINE_PROMPT
 *   - utils-html-cleaning.ts    cleanStreamingHtml/repairTruncatedHtml/prepareOutputHtml
 *   - utils-template-preview.ts buildTemplatePreviewHtml + 5 helper + WORKSHOP_SAMPLE_SECTIONS
 *   - utils-status.ts           getStatusText
 *   - utils-content.ts          splitContentIntoSections + extractBullets/inferImportance
 *   - utils.ts                  facade: re-export 上述全部
 *
 * 自动按区域代码实际引用分析 import（精确，无 unused）。
 */
import { readFile, writeFile } from 'node:fs/promises'

const SRC = 'src/components/output-workshop/utils.ts'
const source = await readFile(SRC, 'utf8')
const lines = source.split('\n')

const EXPORT_AREA = {
  EXTRACTION_PROMPT: 'prompts', CREATIVE_DESIGN_PROMPT: 'prompts', REFINE_PROMPT: 'prompts',
  cleanStreamingHtml: 'html-cleaning', repairTruncatedHtml: 'html-cleaning', prepareOutputHtml: 'html-cleaning',
  buildTemplatePreviewHtml: 'template-preview',
  getStatusText: 'status',
  splitContentIntoSections: 'content-analyzer',
}
const AREA_FILE = { prompts: 'utils-prompts', 'html-cleaning': 'utils-html-cleaning', 'template-preview': 'utils-template-preview', status: 'utils-status', 'content-analyzer': 'utils-content' }
const AREA_ORDER = ['prompts', 'html-cleaning', 'template-preview', 'status', 'content-analyzer']

// 1. 第一个 export 行
const firstExportIdx = lines.findIndex((l) => /^export\s/.test(l))
if (firstExportIdx < 0) throw new Error('找不到 export')

// 2. 解析顶部 import 区（支持多行 import { ... }）
const importZone = lines.slice(0, firstExportIdx).join('\n')
const imports = [] // { from, items: [{name, isType}] }
const importStmtRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
let m
while ((m = importStmtRe.exec(importZone)) !== null) {
  const isTypeAll = !!m[1]
  const items = m[2].split(',').map((s) => {
    s = s.trim()
    const isType = isTypeAll || /^type\s+/.test(s)
    return { name: s.replace(/^type\s+/, '').trim(), isType }
  }).filter((it) => it.name)
  imports.push({ from: m[3], items })
}

// 3. export 锚点
const exportAnchors = []
lines.forEach((l, idx) => {
  if (idx >= firstExportIdx) {
    const mm = l.match(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/)
    if (mm && EXPORT_AREA[mm[1]]) exportAnchors.push({ name: mm[1], line: idx, area: EXPORT_AREA[mm[1]] })
  }
})

// 4. 区域边界；template-preview 向前扩展到 WORKSHOP_SAMPLE_SECTIONS（它被 buildTemplatePreviewHtml 用）
const sampleDataLine = lines.findIndex((l) => /^const WORKSHOP_SAMPLE_SECTIONS/.test(l))
const areaBounds = {}
for (const area of AREA_ORDER) {
  const anchor = exportAnchors.find((a) => a.area === area)
  if (!anchor) { console.log(`  跳过无锚点区域: ${area}`); continue }
  let start = anchor.line
  if (area === 'template-preview' && sampleDataLine >= 0 && sampleDataLine < start) start = sampleDataLine
  areaBounds[area] = { start }
}
for (let i = 0; i < AREA_ORDER.length; i++) {
  if (!areaBounds[AREA_ORDER[i]]) continue
  let end = lines.length - 1
  for (let j = i + 1; j < AREA_ORDER.length; j++) {
    if (areaBounds[AREA_ORDER[j]]) { end = areaBounds[AREA_ORDER[j]].start - 1; break }
  }
  areaBounds[AREA_ORDER[i]].end = end
}

// 5. 依赖分析：区域代码里引用的 import 符号 → 精确 import 语句
function genImports(code) {
  const usedByFrom = new Map()
  for (const imp of imports) {
    for (const item of imp.items) {
      if (new RegExp(`\\b${item.name}\\b`).test(code)) {
        if (!usedByFrom.has(imp.from)) usedByFrom.set(imp.from, [])
        usedByFrom.get(imp.from).push(item)
      }
    }
  }
  const stmts = []
  for (const [from, items] of usedByFrom) {
    const parts = items.map((i) => (i.isType ? `type ${i.name}` : i.name))
    stmts.push(`import { ${parts.join(', ')} } from "${from}"`)
  }
  return stmts.join('\n')
}

// 6. 生成职责文件
for (const area of AREA_ORDER) {
  if (!areaBounds[area]) continue
  const code = lines.slice(areaBounds[area].start, areaBounds[area].end + 1).join('\n').replace(/\s+$/, '\n')
  const importStmts = genImports(code)
  await writeFile(`src/components/output-workshop/${AREA_FILE[area]}.ts`, `${importStmts}\n\n${code}`)
  console.log(`  ✓ ${AREA_FILE[area]}.ts`)
}

// 7. utils.ts facade
const facade = `"use client"

${AREA_ORDER.filter((a) => areaBounds[a]).map((a) => `export * from "./${AREA_FILE[a]}"`).join('\n')}
`
await writeFile(SRC, facade)
console.log('  ✓ utils.ts (facade)')
console.log('\n拆分完成喵～ 接下来更新测试断言 + 验证。')
