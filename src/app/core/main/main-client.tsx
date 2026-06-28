'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { LeftSidebar, LeftSidebarRail } from './left-sidebar'
import { EditorLayout } from './editor/editor-layout'
import Chat from './chat'
import { GlobalProgress } from './global-progress'
import { useSidebarStore } from '@/stores/sidebar'
import useSettingStore from '@/stores/setting'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import emitter from '@/lib/emitter'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { cn } from '@/lib/utils'

const PANEL_STORAGE_PREFIX = 'react-resizable-panels:main-layout'
const DEFAULT_LAYOUT = [30, 40, 30]

function getDefaultLayout(layoutKey: string) {
  if (typeof window === 'undefined') {
    return DEFAULT_LAYOUT
  }

  const storageKey = `${PANEL_STORAGE_PREFIX}:${layoutKey}`
  const layout = localStorage.getItem(storageKey)

  if (layout) {
    try {
      const parsed = JSON.parse(layout)
      const sum = parsed.reduce((a: number, b: number) => a + b, 0)
      if (Math.abs(sum - 100) < 0.1) {
        return parsed
      }
      localStorage.removeItem(storageKey)
    } catch {
      localStorage.removeItem(storageKey)
    }
  }

  switch (layoutKey) {
    case 'left-center-right': return [20, 50, 30]
    case 'left-center': return [30, 70, 0]
    case 'center-right': return [0, 60, 40]
    case 'left-right': return [50, 0, 50]
    case 'left': return [100, 0, 0]
    case 'center': return [0, 100, 0]
    case 'right': return [0, 0, 100]
    default: return DEFAULT_LAYOUT
  }
}

function ResizableWrapper() {
  const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible, initSidebarState } = useSidebarStore()
  const { zenMode } = useSettingStore()

  // 禅专注模式下隐藏侧边栏
  const isLeftSidebarVisible = zenMode ? false : leftSidebarVisible
  const isRightSidebarVisible = zenMode ? false : rightSidebarVisible

  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const centerPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const [minLeftSidebarSize, setMinLeftSidebarSize] = useState(10)
  const [minRightSidebarSize, setMinRightSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)

  const visiblePanels = useMemo(() => [
    isLeftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    isRightSidebarVisible && 'right',
  ].filter(Boolean), [isLeftSidebarVisible, centerPanelVisible, isRightSidebarVisible])

  const layoutKey = visiblePanels.join('-')
  const actualLayout = useMemo(() => getDefaultLayout(layoutKey), [layoutKey])

  useEffect(() => {
    const calculateMinSizes = () => {
      const windowWidth = window.innerWidth
      const minLeftSidebarPercent = Math.max(10, (160 / windowWidth) * 100)
      const minRightSidebarPercent = Math.max(18, (280 / windowWidth) * 100)
      const minEditorPercent = Math.max(25, (400 / windowWidth) * 100)
      setMinLeftSidebarSize(Math.min(minLeftSidebarPercent, 24))
      setMinRightSidebarSize(Math.min(minRightSidebarPercent, 40))
      setMinEditorSize(Math.min(minEditorPercent, 50))
    }

    void initSidebarState()
    calculateMinSizes()
    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [initSidebarState])

  useLayoutEffect(() => {
    const syncPanel = (panel: ImperativePanelHandle | null, visible: boolean) => {
      if (!panel) return
      if (visible) {
        panel.expand()
      } else {
        panel.collapse()
      }
    }

    syncPanel(leftPanelRef.current, isLeftSidebarVisible)
    syncPanel(centerPanelRef.current, centerPanelVisible)
    syncPanel(rightPanelRef.current, isRightSidebarVisible)
  }, [layoutKey, isLeftSidebarVisible, centerPanelVisible, isRightSidebarVisible])

  const chatExpanded = isRightSidebarVisible && !centerPanelVisible

  const onLayout = (sizes: number[]) => {
    const storageKey = `${PANEL_STORAGE_PREFIX}:${layoutKey}`
    localStorage.setItem(storageKey, JSON.stringify(sizes))
  }

  return (
    <div className={cn("flex h-full min-w-0 transition-all duration-300 relative", zenMode && "zen-mode-active")}>
      {!zenMode && <LeftSidebarRail />}
      <ResizablePanelGroup direction="horizontal" onLayout={onLayout} className="main-layout-panel-group h-full min-w-0 flex-1">
        <ResizablePanel
          key="left"
          id="left-panel"
          order={1}
          ref={leftPanelRef}
          defaultSize={actualLayout[0]}
          minSize={isLeftSidebarVisible ? minLeftSidebarSize : 0}
          collapsible
          collapsedSize={0}
          className={cn('main-layout-panel min-w-0', !isLeftSidebarVisible && 'main-layout-panel-collapsed')}
        >
          <LeftSidebar />
        </ResizablePanel>
        {isLeftSidebarVisible && (centerPanelVisible || isRightSidebarVisible) ? (
          <ResizableHandle key="handle-left-center" className="main-layout-resize-handle bg-border/80" />
        ) : null}
        <ResizablePanel
          key="center"
          id="center-panel"
          order={2}
          ref={centerPanelRef}
          defaultSize={actualLayout[1]}
          minSize={centerPanelVisible ? minEditorSize : 0}
          collapsible
          collapsedSize={0}
          className={cn('main-layout-panel min-w-0', !centerPanelVisible && 'main-layout-panel-collapsed')}
        >
          <EditorLayout />
        </ResizablePanel>
        <ResizableHandle
          key="handle-center-right"
          className={`main-layout-resize-handle bg-border/80 ${!(centerPanelVisible && isRightSidebarVisible) ? 'hidden' : ''}`}
        />
        <ResizablePanel
          key="right"
          id="right-panel"
          order={3}
          ref={rightPanelRef}
          defaultSize={actualLayout[2]}
          minSize={isRightSidebarVisible ? minRightSidebarSize : 0}
          collapsible
          collapsedSize={0}
          className={cn('main-layout-panel min-w-0 border-l', !isRightSidebarVisible && 'main-layout-panel-collapsed')}
        >
          <Chat expanded={chatExpanded} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <GlobalProgress />
    </div>
  )
}

function MainClient() {
  const openSettingsDialog = useSettingsDialogStore(state => state.open)

  useEffect(() => {
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }

    void saveCurrentPage()

    const window = getCurrentWindow()
    const unlistenTrayAction = window.listen<string>('tray-action', async (event) => {
      const action = event.payload
      switch (action) {
        case 'screenshot':
          await invoke('screenshot')
          emitter.emit('screenshot-shortcut-register', undefined)
          break
        case 'text':
          emitter.emit('text-shortcut-register', undefined)
          break
        case 'pin':
          emitter.emit('window-pin-register', undefined)
          break
        case 'link':
          emitter.emit('link-shortcut-register', undefined)
          break
      }
    })

    const unlistenOpenSettings = window.listen<void>('open-settings', () => {
      openSettingsDialog()
    })

    return () => {
      void unlistenTrayAction.then(fn => fn())
      void unlistenOpenSettings.then(fn => fn())
    }
  }, [openSettingsDialog])

  return <ResizableWrapper />
}

export default MainClient
