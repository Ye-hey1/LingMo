/**
 * 运行时环境检测
 */

/** Tauri 桌面端会在 window 上注入内部标识 */
type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }

/**
 * 判断是否在 Tauri 桌面端环境中
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && (window as TauriWindow).__TAURI_INTERNALS__ !== undefined
}
