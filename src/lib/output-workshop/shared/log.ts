/**
 * 轻量日志工具
 *
 * 用于替代智能排版模块里大量裸 `catch {}` 的静默吞错。
 * 资源加载/截图场景下的超时属于「可容忍的降级」，不应阻断主流程，
 * 但留下一行 warn 便于排查"为什么字体没生效/图片没出现"类问题。
 */

export function logWarn(tag: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[output-workshop:${tag}] ${message}`)
}
