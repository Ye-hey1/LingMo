'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === 'string'
      ? error
      : String(error ?? '')

  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|importing a module script failed/i.test(message)
}

function reloadOnce() {
  if (typeof window === 'undefined') {
    return
  }

  const key = 'chunk-error-reload'
  const now = Date.now()
  const lastReload = Number(sessionStorage.getItem(key) || 0)
  if (now - lastReload < 3000) {
    return
  }

  sessionStorage.setItem(key, String(now))
  window.location.reload()
}

interface ChunkErrorBoundaryProps {
  children: React.ReactNode
  label?: string
}

interface ChunkErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ChunkErrorBoundary extends React.Component<ChunkErrorBoundaryProps, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      reloadOnce()
    }
  }

  handleRetry = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('chunk-error-reload')
      window.location.reload()
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { error } = this.state
    const chunkError = isChunkLoadError(error)
    const title = this.props.label || '编辑器内容'
    const message = chunkError
      ? '资源加载失败，正在尝试恢复。'
      : error?.message || '内容渲染失败。'

    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-background p-5 text-center shadow-sm">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="size-5" />
          </div>
          <div className="text-base font-medium">{title}出现异常</div>
          <div className="mt-2 text-sm text-muted-foreground">{message}</div>
          <div className="mt-4 flex justify-center">
            <Button type="button" variant="outline" size="sm" onClick={this.handleRetry}>
              <RefreshCw className="mr-2 size-4" />
              重新加载
            </Button>
          </div>
        </div>
      </div>
    )
  }
}

export default ChunkErrorBoundary
