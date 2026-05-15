"use client"

import { Bot, MessageCircle, Telescope } from "lucide-react"
import { Label } from "@/components/ui/label"
import useChatStore, { type ChatMode } from "@/stores/chat"
import { cn } from "@/lib/utils"

const MODE_META: Record<ChatMode, { label: string; description: string; icon: React.ReactNode }> = {
  chat: {
    label: "普通聊天",
    description: "使用当前 Prompt，适合问答和分析",
    icon: <MessageCircle className="size-4" />,
  },
  agent: {
    label: "Agent 模式",
    description: "可调用工具，适合执行操作",
    icon: <Bot className="size-4" />,
  },
  research: {
    label: "深度研究",
    description: "使用 Firecrawl MCP 多轮搜索并生成研究报告",
    icon: <Telescope className="size-4" />,
  },
}

export function ChatModeSelector() {
  const { chatMode, setChatMode, loading } = useChatStore()

  return (
    <div className="flex w-full flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        {MODE_META[chatMode].icon}
        <Label className="text-sm font-medium">对话模式</Label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(["chat", "agent", "research"] as ChatMode[]).map((mode) => {
          const selected = chatMode === mode
          const meta = MODE_META[mode]

          return (
            <button
              key={mode}
              type="button"
              disabled={loading}
              onClick={() => void setChatMode(mode)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50",
                selected ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50"
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {meta.icon}
                {meta.label}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
