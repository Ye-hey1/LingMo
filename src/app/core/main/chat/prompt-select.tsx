import * as React from "react"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"

interface PromptSelectProps {
  trigger?: React.ReactNode
  triggerClassName?: string
}

export function PromptSelect({ trigger, triggerClassName = "hidden md:block" }: PromptSelectProps) {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.promptSelect')

  // 初始化prompt列表
  useEffect(() => {
    initPromptData()
  }, [])

  // 选择 Prompt
  async function promptSelectChangeHandler(id: string) {
    const selectedPrompt = promptList.find(item => item.id === id)
    if (!selectedPrompt) return
    await setCurrentPrompt(selectedPrompt)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ? (
          <button
            type="button"
            className={triggerClassName}
            aria-label={t('tooltip')}
          >
            {trigger}
          </button>
        ) : (
          <div className={triggerClassName}>
            <TooltipButton
              icon={<Drama />}
              tooltipText={t('tooltip')}
              size="icon"
            />
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-0">
        <Command>
          <CommandInput placeholder={t('tooltip')} className="h-9" />
          <CommandList>
            <CommandGroup>
              {promptList?.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={(currentValue) => {
                    promptSelectChangeHandler(currentValue)
                    setOpen(false)
                  }}
                >
                  {item.title}
                  <Check
                    className={cn(
                      "ml-auto",
                      currentPrompt?.id === item.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
