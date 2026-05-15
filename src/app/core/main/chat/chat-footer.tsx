"use client"

import { BotMessageSquare, BotOff, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import useSettingStore from "@/stores/setting"
import { useTranslations } from "next-intl"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"

export function ChatFooter() {
  const t = useTranslations('record.chat.header')
  const { currentPrompt } = usePromptStore()
  const { primaryModel, aiModelList } = useSettingStore()

  // 查找当前选中的模型
  const findSelectedModel = () => {
    if (!primaryModel || !aiModelList) return null
    
    for (const config of aiModelList) {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const targetModel = config.models.find(model => model.id === primaryModel)
        if (targetModel) {
          return {
            model: targetModel.model,
            configTitle: config.title
          }
        }
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === primaryModel) {
          return {
            model: config.model,
            configTitle: config.title
          }
        }
      }
    }
    return null
  }

  const selectedModel = findSelectedModel()

  return (
    <TooltipProvider>
      <footer className="flex h-6 w-full items-center justify-between border-t border-border bg-background px-2 text-xs text-muted-foreground">
        <PromptSelect
          triggerClassName="flex min-w-0 max-w-[40%] items-center gap-1 truncate rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          trigger={(
            <>
              <Drama className="size-3 shrink-0" />
              <span className="truncate">{currentPrompt?.title || '-'}</span>
            </>
          )}
        />
        <ModelSelect
          triggerClassName="flex min-w-0 max-w-[55%] items-center gap-1 truncate rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          trigger={selectedModel ? (
            <>
              <BotMessageSquare className="size-3 shrink-0" />
              <span className="truncate">
                {selectedModel.model}
                <span className="ml-1">({selectedModel.configTitle})</span>
              </span>
            </>
          ) : (
            <>
              <BotOff className="size-3 shrink-0" />
              <span>{t('noModel')}</span>
            </>
          )}
        />
      </footer>
    </TooltipProvider>
  )
}
