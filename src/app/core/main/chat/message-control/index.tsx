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
import { useTranslations } from 'next-intl'
import emitter from "@/lib/emitter"
import { getActionButtonClass } from "./styles"

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
    emitResendFromUserMessage(chat)
  }

  const actionChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    if (child.type === Fragment) return child
    if (typeof child.type === 'string') return child
    return cloneElement(child, { compact: compact || undefined } as Record<string, unknown>)
  })

  const actionButtonClass = getActionButtonClass(compact)

  // 分隔线组件
  const Separator = () => (
    <div className='h-4 w-px shrink-0 bg-border' />
  )

  return (
    <>
      <div
        ref={containerRef}
        className='mt-2 flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1 transition-colors hover:border-border/90'
      >
        {/* 左侧：消息元信息 */}
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          <MessageInfo chat={chat} compact={compact} />
          <CondensedIndicator chat={chat} />
        </div>

        {/* 右侧：操作按钮组 */}
        <div className="ml-auto flex min-w-0 max-w-full shrink items-center gap-1 overflow-x-auto scrollbar-hide">
          {/* 扩展操作：笔记、标记 */}
          {actionChildren ? (
            <>
              <div className='flex shrink-0 items-center gap-1'>
                {actionChildren}
              </div>
              <Separator />
            </>
          ) : null}

          {/* 内容操作：复制、翻译、朗读 */}
          <div className="flex shrink-0 items-center gap-0.5">
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
          </div>

          <Separator />

          {/* 破坏性/流程操作：重新生成、重新开始、删除 */}
          <div className="flex shrink-0 items-center gap-0.5">
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
