"use client"

import * as React from "react"
import { Bot, Check, ChevronDown, ChevronUp, MessageCircle, Telescope } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore, { type ChatMode } from "@/stores/chat"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const MODE_OPTIONS: Array<{
  id: ChatMode
  label: string
  icon: React.ReactNode
}> = [
  {
    id: "chat",
    label: "Chat",
    icon: <MessageCircle className="size-4" />,
  },
  {
    id: "agent",
    label: "Agent",
    icon: <Bot className="size-4" />,
  },
  {
    id: "research",
    label: "Research",
    icon: <Telescope className="size-4" />,
  },
]

interface ChatModeSelectProps {
  variant?: "icon" | "compact"
}

export function ChatModeSelect({ variant = "icon" }: ChatModeSelectProps) {
  const { chatMode, setChatMode, loading } = useChatStore()
  const [open, setOpen] = React.useState(false)
  const current = MODE_OPTIONS.find(option => option.id === chatMode) || MODE_OPTIONS[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "compact" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 min-w-0 max-w-[138px] shrink-0 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-background/70 hover:text-foreground"
            )}
            aria-label={`对话模式：${current.label}`}
          >
            <span className="shrink-0">{current.icon}</span>
            <span className="truncate">{current.label}</span>
            {open ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
          </Button>
        ) : (
          <div className="hidden md:block">
            <TooltipButton
              variant="ghost"
              size="icon"
              icon={current.icon}
              tooltipText={`对话模式：${current.label}`}
              disabled={loading}
              buttonClassName="text-muted-foreground hover:bg-background/70 hover:text-foreground"
            />
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[160px] p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {MODE_OPTIONS.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={() => {
                    void setChatMode(option.id)
                    setOpen(false)
                  }}
                >
                  <div className="mr-2 text-muted-foreground">{option.icon}</div>
                  <span className="min-w-0 flex-1 text-sm font-medium">{option.label}</span>
                  <Check
                    className={cn("ml-2 size-4", chatMode === option.id ? "opacity-100" : "opacity-0")}
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
