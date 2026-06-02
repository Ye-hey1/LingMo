'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Editor } from '@tiptap/react'
import { BookOpen, FileEdit, Loader2, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'

interface WikiLinkPeekCardProps {
  editor: Editor
}

export function WikiLinkPeekCard({ editor }: WikiLinkPeekCardProps) {
  const [targetName, setTargetName] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [contentPreview, setContentPreview] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  
  const cardRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 1. 根据双链的标题查找实际的文件路径
  const findFilePathByName = useCallback((targetName: string): string | null => {
    const { fileTree } = useArticleStore.getState()
    
    const search = (items: any[], prefix = ''): string | null => {
      for (const item of items) {
        const itemPath = prefix ? `${prefix}/${item.name}` : item.name
        const baseName = item.name.replace(/\.md$/, '')
        if (item.isFile && baseName.toLowerCase() === targetName.toLowerCase()) {
          return itemPath
        }
        if (item.children) {
          const found = search(item.children, itemPath)
          if (found) return found
        }
      }
      return null
    }

    return search(fileTree)
  }, [])

  // 2. 读取对应文件的内容前 300 字符
  const loadFileContent = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const pathOptions = await getFilePathOptions(path)
      const workspace = await getWorkspacePath()
      
      let fullText = ''
      if (workspace.isCustom) {
        fullText = await readTextFile(pathOptions.path)
      } else {
        fullText = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      setContentPreview(fullText.slice(0, 300) + (fullText.length > 300 ? '...' : ''))
      setEditContent(fullText)
    } catch {
      setContentPreview('未能成功读取此双链关联笔记的内容。')
    } finally {
      setLoading(false)
    }
  }, [])

  // 3. 原地保存微型修改
  const handleSaveEdit = async () => {
    if (!filePath || saving) return
    setSaving(true)
    try {
      const pathOptions = await getFilePathOptions(filePath)
      const workspace = await getWorkspacePath()
      
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, editContent)
      } else {
        await writeTextFile(pathOptions.path, editContent, { baseDir: pathOptions.baseDir })
      }

      toast({
        title: '已原地保存修改'
      })
      setContentPreview(editContent.slice(0, 300) + (editContent.length > 300 ? '...' : ''))
      setIsEditing(false)
    } catch {
      toast({
        title: '保存失败',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  // 4. 全局监听鼠标 hover 在带有 data-type="wiki-link" 或者是 wiki 属性的 A 标签上
  useEffect(() => {
    if (!editor || !editor.view) return

    const editorDom = editor.view.dom

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const wikiAnchor = target.closest('a[data-wiki-link], span.wiki-link, a.wiki-link') as HTMLElement | null

      if (!wikiAnchor) return

      // 获取被链接目标的文本
      const targetText = wikiAnchor.textContent?.trim() || 
                         wikiAnchor.getAttribute('data-wiki-link') || 
                         wikiAnchor.getAttribute('data-target')

      if (!targetText) return

      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)

      hoverTimerRef.current = setTimeout(() => {
        const path = findFilePathByName(targetText)
        if (!path) return

        const rect = wikiAnchor.getBoundingClientRect()
        const scrollContainer = editorDom.closest('.overflow-y-auto') as HTMLElement | null

        if (!scrollContainer) return

        const containerBounds = scrollContainer.getBoundingClientRect()
        const cardHeight = 160
        const cardWidth = 290

        // 精算弹出位置，对准 hover 的 A 标签正下方，防止溢出视口
        let top = rect.bottom - containerBounds.top + scrollContainer.scrollTop + 6
        const left = rect.left - containerBounds.left + scrollContainer.scrollLeft - cardWidth / 2 + rect.width / 2

        if (top + cardHeight > scrollContainer.scrollTop + containerBounds.height - 20) {
          top = rect.top - containerBounds.top + scrollContainer.scrollTop - cardHeight - 6
        }

        setCoords({
          top: Math.max(scrollContainer.scrollTop + 8, top),
          left: Math.max(scrollContainer.scrollLeft + 12, Math.min(scrollContainer.scrollLeft + containerBounds.width - cardWidth - 12, left)),
        })
        setTargetName(targetText)
        setFilePath(path)
        setIsEditing(false)
        loadFileContent(path)
      }, 500) // 延迟 500ms 触发，给用户极其自然的悬浮感
    }

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null
      if (
        related && 
        (
          cardRef.current?.contains(related) || 
          (e.target as HTMLElement).closest('a[data-wiki-link], span.wiki-link, a.wiki-link')
        )
      ) {
        return
      }

      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
    }

    editorDom.addEventListener('mouseover', handleMouseOver)
    editorDom.addEventListener('mouseout', handleMouseOut)

    return () => {
      editorDom.removeEventListener('mouseover', handleMouseOver)
      editorDom.removeEventListener('mouseout', handleMouseOut)
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [editor, findFilePathByName, loadFileContent])

  // 监听点击外部或者离开卡片关闭
  useEffect(() => {
    if (!targetName) return

    const handleMouseLeave = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null
      if (cardRef.current && !cardRef.current.contains(related)) {
        setTargetName(null)
        setFilePath(null)
        setCoords(null)
      }
    }

    const card = cardRef.current
    card?.addEventListener('mouseleave', handleMouseLeave)
    return () => card?.removeEventListener('mouseleave', handleMouseLeave)
  }, [targetName])

  if (!targetName || !coords) return null

  const element = (
    <div
      ref={cardRef}
      className={cn(
        "absolute z-50 w-[290px] p-3 rounded-xl border border-border bg-background/96 shadow-2xl backdrop-blur-md flex flex-col",
        "animate-in fade-in slide-in-from-bottom-2 duration-150"
      )}
      style={{
        top: coords.top,
        left: coords.left,
      }}
    >
      {/* 头部详情 */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          <BookOpen size={13} className="text-primary" />
          <span className="text-xs font-semibold text-foreground truncate">
            {targetName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={cn(
              "p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-all active:scale-90",
              isEditing && "bg-primary/10 text-primary"
            )}
            title={isEditing ? "查看预览" : "原地微编辑"}
            type="button"
          >
            <FileEdit size={12} />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-[80px] flex flex-col text-[11px] leading-relaxed text-muted-foreground select-none">
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-6 gap-1.5">
            <Loader2 size={13} className="animate-spin text-primary" />
            <span>正在读取笔记数据...</span>
          </div>
        ) : isEditing ? (
          <div className="flex-1 flex flex-col gap-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full flex-1 min-h-[90px] text-xs bg-muted/40 border border-border/60 rounded-md p-1.5 outline-none font-mono placeholder:text-muted-foreground/60 resize-none"
              placeholder="直接在此处微修改笔记内容..."
            />
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="flex items-center justify-center gap-1 py-1 text-xs text-white bg-primary hover:bg-primary/95 rounded transition-all active:scale-95 disabled:opacity-50 shrink-0 font-medium"
              type="button"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              保存修改
            </button>
          </div>
        ) : (
          <p className="whitespace-pre-wrap line-clamp-5 max-h-24 overflow-y-auto">
            {contentPreview || '笔记内容为空。'}
          </p>
        )}
      </div>
    </div>
  )

  const container = editor.view.dom.closest('.tiptap-editor') || document.body
  return createPortal(element, container)
}
