"use client"

import * as React from "react"
import { Bot, Check, MessageCircle, Telescope } from "lucide-react"
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
    label: "Deep Research",
    icon: <Telescope className="size-4" />,
  },
]

export function ChatModeSelect() {
  const { chatMode, setChatMode, loading } = useChatStore()
  const [open, setOpen] = React.useState(false)
  const current = MODE_OPTIONS.find(option => option.id === chatMode) || MODE_OPTIONS[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="hidden md:block">
          <TooltipButton
            variant={chatMode !== "chat" ? "secondary" : "ghost"}
            size="icon"
            icon={current.icon}
            tooltipText={`对话模式：${current.label}`}
            disabled={loading}
            buttonClassName={cn(chatMode !== "chat" && "bg-primary/10 text-primary hover:bg-primary/15")}
          />
        </div>
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
