'use client'

import { Database, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import useVectorStore from '@/stores/vector'

interface VectorCalcProps {
  aiCompletionEnabled: boolean
  onToggleAICompletion: (enabled: boolean) => void
}

export function VectorCalc({
  aiCompletionEnabled,
  onToggleAICompletion
}: VectorCalcProps) {
  const { isProcessing, lastProcessTime, processAllDocuments } = useVectorStore()
  const [isHoveringVector, setIsHoveringVector] = useState(false)

  const formatLastProcessTime = (timestamp: number | null) => {
    if (!timestamp) return '未处理'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return '刚刚'
    if (diffMins < 60) return `${diffMins} 分钟前`
    if (diffHours < 24) return `${diffHours} 小时前`
    return `${diffDays} 天前`
  }

  const handleVectorProcess = useCallback(async () => {
    if (!isProcessing) {
      await processAllDocuments()
    }
  }, [isProcessing, processAllDocuments])

  return (
    <>
      {/* AI Completion Toggle */}
      <button
        onClick={() => onToggleAICompletion(!aiCompletionEnabled)}
        className={cn(
          'h-5 w-5 flex items-center justify-center rounded transition-colors',
          aiCompletionEnabled
            ? 'text-[#1677ff] bg-[#1677ff]/10'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
        title={aiCompletionEnabled ? 'AI 补全已启用' : 'AI 补全已禁用'}
      >
        <Sparkles size={12} />
      </button>

      {/* Vector Database Status */}
      <div
        className="relative"
        onMouseEnter={() => setIsHoveringVector(true)}
        onMouseLeave={() => setIsHoveringVector(false)}
      >
        <button
          onClick={handleVectorProcess}
          disabled={isProcessing}
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded transition-colors',
            isProcessing
              ? 'opacity-50 cursor-wait'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          title="知识库向量"
        >
          <Database size={12} className={cn(isProcessing && 'animate-spin')} />
        </button>

        {/* Hover tooltip */}
        {isHoveringVector && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-[hsl(var(--foreground))] text-[hsl(var(--background))] rounded text-[10px] whitespace-nowrap">
            {isProcessing
              ? '正在计算向量...'
              : `最后更新: ${formatLastProcessTime(lastProcessTime)}`}
          </div>
        )}
      </div>
    </>
  )
}

export default VectorCalc
