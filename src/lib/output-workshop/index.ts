/**
 * output-workshop 模块统一出口（barrel）
 *
 * 子模块也可按深路径直接 import（`@/lib/output-workshop/export` 等），
 * 这里聚合常用公共 API，便于一次性引入与外部消费。
 */

// 模板与样式构建
export * from './templates'
export * from './html-builders'
export * from './prompt-blocks'
export * from './design-profiles'
export * from './styles/index'

// 内容解析与本地渲染
export * from './extraction'
export * from './wechat-builder'
export * from './wechat-markdown-renderer'
export * from './html-normalizer'
export * from './template-routing'
export * from './output-lint'

// 物理导出与卡片
export * from './export'
export * from './smart-card-export'

// 共享底座（仅暴露公共工具与类型）
export * from './shared/types'
export { escapeHtml, escapeAttr } from './shared/escape'
export {
  pick,
  extractAttr,
  decodeEntities,
  stripTags,
  normalizeExternalUrl,
} from './shared/html-parse'
export { isTauri } from './shared/runtime'
