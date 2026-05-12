'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { LeftSidebar, LeftSidebarRail } from './left-sidebar'
import { EditorLayout } from './editor/editor-layout'
import Chat from './chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from '@/stores/sidebar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import emitter from '@/lib/emitter'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

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
  const centerPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const [minLeftSidebarSize, setMinLeftSidebarSize] = useState(10)
  const [minRightSidebarSize, setMinRightSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)

  const visiblePanels = useMemo(() => [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right',
  ].filter(Boolean), [leftSidebarVisible, centerPanelVisible, rightSidebarVisible])

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

  useEffect(() => {
    const syncPanel = (panel: ImperativePanelHandle | null, visible: boolean) => {
      if (!panel) return
      if (visible) {
        panel.expand()
      } else {
        panel.collapse()
      }
    }

    const timer = window.setTimeout(() => {
      syncPanel(centerPanelRef.current, centerPanelVisible)
      syncPanel(rightPanelRef.current, rightSidebarVisible)
    }, 50)

    return () => window.clearTimeout(timer)
  }, [centerPanelVisible, rightSidebarVisible])

  const onLayout = (sizes: number[]) => {
    const storageKey = `${PANEL_STORAGE_PREFIX}:${layoutKey}`
    localStorage.setItem(storageKey, JSON.stringify(sizes))
  }

  return (
    <div className="flex h-full min-w-0">
      <LeftSidebarRail />
      <ResizablePanelGroup direction="horizontal" onLayout={onLayout} className="h-full min-w-0 flex-1">
        {leftSidebarVisible ? (
          <ResizablePanel
            key="left"
            id="left-panel"
            order={1}
            defaultSize={actualLayout[0]}
            minSize={minLeftSidebarSize}
            className="min-w-0"
          >
            <LeftSidebar />
          </ResizablePanel>
        ) : null}
        {leftSidebarVisible && (centerPanelVisible || rightSidebarVisible) ? (
          <ResizableHandle key="handle-left-center" className="bg-border/80" />
        ) : null}
        <ResizablePanel
          key="center"
          id="center-panel"
          order={2}
          ref={centerPanelRef}
          defaultSize={actualLayout[1]}
          minSize={minEditorSize}
          collapsible
          collapsedSize={0}
          className="min-w-0"
        >
          <EditorLayout />
        </ResizablePanel>
        <ResizableHandle
          key="handle-center-right"
          className={`bg-border/80 ${!(centerPanelVisible && rightSidebarVisible) ? 'hidden' : ''}`}
        />
        <ResizablePanel
          key="right"
          id="right-panel"
          order={3}
          ref={rightPanelRef}
          defaultSize={actualLayout[2]}
          minSize={minRightSidebarSize}
          collapsible
          collapsedSize={0}
          className="min-w-0 border-l"
        >
          <Chat />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function Page() {
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

export default dynamic(() => Promise.resolve(Page), { ssr: false })
