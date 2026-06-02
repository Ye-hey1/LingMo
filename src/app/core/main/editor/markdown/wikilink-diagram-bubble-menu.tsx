'use client'

import { Editor } from '@tiptap/react'
import { DraftingCompass, Sparkles } from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { createEmptyDiagramContent } from '@/lib/diagram'

interface WikiLinkDiagramBubbleMenuProps {
  editor: Editor
}

interface DiagramLinkInfo {
  target: string
  rect: DOMRect
}

export function WikiLinkDiagramBubbleMenu({ editor }: WikiLinkDiagramBubbleMenuProps) {
  const [linkInfo, setLinkInfo] = useState<DiagramLinkInfo | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isClickingMenu = useRef(false)

  // 处理编辑器中的链接点击
  const handleLinkClick = useCallback((event: MouseEvent) => {
    if (isClickingMenu.current) return

    const target = event.target as HTMLElement
    const wikilinkEl = target.closest('.wikilink-diagram') as HTMLElement | null

    if (!wikilinkEl) {
      setLinkInfo(null)
      return
    }

    const wikilink = wikilinkEl.getAttribute('data-wikilink')
    if (!wikilink) return

    const rect = wikilinkEl.getBoundingClientRect()
    setLinkInfo({
      target: wikilink,
      rect,
    })
  }, [])

  // 关闭气泡菜单
  const closeMenu = useCallback(() => {
    setLinkInfo(null)
  }, [])

  // 辅助函数：根据 WikiLink target 解析或在 fileTree 中寻找文件的相对路径
  const getRelativePath = useCallback((target: string): string => {
    const { fileTree, activeFilePath } = useArticleStore.getState()
    
    const findFile = (items: any[], prefix = ''): string | null => {
      for (const item of items) {
        const itemPath = prefix ? `${prefix}/${item.name}` : item.name
        const baseName = item.name.replace(/\.(drawio|excalidraw\.json|excalidraw)$/, '')
        if (item.isFile && (item.name === target || baseName === target)) return itemPath
        if (item.children) {
          const found = findFile(item.children, itemPath)
          if (found) return found
        }
      }
      return null
    }

    const found = findFile(fileTree)
    if (found) return found

    // 如果找不到，返回在当前文章的同级目录下的路径
    const isVirtual = activeFilePath?.startsWith("lingmo://")
    const parentPath = (!isVirtual && activeFilePath?.includes('/')) 
      ? activeFilePath.split('/').slice(0, -1).join('/')
      : ''
    return parentPath ? `${parentPath}/${target}` : target
  }, [])

  // 编辑图表
  const handleEdit = useCallback(async () => {
    if (!linkInfo) return
    const target = linkInfo.target
    const relativePath = getRelativePath(target)
    const { fileTree, setActiveFilePath, loadFileTree } = useArticleStore.getState()

    // 检查文件是否确实存在于 fileTree
    const findFile = (items: any[], path: string): boolean => {
      for (const item of items) {
        const itemPath = path ? `${path}/${item.name}` : item.name
        if (itemPath === relativePath) return true
        if (item.children) {
          if (findFile(item.children, itemPath)) return true
        }
      }
      return false
    }

    const exists = findFile(fileTree, '')

    if (exists) {
      setActiveFilePath(relativePath)
    } else {
      // 文件不存在，自动为其创建初始的空图表内容
      try {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(relativePath)
        const emptyContent = createEmptyDiagramContent(relativePath)

        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, emptyContent)
        } else {
          await writeTextFile(pathOptions.path, emptyContent, { baseDir: pathOptions.baseDir })
        }

        // 重新加载文件树并打开
        await loadFileTree()
        setActiveFilePath(relativePath)
      } catch (error) {
        console.error('[WikiLinkDiagram] 创建空图表失败:', error)
        // 容错：直接尝试打开
        setActiveFilePath(relativePath)
      }
    }

    closeMenu()
  }, [linkInfo, getRelativePath, closeMenu])

  // 发送给 AI 提问
  const handleSendToAI = useCallback(async () => {
    if (!linkInfo) return
    const target = linkInfo.target
    const relativePath = getRelativePath(target)

    try {
      const pathOptions = await getFilePathOptions(relativePath)
      
      const resource = {
        name: target,
        path: pathOptions.path,
        relativePath: relativePath,
      }

      // 通过事件总线触发 AI 面板的资源绑定
      emitter.emit('diagramSelected', resource)

      // 展开右侧 AI 侧边栏
      const { rightSidebarVisible, toggleRightSidebar } = useSidebarStore.getState()
      if (!rightSidebarVisible) {
        toggleRightSidebar()
      }
    } catch (error) {
      console.error('[WikiLinkDiagram] 发送图表至 AI 失败:', error)
    }

    closeMenu()
  }, [linkInfo, getRelativePath, closeMenu])

  // 阻止气泡菜单点击穿透到编辑器
  const handleMenuClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    isClickingMenu.current = true
    setTimeout(() => {
      isClickingMenu.current = false
    }, 100)
  }, [])

  // 点击外部关闭气泡菜单
  const handleClickOutside = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (menuRef.current?.contains(target)) return
    if (target.closest('.wikilink-diagram')) return

    closeMenu()
  }, [closeMenu])

  // 注册事件监听
  useEffect(() => {
    const editorElement = editor.view.dom
    if (editorElement) {
      editorElement.addEventListener('click', handleLinkClick as EventListener)
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      if (editorElement) {
        editorElement.removeEventListener('click', handleLinkClick as EventListener)
      }
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [editor, handleLinkClick, handleClickOutside])

  if (!linkInfo) return null

  // 计算浮层菜单定位（显示在链接下方居中）
  const scrollContainer = editor.view.dom.parentElement
  const containerBounds = scrollContainer?.getBoundingClientRect()

  if (!containerBounds) return null

  const linkRect = linkInfo.rect
  // 计算链接相对于滚动容器的中心坐标
  const relativeLeft = linkRect.left - containerBounds.left + linkRect.width / 2 + (scrollContainer?.scrollLeft || 0)
  const relativeTop = linkRect.bottom - containerBounds.top + (scrollContainer?.scrollTop || 0) + 6

  return (
    <div
      ref={menuRef}
      className="absolute z-50 animate-in fade-in slide-in-from-top-1 duration-150"
      style={{
        top: relativeTop,
        left: relativeLeft,
        transform: 'translateX(-50%)',
      }}
    >
      <div
        className="flex items-center gap-1.5 p-1 bg-background/95 backdrop-blur-xs border border-border rounded-lg shadow-lg select-none"
        onClick={handleMenuClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded hover:bg-muted hover:text-foreground text-foreground/80 transition-all duration-150"
          onClick={handleEdit}
          title="在图表编辑器中打开"
        >
          <DraftingCompass className="w-3.5 h-3.5 text-indigo-500" />
          <span>编辑图表</span>
        </button>

        <div className="w-px h-4 bg-border/80" />

        <button
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded hover:bg-muted hover:text-foreground text-foreground/80 transition-all duration-150"
          onClick={handleSendToAI}
          title="将图表上下文发送给 AI"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>发送给 AI</span>
        </button>
      </div>
    </div>
  )
}

export default WikiLinkDiagramBubbleMenu
