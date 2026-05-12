import { TooltipButton } from "@/components/tooltip-button"
import { Chat } from "@/db/chats"
import { insertMark } from "@/db/marks"
import useChatStore from "@/stores/chat"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CheckCircle, Highlighter } from "lucide-react"
import {useEffect, useState} from "react";
import { useTranslations } from 'next-intl';

export function MarkText({chat, compact = false}: {chat: Chat, compact?: boolean}) {

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, marks } = useMarkStore()
  const { updateInsert, chats } = useChatStore()
  const [isRecorded, setIsRecorded] = useState(chat.inserted)
  const t = useTranslations('record.queue')
  const actionButtonClass = compact
    ? "size-6 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
    : "size-6.5 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"

  useEffect(() => {
    const currentIndex = chats.findIndex(item => item.id === chat.id)
    const prevChat = chats[currentIndex - 1]

    if (!prevChat || !chat.content) {
       setIsRecorded(false)
       return
    }

    const contentToCheck = `
${prevChat?.content}
${chat.content}
`.replace(/'/g, '')

    const markExists = marks.some(mark =>
       mark.type === 'text' &&
       mark.content === contentToCheck
    )

    setIsRecorded(markExists)
  }, [marks, chat.id, chats])

  async function handleSuccess() {
    const currentIndex = chats.findIndex(item => item.id === chat.id)
    const prevChat = chats[currentIndex - 1]
    const res = `
${prevChat?.content}
${chat.content}
`
    const resetText = res.replace(/'/g, '')
    await insertMark({ tagId: currentTagId, type: 'text', desc: resetText, content: resetText })
    updateInsert(chat.id)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
    setIsRecorded(true)
  }

  return (
    isRecorded ?
      <TooltipButton icon={<CheckCircle className="size-4" />} tooltipText={t('recorded')} variant={"ghost"} size="sm" buttonClassName={actionButtonClass} disabled/> :
      <TooltipButton icon={<Highlighter className="size-4" />} tooltipText={t('record')} variant={"ghost"} size="sm" buttonClassName={actionButtonClass} onClick={handleSuccess}/>
  )
}
