import DOMPurify from 'dompurify'

/**
 * 富文本净化层。
 *
 * 聊天预览、微信采集、网页抓取等场景会把不可信内容（模型输出、远端页面）
 * 经 markdown-it（html: true）渲染成 HTML 后注入 DOM。若不净化，一次
 * prompt 注入或一个被投毒的页面即可在 webview 内执行脚本；配合 Tauri 的
 * IPC 能力会升级为本地代码执行。
 *
 * 这里保留渲染必需的结构（KaTeX 的 MathML/annotation、Mermaid 生成的 SVG、
 * 代码高亮的 class、以及若干业务 data-* 属性），其余一律剥离。
 */

/** 业务侧依赖的 data-* 属性，净化后必须保留，否则交互失效。 */
const ALLOWED_DATA_ATTRS = [
  'data-agent-live-status',
  'data-agent-run-summary',
  'data-agent-stream-status',
  'data-autolink-kind',
  'data-chart-kind',
  'data-chat-id',
  'data-chat-layout',
  'data-highlight-style',
  'data-mermaid-encoded',
  'data-mermaid-rendered',
  'data-mermaid-source',
  'data-mode-suggestion',
] as const

const BASE_ALLOWED_ATTRS = [
  'class', 'id', 'style', 'title', 'lang', 'dir',
  'href', 'target', 'rel', 'referrerpolicy',
  'src', 'alt', 'width', 'height', 'loading',
  'colspan', 'rowspan', 'align', 'scope',
  'type', 'checked', 'disabled', 'start', 'reversed', 'value',
  'aria-label', 'aria-hidden', 'aria-describedby', 'role',
  // KaTeX MathML
  'display', 'mathvariant', 'encoding', 'xmlns',
]

/**
 * DOMPurify 的 mathMl profile 不含这几个标签，但 KaTeX 会输出它们：
 * <annotation> 承载原始 TeX 源码，剥掉后公式仍能显示，复制公式却拿不回 LaTeX。
 */
const MATHML_EXTRA_TAGS = ['semantics', 'annotation', 'annotation-xml']

/**
 * 这里刻意不放行 <foreignObject>。
 *
 * 它是已知的 mXSS 向量（命名空间切换可能骗过净化器），DOMPurify 会无条件清空其
 * 子节点，加进白名单也只会留下一个空壳。Mermaid 因此配成 htmlLabels: false
 * （见 src/lib/mermaid.ts），标签走 SVG <text>，不再依赖 foreignObject。
 */
const SVG_EXTRA_TAGS: string[] = []

/** 只允许安全协议，阻断 javascript:/vbscript:，放行 Tauri 资源协议。 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|asset|blob|data|lingmo|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

let hookInstalled = false

function ensureHooks(): void {
  if (hookInstalled) return
  hookInstalled = true

  // 即便 target 被剥离，也保证外链不泄漏 opener 引用。
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

export interface SanitizeOptions {
  /** 允许 Mermaid / KaTeX 需要的 SVG + MathML 命名空间，默认开启。 */
  allowSvg?: boolean
  /** 追加的标签白名单。 */
  extraTags?: string[]
  /** 追加的属性白名单。 */
  extraAttrs?: string[]
}

/**
 * 净化一段 HTML 字符串。
 *
 * SSR / Node 环境下 `window` 不存在，DOMPurify 无法工作；此时返回空串而非
 * 原文，避免把未净化内容当成安全值传下去。本项目全量 client render，
 * 该分支只在构建期预渲染时触发。
 */
export function sanitizeHtml(dirty: string, options: SanitizeOptions = {}): string {
  if (!dirty) return ''
  if (typeof window === 'undefined') return ''

  ensureHooks()
  const { allowSvg = true, extraTags = [], extraAttrs = [] } = options

  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true, svg: allowSvg, svgFilters: allowSvg, mathMl: allowSvg },
    ADD_ATTR: [...BASE_ALLOWED_ATTRS, ...ALLOWED_DATA_ATTRS, ...extraAttrs],
    ADD_TAGS: [...(allowSvg ? [...MATHML_EXTRA_TAGS, ...SVG_EXTRA_TAGS] : []), ...extraTags],
    ALLOWED_URI_REGEXP,
    // 禁止 <form> 提交与自定义元素，二者都能绕过 CSP 之外的行为约束。
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'object', 'embed', 'base'],
    FORBID_ATTR: ['formaction', 'ping', 'srcdoc'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    KEEP_CONTENT: true,
  })
}

/**
 * 净化 Mermaid / 图表生成的 SVG 片段。
 *
 * Mermaid 用 <foreignObject> 承载节点标签里的 HTML 文本，所以必须放行；
 * 其内部内容仍会走 html profile 净化，脚本会被剥掉。
 */
export function sanitizeSvg(dirty: string): string {
  if (!dirty) return ''
  if (typeof window === 'undefined') return ''
  ensureHooks()
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { svg: true, svgFilters: true, mathMl: true, html: true },
    ADD_ATTR: [...BASE_ALLOWED_ATTRS, ...ALLOWED_DATA_ATTRS],
    ADD_TAGS: [...MATHML_EXTRA_TAGS, ...SVG_EXTRA_TAGS],
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ['script', 'form', 'object', 'embed', 'base', 'iframe'],
    FORBID_ATTR: ['formaction', 'ping', 'srcdoc'],
    ALLOW_DATA_ATTR: false,
  })
}
