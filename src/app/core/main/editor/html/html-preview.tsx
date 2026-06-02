'use client'

import { useRef, useState, useEffect } from 'react'

// 声明接收的参数类型
interface HtmlPreviewProps {
  content: string
  autoSync: boolean
  refreshTrigger: number
  onSyncStatusChange?: (status: 'synced' | 'syncing' | 'pending') => void
}

export function HtmlPreview({
  content,
  autoSync,
  refreshTrigger,
  onSyncStatusChange,
}: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  
  // 维护实际被 iframe 渲染的页面内容状态
  const [renderedContent, setRenderedContent] = useState(content)

  // 1. 实现防抖自动同步机制
  useEffect(() => {
    if (renderedContent === content) {
      onSyncStatusChange?.('synced')
      return
    }

    // 手动刷新模式，将状态置为待同步
    if (!autoSync) {
      onSyncStatusChange?.('pending')
      return
    }

    onSyncStatusChange?.('syncing')

    // 防抖 400 毫秒后自动载入更新内容
    const timer = setTimeout(() => {
      setRenderedContent(content)
      onSyncStatusChange?.('synced')
    }, 400)

    return () => clearTimeout(timer)
  }, [content, autoSync, renderedContent, onSyncStatusChange])

  // 2. 响应外部强制手动刷新信号
  useEffect(() => {
    if (refreshTrigger > 0) {
      setRenderedContent(content)
      onSyncStatusChange?.('synced')
      
      const iframe = iframeRef.current
      if (iframe) {
        iframe.srcdoc = ''
        requestAnimationFrame(() => {
          iframe.srcdoc = content
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger])

  return (
    <div className="h-full w-full overflow-hidden bg-white relative">
      <iframe
        ref={iframeRef}
        srcDoc={renderedContent}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="HTML Preview"
        className="h-full w-full border-0 bg-white"
      />
    </div>
  )
}
