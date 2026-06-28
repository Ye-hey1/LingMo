'use client'
import { ChatHeader } from './chat-header'
import { ChatInput } from "./chat-input";
import ChatContent from "./chat-content";
import { ClipboardListener } from "./clipboard-listener";
import { ChatSearch } from './chat-search'

type ChatProps = {
  expanded?: boolean
}

export default function Chat({ expanded = false }: ChatProps) {
  return <div
    id="record-chat"
    data-chat-layout={expanded ? 'expanded' : 'panel'}
    className="flex flex-col flex-1 relative overflow-x-hidden h-full overflow-hidden"
  >
    <ChatHeader />
    <ChatSearch />
    <ChatContent expanded={expanded} />
    <ClipboardListener />
    <ChatInput expanded={expanded} />
  </div>
}
