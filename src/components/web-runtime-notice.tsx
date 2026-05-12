'use client'

import { Button } from '@/components/ui/button'

interface WebRuntimeNoticeProps {
  compact?: boolean
}

export function WebRuntimeNotice({ compact = false }: WebRuntimeNoticeProps) {
  return (
    <div className={`flex min-h-screen w-full items-center justify-center bg-background px-6 ${compact ? 'py-10' : 'py-16'}`}>
      <div className="w-full max-w-2xl rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">需要桌面运行时</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">当前程序依赖 Tauri 桌面运行时</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              浏览器里现在只运行了 Next.js 前端。本地配置存储、文件系统、数据库、全局快捷键和原生窗口能力都依赖
              Tauri，所以普通浏览器标签页只能做受限预览。
            </p>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">完整启动方式</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-background px-3 py-2 text-sm text-foreground">
              <code>pnpm tauri dev</code>
            </pre>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              `pnpm dev` 可以用于前端样式预览，但不会提供当前程序真正需要的 Tauri 运行时。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/core/main'
                }
              }}
            >
              打开受限预览
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload()
                }
              }}
            >
              重新检测
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
