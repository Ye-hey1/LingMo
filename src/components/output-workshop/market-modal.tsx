"use client"

import * as React from "react"
import { Loader2, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/hooks/use-toast"
import { openPath } from "@tauri-apps/plugin-opener"

interface MarketModalProps {
  show: boolean
  installing: boolean
  installProgress: string
  githubUrl: string
  customTemplateName: string
  onGithubUrlChange: (url: string) => void
  onCustomTemplateNameChange: (name: string) => void
  onInstall: () => void
  onCreateCustomTemplate: () => void
  onClose: () => void
  onRefreshTemplates: () => Promise<void>
}

export function MarketModal({
  show,
  installing,
  installProgress,
  githubUrl,
  customTemplateName,
  onGithubUrlChange,
  onCustomTemplateNameChange,
  onInstall,
  onCreateCustomTemplate,
  onClose,
  onRefreshTemplates,
}: MarketModalProps) {
  if (!show) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl animate-in zoom-in-95 duration-150 text-foreground flex flex-col max-h-[80vh]">
        <button
          type="button"
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onClick={() => { if (!installing) onClose() }}
          disabled={installing}
        >
          <X className="size-3.5" />
        </button>

        <h3 className="text-sm font-semibold mb-4 shrink-0">模板管理</h3>

        {installing ? (
          <div className="flex-1 py-8 flex flex-col items-center justify-center text-center gap-3">
            <Loader2 className="size-6 text-primary animate-spin" />
            <div className="text-xs font-medium text-muted-foreground">{installProgress}</div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* GitHub 安装 */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">从 GitHub 安装</label>
              <div className="flex gap-2">
                <Input
                  value={githubUrl}
                  onChange={(e) => onGithubUrlChange(e.target.value)}
                  placeholder="owner/repo 或完整 URL"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={onInstall}
                  disabled={!githubUrl.trim()}
                >
                  安装
                </Button>
              </div>
            </div>

            {/* 本地自建 */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-muted-foreground">本地自建模板</label>
              <div className="flex gap-2">
                <Input
                  value={customTemplateName}
                  onChange={(e) => onCustomTemplateNameChange(e.target.value)}
                  placeholder="输入模板名称..."
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs shrink-0"
                  onClick={onCreateCustomTemplate}
                  disabled={!customTemplateName.trim()}
                >
                  创建
                </Button>
              </div>
            </div>
          </div>
        )}

        {!installing && (
          <div className="flex justify-between items-center pt-3 mt-3 border-t shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-[11px] h-7 gap-1 text-muted-foreground"
              onClick={async () => {
                try {
                  const { getSkillsDir } = await import("@/lib/output-workshop/market")
                  const path = await getSkillsDir()
                  await openPath(path)
                } catch (e) {
                  toast({ title: "打开目录失败", description: String(e), variant: "destructive" })
                }
              }}
            >
              打开目录
            </Button>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px] h-7 gap-1 text-muted-foreground"
                onClick={async () => {
                  await onRefreshTemplates()
                  toast({ title: "已刷新" })
                }}
              >
                <RefreshCw className="size-3" />
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-[11px] h-7"
                onClick={onClose}
              >
                关闭
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
