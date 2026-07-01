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

async function repoFileExists(relativePath) {
  try {
    await readFile(join(repoRoot, relativePath), 'utf8')
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
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

  // 重写相对 import：补 .mjs 扩展（ESM 必需），保留相对目录结构以支持子目录（shared/ 等）
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
    DESIGN_PROFILES,
    renderDesignProfilePromptBlock,
  } = await importTsModule('src/lib/output-workshop/design-profiles.ts')
  const {
    buildCreativeDirectPrompt,
    compactCreativeSkillPrompt,
  } = await importTsModule('src/lib/output-workshop/prompt-blocks.ts')
  const {
    lintOutputWorkshopHtml,
    shouldRepairOutputHtml,
  } = await importTsModule('src/lib/output-workshop/output-lint.ts')
  const {
    buildAutoRedbookHtmlFromSource,
    isAutoRedbookTemplateId,
  } = await importTsModule('src/lib/output-workshop/social-redbook-builder.ts')
  const {
    isLocalWechatOutputTemplate,
  } = await importTsModule('src/lib/output-workshop/template-routing.ts')
  const {
    splitContentIntoSections,
  } = await importTsModule('src/components/output-workshop/utils-content.ts')
  const templatesSource = await readRepoFile('src/lib/output-workshop/templates.ts')
  const templateRoutingSource = await readRepoFile('src/lib/output-workshop/template-routing.ts')
  const autoRedbookTemplateIds = [
    'social-redbook-sketch',
    'social-redbook-playful',
    'social-redbook-brutal',
    'social-redbook-botanical',
    'social-redbook-professional',
    'social-redbook-retro',
    'social-redbook-terminal',
    'social-redbook-clean',
  ]
  assert.match(templatesSource, /import type \{ DesignProfileId \} from '\.\/design-profiles'/)
  assert.match(templatesSource, /designProfileId\?: DesignProfileId/)
  assert.match(templatesSource, /qualityRules\?: string\[\]/)
  assert.match(templatesSource, /pipelineHint\?: string\[\]/)
  assert.match(templatesSource, /const CREATIVE_SERIES_BASE_PROMPT = `/)
  assert.match(templatesSource, /const CREATIVE_SERIES_TEMPLATES: OutputTemplate\[\] = \[/)
  assert.match(templatesSource, /\.\.\.CREATIVE_SERIES_TEMPLATES/)
  assert.match(templatesSource, /export const OUTPUT_TEMPLATES: OutputTemplate\[\] = \[/)
  assert.match(templatesSource, /\.\.\.WECHAT_OUTPUT_TEMPLATES/)
  assert.match(templatesSource, /\.\.\.AUTO_REDBOOK_SOCIAL_TEMPLATES/)
  assert.match(templatesSource, /export const INTERNAL_OUTPUT_TEMPLATES: OutputTemplate\[\] = \[/)
  const legacyModePattern = ['mo', 'ka'].join('')
  assert.doesNotMatch(templatesSource, new RegExp(`${legacyModePattern.toUpperCase()}_OUTPUT_TEMPLATES`))
  assert.doesNotMatch(templatesSource, new RegExp(`\\|\\s*'${legacyModePattern}'`))
  assert.doesNotMatch(templatesSource, new RegExp(`mode:\\s*['"]${legacyModePattern}['"]`))
  assert.doesNotMatch(templatesSource, new RegExp(`${legacyModePattern}-ai-(?:single|split)`))
  assert.match(templatesSource, /INTERNAL_OUTPUT_TEMPLATES[\s\S]*\.\.\.OUTPUT_TEMPLATES/)
  assert.doesNotMatch(templatesSource, new RegExp(`id:\\s*'${legacyModePattern}'`))
  assert.doesNotMatch(templatesSource, new RegExp(`${legacyModePattern.replace(/^m/, 'M')} 卡片`))
  assert.match(templatesSource, /id: 'wechat', name: '一键排版'/)
  assert.match(templatesSource, /export \{ isLocalWechatOutputTemplate \} from '\.\/template-routing'/)
  assert.match(templatesSource, /id: 'article', name: '专业阅读'/)
  assert.match(templatesSource, /id: 'social', name: '社交传播'/)
  assert.match(templatesSource, /id: 'deck', name: '演示汇报'/)
  assert.match(templatesSource, /id: 'infographic', name: '可视化展示'/)
  assert.match(templatesSource, /id: 'creative', name: 'AI 自由创意'/)
  assert.doesNotMatch(templatesSource, /\|\s*'huashu'/)
  assert.doesNotMatch(templatesSource, /mode:\s*'huashu'/)
  assert.match(templatesSource, /## 创意设计集成规范/)
  assert.match(templatesSource, /Junior Designer brief/)
  assert.match(templatesSource, /Tweaks/)
  assert.match(templatesSource, /Pentagram/)
  assert.match(templatesSource, /反 AI slop 规则/)
  assert.match(templatesSource, /assumptions、chosen philosophy、artifact type、content structure、known limitations/)
  assert.match(templateRoutingSource, /export function isLocalWechatOutputTemplate/)
  assert.match(templateRoutingSource, /template\?\.mode === "wechat"/)
  assert.match(templateRoutingSource, /isWechatStyleId\(id\)/)
  assert.match(templateRoutingSource, /id\.startsWith\("wechat-"\)/)
  assert.match(templateRoutingSource, /feature === "一键排版"/)
  assert.doesNotMatch(templateRoutingSource, /market|plugin-fs|appDataDir/)
  assert.match(templatesSource, /const AUTO_REDBOOK_BASE_PROMPT = `/)
  assert.match(templatesSource, /comeonzhj\/Auto-Redbook-Skills/)
  assert.match(templatesSource, /const REDBOOK_CARD_SELECTORS = \['\.cover-container', '\.card-container', '\[data-redbook-card\]', '\[data-export-card\]'\]/)
  assert.match(templatesSource, /const AUTO_REDBOOK_SOCIAL_TEMPLATES: OutputTemplate\[\]/)
  assert.match(templatesSource, /skillPrompt: AUTO_REDBOOK_BASE_PROMPT \+ theme\.themePrompt/)
  assert.match(templatesSource, /\.\.\.AUTO_REDBOOK_SOCIAL_TEMPLATES/)
  assert.match(templatesSource, /pagingMode: 'auto-fit'/)
  assert.match(templatesSource, /autoSplitMaxChars: 760/)
  assert.match(templatesSource, /dynamicMaxHeight: 2160/)
  for (const id of autoRedbookTemplateIds) {
    assert.match(templatesSource, new RegExp(`id: '${escapeRegExp(id)}'`), `${id} should be declared as an Auto-Redbook social template`)
  }
  const wechatTemplateIds = [...templatesSource.matchAll(/"wechat-[^"]+"|latepost-depth|guardian|nikkei|warm-docs|lemonde/g)]
    .map((match) => match[0].replace(/^"|"$/g, ''))
    .filter((id, index, list) => list.indexOf(id) === index)
  assert.ok(wechatTemplateIds.length >= 10, 'wechat one-click templates should be present')
  for (const id of wechatTemplateIds) {
    assert.equal(
      isLocalWechatOutputTemplate({ id, mode: 'wechat' }, id),
      true,
      `${id} must be routed to the local one-click renderer`
    )
  }
  assert.equal(isLocalWechatOutputTemplate(null, 'wechat-default'), true)
  assert.equal(isLocalWechatOutputTemplate({ id: 'custom-wechat-preview', mode: 'creative', previewTone: 'wechat-article' }, 'custom-wechat-preview'), true)
  assert.equal(isLocalWechatOutputTemplate({ id: 'feature-wechat-copy', mode: 'creative', features: ['图文复制'] }, 'feature-wechat-copy'), true)
  assert.equal(isLocalWechatOutputTemplate({ id: 'creative-freeform', mode: 'creative' }, 'creative-freeform'), false)
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

  const utilsTemplatePreviewSource = await readRepoFile('src/components/output-workshop/utils-template-preview.ts')
  const utilsContentSource = await readRepoFile('src/components/output-workshop/utils-content.ts')
  const utilsPromptsSource = await readRepoFile('src/components/output-workshop/utils-prompts.ts')
  assert.doesNotMatch(utilsTemplatePreviewSource, new RegExp(`build${legacyModePattern.replace(/^m/, 'M')}TemplatePreviewHtml`))
  assert.doesNotMatch(utilsTemplatePreviewSource, new RegExp(`is${legacyModePattern.replace(/^m/, 'M')}TemplateId`))
  assert.match(utilsContentSource, /export function splitContentIntoSections\(content: string\): ExtractedSection\[\]/)
  assert.match(utilsContentSource, /function cleanMarkdownTitle\(value: string\): string/)
  assert.match(utilsContentSource, /const title = cleanMarkdownTitle\(rawTitle\.replace/)
  assert.match(utilsContentSource, /const level = rawTitle\.match\(/)
  assert.match(utilsContentSource, /title: title \|\| "未命名章节",[\s\S]*?level,/)
  assert.match(utilsContentSource, /\.filter\(\(section\) => section\.title\)/)
  assert.match(utilsContentSource, /title: index === 0 \? "核心概览" : `要点 \$\{index \+ 1\}`,[\s\S]*?level: 1,/)
  for (const [id] of creativeSeriesTemplates) {
    assert.match(utilsTemplatePreviewSource, new RegExp(`case "${id}":`), `${id} should use the creative-series preview`)
  }
  for (const id of autoRedbookTemplateIds) {
    assert.match(utilsTemplatePreviewSource, new RegExp(`case "${escapeRegExp(id)}":`), `${id} should use the social-series preview`)
  }
  assert.match(utilsTemplatePreviewSource, /buildSocialSeriesTemplatePreview\(template\)/)
  const genericWechatPreviewLabel = ['公众号', '模板示例'].join('')
  assert.match(utilsTemplatePreviewSource, /buildCreativeSeriesTemplatePreview\(template\)/)
  assert.match(utilsTemplatePreviewSource, /sourceLabel: "一键排版模板示例"/)
  assert.match(utilsTemplatePreviewSource, /sourceLabel: "模板示例"/)
  assert.doesNotMatch(utilsTemplatePreviewSource, new RegExp(genericWechatPreviewLabel))
  assert.match(utilsTemplatePreviewSource, /LingMo 智能排版/)
  assert.match(utilsTemplatePreviewSource, /content-driven HTML artifact/)
  assert.match(utilsTemplatePreviewSource, /真机状态流，不是静态截图/)
  assert.match(utilsTemplatePreviewSource, /一张一张居中演讲/)
  assert.match(utilsTemplatePreviewSource, /时间片段驱动的动画稿/)
  assert.match(utilsTemplatePreviewSource, /并排比较，而不是换个颜色/)
  assert.match(utilsTemplatePreviewSource, /印刷级网格信息图/)
  assert.match(utilsTemplatePreviewSource, /先选设计方向，再深挖方案/)
  assert.match(utilsTemplatePreviewSource, /5 维度设计评审/)
  assert.match(utilsTemplatePreviewSource, /Anti AI slop/)
  assert.match(utilsPromptsSource, /prefers-reduced-motion: reduce/)

  assert.ok(DESIGN_PROFILES.length >= 6)
  assert.match(renderDesignProfilePromptBlock('swiss-deck'), /瑞士网格演示/)
  assert.match(renderDesignProfilePromptBlock('data-utility'), /数据工具叙事/)
  const compactedSkill = compactCreativeSkillPrompt('intro\n### 演讲幻灯片任务\n- 生成 deck')
  assert.equal(compactedSkill, '### 演讲幻灯片任务\n- 生成 deck')
  const creativePrompt = buildCreativeDirectPrompt({
    template: {
      id: 'test-deck',
      name: '测试 Deck',
      nameEn: 'Test Deck',
      mode: 'creative',
      scenario: 'presentation',
      description: '测试',
      icon: 'T',
      designConstraints: '测试约束',
      outputHint: '测试输出',
      bestFor: '测试场景',
      designProfileId: 'swiss-deck',
      qualityRules: ['测试质量规则'],
      pipelineHint: ['brief', 'deck'],
      skillPrompt: '### 演讲幻灯片任务\n- 输出 16:9 deck',
      outputTargets: ['HTML deck'],
      sizePresets: ['16:9'],
    },
    title: 'AI 产品方法论',
    sourceContent: '# 输入标题\n正文',
    sourceLabel: '单元测试',
    customInstructions: '保持克制',
    templateOverrides: {
      fontFamily: 'Noto Sans SC',
      fontSize: 24,
      lineHeight: 1.55,
      themeColor: '#2563eb',
      cardGap: 32,
      backgroundStyle: 'soft',
      stickersEnabled: false,
      safeAreaEnabled: true,
      sizePresetId: '16:9',
      mermaidRenderMode: 'card',
    },
  })
  assert.match(creativePrompt, /设计 Profile：瑞士网格演示/)
  assert.match(creativePrompt, /当前选用的创意模板规范：测试 Deck/)
  assert.match(creativePrompt, /测试质量规则/)
  assert.match(creativePrompt, /推荐工作流：brief -> deck/)
  assert.match(creativePrompt, /主标题：AI 产品方法论/)

  const autoRedbookPrompt = buildCreativeDirectPrompt({
    template: {
      id: 'social-redbook-sketch',
      name: '手绘笔记组图',
      nameEn: 'Redbook Sketch',
      mode: 'social',
      scenario: 'sharing',
      description: '测试',
      icon: '笔',
      designConstraints: 'Auto-Redbook',
      outputHint: '生成 3:4 卡片组图',
      bestFor: '小红书组图',
      skillPrompt: '## Auto-Redbook 社交组图规范\n### 主题皮肤：Sketch 手绘素描',
      exportBlueprint: { cardSelectors: ['.cover-container', '.card-container'], defaultRatio: '3:4', pagingMode: 'auto-fit' },
    },
    title: 'AI 项目简历重构手册',
    sourceContent: '# STAR 法则\nSituation Task Action Result',
    sourceLabel: '面试指导.md',
    customInstructions: '',
    templateOverrides: {
      fontFamily: 'Noto Sans SC',
      fontSize: 24,
      lineHeight: 1.55,
      themeColor: '#e74c3c',
      cardGap: 24,
      backgroundStyle: 'paper',
      stickersEnabled: false,
      safeAreaEnabled: true,
      sizePresetId: '3:4',
      mermaidRenderMode: 'card',
    },
  })
  assert.match(autoRedbookPrompt, /Auto-Redbook 卡片生成硬性合同/)
  assert.match(autoRedbookPrompt, /\.redbook-deck/)
  assert.match(autoRedbookPrompt, /\.cover-container/)
  assert.match(autoRedbookPrompt, /\.card-container/)
  assert.match(autoRedbookPrompt, /\.card-content-scale/)
  assert.match(autoRedbookPrompt, /禁止只输出一个 `\.container`/)

  const lintResult = lintOutputWorkshopHtml('body { color: #fff; }')
  assert.ok(shouldRepairOutputHtml(lintResult))
  assert.ok(lintResult.severeFindings.some((finding) => finding.id === 'missing-shell'))
  assert.ok(lintResult.severeFindings.some((finding) => finding.id === 'css-only'))
  const lintClean = lintOutputWorkshopHtml(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
    body{font-family:system-ui,sans-serif;color:#111827;background:#ffffff;margin:0}
    main{max-width:720px;margin:0 auto;padding:48px 24px}
    p{line-height:1.7}
    @media (prefers-reduced-motion: reduce){*{animation:none;transition:none}}
  </style></head><body><main><h1>AI 产品方法论</h1><p>把模糊需求拆成可观察的输入、约束和验收标准，再用证据区承载细节。</p><p>页面保留真实标题、段落、列表和来源信息，确保生成结果可预览、可复制、可导出，并且不会横向溢出。</p><p>这段内容用于验证完整 HTML 不会被质量检查误判为残缺片段。</p></main></body></html>`)
  assert.equal(shouldRepairOutputHtml(lintClean), false)
  const autoRedbookBadLint = lintOutputWorkshopHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{margin:0}.container{max-width:1200px;margin:0 auto}.card{padding:24px}
    @media (prefers-reduced-motion: reduce){*{animation:none;transition:none}}
  </style></head><body><main class="container"><h1>AI 项目简历重构手册</h1><section class="card"><h2>STAR 法则</h2><p>Situation Task Action Result 是核心表达方式。</p><p>这里故意模拟错误的普通平铺长网页。</p></section></main></body></html>`, { templateId: 'social-redbook-sketch' })
  assert.ok(shouldRepairOutputHtml(autoRedbookBadLint))
  assert.ok(autoRedbookBadLint.severeFindings.some((finding) => finding.id === 'missing-auto-redbook-cards'))
  assert.match(autoRedbookBadLint.repairPrompt, /Auto-Redbook 组图结构/)
  const autoRedbookGoodLint = lintOutputWorkshopHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{margin:0}.redbook-deck{display:grid;gap:24px}.cover-container,.card-container{width:1080px;height:1440px;overflow:hidden}.card-content-scale{position:relative}
    @media (prefers-reduced-motion: reduce){*{animation:none;transition:none}}
  </style></head><body><main class="redbook-deck"><section class="cover-container" data-redbook-card="cover"><div class="cover-inner"><div class="card-content"><div class="card-content-scale"><h1>AI 项目简历重构手册</h1><p>封面卡说明文字足够完整。</p></div></div></div></section><section class="card-container" data-redbook-card="1"><div class="card-inner"><div class="card-content"><div class="card-content-scale"><h2>STAR 法则</h2><p>Situation 背景、Task 任务、Action 行动、Result 结果共同组成面试表达主线。</p><p>这张卡用于验证 Auto-Redbook 结构不会被误判为普通长网页。</p></div></div></div></section><section class="card-container" data-redbook-card="2"><div class="card-inner"><div class="card-content"><div class="card-content-scale"><h2>行动证据</h2><p>每张卡只讲一个章节，避免把所有内容压在同一个长页面里。</p></div></div></div></section><section class="card-container" data-redbook-card="3"><div class="card-inner"><div class="card-content"><div class="card-content-scale"><h2>结果表达</h2><p>结尾卡承接量化成果和面试表达提醒，保持组图导出顺序明确。</p></div></div></div></section></main></body></html>`, { templateId: 'social-redbook-sketch' })
  assert.equal(autoRedbookGoodLint.severeFindings.some((finding) => finding.id === 'missing-auto-redbook-cards'), false)
  const autoRedbookTooFewLint = lintOutputWorkshopHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{margin:0}.redbook-deck{display:grid;gap:24px}.cover-container,.card-container{width:1080px;height:1440px;overflow:hidden}.card-content-scale{position:relative}
    @media (prefers-reduced-motion: reduce){*{animation:none;transition:none}}
  </style></head><body><main class="redbook-deck"><section class="cover-container" data-redbook-card="cover"><div class="cover-inner"><div class="card-content"><div class="card-content-scale"><h1>AI 项目简历重构手册</h1><p>封面卡说明文字足够完整。</p></div></div></div></section><section class="card-container" data-redbook-card="1"><div class="card-inner"><div class="card-content"><div class="card-content-scale"><h2>STAR 法则</h2><p>只有一张正文卡，不符合组图模板。</p></div></div></div></section></main></body></html>`, { templateId: 'social-redbook-sketch' })
  assert.ok(autoRedbookTooFewLint.severeFindings.some((finding) => finding.id === 'missing-auto-redbook-cards'))
  assert.equal(isAutoRedbookTemplateId('social-redbook-sketch'), true)
  const rebuiltAutoRedbookHtml = buildAutoRedbookHtmlFromSource({
    templateId: 'social-redbook-sketch',
    title: 'AI 项目简历重构手册',
    sourceLabel: '面试指导.md',
    sourceContent: `# AI项目简历包装方法论

核心原则：采用STAR法则（Situation, Task, Action, Result）来包装项目经历，使其更具故事性和说服力。

## 核心包装逻辑：STAR 法则
Situation（背景）：清晰阐述用户是谁，其面临的核心痛点和需求是什么。
Task（任务）：明确项目需要达成的目标或承担的具体职责。
Action（行动）：描述为达成目标所采取的关键策略、技术方案和具体执行步骤。
Result（结果）：呈现可量化的成果，包括技术指标和业务指标。

## 表达重点
- 先讲业务问题，再讲技术方案。
- 每个经历都要有行动证据。
- 结果尽量量化，没有数据时讲清影响范围。`,
  })
  assert.match(rebuiltAutoRedbookHtml, /class="redbook-deck"/)
  assert.match(rebuiltAutoRedbookHtml, /class="cover-container[^"]*" data-redbook-card="cover"/)
  assert.ok((rebuiltAutoRedbookHtml.match(/class="card-container/g) || []).length >= 3)
  assert.match(rebuiltAutoRedbookHtml, /class="card-content-scale"/)
  assert.equal(
    lintOutputWorkshopHtml(rebuiltAutoRedbookHtml, { templateId: 'social-redbook-sketch' }).severeFindings.some((finding) => finding.id === 'missing-auto-redbook-cards'),
    false
  )

  const legacyBrand = ['Mo', 'ka'].join('')
  const legacyToken = legacyBrand.toLowerCase()
  const legacyRegex = new RegExp(`${legacyBrand}|${legacyToken}|${legacyBrand.toUpperCase()}`)
  const legacyModulePaths = [
    `src/components/output-workshop/${legacyToken}-design-panel.tsx`,
    `src/lib/output-workshop/${legacyToken}/builders.ts`,
    `src/lib/output-workshop/${legacyToken}/constants.ts`,
    `src/lib/output-workshop/${legacyToken}/editor.ts`,
    `src/lib/output-workshop/${legacyToken}/index.ts`,
    `src/lib/output-workshop/${legacyToken}/parser.ts`,
    `src/lib/output-workshop/${legacyToken}/prompts.ts`,
    `src/lib/output-workshop/${legacyToken}/templates.ts`,
    `src/lib/output-workshop/${legacyToken}/types.ts`,
  ]
  for (const legacyPath of legacyModulePaths) {
    assert.equal(await repoFileExists(legacyPath), false, `${legacyPath} should be removed`)
  }

  const generationSource = await readRepoFile('src/hooks/use-output-generation.ts')
  assert.doesNotMatch(generationSource, legacyRegex)
  assert.doesNotMatch(generationSource, /forceAiDesign/)
  assert.doesNotMatch(generationSource, /imageUrls/)
  assert.match(generationSource, /OUTPUT_WORKSHOP_MODEL_STORE_KEY = "outputWorkshopModel"/)
  assert.match(generationSource, /INITIAL_GENERATION_TELEMETRY/)
  assert.match(generationSource, /generationTelemetry/)
  assert.match(generationSource, /markAiRequestStarted/)
  assert.match(generationSource, /markAiChunkThrottled/)
  assert.match(generationSource, /telemetryRef/)
  assert.match(generationSource, /firstByteAt: telemetryRef\.current\.firstByteAt \?\? now/)
  assert.match(generationSource, /qualityChecked/)
  assert.match(generationSource, /repairTriggered/)
  assert.match(generationSource, /rebuildAutoRedbookIfNeeded/)
  assert.match(generationSource, /buildAutoRedbookHtmlFromSource/)
  assert.match(generationSource, /import \{ buildWechatArticle \} from "@\/lib\/output-workshop\/wechat-builder"/)
  assert.match(generationSource, /import \{ isLocalWechatOutputTemplate \} from "@\/lib\/output-workshop\/template-routing"/)
  assert.match(generationSource, /generationRunIdRef/)
  assert.match(generationSource, /selectedTemplateRef/)
  assert.match(generationSource, /selectedTemplateIdRef/)
  assert.match(generationSource, /selectedTemplateRef\.current = selectedTemplate/)
  assert.match(generationSource, /selectedTemplateIdRef\.current = selectedTemplateId/)
  assert.match(generationSource, /已拦截一键排版模板进入 AI 直绘/)
  assert.doesNotMatch(generationSource, /localWechatGeneratorRef/)
  assert.match(generationSource, /const generateLocalWechatOutput = React\.useCallback/)
  assert.match(generationSource, /generationRunIdRef\.current \+= 1/)
  assert.match(generationSource, /abortRef\.current\?\.abort\(\)/)
  assert.match(generationSource, /buildWechatArticle\(\{/)
  assert.match(generationSource, /styleId: latestTemplateId/)
  assert.match(generationSource, /phase: "local-build"/)
  assert.match(generationSource, /isLocalWechatOutputTemplate\(latestTemplate, latestTemplateId\)/)
  assert.match(generationSource, /isLocalWechatOutputTemplate\(selectedTemplateRef\.current, selectedTemplateIdRef\.current\)/)
  assert.match(generationSource, /const isCurrentRun = \(\) => generationRunIdRef\.current === runId && !abortController\.signal\.aborted/)
  assert.match(generationSource, /void generateLocalWechatOutput\(\)/)
  assert.match(generationSource, /generateLocalWechatOutput,[\s\S]*?markAiChunkThrottled/)
  assert.match(generationSource, /toast\(\{ title: "一键排版完成" \}\)/)
  assert.match(generationSource, /function fetchOutputWorkshopAiStream/)
  assert.match(generationSource, /buildCreativeDirectPrompt/)
  assert.match(generationSource, /lintOutputWorkshopHtml/)
  assert.match(generationSource, /shouldRepairOutputHtml/)
  assert.match(generationSource, /正在修复生成结果/)
  assert.doesNotMatch(generationSource, /CREATIVE_PROMPT_SOURCE_LIMIT = 8_000/)
  assert.doesNotMatch(generationSource, /function compactCreativeSkillPrompt\(skillPrompt: string\): string/)
  assert.doesNotMatch(generationSource, /compactCreativeSkillPrompt\(tpl\.skillPrompt\)/)
  assert.doesNotMatch(generationSource, /trimmed\.slice\(0, CREATIVE_PROMPT_SOURCE_LIMIT\)/)
  assert.match(generationSource, /CREATIVE_DIRECT_MAX_TOKENS[\s\S]*?\)/)
  assert.doesNotMatch(generationSource, /buildFastCreativePreviewHtml/)
  assert.doesNotMatch(generationSource, /CREATIVE_FAST_PREVIEW_DELAY_MS/)
  assert.doesNotMatch(generationSource, /CREATIVE_FIRST_BYTE_TIMEOUT_MS/)
  assert.doesNotMatch(generationSource, /快速预览/)
  assert.equal(
    (generationSource.match(/await\s+fetchOutputWorkshopAiStream\(/g) || []).length,
    3,
    'output workshop AI generation, repair, and refine calls should use the dedicated model selector'
  )
  assert.doesNotMatch(generationSource, /解析 JSON schema/)
  assert.doesNotMatch(generationSource, /生成设计 schema/)

  const outputExportSource = await readRepoFile('src/hooks/use-output-export.ts')
  assert.match(outputExportSource, /result\.skipped\?\.length/)
  assert.match(outputExportSource, /智能卡片导出完成，部分页面已跳过/)
  assert.match(outputExportSource, /result\.exportedCount/)

  const aiChatSource = await readRepoFile('src/lib/ai/chat.ts')
  assert.match(aiChatSource, /modelStoreKey\?: string/)
  assert.match(aiChatSource, /modelStoreKey: storeKey/)
  assert.match(aiChatSource, /usageStoreKey = storeKey\?\.trim\(\) \|\| 'primaryModel'/)
  assert.match(aiChatSource, /storeKey\?\.trim\(\) \? await getAISettings\(storeKey\.trim\(\)\) : undefined/)
  assert.match(aiChatSource, /storeKey: usageStoreKey/)

  const marketSource = await readRepoFile('src/lib/output-workshop/market.ts')
  assert.match(marketSource, /interface OpenDesignManifestLite/)
  assert.match(marketSource, /openDesignManifest/)
  assert.match(marketSource, /open-design\.json/)
  assert.match(marketSource, /function mapOpenDesignMode\(mode\?: string\): OutputMode/)
  assert.match(marketSource, /function inferDesignProfileFromManifest\(manifest\?: OpenDesignManifestLite\): DesignProfileId \| undefined/)
  assert.match(marketSource, /function renderOpenDesignPromptAppendix\(manifest\?: OpenDesignManifestLite\): string/)
  assert.match(marketSource, /const manifestText = await readOptionalTextFile/)
  assert.match(marketSource, /designProfileId:/)
  assert.match(marketSource, /pipelineHint:/)
  assert.match(marketSource, /previewTone:/)
  assert.match(marketSource, /metadata\.pagingMode/)
  assert.match(marketSource, /metadata\.autoSplitMaxChars/)
  assert.match(marketSource, /metadata\.dynamicMaxHeight/)

  const outputWorkshopSource = await readRepoFile('src/components/output-workshop/index.tsx')
  assert.doesNotMatch(outputWorkshopSource, legacyRegex)
  assert.doesNotMatch(outputWorkshopSource, /PopoverContent/)
  const outlineSelectStart = outputWorkshopSource.indexOf('const handleSelectOutlineSection')
  const outlineSelectEnd = outputWorkshopSource.indexOf('if (!open) return null', outlineSelectStart)
  assert.notEqual(outlineSelectStart, -1)
  assert.notEqual(outlineSelectEnd, -1)
  const outlineSelectHandler = outputWorkshopSource.slice(outlineSelectStart, outlineSelectEnd)
  assert.match(outlineSelectHandler, /setActiveOutlineIndex\(index\)/)
  assert.match(outlineSelectHandler, /window\.setTimeout/)
  assert.match(outlineSelectHandler, /scrollToPreviewSection\(section, index\)/)
  assert.doesNotMatch(outlineSelectHandler, /setSourceWorkspaceTab\("edit"\)/)

  const previewPanelSource = await readRepoFile('src/components/output-workshop/preview-panel.tsx')
  assert.doesNotMatch(previewPanelSource, legacyRegex)
  assert.doesNotMatch(previewPanelSource, /event\.source !== iframeRef\.current\?\.contentWindow/)
  assert.match(previewPanelSource, /overflow-y-auto overflow-x-hidden/)
  assert.match(previewPanelSource, /absolute inset-0 z-20 grid place-items-center/)
  assert.match(previewPanelSource, /getFirstResponseText/)
  assert.match(previewPanelSource, /getGenerationWaitText/)
  assert.match(previewPanelSource, /等待首个响应/)
  assert.match(previewPanelSource, /首响应/)
  assert.match(previewPanelSource, /质量检查/)
  assert.match(previewPanelSource, /修复状态/)
  assert.match(previewPanelSource, /min-h-full w-full max-w-none overflow-hidden bg-background/)
  assert.doesNotMatch(previewPanelSource, /选择模板并输入素材后，在这里检查生成结果/)
  assert.doesNotMatch(previewPanelSource, /<div className="font-medium text-foreground">模板示例<\/div>/)
  assert.doesNotMatch(previewPanelSource, /freezePreviewInteraction && "pointer-events-none"/)

  const smartCardDialogSource = await readRepoFile('src/components/output-workshop/smart-card-dialog.tsx')
  assert.match(smartCardDialogSource, /thumbnailErrors/)
  assert.match(smartCardDialogSource, /const thumbnailConcurrency = Math\.min\(3, queue\.length\)/)
  assert.match(smartCardDialogSource, /finally \{[\s\S]*?setLoadingThumbs\(false\)/)
  assert.match(smartCardDialogSource, /预览失败/)
  assert.match(smartCardDialogSource, /const isVerticalCardPreset = currentPresetId === "3:4"/)
  assert.match(smartCardDialogSource, /max-w-\[680px\]/)
  assert.match(smartCardDialogSource, /grid-rows-\[auto_minmax\(0,1fr\)_auto\]/)
  assert.match(smartCardDialogSource, /md:grid-cols-\[minmax\(0,1fr\)_188px\]/)
  assert.match(smartCardDialogSource, /isVerticalCardPreset[\s\S]*?\? "grid-cols-2 gap-2"/)
  assert.match(smartCardDialogSource, /max-h-\[168px\]/)

  const smartCardExportSource = await readRepoFile('src/lib/output-workshop/smart-card-export.ts')
  assert.match(smartCardExportSource, /CARD_RESOURCE_TIMEOUT_MS/)
  assert.match(smartCardExportSource, /CARD_SCREENSHOT_TIMEOUT_MS/)
  assert.match(smartCardExportSource, /CARD_THUMBNAIL_SCREENSHOT_TIMEOUT_MS/)
  assert.match(smartCardExportSource, /function withTimeout<T>/)
  assert.match(smartCardExportSource, /waitForIframeReadyInner/)
  assert.doesNotMatch(smartCardExportSource, legacyRegex)
  assert.doesNotMatch(smartCardExportSource, new RegExp(`function is${legacyBrand}Card`))
  assert.match(smartCardExportSource, /export type SmartCardPagingMode = "semantic" \| "separator" \| "auto-fit" \| "auto-split" \| "dynamic"/)
  assert.match(smartCardExportSource, /pagingMode\?: SmartCardPagingMode/)
  assert.match(smartCardExportSource, /function splitBySeparatorBoundaries/)
  assert.match(smartCardExportSource, /function splitByContentWeight/)
  assert.match(smartCardExportSource, /function applyAutoFitScale/)
  assert.match(smartCardExportSource, /"\.cover-container"/)
  assert.match(smartCardExportSource, /"\.card-container"/)
  assert.match(smartCardExportSource, /function getRenderViewport\(card: SmartCard, targetWidth: number, targetHeight: number\)/)
  assert.match(smartCardExportSource, /width: Math\.max\(targetWidth, CARD_BASE_WIDTH\)/)
  assert.match(smartCardExportSource, /height: Math\.max\(dynamicHeight, CARD_BASE_HEIGHT\)/)
  assert.match(smartCardExportSource, /function findScreenshotTarget/)
  assert.match(smartCardExportSource, /function resolveTargetBackground/)
  assert.match(smartCardExportSource, /domToBlob\(target,/)
  assert.match(smartCardExportSource, /fitBlobToTargetSize\(blob, targetWidth, targetHeight/)
  assert.match(smartCardExportSource, /const ratioMatches = Math\.abs\(sourceRatio - targetRatio\) < 0\.02/)
  assert.doesNotMatch(smartCardExportSource, /domToBlob\(doc\.documentElement/)
  assert.match(smartCardExportSource, /SmartCardExportSkip/)
  assert.match(smartCardExportSource, /exportedCount/)
  assert.match(smartCardExportSource, /已跳过/)

  const workshopControlsSource = await readRepoFile('src/components/output-workshop/workshop-controls.ts')
  assert.match(workshopControlsSource, /label: "提炼内容"/)
  assert.match(workshopControlsSource, /templateId\.startsWith\("social-redbook-"\)/)
  assert.doesNotMatch(workshopControlsSource, legacyRegex)

  assert.match(previewPanelSource, /REDBOOK_PREVIEW_GRID_STYLE_ID/)
  assert.match(previewPanelSource, /function injectRedbookPreviewGridStyles/)
  assert.match(previewPanelSource, /function RedbookCardWall/)
  assert.match(previewPanelSource, /parseSmartCards\(html, selectedTemplate\.exportBlueprint\)/)
  assert.match(previewPanelSource, /grid-cols-1[\s\S]*sm:grid-cols-\[repeat\(2,minmax\(0,300px\)\)\]/)
  assert.match(previewPanelSource, /智能排版导出源视口/)
  assert.match(previewPanelSource, /grid-template-columns: repeat\(2, max-content\) !important/)
  assert.match(previewPanelSource, /--lingmo-redbook-preview-zoom: 0\.46/)
  assert.match(previewPanelSource, /isRedbookPreview[\s\S]*?min-h-full w-full max-w-\[1180px\]/)

  assert.match(utilsTemplatePreviewSource, /overflow: auto !important/)
  assert.doesNotMatch(utilsTemplatePreviewSource, /overflow: hidden !important/)

  const outputTemplatesHookSource = await readRepoFile('src/hooks/use-output-templates.ts')
  assert.match(outputTemplatesHookSource, /INTERNAL_OUTPUT_TEMPLATES/)
  assert.match(outputTemplatesHookSource, /type TemplateCategoryId = "all" \| OutputMode/)
  assert.match(outputTemplatesHookSource, /const templateList = React\.useMemo\(\(\) => \{\s*return allTemplates\.length > 0 \? allTemplates : OUTPUT_TEMPLATES\s*\}/)
  assert.match(outputTemplatesHookSource, /INTERNAL_OUTPUT_TEMPLATES\.find\(\(t\) => t\.id === selectedTemplateId\)/)
  assert.match(outputTemplatesHookSource, /templateCategoryTotal/)
  assert.match(outputTemplatesHookSource, /groupedFilteredTemplates/)
  assert.match(outputTemplatesHookSource, /template\.features/)
  assert.match(outputTemplatesHookSource, /template\.outputTargets/)
  assert.match(outputTemplatesHookSource, /templatePickerPopupRef/)
  assert.match(outputTemplatesHookSource, /const clickedPopup = templatePickerPopupRef\.current\?\.contains\(target\)/)

  const templatePickerSource = await readRepoFile('src/components/output-workshop/template-picker.tsx')
  assert.match(templatePickerSource, /groupedFilteredTemplates/)
  assert.match(templatePickerSource, /templateCategoryTotal/)
  assert.match(templatePickerSource, /全部模板/)
  assert.match(templatePickerSource, /label: "一键排版"/)
  assert.match(templatePickerSource, /template\.features\?\.length/)
  assert.match(templatePickerSource, /template\.mode === "wechat" \? 1 : 2/)
  assert.match(templatePickerSource, /import \{ createPortal \} from "react-dom"/)
  assert.match(templatePickerSource, /function resolveTemplatePickerPosition\(triggerRect: DOMRect\): TemplatePickerPosition/)
  assert.match(templatePickerSource, /TEMPLATE_PICKER_WIDTH = 460/)
  assert.match(templatePickerSource, /TEMPLATE_PICKER_HEIGHT = 420/)
  assert.match(templatePickerSource, /createPortal\(/)
  assert.match(templatePickerSource, /document\.body/)
  assert.match(templatePickerSource, /fixed z-\[10030\]/)
  assert.match(templatePickerSource, /h-\[420px\]/)
  assert.match(templatePickerSource, /w-\[460px\]/)
  assert.match(templatePickerSource, /w-\[124px\] shrink-0 overflow-y-auto border-r/)
  assert.match(templatePickerSource, /group relative flex h-16 w-full/)
  assert.match(templatePickerSource, /SOCIAL_TEMPLATE_ICON_TONES/)
  assert.match(templatePickerSource, /social-redbook-sketch/)
  assert.doesNotMatch(templatePickerSource, /absolute left-0 top-full/)
  assert.doesNotMatch(templatePickerSource, /text-\[(?:9\.5|10\.5)px\]/)
  assert.match(templatePickerSource, /group\.templates\.map/)
  assert.match(templatePickerSource, /template\.bestFor \|\| template\.description/)
  assert.doesNotMatch(templatePickerSource, legacyRegex)

  const sourcePanelSource = await readRepoFile('src/components/output-workshop/source-panel.tsx')
  assert.doesNotMatch(sourcePanelSource, legacyRegex)
  assert.match(sourcePanelSource, /flex min-h-0 flex-1 flex-col/)
  assert.match(sourcePanelSource, /生成模型/)
  assert.match(sourcePanelSource, /modelKey="outputWorkshop"/)
  assert.match(sourcePanelSource, /triggerClassName="h-8 w-full min-w-0 rounded-md bg-background text-xs font-medium shadow-none"/)
  assert.match(sourcePanelSource, /import \{ isLocalWechatOutputTemplate \} from "@\/lib\/output-workshop\/template-routing"/)
  assert.match(sourcePanelSource, /const isOneClickLayoutTemplate = isLocalWechatOutputTemplate\(ctx\.selectedTemplate, selectedTemplateId\)/)
  assert.match(sourcePanelSource, /isBuilding && !isOneClickLayoutTemplate/)
  assert.match(sourcePanelSource, /\{isOneClickLayoutTemplate \? "一键排版" : "开始构建"\}/)
  const sourceOutlineStart = sourcePanelSource.indexOf('{sourceWorkspaceTab === "outline"')
  const sourceOutlineEnd = sourcePanelSource.indexOf('{hasGeneratedOutput', sourceOutlineStart)
  assert.notEqual(sourceOutlineStart, -1)
  assert.notEqual(sourceOutlineEnd, -1)
  const sourceOutlineBlock = sourcePanelSource.slice(sourceOutlineStart, sourceOutlineEnd)
  assert.match(sourceOutlineBlock, /getOutlineLevel\(section\)/)
  assert.match(sourceOutlineBlock, /section\.title/)
  assert.match(sourceOutlineBlock, /aria-current/)
  assert.match(sourceOutlineBlock, /bg-primary\/10/)
  assert.match(sourceOutlineBlock, /active \? "text-primary"/)
  assert.match(sourceOutlineBlock, /H\{level\}/)
  assert.doesNotMatch(sourceOutlineBlock, /String\(index \+ 1\)\.padStart/)
  assert.doesNotMatch(sourceOutlineBlock, /L\$\{section\.startLine\}/)
  assert.doesNotMatch(sourceOutlineBlock, /section\.body|section\.bullets/)

  const cleanedOutline = splitContentIntoSections(
    '# AI产品经理的职业发展史\n正文\n## **一、AI产品经理的职业发展史（从「兼职打标签」到「AI产品架构师」）**\n内容\n### **1. 起源：为什么会出现「AI产品经理」？**\n内容'
  )
  assert.equal(cleanedOutline[1].title, '一、AI产品经理的职业发展史（从「兼职打标签」到「AI产品架构师」）')
  assert.equal(cleanedOutline[2].title, '1. 起源：为什么会出现「AI产品经理」？')
  assert.equal(cleanedOutline[1].level, 2)
  assert.equal(cleanedOutline[2].level, 3)

  const outputTypesSource = await readRepoFile('src/components/output-workshop/types.ts')
  assert.match(outputTypesSource, /level\?: number/)
  assert.match(outputTypesSource, /GenerationTelemetryPhase/)
  assert.match(outputTypesSource, /interface GenerationTelemetry/)
  assert.match(outputTypesSource, /firstByteAt: number \| null/)
  assert.match(outputTypesSource, /qualityFindingCount: number/)

  const modelSelectSource = await readRepoFile('src/app/core/setting/components/model-select.tsx')
  assert.match(modelSelectSource, /interface ModelSelectProps/)
  assert.match(modelSelectSource, /triggerClassName/)
  assert.match(modelSelectSource, /popoverClassName/)
  assert.match(modelSelectSource, /default: return `\$\{modelKey\}Model`/)

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
    sourceLabel: 'LingMo 智能排版',
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
  assert.doesNotMatch(xhsHtml, /CLAUDE|LingMo智能排版|LingMo Studio|LINGMO\.STUDIO/)

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

  console.info('output workshop tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
