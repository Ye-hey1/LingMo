import { Chat } from "@/db/chats"
import { GlobeIcon, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { fetchAiTranslate } from "@/lib/ai/translate"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { scrollToBottom } from '@/lib/utils'
import { TooltipButton } from "@/components/tooltip-button"

interface TranslateControlProps {
  chat: Chat
  onTranslatedContent: (content: string) => void
  compact?: boolean
}

export function TranslateControl({ chat, onTranslatedContent, compact = false }: TranslateControlProps) {
  const translateT = useTranslations('record.chat.input.translate')
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const actionButtonClass = compact
    ? "size-6 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
    : "size-6.5 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
  
  // 可翻译的语言列表
  const languageOptions = [
    "English",
    "中文",
    "日本語",
    "한국어",
    "Français",
    "Deutsch",
    "Español",
    "Русский",
  ]
  
  // 处理翻译
  async function handleTranslate(language: string) {
    if (!chat.content || isTranslating) return
    
    setIsTranslating(true)
    setSelectedLanguage(language)
    
    try {
      const translatedText = await fetchAiTranslate(chat.content, language)
      onTranslatedContent(translatedText)
    } catch (error) {
      console.error('Translation error:', error)
    } finally {
      setIsTranslating(false)
      setTimeout(() => {
        scrollToBottom()
      }, 100);
    }
  }
  
  // 重置翻译
  function resetTranslation() {
    setSelectedLanguage('')
    onTranslatedContent('')
  }

  if (!chat.content || chat.type !== 'chat') {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div>
          <TooltipButton
            icon={isTranslating ? <Loader2 className="size-4 animate-spin" /> : <GlobeIcon className="size-4" />}
            tooltipText={translateT('tooltip')}
            disabled={isTranslating}
            variant="ghost"
            size="sm"
            buttonClassName={actionButtonClass}
          />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {selectedLanguage ? (
          <DropdownMenuItem onClick={resetTranslation}>
            {translateT('showOriginal')}
          </DropdownMenuItem>
        ) : (
          languageOptions.map((language) => (
            <DropdownMenuItem 
              key={language}
              onClick={() => handleTranslate(language)}
            >
              {language}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
