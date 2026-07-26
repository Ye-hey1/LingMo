/**
 * HTML 净化层的行为测试。
 *
 * 聊天预览把模型输出与抓取到的远端页面经 markdown-it(html: true) 渲染后注入
 * DOM，是整条 XSS→RCE 链的入口。这里在 jsdom 里真实执行 DOMPurify，断言注入
 * 载荷被剥离、同时渲染必需的结构（KaTeX MathML、Mermaid SVG、业务 data-*）被保留。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(repoRoot, '.tmp'), { recursive: true })
const tempDir = await mkdtemp(join(repoRoot, '.tmp', 'lingmo-sanitize-'))
const require = createRequire(import.meta.url)

// DOMPurify 需要真实 DOM；在加载被测模块之前装好全局环境
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.DocumentFragment = dom.window.DocumentFragment
globalThis.NodeFilter = dom.window.NodeFilter
globalThis.trustedTypes = dom.window.trustedTypes

async function loadSanitizer() {
  const sourcePath = join(repoRoot, 'src/lib/sanitize-html.ts')
  const source = await readFile(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText

  const outPath = join(tempDir, 'sanitize-html.cjs')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
  return require(outPath)
}

const { sanitizeHtml, sanitizeSvg } = await loadSanitizer()

// --- 脚本执行载荷必须被剥离 ---
const scriptPayloads = [
  '<script>window.__pwned = 1</script>',
  '<img src=x onerror="window.__pwned=1">',
  '<svg><script>window.__pwned=1</script></svg>',
  '<iframe src="javascript:window.__pwned=1"></iframe>',
  '<a href="javascript:window.__pwned=1">click</a>',
  '<body onload="window.__pwned=1">',
  '<details open ontoggle="window.__pwned=1">',
  '<math><mtext><style><img src=x onerror="window.__pwned=1"></style></mtext></math>',
  '<form action="x"><button formaction="javascript:window.__pwned=1">go</button></form>',
  '<object data="data:text/html,<script>window.__pwned=1</script>"></object>',
  '<embed src="data:text/html,<script>window.__pwned=1</script>">',
  '<base href="https://evil.example/">',
]

for (const payload of scriptPayloads) {
  const clean = sanitizeHtml(payload)
  assert.ok(!/<script/i.test(clean), `script 标签未剥离: ${payload} -> ${clean}`)
  assert.ok(!/\son\w+\s*=/i.test(clean), `事件处理器未剥离: ${payload} -> ${clean}`)
  assert.ok(!/javascript:/i.test(clean), `javascript: 协议未剥离: ${payload} -> ${clean}`)
  assert.ok(!/<iframe/i.test(clean), `iframe 未剥离: ${payload} -> ${clean}`)
  assert.ok(!/<object|<embed|<base/i.test(clean), `危险标签未剥离: ${payload} -> ${clean}`)
  assert.ok(!/formaction/i.test(clean), `formaction 未剥离: ${payload} -> ${clean}`)
}

// 把净化结果真正插进 DOM，确认没有副作用发生
dom.window.__pwned = undefined
const host = dom.window.document.createElement('div')
host.innerHTML = sanitizeHtml(scriptPayloads.join('\n'))
dom.window.document.body.appendChild(host)
assert.equal(dom.window.__pwned, undefined, '净化后的 HTML 插入 DOM 后仍产生了副作用')

// --- 正常 markdown 结构必须保留 ---
const benign =
  '<h2>标题</h2><p>正文 <strong>粗体</strong> <em>斜体</em> <code>code</code></p>' +
  '<ul><li>项</li></ul><table><thead><tr><th>头</th></tr></thead>' +
  '<tbody><tr><td colspan="2">格</td></tr></tbody></table>' +
  '<pre class="hljs hljs-dark"><code>x=1</code></pre>' +
  '<blockquote>引用</blockquote><hr>'
const cleanBenign = sanitizeHtml(benign)
for (const tag of ['h2', 'strong', 'em', 'code', 'ul', 'li', 'table', 'thead', 'th', 'td', 'pre', 'blockquote', 'hr']) {
  assert.ok(new RegExp(`<${tag}[\\s>]`).test(cleanBenign), `${tag} 被误删: ${cleanBenign}`)
}
assert.match(cleanBenign, /class="hljs hljs-dark"/, '代码高亮 class 被误删')
assert.match(cleanBenign, /colspan="2"/, 'colspan 被误删')

// --- 链接与图片 ---
const link = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>')
assert.match(link, /href="https:\/\/example\.com"/, 'https 链接被误删')
assert.match(link, /rel="noopener noreferrer"/, 'target=_blank 应强制补 rel')

const img = sanitizeHtml('<img src="asset://localhost/a.png" referrerpolicy="no-referrer">')
assert.match(img, /src="asset:/, 'asset 协议图片被误删')
assert.match(img, /referrerpolicy="no-referrer"/, 'referrerpolicy 被误删')
assert.match(
  sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">'),
  /src="data:image\/png/,
  'data: 图片被误删',
)

// --- 业务 data-* 属性必须保留 ---
const dataAttrs = sanitizeHtml(
  '<div data-mermaid-source="graph TD" data-mermaid-rendered="1" data-chat-id="7" ' +
    'data-highlight-style="github" data-agent-run-summary="x" data-evil="1">x</div>',
)
for (const attr of [
  'data-mermaid-source',
  'data-mermaid-rendered',
  'data-chat-id',
  'data-highlight-style',
  'data-agent-run-summary',
]) {
  assert.ok(dataAttrs.includes(attr), `白名单内的 ${attr} 被误删: ${dataAttrs}`)
}
assert.ok(!dataAttrs.includes('data-evil'), `白名单外的 data-* 应被剥离: ${dataAttrs}`)

// --- KaTeX 输出 ---
const katexHtml =
  '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block">' +
  '<semantics><mrow><mi>x</mi></mrow>' +
  '<annotation encoding="application/x-tex">x</annotation></semantics></math></span>'
const cleanKatex = sanitizeHtml(katexHtml)
assert.match(cleanKatex, /<math/, 'MathML 被误删')
assert.match(cleanKatex, /<annotation/, 'KaTeX annotation 被误删')
assert.match(cleanKatex, /encoding="application\/x-tex"/, 'annotation encoding 被误删')

// --- Mermaid SVG ---
const mermaidSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" role="graphics-document">' +
  '<g><rect x="1" y="1" width="10" height="10"/><path d="M0 0L1 1"/>' +
  '<text x="2" y="3">文字</text><tspan>续行</tspan>' +
  '<marker id="m"><polygon points="0,0 1,1"/></marker></g></svg>'
const cleanSvg = sanitizeSvg(mermaidSvg)
for (const tag of ['svg', 'g', 'rect', 'path', 'text', 'tspan', 'marker', 'polygon']) {
  assert.ok(new RegExp(`<${tag}[\\s>]`, 'i').test(cleanSvg), `${tag} 被误删: ${cleanSvg}`)
}
assert.ok(cleanSvg.includes('文字'), 'SVG 文本被误删')
assert.ok(cleanSvg.includes('续行'), 'tspan 文本被误删')

// foreignObject 刻意不放行：DOMPurify 会无条件清空其子节点，加白名单也只剩空壳。
// Mermaid 已配 htmlLabels: false 改走 <text>，因此这里断言它被剥离。
const foreignObjectResult = sanitizeSvg(
  '<svg><foreignObject><div>标签</div></foreignObject></svg>',
)
assert.ok(
  !foreignObjectResult.includes('标签'),
  `foreignObject 内容应被剥离（Mermaid 须配 htmlLabels: false）: ${foreignObjectResult}`,
)

const evilSvg = sanitizeSvg(
  '<svg><script>window.__pwned=1</script><rect onclick="window.__pwned=1"/>' +
    '<a href="javascript:window.__pwned=1"><text>x</text></a>' +
    '<image href="javascript:window.__pwned=1"/></svg>',
)
assert.ok(!/javascript:/i.test(evilSvg), `SVG 内 javascript: 协议未剥离: ${evilSvg}`)
assert.ok(!/<script/i.test(evilSvg), `SVG 内 script 未剥离: ${evilSvg}`)
assert.ok(!/\son\w+\s*=/i.test(evilSvg), `SVG 内事件处理器未剥离: ${evilSvg}`)

// --- 边界输入 ---
assert.equal(sanitizeHtml(''), '', '空串应原样返回')
assert.equal(sanitizeSvg(''), '', '空串应原样返回')

console.log('sanitize-html tests passed')
