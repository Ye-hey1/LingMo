import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-output-workshop-tests-'))

async function readRepoFile(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const transpiledModules = new Set()

function posixDirname(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx < 0 ? '' : normalized.slice(0, idx)
}

function posixResolve(base, spec) {
  const parts = [...(base ? base.split('/') : []), ...spec.split('/')]
  const result = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { result.pop(); continue }
    result.push(part)
  }
  return result.join('/')
}

async function ensureTranspiled(relativePath) {
  if (transpiledModules.has(relativePath)) return
  transpiledModules.add(relativePath)

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

  // 重写相对 import：补 .mjs 扩展（ESM 必需），保留相对目录结构以支持子目录（shared/、moka/ 等）
  const rewritten = output.replace(
    /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
    (_full, pre, spec, post) => `${pre}${spec.replace(/\.(tsx?|mjs)$/i, '')}.mjs${post}`,
  )

  const outPath = join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, rewritten, 'utf8')

  // 递归发现并转换相对依赖（.ts / .tsx），保留目录结构
  const depSpecs = [...source.matchAll(/from\s+["'](\.\.?\/[^"']+?)(?:\.tsx?)?["']/g)].map((m) => m[1])
  for (const depSpec of depSpecs) {
    const depBase = posixResolve(posixDirname(relativePath), depSpec)
    for (const ext of ['.ts', '.tsx']) {
      const candidate = depBase.endsWith(ext) ? depBase : depBase + ext
      try {
        await readFile(join(repoRoot, candidate), 'utf8')
        await ensureTranspiled(candidate)
        break
      } catch {
        // 该扩展不存在，尝试下一个
      }
    }
  }
}

async function importTsModule(relativePath) {
  await ensureTranspiled(relativePath)
  const outPath = join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))
  return import(pathToFileURL(outPath).href)
}

