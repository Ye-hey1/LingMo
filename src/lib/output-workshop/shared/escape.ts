/**
 * 智能排版共享的 HTML 转义工具
 *
 * 统一各 builder（wechat-builder / html-builders）此前分散重复的
 * escapeHtml / escapeAttr 实现。采用最健壮的 unknown 入参 + null 安全降级版本，
 * 对既有 string 调用完全向后兼容。
 */

/**
 * HTML 实体转义：转义 & < > " '
 * 接受任意类型，null / undefined 安全降级为空字符串。
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * HTML 属性值转义：在 escapeHtml 基础上额外转义反引号，
 * 避免属性上下文中的注入风险。
 */
export function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/`/g, "&#96;")
}
