import { Chat } from "@/db/chats"
import dayjs from "dayjs"
import { Clock } from "lucide-react"
import relativeTime from "dayjs/plugin/relativeTime"

dayjs.extend(relativeTime)

interface MessageInfoProps {
  chat: Chat
  compact?: boolean
}

export function MessageInfo({ chat, compact = false }: MessageInfoProps) {

  return (
    <div className='flex items-center gap-1 text-muted-foreground'>
      <Clock className={`${compact ? "size-3.5" : "size-4"} shrink-0`} />
      <span className={`${compact ? "text-xs" : "text-sm"} leading-none`}>
        {dayjs(chat.createdAt).fromNow()}
      </span>
    </div>
  )
}
