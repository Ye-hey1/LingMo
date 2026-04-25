'use client'
import ChatContent from '@/app/core/main/chat/chat-content'
import { ClipboardListener } from '@/app/core/main/chat/clipboard-listener'
import { ChatInput } from '@/app/core/main/chat/chat-input'
import { MobileChatHeader } from './components/mobile-chat-header'

export default function Chat() {
  return (
    <div id="mobile-chat" className="flex flex-col flex-1 w-full">
      <MobileChatHeader />
      <ChatContent />
      <ClipboardListener />
      <div className="px-1 pb-1">
        <ChatInput />
      </div>
    </div>
  )
}
