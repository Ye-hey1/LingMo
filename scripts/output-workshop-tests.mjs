import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-output-workshop-tests-'))
await symlink(join(repoRoot, 'node_modules'), join(tempDir, 'node_modules'), 'junction')

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
    buildOutputExtractionPrompt,
    getExtractionStrategy,
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
    sanitizeWechatClipboardHtml,
  } = await importTsModule('src/lib/output-workshop/export.ts')
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
    buildThemedSocialCards,
    isAutoRedbookTemplateId,
    isThemedSocialTemplate,
  } = await importTsModule('src/lib/output-workshop/social-redbook-builder.ts')
  const {
    buildStyle,
    hasStyleBuilder,
    STYLE_BUILDERS,
  } = await importTsModule('src/lib/output-workshop/styles/index.ts')
  const {
    isLocalStyleOutputTemplate,
    isLocalWechatOutputTemplate,
  } = await importTsModule('src/lib/output-workshop/template-routing.ts')
  const {
    buildWechatArticleSync,
  } = await importTsModule('src/lib/output-workshop/wechat-builder.ts')
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
  assert.match(templateRoutingSource, /export function isLocalStyleOutputTemplate/)
  assert.match(templateRoutingSource, /hasStyleBuilder\(id\)/)
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

  const wechatComplexHtml = buildWechatArticleSync({
    styleId: 'wechat-tech',
    title: '复杂 Markdown',
    subtitle: '语义化渲染测试',
    markdown: [
      '## 功能清单',
      '',
      '- 一级 **重点**',
      '  - 二级 `代码`',
      '    1. 有序子项 [链接](https://example.com?q=1)',
      '- 图片 ![流程图](https://example.com/flow.png "流程图标题")',
      '',
      '| 模块 | 状态 |',
      '| --- | --- |',
      '| **表格** | `ready` |',
      '',
      '> 第一行引用',
      '> 第二行引用',
      '',
      '```ts',
      'const tag = "<script>alert(1)</script>"',
      '```',
      '',
      '行内公式 $E=mc^2$ 与块级公式：',
      '$$\\int_0^1 x^2 dx = \\frac{1}{3}$$',
      '',
      '<script>alert("xss")</script>',
      '[坏链接](javascript:alert(1))',
      '![坏图](javascript:alert(1))',
    ].join('\n'),
    sourceLabel: '测试素材',
    generatedAt: '2026-07-01 09:00',
  })
  assert.match(wechatComplexHtml, /<h2\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<ul\b[^>]*style=/)
  assert.ok((wechatComplexHtml.match(/<ul\b/g) || []).length >= 2, 'wechat renderer should preserve nested bullet lists')
  assert.match(wechatComplexHtml, /<ol\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<li\b[^>]*>[\s\S]*<strong\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<table\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<th\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<td\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<code\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<blockquote\b[^>]*style=/)
  assert.match(wechatComplexHtml, /<img src="https:\/\/example\.com\/flow\.png" alt="流程图" title="流程图标题" style=/)
  // 代码块经 highlight.js 着色后，const/字符串等会被 <span style="color:..."> 包裹，
  // 但危险内容（<script>）仍必须被转义为 &lt;script&gt;，不会被当成真标签执行。
  assert.match(wechatComplexHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(wechatComplexHtml, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/)
  // 验证代码高亮已生效：ts 代码块的 const 关键字应被着色为紫色 span
  assert.match(wechatComplexHtml, /<span style="color:#c678dd">const<\/span>/)
  // 验证数学公式已接入 KaTeX：行内和块级公式应渲染成 katex 容器，并带内联 font-family
  assert.match(wechatComplexHtml, /<span class="katex"[^>]*style="font-family:/)
  assert.match(wechatComplexHtml, /<span class="katex-display"[^>]*style="display:block/)
  assert.doesNotMatch(wechatComplexHtml, /<script\b/i)
  assert.doesNotMatch(wechatComplexHtml, /href="javascript:/i)
  assert.doesNotMatch(wechatComplexHtml, /src="javascript:/i)

  // 验证 mermaid 代码块在同步版本中被识别为占位标记（异步版本会替换为 SVG）
  const wechatMermaidHtml = buildWechatArticleSync({
    styleId: 'wechat-default',
    title: '流程图示例',
    markdown: ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n'),
  })
  assert.match(wechatMermaidHtml, /data-lingmo-mermaid-slot="0"/)

  const localStyleTemplateIds = Object.keys(STYLE_BUILDERS)
  assert.ok(localStyleTemplateIds.includes('learning-mindmap'), 'mindmap template must have a local style builder')
  assert.equal(hasStyleBuilder('learning-mindmap'), true)
  for (const id of localStyleTemplateIds) {
    assert.equal(
      isLocalStyleOutputTemplate({ id, mode: id.startsWith('deck-') ? 'deck' : 'article' }, id),
      true,
      `${id} must use AI structure parsing plus local style rendering`
    )
  }
  assert.equal(isLocalStyleOutputTemplate({ id: 'custom-ai-design', mode: 'creative' }, 'custom-ai-design'), false)

  // 7 个主题化社交卡片模板此前被错误路由到 AI 自由直绘（无渲染器），现已纳入 local-style
  const themedSocialIds = ['social-editorial', 'social-geek-report', 'social-consulting-report', 'social-clean-review', 'social-terminal', 'social-story-field', 'social-dot-matrix']
  for (const id of themedSocialIds) {
    assert.equal(isThemedSocialTemplate(id), true, `${id} 应识别为主题化社交模板`)
    assert.equal(isLocalStyleOutputTemplate({ id, mode: 'social' }, id), true, `${id} 应走 local-style 管线`)
  }
  assert.equal(isThemedSocialTemplate('social-card'), false, 'social-card 有独立 STYLE_BUILDER，不属于 themed-social')
  assert.equal(isThemedSocialTemplate('unknown'), false)
  // buildThemedSocialCards：验证产出含封面卡 + 内容卡 + 主题配色
  const themedHtml = buildThemedSocialCards('social-terminal', {
    title: '终端风测试', subtitle: '暖纸终端',
    sections: [
      { title: '启动', body: '加载模块', bullets: ['kernel OK', 'net OK'] },
      { title: '运行', body: '处理信号' },
    ],
    sourceLabel: '测试', generatedAt: '2026-07',
  })
  assert.match(themedHtml, /<!DOCTYPE html>/)
  assert.match(themedHtml, /redbook-deck/, '应使用 redbook 组图骨架')
  assert.match(themedHtml, /card-container/, '应渲染卡片容器')
  // social-terminal 的 previewTheme accent 是 #8b4513（暖棕），应注入到样式
  assert.match(themedHtml, /8b4513|social-terminal/, '应注入模板主题配色')
  const mindmapHtml = buildStyle('learning-mindmap', {
    title: 'AI产品经理发展史',
    subtitle: '结构化脑图',
    sourceLabel: '测试素材',
    sections: [
      { title: '起源', body: '- 技术土壤\n- 行业土壤\n- 人才断层' },
      { title: '分化', body: '- AI产品经理\n- AI产品架构师' },
    ],
  })
  assert.match(mindmapHtml, /mindmap-container/)
  assert.match(mindmapHtml, /mindmap-svg/)
  assert.match(mindmapHtml, /node-group/)
  assert.match(mindmapHtml, /level-root/)
  assert.match(mindmapHtml, /children-container/)
  // 结构化 mindmap 树渲染：传入嵌套树，应直接渲染 3 层节点（零猜测）
  const structuredMindmapHtml = buildStyle('learning-mindmap', {
    title: 'AI 工程核心脉络',
    subtitle: '提炼版',
    sourceLabel: '测试',
    sections: [],
    mindmap: [
      {
        title: '提示工程',
        children: [
          { text: '指令设计', children: [{ text: '角色设定' }, { text: '输出约束' }] },
          { text: '上下文编排' },
        ],
      },
      {
        title: '评估体系',
        children: [{ text: '基准测试' }, { text: '人工评审' }],
      },
    ],
  })
  assert.match(structuredMindmapHtml, /mindmap-container/)
  // 一级分支标题（提示工程、评估体系）应渲染为 level-1 节点
  assert.match(structuredMindmapHtml, /提示工程/)
  assert.match(structuredMindmapHtml, /评估体系/)
  // 二级子节点（指令设计、上下文编排）应渲染为 level-2
  assert.match(structuredMindmapHtml, /指令设计/)
  assert.match(structuredMindmapHtml, /上下文编排/)
  // 三级孙节点（角色设定）应渲染为 level-deep（≥3 层）
  assert.match(structuredMindmapHtml, /角色设定/)
  assert.match(structuredMindmapHtml, /level-deep/)
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
  // CREATIVE_DESIGN_PROMPT 已下沉到 lib 层 prompt-blocks.ts，reduced-motion 断言改指向新位置；
  // utils-prompts.ts 仅 re-export 保持旧导入路径。
  const promptBlocksSource = await readRepoFile('src/lib/output-workshop/prompt-blocks.ts')
  assert.match(promptBlocksSource, /prefers-reduced-motion: reduce/)
  assert.match(utilsPromptsSource, /export \{ CREATIVE_DESIGN_PROMPT \} from "@\/lib\/output-workshop\/prompt-blocks"/)

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
  // designConstraints 应注入 prompt，让无 skillPrompt 的 deck 模板也有风格约束
  assert.match(creativePrompt, /视觉规范（必须严格遵守）：测试约束/)

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
  assert.match(generationSource, /isLocalStyleOutputTemplate/)
  assert.match(generationSource, /import \{ buildStyle \} from "@\/lib\/output-workshop\/styles"/)
  assert.match(generationSource, /buildOutputExtractionPrompt/)
  assert.match(generationSource, /parseOutputExtractionResult/)
  assert.doesNotMatch(generationSource, /import \{ splitPlainTextIntoSections \} from "@\/lib\/output-workshop\/extraction"/)
  assert.match(generationSource, /isLocalWechatOutputTemplate/)
  assert.match(generationSource, /generationRunIdRef/)
  assert.match(generationSource, /selectedTemplateRef/)
  assert.match(generationSource, /selectedTemplateIdRef/)
  assert.match(generationSource, /selectedTemplateRef\.current = selectedTemplate/)
  assert.match(generationSource, /selectedTemplateIdRef\.current = selectedTemplateId/)
  assert.match(generationSource, /已拦截一键排版模板进入 AI 直绘/)
  assert.doesNotMatch(generationSource, /localWechatGeneratorRef/)
  assert.match(generationSource, /const generateLocalWechatOutput = React\.useCallback/)
  assert.doesNotMatch(generationSource, /const generateLocalStyleOutput = React\.useCallback/)
  assert.match(generationSource, /const generateStructuredStyleOutput = React\.useCallback/)
  assert.match(generationSource, /generationRunIdRef\.current \+= 1/)
  assert.match(generationSource, /abortRef\.current\?\.abort\(\)/)
  assert.match(generationSource, /buildWechatArticle\(\{/)
  assert.match(generationSource, /buildStyle\(latestTemplateId/)
  assert.match(generationSource, /styleId: latestTemplateId/)
  assert.match(generationSource, /phase: "local-build"/)
  assert.match(generationSource, /isLocalWechatOutputTemplate\(latestTemplate, latestTemplateId\)/)
  assert.match(generationSource, /isLocalStyleOutputTemplate\(latestTemplate, latestTemplateId\)/)
  assert.match(generationSource, /已拦截本地样式模板进入 AI 直绘，改用 AI 结构解析 \+ 本地模板/)
  assert.match(generationSource, /isLocalWechatOutputTemplate\(selectedTemplateRef\.current, selectedTemplateIdRef\.current\)/)
  assert.match(generationSource, /isLocalStyleOutputTemplate\(selectedTemplateRef\.current, selectedTemplateIdRef\.current\)/)
  assert.match(generationSource, /const isCurrentRun = \(\) => generationRunIdRef\.current === runId && !abortController\.signal\.aborted/)
  // handleGenerate 分派到三个生成函数；调用形式可能是 `void fn()` 或 `fn().catch(...)`
  //（后者更健壮，能捕获生成异常），这里用宽松匹配兼容两种写法。
  assert.match(generationSource, /generateLocalWechatOutput\(\)/)
  assert.match(generationSource, /generateStructuredStyleOutput\(\)/)
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
    4,
    'output workshop AI generation, structured extraction, repair, and refine calls should use the dedicated model selector'
  )
  assert.doesNotMatch(generationSource, /解析 JSON schema/)
  assert.doesNotMatch(generationSource, /生成设计 schema/)

  const outputExportSource = await readRepoFile('src/hooks/use-output-export.ts')
  assert.match(outputExportSource, /result\.skipped\?\.length/)
  assert.match(outputExportSource, /智能卡片导出完成，部分页面已跳过/)
  assert.match(outputExportSource, /result\.exportedCount/)

  const outputExportLibSource = await readRepoFile('src/lib/output-workshop/export.ts')
  assert.equal(sanitizeWechatClipboardHtml('<p>Node fallback</p>'), '<p>Node fallback</p>')
  assert.match(outputExportLibSource, /export function sanitizeWechatClipboardHtml/)
  assert.match(outputExportLibSource, /sanitizeWechatClipboardRoot/)
  assert.match(outputExportLibSource, /querySelectorAll\("script, iframe, object, embed, form, input, textarea, select, button"\)/)
  assert.match(outputExportLibSource, /name\.startsWith\("on"\) \|\| name === "srcdoc"/)
  assert.match(outputExportLibSource, /setAttribute\("data-src", src\)/)
  assert.match(outputExportLibSource, /max-width: 100% !important; height: auto !important; display: block;/)
  assert.match(outputExportLibSource, /return sanitizeWechatClipboardHtml\(/)

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
  // withTimeout / waitForIframeReady 已下沉到共享底座 ./shared/offscreen-render.ts，
  // 这里改为校验 smart-card-export.ts 正确 import 并复用它们。
  assert.match(smartCardExportSource, /import \{[\s\S]*?withTimeout[\s\S]*?\} from "\.\/shared\/offscreen-render"/)
  assert.match(smartCardExportSource, /function waitForIframeReady\(/)
  assert.match(smartCardExportSource, /waitForDocumentResources/)
  const offscreenRenderSource = await readRepoFile('src/lib/output-workshop/shared/offscreen-render.ts')
  assert.match(offscreenRenderSource, /export function withTimeout<T>/)
  assert.match(offscreenRenderSource, /export async function waitForDocumentResources/)
  assert.match(offscreenRenderSource, /export function createOffscreenIframe/)
  assert.doesNotMatch(smartCardExportSource, legacyRegex)
  assert.doesNotMatch(smartCardExportSource, new RegExp(`function is${legacyBrand}Card`))
  assert.match(smartCardExportSource, /export type SmartCardPagingMode = "semantic" \| "separator" \| "auto-fit" \| "auto-split" \| "dynamic"/)
  assert.match(smartCardExportSource, /pagingMode\?: SmartCardPagingMode/)
  assert.match(smartCardExportSource, /function splitBySeparatorBoundaries/)
  assert.match(smartCardExportSource, /function splitByContentWeight/)
  assert.match(smartCardExportSource, /function applyAutoFitScale/)
  assert.match(smartCardExportSource, /function shouldTryCombinedCardSelectors\(selectors: string\[\]\)/)
  assert.match(smartCardExportSource, /function tryCombinedSelectors\(/)
  assert.match(smartCardExportSource, /selectors\.join\(","\)/)
  // parseSmartCards 已重构为「策略数组 + 首个命中即返回」的降级链，
  // blueprint 策略内部仍调用 tryCombinedSelectors（参数通过策略上下文 c 传递）。
  assert.match(smartCardExportSource, /const strategies: DetectionStrategy\[\]/)
  assert.match(smartCardExportSource, /shouldTryCombinedCardSelectors\(selectors\)/)
  assert.match(smartCardExportSource, /tryCombinedSelectors\(c\.doc, selectors, c\.head, c\.bodyClass, c\.bodyStyle, c\.blueprint\)/)
  assert.match(smartCardExportSource, /const isRedbookCard = Boolean\(/)
  assert.match(smartCardExportSource, /el\.hasAttribute\("data-redbook-card"\)/)
  assert.match(smartCardExportSource, /body\.redbook-output \$\{rootSelector\} > \.card-container/)
  assert.match(smartCardExportSource, /width: 1080px !important/)
  assert.match(smartCardExportSource, /height: 1440px !important/)
  assert.match(smartCardExportSource, /redbookAutoFitScript/)
  assert.match(smartCardExportSource, /exportMode: isRedbookCard \? "auto-fit"/)
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
  assert.match(previewPanelSource, /REDBOOK_STANDALONE_PREVIEW_STYLE_ID/)
  assert.match(previewPanelSource, /function injectRedbookPreviewGridStyles/)
  assert.match(previewPanelSource, /function injectRedbookStandalonePreviewStyles/)
  assert.match(previewPanelSource, /function RedbookPreviewCard/)
  assert.match(previewPanelSource, /function RedbookCardWall/)
  assert.match(previewPanelSource, /parseSmartCards\(html, selectedTemplate\.exportBlueprint\)/)
  assert.match(previewPanelSource, /const REDBOOK_SOURCE_CARD_WIDTH = 1080/)
  assert.match(previewPanelSource, /const REDBOOK_SOURCE_CARD_HEIGHT = 1440/)
  assert.match(previewPanelSource, /const REDBOOK_PREVIEW_CARD_WIDTH = 320/)
  assert.match(previewPanelSource, /const REDBOOK_PREVIEW_CARD_HEIGHT = Math\.round\(REDBOOK_PREVIEW_CARD_WIDTH \* REDBOOK_SOURCE_CARD_HEIGHT \/ REDBOOK_SOURCE_CARD_WIDTH\)/)
  assert.match(previewPanelSource, /const REDBOOK_PREVIEW_CARD_FRAME_WIDTH = REDBOOK_PREVIEW_CARD_WIDTH \+ 14/)
  assert.match(previewPanelSource, /const REDBOOK_PREVIEW_CARD_FRAME_HEIGHT = REDBOOK_PREVIEW_CARD_HEIGHT \+ 14/)
  assert.match(previewPanelSource, /const REDBOOK_PREVIEW_CARD_SCALE = REDBOOK_PREVIEW_CARD_WIDTH \/ REDBOOK_SOURCE_CARD_WIDTH/)
  assert.doesNotMatch(previewPanelSource, /new ResizeObserver\(updateWidth\)/)
  assert.match(previewPanelSource, /width: REDBOOK_PREVIEW_CARD_FRAME_WIDTH/)
  assert.match(previewPanelSource, /minWidth: REDBOOK_PREVIEW_CARD_FRAME_WIDTH/)
  assert.match(previewPanelSource, /height: REDBOOK_PREVIEW_CARD_FRAME_HEIGHT/)
  assert.match(previewPanelSource, /minHeight: REDBOOK_PREVIEW_CARD_FRAME_HEIGHT/)
  assert.match(previewPanelSource, /width: REDBOOK_PREVIEW_CARD_WIDTH/)
  assert.match(previewPanelSource, /minWidth: REDBOOK_PREVIEW_CARD_WIDTH/)
  assert.match(previewPanelSource, /height: REDBOOK_PREVIEW_CARD_HEIGHT/)
  assert.match(previewPanelSource, /minHeight: REDBOOK_PREVIEW_CARD_HEIGHT/)
  assert.match(previewPanelSource, /aspectRatio: "3 \/ 4"/)
  assert.match(previewPanelSource, /transform: `scale\(\$\{REDBOOK_PREVIEW_CARD_SCALE\}\)`/)
  assert.match(previewPanelSource, /gridTemplateColumns: `repeat\(auto-fit, \$\{REDBOOK_PREVIEW_CARD_FRAME_WIDTH\}px\)`/)
  assert.match(previewPanelSource, /buildPreviewSrcDoc\(card\.html, templateOverrides, selectedTemplateId, \{ applyOverrides: false \}\)/)
  assert.match(previewPanelSource, /sandbox="allow-scripts allow-same-origin"/)
  assert.match(previewPanelSource, /pointer-events-none block border-0 bg-white/)
  assert.match(previewPanelSource, /智能排版导出源视口/)
  assert.match(previewPanelSource, /grid-template-columns: repeat\(2, max-content\) !important/)
  assert.match(previewPanelSource, /--lingmo-redbook-preview-zoom: 0\.46/)
  assert.match(previewPanelSource, /--lingmo-redbook-standalone-scale: 1/)
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
  // ExtractedSection 已下沉到 lib 层 shared/types.ts（消除 lib→components 反向依赖），
  // components/types.ts 改为 re-export；这里分别校验两处。
  assert.match(outputTypesSource, /export type \{ ExtractedSection \} from "@\/lib\/output-workshop\/shared\/types"/)
  const sharedTypesSource = await readRepoFile('src/lib/output-workshop/shared/types.ts')
  assert.match(sharedTypesSource, /level\?: number/)
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

  const extractionPrompt = buildOutputExtractionPrompt({
    templateId: 'learning-mindmap',
    templateName: '思维导图',
    outputHint: '生成思维导图风格的知识结构页面',
    bestFor: '知识梳理',
    title: 'FDE',
    sourceContent: '## 起源\nPalantir\n## 发展\nOpenAI',
    sourceLabel: '测试素材',
    customInstructions: '突出时间线',
  })
  assert.match(extractionPrompt, /不是设计网页，也不是输出 HTML\/CSS/)
  assert.match(extractionPrompt, /只输出一个 JSON 对象/)
  // 新版 prompt 强调「提炼核心」+ 按 strategy 注入差异化规则块
  assert.match(extractionPrompt, /提炼核心规则/)
  // mindmap 策略用专用嵌套树 schema，不再走通用 sections 规则
  assert.match(extractionPrompt, /必须输出 `mindmap` 嵌套树数组/)
  assert.match(extractionPrompt, /结构：一级分支（title）→ 二级子节点（children\[\]\.text）/)
  assert.match(extractionPrompt, /先通读全文，提炼出 4-7 条核心脉络/)
  assert.match(extractionPrompt, /ID: learning-mindmap/)

  // 验证解析策略按 templateId 正确归类
  assert.equal(getExtractionStrategy('learning-mindmap'), 'mindmap')
  assert.equal(getExtractionStrategy('learning-flashcard'), 'flashcard')
  assert.equal(getExtractionStrategy('read-accordion'), 'flashcard')
  assert.equal(getExtractionStrategy('data-dashboard'), 'data')
  assert.equal(getExtractionStrategy('data-infographic'), 'data')
  assert.equal(getExtractionStrategy('report-business'), 'data')
  assert.equal(getExtractionStrategy('social-card'), 'social')
  assert.equal(getExtractionStrategy('poster-hero'), 'social')
  assert.equal(getExtractionStrategy('visual-bento'), 'social')
  // 未配置的模板回退到 article
  assert.equal(getExtractionStrategy('article-editorial'), 'article')
  assert.equal(getExtractionStrategy('deck-minimal'), 'article')
  assert.equal(getExtractionStrategy('unknown-template'), 'article')

  // 验证不同 strategy 产出含对应规则关键词的 prompt
  const dataPrompt = buildOutputExtractionPrompt({
    templateId: 'data-dashboard', templateName: '仪表盘', outputHint: 'x', bestFor: 'y',
    title: 't', sourceContent: 's',
  })
  assert.match(dataPrompt, /第一个 section 必须是关键指标/)
  const socialPrompt = buildOutputExtractionPrompt({
    templateId: 'social-card', templateName: '社媒卡', outputHint: 'x', bestFor: 'y',
    title: 't', sourceContent: 's',
  })
  assert.match(socialPrompt, /短句金句式要点/)

  // 验证截断 JSON 修复能力（max_tokens 用尽场景）
  const truncatedInput = '{"title":"测试","subtitle":"","sections":[{"title":"章节一","body":"内容一"},{"title":"章节二","body":"内容二'
  const repairedResult = parseOutputExtractionResult(truncatedInput, '回退素材', '回退标题')
  assert.equal(repairedResult.usedFallback, false, '截断 JSON 应被修复而非回退')
  assert.ok(repairedResult.warning, '修复后应带 warning 提示截断')
  assert.ok(repairedResult.sections.length >= 1, '修复后至少保留 1 个 section')

  // 验证思维导图结构化树解析：AI 输出 mindmap 数组，应解析成嵌套树
  const mindmapResult = parseOutputExtractionResult(
    JSON.stringify({
      title: '核心主题',
      subtitle: '脉络',
      mindmap: [
        { title: '分支A', children: [{ text: '子A1', children: [{ text: '孙A1a' }] }, { text: '子A2' }] },
        { title: '分支B', children: [{ text: '子B1' }] },
      ],
    }),
    '回退素材',
    '回退标题'
  )
  assert.equal(mindmapResult.usedFallback, false)
  assert.ok(mindmapResult.mindmap, 'mindmap 策略应解析出 mindmap 数组')
  assert.equal(mindmapResult.mindmap.length, 2)
  assert.equal(mindmapResult.mindmap[0].title, '分支A')
  assert.equal(mindmapResult.mindmap[0].children.length, 2)
  assert.equal(mindmapResult.mindmap[0].children[0].children[0].text, '孙A1a')

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

  // ---------------------------------------------------------------------------
  // 共享底座单测（shared/html-parse、shared/file-save、template-routing 声明式）
  // ---------------------------------------------------------------------------

  // shared/html-parse：pick / extractAttr / decodeEntities / stripTags
  const {
    pick,
    extractAttr,
    decodeEntities,
    stripTags,
    normalizeExternalUrl,
  } = await importTsModule('src/lib/output-workshop/shared/html-parse.ts')
  assert.equal(pick(/<title>([\s\S]*?)<\/title>/, '<title>Hi</title>'), 'Hi')
  assert.equal(pick(/<title>([\s\S]*?)<\/title>/, 'nope'), '')
  assert.equal(extractAttr('<body class="a b" style="x">', 'class'), 'a b')
  assert.equal(extractAttr('<body class="a b">', 'style'), '')
  assert.equal(decodeEntities('&lt;a&gt; &amp; &quot;q&quot; &#39;s'), '<a> & "q" \'s')
  assert.equal(stripTags('<p>Hello&nbsp;<b>World</b></p>'), 'Hello&nbsp; World') // 标签被剥除，&nbsp; 非基本实体故保留
  // normalizeExternalUrl：拦截危险协议，data: 默认拒绝但图片 base64 可放行
  assert.equal(normalizeExternalUrl('javascript:alert(1)'), '')
  assert.equal(normalizeExternalUrl('vbscript:msgbox'), '')
  assert.equal(normalizeExternalUrl('  https://example.com/a  '), 'https://example.com/a')
  assert.equal(normalizeExternalUrl('data:text/html,<script>'), '')
  assert.equal(normalizeExternalUrl('data:image/png;base64,AAAA', true), 'data:image/png;base64,AAAA')
  assert.equal(normalizeExternalUrl('data:image/png;base64,AAAA', false), '')

  // shared/file-save：getExtension / getMimeFilter（纯函数，可在 Node 直接测）
  const { getExtension, getMimeFilter } = await importTsModule('src/lib/output-workshop/shared/file-save.ts')
  assert.equal(getExtension('card.png'), 'png')
  assert.equal(getExtension('deck.PPTX'), 'pptx')
  assert.equal(getExtension('noext'), '')
  assert.equal(getMimeFilter('png'), 'PNG Image')
  assert.equal(getMimeFilter('zip'), 'ZIP Archive')
  assert.equal(getMimeFilter('unknown'), 'File')

  // template-routing：pipeline 字段优先于启发式规则（复用文件前面已解构的函数）
  // 显式 pipeline 声明直接命中，无需依赖 mode/features
  assert.equal(isLocalWechatOutputTemplate({ id: 'x', pipeline: 'wechat' } , 'x'), true)
  assert.equal(isLocalStyleOutputTemplate({ id: 'x', pipeline: 'local-style' }, 'x'), true)
  assert.equal(isLocalStyleOutputTemplate({ id: 'x', pipeline: 'creative' }, 'x'), false)
  // 未声明 pipeline 时回退到启发式（hasStyleBuilder 判定）
  assert.equal(isLocalStyleOutputTemplate({ id: 'social-redbook-sketch', mode: 'creative' }, 'social-redbook-sketch'), false)
  assert.equal(isLocalStyleOutputTemplate({ id: 'article-editorial', mode: 'standard' }, 'article-editorial'), true)

  console.info('output workshop tests passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
