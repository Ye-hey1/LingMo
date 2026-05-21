'use client'

import dynamic from 'next/dynamic'
import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { useEffect, useState, Suspense } from "react";
import { initAllDatabases } from "@/db"
import dayjs from "dayjs"
import zh from "dayjs/locale/zh-cn";
import en from "dayjs/locale/en";
import { useI18n } from "@/hooks/useI18n"
import useVectorStore from "@/stores/vector"
import useImageStore from "@/stores/imageHosting"
import useShortcutStore from "@/stores/shortcut"
import useUpdateStore from "@/stores/update"
import initQuickRecordText from "@/lib/shortcut/quick-record-text"
import { useRouter, usePathname } from "next/navigation"
import initShowWindow from "@/lib/shortcut/show-window"
import { initMcp } from "@/lib/mcp/init"
import { reportAppStart } from "@/lib/event-report"
import { TitleBar } from "@/components/title-bar"
import { Store } from '@tauri-apps/plugin-store'
import { TextSizeProvider } from "@/contexts/text-size-context"
import { applyThemeColors } from "@/lib/theme-utils"
import emitter from "@/lib/emitter"
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target"
import { checkIsTauri } from "@/lib/check"
import { WebRuntimeNotice } from "@/components/web-runtime-notice"

// 动态导入：非首屏必需的重型组件，减少首屏 bundle 大小
const SearchDialog = dynamic(() => import('@/components/search-dialog').then(m => ({ default: m.SearchDialog })), { ssr: false })
const ActivityDrawer = dynamic(() => import('@/components/activity/activity-drawer').then(m => ({ default: m.ActivityDrawer })), { ssr: false })
const SyncConfirmDialog = dynamic(() => import('@/components/sync-confirm-dialog').then(m => ({ default: m.SyncConfirmDialog })), { ssr: false })
const SettingsDialog = dynamic(() => import('@/components/settings-dialog').then(m => ({ default: m.SettingsDialog })), { ssr: false })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initSettingData, uiScale, customThemeColors } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { currentLocale } = useI18n()
  const { initShortcut } = useShortcutStore()
  const { initVectorDb } = useVectorStore()
  const { initUpdateStore, checkForUpdates } = useUpdateStore()
  const router = useRouter()
  const pathname = usePathname()
  const isTauri = checkIsTauri()
  const [searchOpen, setSearchOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  // ChunkLoadError 自动恢复：chunk 加载失败时刷新页面
  useEffect(() => {
    const handleChunkError = (event: ErrorEvent) => {
      if (
        event.message?.includes('ChunkLoadError') ||
        event.message?.includes('Loading chunk') ||
        event.message?.includes('Failed to fetch dynamically imported module')
      ) {
        // 避免无限刷新：记录刷新时间，3秒内不重复刷新
        const lastReload = sessionStorage.getItem('chunk-error-reload')
        const now = Date.now()
        if (lastReload && now - Number(lastReload) < 3000) return
        sessionStorage.setItem('chunk-error-reload', String(now))
        window.location.reload()
      }
    }
    window.addEventListener('error', handleChunkError)
    return () => window.removeEventListener('error', handleChunkError)
  }, [])

  // 重定向旧路径到新的 /core/main
  useEffect(() => {
    if (!isTauri) {
      return
    }

    async function redirectOldPaths() {
      if (pathname === '/core/article' || pathname === '/core/record') {
        const store = await Store.load('store.json')
        await store.set('currentPage', '/core/main')
        await store.save()
        router.replace('/core/main')
      }
    }
    redirectOldPaths()
  }, [isTauri, pathname, router])

  useEffect(() => {
    if (!isTauri) {
      return
    }

    let cancelled = false
    let idleHandle: number | undefined

    const scheduleBackgroundInit = () => {
      const run = async () => {
        try {
          if (cancelled) return

          initShortcut()
          initQuickRecordText()
          initShowWindow()
          initMcp()
          reportAppStart()

          await Promise.all([
            initAllDatabases(),
            initMainHosting(),
            initSettingData(),
            initUpdateStore(),
          ])

          // 数据库初始化完成后再初始化向量索引（避免 database locked）
          if (!cancelled) {
            await initVectorDb()
          }

          if (cancelled) return
          checkForUpdates()
        } catch (error) {
          console.error('Failed to initialize app core:', error)
        }
      }

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleHandle = window.requestIdleCallback(() => {
          void run()
        }, { timeout: 1500 })
      } else {
        globalThis.setTimeout(() => {
          void run()
        }, 0)
      }
    }

    scheduleBackgroundInit()

    return () => {
      cancelled = true
      if (idleHandle !== undefined && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleHandle)
      }
    }
  }, [isTauri])

  // 应用界面缩放
  useEffect(() => {
    if (uiScale && uiScale !== 100) {
      document.documentElement.style.fontSize = `${uiScale}%`
    }
  }, [uiScale])

  // 应用自定义主题颜色
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

  useEffect(() => {
    switch (currentLocale) {
      case 'zh':
        dayjs.locale(zh);
        break;
      case 'en':
        dayjs.locale(en);
        break;
      default:
        break;
    }
  }, [currentLocale])

  // 禁用浏览器后退快捷键（Backspace）和添加搜索快捷键（Cmd/Ctrl+F）
  useEffect(() => {
    if (!isTauri) {
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // 搜索快捷键：Cmd+F (macOS) 或 Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // 检查焦点是否在编辑器内
        const target = e.target as HTMLElement
        const editorElement = document.getElementById('aritcle-md-editor')
        const isFocusInEditor = editorElement && editorElement.contains(target)

        // 如果焦点在编辑器内，触发编辑器搜索
        if (isFocusInEditor) {
          e.preventDefault()
          // 触发编辑器内搜索
          emitter.emit('editor-search-trigger' as any)
          return
        }

        // 检查焦点是否在聊天区域内，触发会话内搜索
        const chatElement = document.getElementById('record-chat')
        const isFocusInChat = chatElement && chatElement.contains(target)
        if (isFocusInChat) {
          e.preventDefault()
          import('@/stores/chat').then(({ default: useChatStore }) => {
            useChatStore.getState().setChatSearchOpen(true)
          })
          return
        }

        // 否则打开全局搜索
        e.preventDefault()
        const activePdfViewer = document.querySelector('[data-pdf-viewer-active="true"]')
        if (activePdfViewer) {
          e.preventDefault()
          emitter.emit('pdf-search-trigger' as any)
          return
        }

        setSearchOpen(true)
        return
      }

      // 如果按下 Backspace 键，且不在可编辑元素中
      if (e.key === 'Backspace') {
        const editableTarget = isEditableKeyboardTarget(e.target)
        if (editableTarget) {
          return
        }

        // 否则阻止默认的后退行为
        e.preventDefault()
      }

    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isTauri])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TextSizeProvider>
        {isTauri ? (
          <>
            <TitleBar
              onSearchClick={() => setSearchOpen(true)}
              onActivityClick={() => setActivityOpen(open => !open)}
              activityOpen={activityOpen}
            />
            <main className="flex flex-1 flex-col overflow-hidden w-full h-[calc(100vh-36px)] mt-9">
              {children}
            </main>
            <ActivityDrawer open={activityOpen} onOpenChange={setActivityOpen} />
            <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
            <SettingsDialog />
            <SyncConfirmDialog />
          </>
        ) : (
          <WebRuntimeNotice compact />
        )}
      </TextSizeProvider>
    </ThemeProvider>
  );
}
