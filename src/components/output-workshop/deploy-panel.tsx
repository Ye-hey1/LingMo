"use client"

import * as React from "react"
import { Globe, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/hooks/use-toast"
import { openUrl } from "@tauri-apps/plugin-opener"

interface DeployPanelProps {
  showDeployModal: boolean
  isDeploying: boolean
  deployProgress: string
  deployedUrl: string
  vercelToken: string
  onVercelTokenChange: (token: string) => void
  onDeploy: () => void
  onClose: () => void
}

export function DeployPanel({
  showDeployModal,
  isDeploying,
  deployProgress,
  deployedUrl,
  vercelToken,
  onVercelTokenChange,
  onDeploy,
  onClose,
}: DeployPanelProps) {
  if (!showDeployModal) return null

  return (
    <div className="shrink-0 border-t bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-2.5">
        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          {isDeploying ? <Loader2 className="size-4 animate-spin text-primary" /> : <Globe className="size-4 text-primary" />}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Vercel 部署</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {deployedUrl || deployProgress || "输入 Token 后即可部署当前生成页"}
            </div>
          </div>
        </div>

        {!deployedUrl && (
          <Input
            type="password"
            value={vercelToken}
            onChange={(e) => {
              onVercelTokenChange(e.target.value)
              localStorage.setItem("lingmo_vercel_token", e.target.value)
            }}
            placeholder="Vercel API Token"
            className="h-8 min-w-[260px] flex-1 text-xs shadow-none"
            disabled={isDeploying}
          />
        )}

        {deployedUrl && (
          <Input readOnly value={deployedUrl} className="h-8 min-w-[260px] flex-1 select-all font-mono text-xs shadow-none" />
        )}

        <div className="flex items-center gap-2">
          {deployedUrl ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs shadow-none"
                onClick={async () => {
                  try {
                    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager")
                    await writeText(deployedUrl)
                  } catch {
                    await navigator.clipboard.writeText(deployedUrl)
                  }
                  toast({ title: "链接已复制到剪贴板" })
                }}
              >
                复制链接
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs shadow-none"
                onClick={async () => {
                  try {
                    await openUrl(deployedUrl)
                  } catch {
                    window.open(deployedUrl, "_blank")
                  }
                }}
              >
                打开
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-8 gap-1 text-xs shadow-none" onClick={onDeploy} disabled={!vercelToken.trim() || isDeploying}>
              {isDeploying ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
              开始部署
            </Button>
          )}
          <Button size="sm" variant="ghost" className="size-8 p-0" onClick={onClose} disabled={isDeploying}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
