'use client'
import { ChatHeader } from './chat-header'
import { ChatFooter } from './chat-footer'
import { ChatInput } from "./chat-input";
import ChatContent from "./chat-content";
import { ClipboardListener } from "./clipboard-listener";
import { ChatSearch } from './chat-search'

export default function Chat() {
  return <div id="record-chat" className="flex flex-col flex-1 relative overflow-x-hidden h-full overflow-hidden">
    <ChatHeader />
    <ChatSearch />
    <ChatContent />
    <ClipboardListener />
    <ChatInput />
    <ChatFooter />
  </div>
}
