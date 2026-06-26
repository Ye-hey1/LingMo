/**
 * sync-reindex-hook - 订阅同步事件触发增量重索引
 *
 * 安装时机：app 启动后调用 installSyncReindexHook()。
 * 卸载：返回 uninstall 函数。
 *
 * 监听事件：
 * - sync-content-updated: 同步拉取到本地的新内容 → debounce 后增量重索引
 * - immediate-pull-needed: 立即拉取触发 → 同上
 *
 * 不监听 sync-push-completed: 自己推送的改动不需要重索引（本地已是最新）。
 */

import emitter from '@/lib/emitter'
import { scheduleDebouncedReindex } from './reindex'

let installed = false

type Uninstaller = () => void

export function installSyncReindexHook(): Uninstaller {
  if (installed) {
    return () => {}
  }
  installed = true

  const onSyncContentUpdated = (_payload: unknown) => {
    // debounce 合并多次触发为一次重索引
    void scheduleDebouncedReindex(2000).catch(error => {
      console.error('[knowledge] sync-triggered reindex failed:', error)
    })
  }

  const onImmediatePull = (_payload: unknown) => {
    void scheduleDebouncedReindex(1500).catch(error => {
      console.error('[knowledge] pull-triggered reindex failed:', error)
    })
  }

  emitter.on('sync-content-updated', onSyncContentUpdated)
  emitter.on('immediate-pull-needed', onImmediatePull)

  return () => {
    emitter.off('sync-content-updated', onSyncContentUpdated)
    emitter.off('immediate-pull-needed', onImmediatePull)
    installed = false
  }
}
