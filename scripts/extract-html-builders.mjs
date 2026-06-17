/**
 * 一次性提取脚本：把 html-builders.ts(6569行, 19个build*函数) 拆分为
 *   - shared/builder-utils.ts  (共享 helper + 类型)
 *   - styles/<templateId>.ts   (每个 build* 独立文件, 按依赖注入 import)
 *   - styles/index.ts          (STYLE_BUILDERS 注册表 + buildStyle 分发)
 *   - html-builders.ts         (facade, re-export 保持对外 API 不变)
 *
 * v2 修复：不依赖模板分隔注释格式（原文件 // --- 与 // === 混用），
 *         改用 export function 行号精确界定 helper 区与每个函数体。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const SRC = 'src/lib/output-workshop/html-builders.ts'
const source = await readFile(SRC, 'utf8')
const lines = source.split('\n')

const FN_TO_ID = {
  buildEditorialArticle: 'article-editorial',
  buildKamiParchment: 'article-kami',
  buildBrutalistStyle: 'article-brutalist',
  buildGuizangDeck: 'deck-minimal',
  buildTechSharing: 'deck-tech',
  buildMagazinePoster: 'poster-magazine',
  buildHeroPoster: 'poster-hero',
  buildDataDashboard: 'data-dashboard',
  buildInfographic: 'data-infographic',
  buildGuizangSocialCard: 'social-card',
  buildXiaohongshuStyle: 'social-xiaohongshu',
  buildWaterfallStyle: 'social-waterfall',
  buildBentoStyle: 'visual-bento',
  buildBusinessReportStyle: 'report-business',
  buildLiquidGlassStyle: 'read-glass',
  buildAccordionManualStyle: 'read-accordion',
  buildDarkTechStyle: 'read-dark-tech',
  buildLearningCards: 'learning-flashcard',
  buildMindmapStyle: 'learning-mindmap',
}

const SHARED_HELPERS = [
  'escapeHtml',
  'renderMarkdown',
  'formatDate',
  'normalizeLabel',
  'getContentBrand',
  'getContentInitials',
  'getContentCategory',
]

// 1. 定位所有 `export function buildXxx` 行（唯一的拆分锚点，不依赖注释格式）
const exportIdx = []
lines.forEach((l, i) => {
  if (/^export function (build\w+)\s*\(/.test(l)) exportIdx.push(i)
})
if (exportIdx.length !== 19) {
  throw new Error(`期望 19 个 build 函数，实际 ${exportIdx.length}`)
}
const fns = exportIdx.map((start, idx) => ({
  start,
  end: idx < exportIdx.length - 1 ? exportIdx[idx + 1] - 1 : lines.length - 1,
  name: lines[start].match(/^export function (build\w+)/)[1],
}))
for (const fn of fns) {
  if (!FN_TO_ID[fn.name]) throw new Error(`${fn.name} 缺少 templateId 映射`)
}
console.log(`找到 ${fns.length} 个 build 函数`)

// 去掉一段代码末尾的分隔注释（// --- 或 // ===）与空行，保留实质内容
function trimTrailingComments(text) {
  return text.replace(/(\n\s*\/\/[^\n]*)*\s*$/, '\n')
}

// 2. helper 区 = helperStart 到 第一个 export function 之前
const helperStart = lines.slice(0, exportIdx[0]).findIndex((l) => /^(export )?(interface|function)\s/.test(l))
if (helperStart < 0) throw new Error('找不到 helper 区起始')
let helperSource = trimTrailingComments(lines.slice(helperStart, exportIdx[0]).join('\n'))
helperSource = helperSource.replace(/^function /gm, 'export function ')

// 3. 写 shared/builder-utils.ts
const builderUtils = `/**
 * 输出工坊 HTML 构建器共享层
 * 类型 + 各风格构建器共用的辅助函数，从 html-builders.ts 提取。
 */
import { escapeHtml } from "./escape"
// 本地绑定供下方 helper(renderMarkdown 等)使用，同时 re-export 给各 styles
export { escapeHtml }

${helperSource}`

await mkdir('src/lib/output-workshop/shared', { recursive: true })
await writeFile('src/lib/output-workshop/shared/builder-utils.ts', builderUtils)
console.log('  ✓ shared/builder-utils.ts')

// 4. 写 styles/<id>.ts —— body 从 exportIdx[idx] 到 exportIdx[idx+1]-1（纯函数体）
await mkdir('src/lib/output-workshop/styles', { recursive: true })
for (let idx = 0; idx < fns.length; idx++) {
  const fn = fns[idx]
  const id = FN_TO_ID[fn.name]
  const bodyStart = exportIdx[idx]
  const bodyEnd = idx < fns.length - 1 ? exportIdx[idx + 1] - 1 : lines.length - 1
  let body = lines.slice(bodyStart, bodyEnd + 1).join('\n')
  body = trimTrailingComments(body)
  const used = SHARED_HELPERS.filter((h) => new RegExp(`\\b${h}\\b`).test(body))
  const imports = [...used, 'type BuildHtmlOptions'].join(', ')
  const header = `import { ${imports} } from "../shared/builder-utils"\n\n`
  await writeFile(`src/lib/output-workshop/styles/${id}.ts`, header + body)
}
console.log(`  ✓ styles/*.ts × ${fns.length}`)

// 5. 写 styles/index.ts（注册表 + buildStyle + re-export）
const importLines = fns.map((f) => `import { ${f.name} } from "./${FN_TO_ID[f.name]}"`).join('\n')
const reExportLines = fns.map((f) => `export { ${f.name} } from "./${FN_TO_ID[f.name]}"`).join('\n')
const registryEntries = fns.map((f) => `  "${FN_TO_ID[f.name]}": ${f.name},`).join('\n')
const indexTs = `/**
 * 输出工坊风格构建器注册表
 * 按 templateId 分发到对应 build* 函数，替代 use-output-generation 里的 19-case switch。
 */
import type { BuildHtmlOptions } from "../shared/builder-utils"
${importLines}

export type StyleBuilder = (options: BuildHtmlOptions) => string

/** templateId -> 风格构建器 */
export const STYLE_BUILDERS: Record<string, StyleBuilder> = {
${registryEntries}
}

/** 按 templateId 分发风格构建（未知 id 回退到第一个风格） */
export function buildStyle(templateId: string, options: BuildHtmlOptions): string {
  return (STYLE_BUILDERS[templateId] ?? ${fns[0].name})(options)
}

${reExportLines}
`
await writeFile('src/lib/output-workshop/styles/index.ts', indexTs)
console.log('  ✓ styles/index.ts (注册表 + buildStyle)')

// 6. 覆盖 html-builders.ts 为 facade
const facade = `/**
 * 输出工坊 HTML 构建器（facade）
 * 实际实现已按风格拆分到 ./styles/*，本文件仅 re-export 以保持对外 API 不变。
 * 调用方可改用 ./styles 的 buildStyle(templateId, options) 替代 switch 分发。
 */
export type { BuildHtmlOptions, ExtractedSection } from "./shared/builder-utils"
export * from "./styles/index"
`
await writeFile(SRC, facade)
console.log('  ✓ html-builders.ts (facade)')
console.log('\n拆分完成喵～ 接下来跑测试验证。')
