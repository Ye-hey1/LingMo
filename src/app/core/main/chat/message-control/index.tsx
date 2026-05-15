import { Chat } from "@/db/chats"
import useChatStore from "@/stores/chat"
import { CornerUpLeft, RefreshCw, XIcon } from "lucide-react"
import { clear, hasText, readText } from "tauri-plugin-clipboard-api"
import { Children, cloneElement, isValidElement, Fragment, useEffect, useRef, useState } from "react"
import { MessageInfo } from "./message-info"
import { CondensedIndicator } from "./condensed-indicator"
import { TranslateControl } from "./translate-control"
import { CopyControl } from "./copy-control"
import { ReadAloudControl } from "./read-aloud-control"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl';
import emitter from "@/lib/emitter"

export default function MessageControl({chat, children}: {chat: Chat, children: React.ReactNode}) {
  const { deleteChat, chats, loading } = useChatStore()
  const [translatedContent, setTranslatedContent] = useState<string>('')
  const [compact, setCompact] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const t = useTranslations('common')

  useEffect(() => {
    const target = containerRef.current
    if (!target) return

    const updateCompact = () => {
      const width = target.clientWidth
      setCompact(width < 420)
    }

    updateCompact()

    const observer = new ResizeObserver(() => {
      updateCompact()
    })
    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [])
  
  async function deleteHandler() {
    if (chat.type === "clipboard" && !chat.image) {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        try {
          const text = await readText()
          if (text === chat.content) {
            await clear()
          }
        } catch {}
      }
    }
    deleteChat(chat.id)
  }

  function parseMessageImages(chat: Chat) {
    if (!chat.images) return []

    try {
      const images = JSON.parse(chat.images)
      return Array.isArray(images) ? images.filter((image): image is string => typeof image === 'string') : []
    } catch {
      return []
    }
  }

  function parseMessageQuote(chat: Chat) {
    if (!chat.quoteData) return null

    try {
      const quoteData = JSON.parse(chat.quoteData)
      return quoteData && typeof quoteData === 'object' ? quoteData : null
    } catch {
      return null
    }
  }

  function emitResendFromUserMessage(targetChat: Chat, restartConversation = false) {
    const content = targetChat.content?.trim()
    if (!content || loading) return

    emitter.emit('chat-message-resend', {
      content,
      images: parseMessageImages(targetChat),
      quoteData: parseMessageQuote(targetChat),
      restartConversation,
    })
  }

  function regenerateHandler() {
    const currentIndex = chats.findIndex(item => item.id === chat.id)
    const previousUserChat = currentIndex >= 0
      ? [...chats.slice(0, currentIndex)].reverse().find(item => item.role === 'user' && item.type === 'chat')
      : null

    if (previousUserChat) {
      emitResendFromUserMessage(previousUserChat)
    }
  }

  function restartFromMessageHandler() {
    emitResendFromUserMessage(chat, true)
  }

  const actionChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    if (child.type === Fragment) return child
    return cloneElement(child, { compact } as Record<string, unknown>)
  })

  const actionButtonClass = compact
    ? "size-6 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
    : "size-6.5 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"

  return (
    <>
      <div ref={containerRef} className='mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1'>

        <div className="flex min-w-0 items-center gap-1.5">
          <MessageInfo chat={chat} compact={compact} />
          <CondensedIndicator chat={chat} />
        </div>

        <div className="ml-auto flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto scrollbar-hide">
          {actionChildren ? (
            <>
              <div className='flex shrink-0 items-center gap-0.5'>
                {actionChildren}
              </div>
              <div className='mx-0.5 h-4 w-px bg-border/70' />
            </>
          ) : null}

          <CopyControl
            chat={chat}
            translatedContent={translatedContent}
            compact={compact}
          />

          <TranslateControl
            chat={chat}
            onTranslatedContent={setTranslatedContent}
            compact={compact}
          />

            <ReadAloudControl
            chat={chat}
            translatedContent={translatedContent}
            compact={compact}
          />

          {chat.role === 'system' && chat.type === 'chat' ? (
            <TooltipButton
              icon={<RefreshCw className='size-4' />}
              tooltipText="重新生成"
              variant={"ghost"}
              size={"sm"}
              buttonClassName={actionButtonClass}
              onClick={regenerateHandler}
              disabled={loading}
            />
          ) : null}

          {chat.role === 'user' && chat.type === 'chat' ? (
            <TooltipButton
              icon={<CornerUpLeft className='size-4' />}
              tooltipText="从这里重新开始"
              variant={"ghost"}
              size={"sm"}
              buttonClassName={actionButtonClass}
              onClick={restartFromMessageHandler}
              disabled={loading}
            />
          ) : null}

          <TooltipButton
            icon={<XIcon className='size-4' />}
            tooltipText={t('delete')}
            variant={"ghost"}
            size={"sm"}
            buttonClassName={actionButtonClass}
            onClick={deleteHandler}
          />
        </div>
      </div>

      {/* 显示翻译结果 */}
      {translatedContent && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="whitespace-pre-wrap">{translatedContent}</div>
        </div>
      )}
    </>
  )
}
