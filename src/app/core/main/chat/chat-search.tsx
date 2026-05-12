'use client'
import { useCallback, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, X, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import useChatStore from '@/stores/chat'

export function ChatSearch() {
  const chatSearchOpen = useChatStore((s) => s.chatSearchOpen)
  const setChatSearchOpen = useChatStore((s) => s.setChatSearchOpen)
  const chatSearchQuery = useChatStore((s) => s.chatSearchQuery)
  const setChatSearchQuery = useChatStore((s) => s.setChatSearchQuery)
  const chatSearchResults = useChatStore((s) => s.chatSearchResults)
  const chatSearchCurrentIndex = useChatStore((s) => s.chatSearchCurrentIndex)
  const setChatSearchCurrentIndex = useChatStore((s) => s.setChatSearchCurrentIndex)

  const inputRef = useRef<HTMLInputElement>(null)
  const resultCount = chatSearchResults.length
  const currentIndex = resultCount > 0 ? chatSearchCurrentIndex + 1 : 0

  useEffect(() => {
    if (chatSearchOpen) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [chatSearchOpen])

  const handleNavigatePrev = useCallback(() => {
    if (resultCount === 0) return
    const newIndex = chatSearchCurrentIndex > 0 ? chatSearchCurrentIndex - 1 : resultCount - 1
    setChatSearchCurrentIndex(newIndex)
  }, [chatSearchCurrentIndex, resultCount, setChatSearchCurrentIndex])

  const handleNavigateNext = useCallback(() => {
    if (resultCount === 0) return
    const newIndex = chatSearchCurrentIndex < resultCount - 1 ? chatSearchCurrentIndex + 1 : 0
    setChatSearchCurrentIndex(newIndex)
  }, [chatSearchCurrentIndex, resultCount, setChatSearchCurrentIndex])

  const handleClose = useCallback(() => {
    setChatSearchOpen(false)
  }, [setChatSearchOpen])

  if (!chatSearchOpen) return null

  return (
    <div className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={chatSearchQuery}
        onChange={(e) => setChatSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            handleClose()
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            if (e.shiftKey) handleNavigatePrev()
            else handleNavigateNext()
          }
        }}
        placeholder="搜索会话内消息..."
        className="h-7 flex-1 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground min-w-[60px] text-center">
        {resultCount > 0 ? `${currentIndex}/${resultCount}` : '无结果'}
      </span>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className="size-6" onClick={handleNavigatePrev} disabled={resultCount === 0}>
          <ChevronUp className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-6" onClick={handleNavigateNext} disabled={resultCount === 0}>
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
      <Button variant="ghost" size="icon" className="size-6" onClick={handleClose}>
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