async function importMokaBuildersModule() {
  const builders = await importTsModule('src/lib/output-workshop/moka/builders.ts')
  const parser = await importTsModule('src/lib/output-workshop/moka/parser.ts')
  return { ...builders, ...parser }
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
    buildAccordionManualStyle,
    buildBentoStyle,
    buildBrutalistStyle,
    buildBusinessReportStyle,
    buildDarkTechStyle,
    buildDataDashboard,
    buildEditorialArticle,
    buildHeroPoster,
    buildInfographic,
    buildKamiParchment,
    buildLearningCards,
    buildLiquidGlassStyle,
    buildMagazinePoster,
    buildMindmapStyle,
    buildTechSharing,
    buildWaterfallStyle,
    buildXiaohongshuStyle,
  } = await importTsModule('src/lib/output-workshop/html-builders.ts')
  const {
    normalizeOutputWorkshopHtml,
  } = await importTsModule('src/lib/output-workshop/html-normalizer.ts')
  const {
    MOKA_SINGLE_STYLES,
    MOKA_SPLIT_STYLES,
  } = await importTsModule('src/lib/output-workshop/moka/constants.ts')
  const {
    buildMokaHtml,
    hasMokaContentQualityIssue,
    parseMokaGenerationResult,
  } = await importMokaBuildersModule()

  const templatesSource = await readRepoFile('src/lib/output-workshop/templates.ts')
  assert.match(templatesSource, /const CREATIVE_SERIES_BASE_PROMPT = `/)
  assert.match(templatesSource, /const CREATIVE_SERIES_TEMPLATES: OutputTemplate\[\] = \[/)
  assert.match(templatesSource, /\.\.\.CREATIVE_SERIES_TEMPLATES/)
  assert.match(templatesSource, /import \{ MOKA_OUTPUT_TEMPLATES \} from '\.\/moka\/templates'/)
  assert.match(templatesSource, /export const INTERNAL_OUTPUT_TEMPLATES: OutputTemplate\[\] = \[/)
  assert.match(templatesSource, /\|\s*'moka'/)
  assert.match(templatesSource, /INTERNAL_OUTPUT_TEMPLATES[\s\S]*\.\.\.OUTPUT_TEMPLATES/)
  const visibleTemplatesBlock = templatesSource.slice(
    templatesSource.indexOf('export const OUTPUT_TEMPLATES: OutputTemplate[] = ['),
    templatesSource.indexOf('export const INTERNAL_OUTPUT_TEMPLATES: OutputTemplate[] = [')
  )
  assert.match(visibleTemplatesBlock, /MOKA_OUTPUT_TEMPLATES/)
  assert.match(templatesSource, /id: 'moka', name: 'Moka 卡片'/)
  assert.doesNotMatch(templatesSource, /\|\s*'huashu'/)
  assert.doesNotMatch(templatesSource, /mode:\s*'huashu'/)
  assert.match(templatesSource, /id: 'creative', name: 'AI 自由创意'/)
  assert.match(templatesSource, /## 创意设计集成规范/)
  assert.match(templatesSource, /Junior Designer brief/)
  assert.match(templatesSource, /Tweaks/)
  assert.match(templatesSource, /Pentagram/)
  assert.match(templatesSource, /反 AI slop 规则/)
  assert.match(templatesSource, /assumptions、chosen philosophy、artifact type、content structure、known limitations/)
  assert.match(templatesSource, /iPhone 15 Pro bezel/)
  assert.match(templatesSource, /Playwright/)
  assert.match(templatesSource, /scripts\/export_deck_pptx\.mjs/)
  assert.match(templatesSource, /25fps MP4/)
  assert.match(templatesSource, /palette 优化 GIF/)
  assert.match(templatesSource, /localStorage/)
  assert.match(templatesSource, /5 流派/)
  assert.match(templatesSource, /20 种哲学/)
  assert.match(templatesSource, /Keep \/ Fix \/ Quick Wins/)

  const creativeSeriesTemplates = [
    ['creative-huashu-design', '智能创意路由', 'Creative Output Router'],
    ['huashu-prototype', '真机交互原型', 'Device Prototype'],
    ['huashu-deck', '浏览器演讲 Deck', 'Centered HTML Deck'],
    ['huashu-timeline-animation', '时间轴动画直绘', 'Timeline Animation'],
    ['huashu-variants', '多方向设计变体', 'Variants + Tweaks'],
    ['huashu-infographic', '印刷级信息图', 'Print-grade Infographic'],
    ['huashu-direction-advisor', '设计方向顾问', 'Direction Advisor'],
    ['huashu-expert-review', '5维专家评审', '5D Expert Review'],
  ]

  for (const [id, name, nameEn] of creativeSeriesTemplates) {
    const escapedId = escapeRegExp(id)
    const templateBlock = new RegExp(`id: '${escapedId}',[\\s\\S]*?skillPrompt: CREATIVE_SERIES_BASE_PROMPT`, 'm')
    assert.match(templatesSource, templateBlock, `${id} should be a creative-series skill template`)
    const visibleBlock = new RegExp(`id: '${escapedId}',[\\s\\S]*?name: '${escapeRegExp(name)}',[\\s\\S]*?nameEn: '${escapeRegExp(nameEn)}',[\\s\\S]*?mode: 'creative'`, 'm')
    assert.match(templatesSource, visibleBlock, `${id} should use product-facing naming and creative mode`)
  }
  assert.doesNotMatch(templatesSource, /name:\s*'[^']*(?:花叔|Huashu)[^']*'/)
  assert.doesNotMatch(templatesSource, /nameEn:\s*'[^']*(?:花叔|Huashu)[^']*'/)
  assert.doesNotMatch(templatesSource, /description:\s*'[^']*(?:花叔|Huashu|huashu-design)[^']*'/)

  const utilsSource = await readRepoFile('src/components/output-workshop/utils.ts')
  assert.match(utilsSource, /buildMokaTemplatePreviewHtml/)
  assert.match(utilsSource, /isMokaTemplateId\(template\.id\)/)
  assert.match(utilsSource, /export function splitContentIntoSections\(content: string\): ExtractedSection\[\]/)
  assert.match(utilsSource, /const level = rawTitle\.match\(/)
  assert.match(utilsSource, /title: title \|\| "未命名章节",[\s\S]*?level,/)
  assert.match(utilsSource, /\.filter\(\(section\) => section\.title\)/)
  assert.match(utilsSource, /title: index === 0 \? "核心概览" : `要点 \$\{index \+ 1\}`,[\s\S]*?level: 1,/)
  for (const [id] of creativeSeriesTemplates) {
    assert.match(utilsSource, new RegExp(`case "${id}":`), `${id} should use the creative-series preview`)
  }
  assert.match(utilsSource, /buildCreativeSeriesTemplatePreview\(template\)/)
  assert.match(utilsSource, /Creative Output Lab/)
  assert.match(utilsSource, /content-driven HTML artifact/)
  assert.match(utilsSource, /真机状态流，不是静态截图/)
  assert.match(utilsSource, /一张一张居中演讲/)
  assert.match(utilsSource, /时间片段驱动的动画稿/)
  assert.match(utilsSource, /并排比较，而不是换个颜色/)
  assert.match(utilsSource, /印刷级网格信息图/)
  assert.match(utilsSource, /先选设计方向，再深挖方案/)
  assert.match(utilsSource, /5 维度设计评审/)
  assert.match(utilsSource, /Anti AI slop/)
  assert.match(utilsSource, /prefers-reduced-motion: reduce/)

  const mokaConstantsSource = await readRepoFile('src/lib/output-workshop/moka/constants.ts')
  assert.match(mokaConstantsSource, /MOKA_SINGLE_STYLES/)
  assert.match(mokaConstantsSource, /MOKA_SPLIT_STYLES/)
  assert.match(mokaConstantsSource, /MOKA_PALETTES/)
  assert.match(mokaConstantsSource, /moka-ai-single/)
  assert.match(mokaConstantsSource, /moka-ai-split/)
  assert.match(mokaConstantsSource, /label: "玫瑰"/)
  assert.match(mokaConstantsSource, /label: "金色"/)
  assert.equal(MOKA_SINGLE_STYLES[0].id, 'ai')
  assert.equal(MOKA_SPLIT_STYLES[0].id, 'ai')
  assert.equal(
    new Set(MOKA_SINGLE_STYLES.map((style) => style.id)).size,
    MOKA_SINGLE_STYLES.length,
    'moka single style ids must be unique'
  )
  assert.equal(
    new Set(MOKA_SPLIT_STYLES.map((style) => style.id)).size,
    MOKA_SPLIT_STYLES.length,
    'moka split style ids must be unique'
  )
  const removedMokaStyleIds = ['dark', 'forest', 'ins', 'korean', 'artistic', 'medical', 'finance', 'fashion', 'mom']
  for (const styleId of removedMokaStyleIds) {
    assert.equal(
      MOKA_SINGLE_STYLES.some((style) => style.id === styleId),
      false,
      `${styleId} should not be available as a moka single template`
    )
    assert.equal(
      MOKA_SPLIT_STYLES.some((style) => style.id === styleId),
      false,
      `${styleId} should not be available as a moka split template`
    )
  }

  const mokaPromptsSource = await readRepoFile('src/lib/output-workshop/moka/prompts.ts')
  assert.match(mokaPromptsSource, /MOKA_CONTENT_PROMPTS/)
  assert.match(mokaPromptsSource, /MOKA_AI_DESIGN_PROMPT_SINGLE/)
  assert.match(mokaPromptsSource, /MOKA_AI_DESIGN_PROMPT_SPLIT/)
  assert.match(mokaPromptsSource, /MOKA_STUDY_NOTE_REQUIREMENTS/)
  assert.match(mokaPromptsSource, /buildMokaRepairPrompt/)
  assert.match(mokaPromptsSource, /核心逻辑、观点、阶段变化和关键细节/)
  assert.match(mokaPromptsSource, /洞察抽取/)
  assert.match(mokaPromptsSource, /不要复述目录/)
  assert.match(mokaPromptsSource, /参考图/)
  assert.match(mokaPromptsSource, /styleConfig/)
  assert.match(mokaPromptsSource, /slides/)
  assert.match(mokaPromptsSource, /MOKA_AI_SPEED_REQUIREMENTS/)
  assert.match(mokaPromptsSource, /只提炼内容 JSON/)
  assert.match(mokaPromptsSource, /不要输出 styleConfig/)
  assert.match(mokaPromptsSource, /完整 moka AI 设计 JSON/)

  const mokaBuildersSource = await readRepoFile('src/lib/output-workshop/moka/builders.ts')
  assert.match(mokaBuildersSource, /\.moka-card/)
  assert.match(mokaBuildersSource, /data-moka-card/)
  assert.match(mokaBuildersSource, /data-moka-ai-design/)
  assert.match(mokaBuildersSource, /restyleAiSingleDesign/)
  assert.match(mokaBuildersSource, /restyleAiSplitDesign/)
  assert.match(mokaBuildersSource, /styleId === "ai"/)
  assert.match(mokaBuildersSource, /renderAiSingle\(options\.result\.design, styleId, palette\)/)
  assert.match(mokaBuildersSource, /renderAiSplit\(options\.result\.design, styleId, palette\)/)
  assert.match(mokaBuildersSource, /renderSingleCard\(options\.result\.design\.content, styleId, palette\)/)
  assert.match(mokaBuildersSource, /renderEditableSplitCards\(options\.result\.design\.slides, styleId, palette\)/)
  assert.match(mokaBuildersSource, /moka-layout-vivid/)
  assert.match(mokaBuildersSource, /moka-layout-clean/)
  assert.match(mokaBuildersSource, /moka-layout-pastel/)
  assert.match(mokaBuildersSource, /moka-layout-organic/)
  assert.match(mokaBuildersSource, /moka-layout-swiss/)
  assert.match(mokaBuildersSource, /moka-layout-poster/)
  assert.match(mokaBuildersSource, /moka-layout-magazine/)
  assert.match(mokaBuildersSource, /moka-layout-ledger/)
  assert.match(mokaBuildersSource, /moka-layout-signal/)
  assert.match(mokaBuildersSource, /moka-layout-dossier/)
  assert.match(mokaBuildersSource, /moka-layout-fieldnote/)
  assert.match(mokaBuildersSource, /moka-layout-archive/)
  assert.match(mokaBuildersSource, /lingmo-smart-card-export-root/)
  assert.match(mokaBuildersSource, /prefers-reduced-motion: reduce/)
  assert.match(mokaBuildersSource, /data-moka-edit-path/)
  assert.match(mokaBuildersSource, /data-moka-drag-path/)
  assert.match(mokaBuildersSource, /data-moka-slide-index/)
  assert.match(mokaBuildersSource, /\[data-moka-edit-path\]\s*\{[\s\S]*?position: relative;/)
  assert.match(mokaBuildersSource, /left: getOffsetPx\(element, "left"\)/)
  assert.match(mokaBuildersSource, /top: getOffsetPx\(element, "top"\)/)
  assert.match(mokaBuildersSource, /activeDrag\.element\.style\.left = String\(Math\.round\(activeDrag\.left \+ dx\)\) \+ "px"/)
  assert.match(mokaBuildersSource, /activeDrag\.element\.style\.top = String\(Math\.round\(activeDrag\.top \+ dy\)\) \+ "px"/)
  assert.match(mokaBuildersSource, /moka-reorder-handle/)
  assert.match(mokaBuildersSource, /lingmo-moka-editor/)
  assert.match(mokaBuildersSource, /contenteditable="true"/)

  const mokaAiSplitResult = {
    kind: 'ai-split',
    usedFallback: false,
    design: {
      styleConfig: {
        cover: { background: 'linear-gradient(135deg,#111827,#334155)' },
        content: { background: '#ffffff' },
        end: { background: '#f8fafc' },
      },
      slides: [
        { type: 'cover', emoji: '✨', title: 'AI 产品方法论', subtitle: '从问题定义到可验证结果' },
        { type: 'content', heading: '先收敛问题', text: '把模糊需求拆成可观察的输入、约束和验收标准。', extra: '每页只讲一个核心观点。' },
        { type: 'end', cta: '记住三条主线', sub: '把问题、能力和商业化串起来看', tags: ['Moka', 'AI设计', '输出工坊'] },
      ],
    },
  }
  const mokaAiHtml = buildMokaHtml({
    templateId: 'moka-ai-split',
    title: 'Moka AI Smoke',
    styleId: 'ai',
    result: mokaAiSplitResult,
  })
  const mokaVividHtml = buildMokaHtml({
    templateId: 'moka-ai-split',
    title: 'Moka Vivid Smoke',
    styleId: 'vivid',
    paletteId: 'ocean',
    result: mokaAiSplitResult,
  })
  const mokaCleanHtml = buildMokaHtml({
    templateId: 'moka-ai-split',
    title: 'Moka Clean Smoke',
    styleId: 'clean',
    result: mokaAiSplitResult,
  })
  assert.match(mokaAiHtml, /data-moka-ai-design="split"/)
  assert.match(mokaAiHtml, /linear-gradient\(135deg,#111827,#334155\)/)
  assert.match(mokaAiHtml, /data-moka-edit-path="slides\.0\.title"/)
  assert.match(mokaAiHtml, /data-moka-drag-path="slides\.0\.titleStyle"/)
  assert.match(mokaAiHtml, /data-moka-edit-path="slides\.1\.heading"/)
  assert.match(mokaAiHtml, /data-moka-edit-path="slides\.2\.tags\.1"/)
  assert.match(mokaAiHtml, /data-moka-slide-index="0"/)
  assert.match(mokaAiHtml, /class="moka-reorder-handle"/)
  assert.match(mokaAiHtml, /lingmo-moka-editor/)
  assert.doesNotMatch(mokaAiHtml, />Moka mode · moka-ai-split</)
  assert.doesNotMatch(mokaAiHtml, />MOKA</)
  assert.doesNotMatch(mokaAiHtml, />#Moka</)
  assert.doesNotMatch(mokaAiHtml, />moka-ai-split</)
  assert.doesNotMatch(mokaAiHtml, /moka-layout-xhs-/)
  assert.doesNotMatch(mokaVividHtml, /data-moka-ai-design="split"/)
  assert.match(mokaVividHtml, /moka-layout-poster/)
  assert.match(mokaVividHtml, /moka-layout-xhs-poster/)
  assert.match(mokaVividHtml, /data-moka-edit-path="slides\.0\.title"/)
  assert.match(mokaVividHtml, /data-moka-slide-index="0"/)
  assert.match(mokaVividHtml, /#2e86ab/)
  assert.match(mokaCleanHtml, /moka-layout-swiss/)
  assert.match(mokaCleanHtml, /moka-layout-xhs-swiss/)
  assert.notEqual(mokaVividHtml, mokaCleanHtml, 'moka split templates should change structural layout')
  assert.match(mokaVividHtml, /data-moka-card/)
  assert.match(mokaCleanHtml, /data-moka-card/)
  const mokaThemeFamilies = new Map([
    ['clean', 'swiss'],
    ['vivid', 'poster'],
    ['paper', 'ledger'],
    ['business', 'dossier'],
    ['editorial', 'magazine'],
    ['gradient', 'signal'],
    ['tech', 'signal'],
    ['food', 'fieldnote'],
    ['travel', 'fieldnote'],
    ['retro', 'archive'],
    ['label', 'archive'],
    ['law', 'dossier'],
  ].map(([styleId, family]) => [
    styleId,
    buildMokaHtml({
      templateId: 'moka-ai-split',
      title: `Moka ${styleId} family smoke`,
      styleId,
      result: mokaAiSplitResult,
    }).match(/moka-layout-xhs-([a-z]+)/)?.[1],
  ]))
  assert.deepEqual(
    Object.fromEntries(mokaThemeFamilies),
    {
      clean: 'swiss',
      vivid: 'poster',
      paper: 'ledger',
      business: 'dossier',
      editorial: 'magazine',
      gradient: 'signal',
      tech: 'signal',
      food: 'fieldnote',
      travel: 'fieldnote',
      retro: 'archive',
      label: 'archive',
      law: 'dossier',
    },
    'moka themes should map to different structural layout families'
  )

  const aiPmSource = `AI产品经理的职业发展史
一、从兼职打标签到AI产品架构师
起源：为什么会出现AI产品经理？
1.1 技术土壤：AI从实验室走向商用
2006-2015：深度学习与算力、数据一起，把AI从玩具推向业务。
1.2 职责转折：产品经理开始负责数据、模型和体验的协同。
二、真正的门槛
AI产品经理不只写需求，还要理解模型能力边界、业务场景和落地成本。`
  const fallbackMokaResult = parseMokaGenerationResult(
    'moka-ai-split',
    'not json',
    aiPmSource,
    'AI产品经理的职业发展史',
    'ai-split'
  )
  assert.equal(hasMokaContentQualityIssue(fallbackMokaResult), true)
  const fallbackMokaHtml = buildMokaHtml({
    templateId: 'moka-ai-split',
    title: 'AI产品经理的职业发展史',
    styleId: 'clean',
    result: fallbackMokaResult,
  })
  assert.match(fallbackMokaHtml, /技术土壤|职责转折|真正的门槛/)
  assert.doesNotMatch(fallbackMokaHtml, /来自原始材料的结构化摘要|收藏这组卡片|用输出工坊继续|继续输出/)
  assert.doesNotMatch(fallbackMokaHtml, />Moka mode · moka-ai-split</)

  const genericMokaResult = parseMokaGenerationResult(
    'moka-ai-split',
    JSON.stringify({
      styleConfig: {
        cover: { background: '#ffffff' },
        content: { background: '#ffffff' },
        end: { background: '#ffffff' },
      },
      slides: [
        { type: 'cover', emoji: '✨', title: '封面标题', subtitle: '副标题' },
        { type: 'content', heading: '小标题1', text: '正文内容', extra: '金句' },
        { type: 'content', heading: '一、从兼职打标签到AI产品架构师', text: '1.1 技术土壤：AI从实验室走向商用。', extra: '来自原始材料的结构化摘要' },
        { type: 'end', cta: '收藏这组卡片', sub: '用输出工坊继续微调、导出和分享', tags: ['标签1', '标签2'] },
      ],
    }),
    aiPmSource,
    'AI产品经理的职业发展史',
    'ai-split'
  )
  assert.equal(hasMokaContentQualityIssue(genericMokaResult), true)
  assert.doesNotMatch(
    genericMokaResult.design.slides.map((slide) => slide.heading || slide.text || '').join('\n'),
    /^[一二三四五六七八九十]+[、.．]|^\d+(?:\.\d+)*[、.．:：]/m,
    'moka normalized text should strip raw outline numbering'
  )
  const leakedFieldMokaResult = parseMokaGenerationResult(
    'moka-ai-split',
    JSON.stringify({
      styleConfig: {
        cover: { background: '#ffffff' },
        content: { background: '#ffffff' },
        end: { background: '#ffffff' },
      },
      slides: [
        { type: 'cover', emoji: '✨', category: 'Moka', title: 'titel: AI产品经理的职业变化', subtitle: 'styleConfig: 从原文中提炼核心职业变化' },
        { type: 'content', heading: 'title: 能力从标注转向架构', text: 'text: 文章把 AI 产品经理的起点放在数据标注与模型协作，重点说明岗位逐步转向系统架构。', extra: 'slides: 核心变化是职责上移。' },
        { type: 'content', heading: 'heading: 门槛来自落地判断', text: 'content: 真正难点不是写需求，而是判断模型边界、业务场景和落地成本之间的关系。', extra: 'tags: 理解边界比堆功能更重要。' },
        { type: 'end', cta: 'cta: 记住能力主线', sub: 'sub: 从执行协作走向系统判断', tags: ['Moka', 'title', 'AI产品'] },
      ],
    }),
    aiPmSource,
    'AI产品经理的职业发展史',
    'ai-split'
  )
  const leakedFieldText = leakedFieldMokaResult.design.slides.flatMap((slide) => [
    slide.category,
    slide.title,
    slide.subtitle,
    slide.heading,
    slide.text,
    slide.extra,
    slide.cta,
    slide.sub,
    ...(slide.tags || []),
  ]).filter(Boolean).join('\n')
  assert.doesNotMatch(leakedFieldText, /\b(?:titel|title|styleConfig|slides|content|heading|text|tags|cta|sub)\s*[:：]/i)
  assert.doesNotMatch(leakedFieldText, /^Moka$/im)
  const leakedFieldHtml = buildMokaHtml({
    templateId: 'moka-ai-split',
    title: 'AI产品经理的职业发展史',
    styleId: 'editorial',
    result: leakedFieldMokaResult,
  })
  assert.doesNotMatch(leakedFieldHtml, />MOKA</)
  assert.doesNotMatch(leakedFieldHtml, />#Moka</)
  assert.doesNotMatch(leakedFieldHtml, />moka-ai-split</)
  const missingTitleMokaResult = parseMokaGenerationResult(
    'moka-ai-split',
    JSON.stringify({
      styleConfig: {
        cover: { background: '#ffffff' },
        content: { background: '#ffffff' },
        end: { background: '#ffffff' },
      },
      slides: [
        { type: 'cover', emoji: '✨', subtitle: '从原文中提炼核心职业变化' },
        { type: 'content', heading: '能力从标注转向架构', text: '文章把 AI 产品经理的起点放在数据标注与模型协作，重点说明岗位逐步转向系统架构。', extra: '核心变化是职责上移。' },
        { type: 'content', heading: '门槛来自落地判断', text: '真正难点不是写需求，而是判断模型边界、业务场景和落地成本之间的关系。', extra: '理解边界比堆功能更重要。' },
        { type: 'end', cta: '记住能力主线', sub: '从执行协作走向系统判断', tags: ['AI产品', '能力边界'] },
      ],
    }),
    aiPmSource,
    'AI产品经理的职业发展史',
    'ai-split'
  )
  assert.equal(hasMokaContentQualityIssue(missingTitleMokaResult), true)

  const mokaTemplatesSource = await readRepoFile('src/lib/output-workshop/moka/templates.ts')
  assert.match(mokaTemplatesSource, /mode: "moka"/)
  assert.match(mokaTemplatesSource, /Moka AI 单页创作/)
  assert.match(mokaTemplatesSource, /Moka AI 分页创作/)
  assert.match(mokaTemplatesSource, /cardSelectors: \["\.moka-card", "\.moka-slide", "\[data-moka-card\]"\]/)
  assert.doesNotMatch(mokaTemplatesSource, /singleTemplates/)
  assert.doesNotMatch(mokaTemplatesSource, /splitTemplates/)
  assert.doesNotMatch(mokaTemplatesSource, /moka-single-\$\{style\.id\}/)
  assert.doesNotMatch(mokaTemplatesSource, /moka-split-\$\{style\.id\}/)

  const generationSource = await readRepoFile('src/hooks/use-output-generation.ts')
  assert.match(generationSource, /isMokaTemplateId\(tplId\)/)
  assert.match(generationSource, /buildMokaGenerationPrompt/)
  assert.match(generationSource, /parseMokaGenerationResult/)
  assert.match(generationSource, /hasMokaContentQualityIssue/)
  assert.match(generationSource, /buildMokaRepairPrompt/)
  assert.match(generationSource, /Moka AI 正在重新提炼文章精华/)
  assert.match(generationSource, /if \(!hasMokaContentQualityIssue\(partial\)\)/)
  assert.match(generationSource, /const repairedHasIssue = hasMokaContentQualityIssue\(repaired\)/)
  assert.match(generationSource, /throw new Error\("Moka AI 没有从原文中提炼出可用的真实卡片内容/)
  assert.match(generationSource, /buildMokaHtml/)
  assert.match(generationSource, /mokaReferenceImageDataUrl/)
  assert.match(generationSource, /forceAiDesign/)
  assert.match(generationSource, /const forceMokaAiDesign = currentMokaStyleId === "ai"/)
  assert.match(generationSource, /const streamingReadyPattern = forceMokaAiDesign \? "styleConfig"/)
  assert.match(generationSource, /mokaGenerationMaxTokens/)
  assert.match(generationSource, /mokaRepairMaxTokens/)
  assert.match(generationSource, /imageUrls/)
  assert.match(generationSource, /setMokaRenderMemory/)
  assert.match(generationSource, /mokaRenderMemoryRef/)
  assert.match(generationSource, /renderMokaFromMemory/)
  assert.match(generationSource, /handleMokaTextEdit/)
  assert.match(generationSource, /handleMokaStyleEdit/)
  assert.match(generationSource, /handleMokaReorder/)
  assert.match(generationSource, /applyMokaTextEdit/)
  assert.match(generationSource, /applyMokaStyleEdit/)
  assert.match(generationSource, /applyMokaReorder/)
  assert.match(generationSource, /new Set\(\["left", "top", "marginLeft", "marginTop"\]\)/)
  assert.match(generationSource, /delete merged\.marginLeft/)
  assert.match(generationSource, /delete merged\.marginTop/)
  assert.match(generationSource, /Moka AI 正在生成视觉设计/)
  assert.match(generationSource, /Moka AI 正在提炼卡片内容/)
  assert.match(generationSource, /正在套用 Moka 模板结构/)
  assert.match(generationSource, /OUTPUT_WORKSHOP_MODEL_STORE_KEY = "outputWorkshopModel"/)
  assert.match(generationSource, /function fetchOutputWorkshopAiStream/)
  assert.match(generationSource, /result\.skipped\?\.length/)
  assert.match(generationSource, /智能卡片导出完成，部分页面已跳过/)
  assert.equal(
    (generationSource.match(/await fetchOutputWorkshopAiStream/g) || []).length,
    5,
    'output workshop AI generation and refine calls should use the dedicated model selector'
  )
  assert.doesNotMatch(generationSource, /解析 JSON schema/)
  assert.doesNotMatch(generationSource, /生成设计 schema/)

  const aiChatSource = await readRepoFile('src/lib/ai/chat.ts')
  assert.match(aiChatSource, /modelStoreKey\?: string/)
  assert.match(aiChatSource, /getAISettings\(modelStoreKey\.trim\(\)\)/)
  assert.match(aiChatSource, /storeKey: usageStoreKey/)

  const outputWorkshopSource = await readRepoFile('src/components/output-workshop/index.tsx')
  assert.match(outputWorkshopSource, /Moka/)
  assert.match(outputWorkshopSource, /getMokaTemplateKind\(selectedTemplateId\)/)
  assert.match(outputWorkshopSource, /setShowAdvanced\(true\)/)
  assert.match(outputWorkshopSource, /mokaEditingEnabled/)
  assert.match(outputWorkshopSource, /onMokaTextEdit/)
  assert.match(outputWorkshopSource, /onMokaStyleEdit/)
  assert.match(outputWorkshopSource, /onMokaReorder/)
  assert.doesNotMatch(outputWorkshopSource, /MokaDesignPanel/)
  assert.doesNotMatch(outputWorkshopSource, /PopoverContent/)
  assert.doesNotMatch(outputWorkshopSource, /MokaModePanel/)
  assert.doesNotMatch(outputWorkshopSource, /showMokaPanel/)
  assert.doesNotMatch(outputWorkshopSource, /showMokaSettings/)
  assert.doesNotMatch(outputWorkshopSource, /mokaAiDesignEnabled/)
  const outlineSelectStart = outputWorkshopSource.indexOf('const handleSelectOutlineSection')
  const outlineSelectEnd = outputWorkshopSource.indexOf('if (!open) return null', outlineSelectStart)
  assert.notEqual(outlineSelectStart, -1)
  assert.notEqual(outlineSelectEnd, -1)
  const outlineSelectHandler = outputWorkshopSource.slice(outlineSelectStart, outlineSelectEnd)
  assert.match(outlineSelectHandler, /setActiveOutlineIndex\(index\)/)
  assert.match(outlineSelectHandler, /scrollToPreviewSection\(index\)/)
  assert.doesNotMatch(outlineSelectHandler, /setSourceWorkspaceTab\("edit"\)/)

  const previewPanelSource = await readRepoFile('src/components/output-workshop/preview-panel.tsx')
  assert.match(previewPanelSource, /lingmo-moka-editor/)
  assert.match(previewPanelSource, /event\.source !== iframeRef\.current\?\.contentWindow/)
  assert.match(previewPanelSource, /onMokaTextEdit/)
  assert.match(previewPanelSource, /onMokaStyleEdit/)
  assert.match(previewPanelSource, /onMokaReorder/)
  assert.match(previewPanelSource, /overflow-y-auto overflow-x-hidden/)
  assert.match(previewPanelSource, /min-h-full w-full max-w-none overflow-hidden bg-background/)
  assert.doesNotMatch(previewPanelSource, /选择模板并输入素材后，在这里检查生成结果/)
  assert.doesNotMatch(previewPanelSource, /<div className="font-medium text-foreground">模板示例<\/div>/)
  assert.doesNotMatch(previewPanelSource, /freezePreviewInteraction && "pointer-events-none"/)

  const smartCardDialogSource = await readRepoFile('src/components/output-workshop/smart-card-dialog.tsx')
  assert.match(smartCardDialogSource, /thumbnailErrors/)
  assert.match(smartCardDialogSource, /const thumbnailConcurrency = Math\.min\(3, queue\.length\)/)
  assert.match(smartCardDialogSource, /finally \{[\s\S]*?setLoadingThumbs\(false\)/)
  assert.match(smartCardDialogSource, /预览失败/)

  const smartCardExportSource = await readRepoFile('src/lib/output-workshop/smart-card-export.ts')
  assert.match(smartCardExportSource, /CARD_RESOURCE_TIMEOUT_MS/)
  assert.match(smartCardExportSource, /CARD_SCREENSHOT_TIMEOUT_MS/)
  assert.match(smartCardExportSource, /CARD_THUMBNAIL_SCREENSHOT_TIMEOUT_MS/)
  assert.match(smartCardExportSource, /function withTimeout<T>/)
  assert.match(smartCardExportSource, /waitForIframeReadyInner/)
  assert.match(smartCardExportSource, /function isMokaCard/)
  assert.match(smartCardExportSource, /getRenderViewport\(card, targetWidth, targetHeight\)/)
  assert.match(smartCardExportSource, /width: CARD_BASE_WIDTH/)
  assert.match(smartCardExportSource, /height: CARD_BASE_HEIGHT/)
  assert.match(smartCardExportSource, /function findScreenshotTarget/)
  assert.match(smartCardExportSource, /function resolveTargetBackground/)
  assert.match(smartCardExportSource, /domToBlob\(target,/)
  assert.match(smartCardExportSource, /fitBlobToTargetSize\(blob, targetWidth, targetHeight/)
  assert.match(smartCardExportSource, /\.lingmo-smart-card-export-root > \.moka-card/)
  assert.match(smartCardExportSource, /width: 100% !important/)
  assert.match(smartCardExportSource, /const ratioMatches = Math\.abs\(sourceRatio - targetRatio\) < 0\.02/)
  assert.doesNotMatch(smartCardExportSource, /domToBlob\(doc\.documentElement/)
  assert.match(smartCardExportSource, /SmartCardExportSkip/)
  assert.match(smartCardExportSource, /exportedCount/)
  assert.match(smartCardExportSource, /已跳过/)
  assert.match(smartCardExportSource, /lingmo-moka-editor/)

  const workshopControlsSource = await readRepoFile('src/components/output-workshop/workshop-controls.ts')
  assert.match(workshopControlsSource, /label: "提炼内容"/)

  assert.match(utilsSource, /overflow: auto !important/)
  assert.doesNotMatch(utilsSource, /overflow: hidden !important/)

  const outputTemplatesHookSource = await readRepoFile('src/hooks/use-output-templates.ts')
  assert.match(outputTemplatesHookSource, /INTERNAL_OUTPUT_TEMPLATES/)
  assert.match(outputTemplatesHookSource, /const templateList = React\.useMemo\(\(\) => \{\s*return allTemplates\.length > 0 \? allTemplates : OUTPUT_TEMPLATES\s*\}/)
  assert.match(outputTemplatesHookSource, /INTERNAL_OUTPUT_TEMPLATES\.find\(\(t\) => t\.id === selectedTemplateId\)/)

  const sourcePanelSource = await readRepoFile('src/components/output-workshop/source-panel.tsx')
  assert.match(sourcePanelSource, /isMokaTemplateId\(selectedTemplateId\)/)
  assert.match(sourcePanelSource, /MokaDesignPanel/)
  assert.match(sourcePanelSource, /isMokaMode &&/)
  assert.match(sourcePanelSource, /flex min-h-0 flex-1 flex-col/)
  assert.match(sourcePanelSource, /生成模型/)
  assert.match(sourcePanelSource, /modelKey="outputWorkshop"/)
  assert.match(sourcePanelSource, /triggerClassName="h-8 w-full min-w-0 text-xs shadow-none"/)
  const sourceOutlineStart = sourcePanelSource.indexOf('{sourceWorkspaceTab === "outline"')
  const sourceOutlineEnd = sourcePanelSource.indexOf('{hasGeneratedOutput', sourceOutlineStart)
  assert.notEqual(sourceOutlineStart, -1)
  assert.notEqual(sourceOutlineEnd, -1)
  const sourceOutlineBlock = sourcePanelSource.slice(sourceOutlineStart, sourceOutlineEnd)
  assert.match(sourceOutlineBlock, /getOutlineLevel\(section\)/)
  assert.match(sourceOutlineBlock, /section\.title/)
  assert.match(sourceOutlineBlock, /aria-current/)
  assert.doesNotMatch(sourceOutlineBlock, /section\.body|section\.bullets/)

  const outputTypesSource = await readRepoFile('src/components/output-workshop/types.ts')
  assert.match(outputTypesSource, /level\?: number/)

  const modelSelectSource = await readRepoFile('src/app/core/setting/components/model-select.tsx')
  assert.match(modelSelectSource, /interface ModelSelectProps/)
  assert.match(modelSelectSource, /triggerClassName/)
  assert.match(modelSelectSource, /popoverClassName/)
  assert.match(modelSelectSource, /default: return `\$\{modelKey\}Model`/)

  const mokaPanelSource = await readRepoFile('src/components/output-workshop/moka-design-panel.tsx')
  assert.match(mokaPanelSource, /Moka AI 设计/)
  assert.match(mokaPanelSource, /风格/)
  assert.match(mokaPanelSource, /grid-cols-7 gap-1\.5/)
  assert.match(mokaPanelSource, /data-testid="moka-ai-design-panel"/)
  assert.match(mokaPanelSource, /accept="image\/png,image\/jpeg,image\/webp"/)
  assert.match(mokaPanelSource, /readAsDataURL/)
  assert.doesNotMatch(mokaPanelSource, /absolute inset-y-0 right-0/)
  assert.doesNotMatch(mokaPanelSource, /fixed/)

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
  assert.match(deckHtml, /class="slide-title-block"/)
  assert.match(deckHtml, /class="slide-section-index"/)
  assert.match(deckHtml, /id="prevBtn" aria-label="上一页">Prev/)
  assert.match(deckHtml, /id="nextBtn" aria-label="下一页">Next/)
  assert.match(deckHtml, /prevBtn\.disabled = activeIndex === 0/)
  assert.match(deckHtml, /nextBtn\.disabled = activeIndex === slides\.length - 1/)
  assert.match(deckHtml, /\.deck\s*\{[\s\S]*?place-items: center;[\s\S]*?overflow: hidden;/)
  assert.match(deckHtml, /\.gz-deck-slide\s*\{[\s\S]*?position: absolute;[\s\S]*?place-items: center;/)
  assert.match(deckHtml, /\.gz-deck-slide\.active\s*\{[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/)
  assert.doesNotMatch(deckHtml, /overflow-x:\s*auto/)
  assert.doesNotMatch(deckHtml, /scrollTo\(/)
  assert.match(deckHtml, /16 Columns/)

  const socialHtml = buildGuizangSocialCard(sampleOptions)
  assert.match(socialHtml, /template-code">M01/)
  assert.match(socialHtml, /template-code">S03/)
  assert.match(socialHtml, /class="gz-social-card cover-card/)
  assert.match(socialHtml, /class="gz-social-card detail-card/)
  assert.match(socialHtml, /class="hero-line"/)
  assert.match(socialHtml, /class="directory-list"/)
  assert.match(socialHtml, /\.hero-line\s*\{/)
  assert.match(socialHtml, /\.directory,\s*\n\s*\.directory-list\s*\{/)
  assert.match(socialHtml, /\.directory-list strong\s*\{/)
  assert.match(socialHtml, /\.detail-index\s*\{[\s\S]*?grid-column: 10 \/ 13;[\s\S]*?font-size: 56px;/)
  assert.match(socialHtml, /\.detail-body\s*\{[\s\S]*?grid-row: 7 \/ 15;[\s\S]*?display: grid;/)
  assert.match(socialHtml, /\.card-footer\s*\{[\s\S]*?grid-row: 15 \/ 17;[\s\S]*?line-height: 1\.2;/)
  assert.match(socialHtml, /1080 × 1440 · 3:4/)

  const xhsHtml = buildXiaohongshuStyle({
    ...sampleOptions,
    sourceLabel: 'AI产品经理发展史.md',
  })
  assert.match(xhsHtml, /AI产品经理发展史/)
  assert.match(xhsHtml, /产品洞察|技术笔记|研究摘要/)
  assert.doesNotMatch(xhsHtml, /CLAUDE|LingMo输出工坊|LingMo Studio|LINGMO\.STUDIO/)

  const builtInBuilders = [
    ['article-editorial', buildEditorialArticle],
    ['article-kami', buildKamiParchment],
    ['article-brutalist', buildBrutalistStyle],
    ['deck-minimal', buildGuizangDeck],
    ['deck-tech', buildTechSharing],
    ['poster-magazine', buildMagazinePoster],
    ['poster-hero', buildHeroPoster],
    ['data-dashboard', buildDataDashboard],
    ['data-infographic', buildInfographic],
    ['social-card', buildGuizangSocialCard],
    ['social-xiaohongshu', buildXiaohongshuStyle],
    ['social-waterfall', buildWaterfallStyle],
    ['visual-bento', buildBentoStyle],
    ['report-business', buildBusinessReportStyle],
    ['read-glass', buildLiquidGlassStyle],
    ['read-accordion', buildAccordionManualStyle],
    ['read-dark-tech', buildDarkTechStyle],
    ['learning-flashcard', buildLearningCards],
    ['learning-mindmap', buildMindmapStyle],
  ]

  for (const [templateId, build] of builtInBuilders) {
    const normalized = normalizeOutputWorkshopHtml(build(sampleOptions))
    assert.match(normalized, /<!DOCTYPE html>/i, `${templateId} should produce a document`)
    assert.match(normalized, /data-version="2026-06-layout-animate-typeset"/, `${templateId} should include the quality guard`)
    assert.match(normalized, /text-wrap: balance/, `${templateId} should include type balancing`)
    assert.match(normalized, /prefers-reduced-motion: reduce/, `${templateId} should include reduced motion fallback`)
    assert.equal((normalized.match(/lingmo-output-workshop-layout-guard/g) || []).length, 1, `${templateId} should not duplicate guard styles`)
  }

  const leakedCssHtml = normalizeOutputWorkshopHtml('.canvas { color: #fff; }\n.safe-area { display: flex; }')
  assert.match(leakedCssHtml, /<style>\.canvas \{ color: #fff; \}/)
  assert.match(leakedCssHtml, /id="lingmo-output-workshop-layout-guard"/)
  assert.match(leakedCssHtml, /data-version="2026-06-layout-animate-typeset"/)
  assert.match(leakedCssHtml, /text-wrap: balance/)
  assert.match(leakedCssHtml, /prefers-reduced-motion: reduce/)
  assert.doesNotMatch(leakedCssHtml, /<body>\.canvas/)

  const fragmentHtml = normalizeOutputWorkshopHtml('<section><h1>标题</h1><p>正文</p></section>')
  assert.match(fragmentHtml, /<!DOCTYPE html>/)
  assert.match(fragmentHtml, /<body><section>/)
  assert.match(fragmentHtml, /<meta name="viewport"/)

  const upgradedGuardHtml = normalizeOutputWorkshopHtml(
    '<!DOCTYPE html><html><head><style id="lingmo-output-workshop-layout-guard">old</style></head><body><p>正文</p></body></html>'
  )
  assert.doesNotMatch(upgradedGuardHtml, />old<\/style>/)
  assert.equal((upgradedGuardHtml.match(/lingmo-output-workshop-layout-guard/g) || []).length, 1)

  console.log('output workshop tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
