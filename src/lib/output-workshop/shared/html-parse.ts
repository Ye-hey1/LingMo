/**
 * HTML 解析与 URL 安全过滤的共享工具
 *
 * 此前 `export.ts`、`smart-card-export.ts`、`wechat-markdown-renderer.ts` 各自维护
 * 一套近乎相同的 helper（pick / extractAttr / decodeEntities / stripTags / URL 过滤），
 * 改一处要改三处、行为还容易漂移。这里统一收口，调用方按需 import。
 */

/** 匹配 data:image/(png|jpeg|jpg|gif|webp);base64,... 的图片协议前缀 */
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i

/**
 * 从源串中按正则取第一个捕获组，未命中返回空串。
 *
 * 用于在字符串切片里抓取 head/title/body 标签内容等。
 */
export function pick(re: RegExp, src: string): string {
  const m = re.exec(src)
  return m ? m[1] : ""
}

/**
 * 提取 HTML 标签上指定属性的值（大小写不敏感），未命中返回空串。
 *
 * 例：extractAttr('<body class="a b">', 'class') === 'a b'
 */
export function extractAttr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i")
  return pick(re, tag)
}

/** 反转义常见 HTML 实体（amp/lt/gt/quot/#39） */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 剥除 HTML 标签并反转义实体，返回规整后的纯文本 */
export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

/**
 * 规整外部 URL 并做安全过滤：
 * - 去除控制字符与空白后小写化，拦截 javascript:/vbscript: 协议
 * - data: 协议默认拒绝；仅当 allowImageData=true 且为合法图片 base64 时放行
 *
 * 合并自原 `export.ts` 的 normalizeClipboardUrl（强制拒绝 data:）
 * 与 `wechat-markdown-renderer.ts` 的 sanitizeUrl（按参数放行图片 base64）。
 */
export function normalizeExternalUrl(value: string | null, allowImageData = false): string {
  const url = (value || "").trim()
  if (!url) return ""

  const compact = url.replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase()
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:")) return ""
  if (compact.startsWith("data:")) {
    return allowImageData && SAFE_DATA_IMAGE_RE.test(url) ? url : ""
  }

  return url
}
