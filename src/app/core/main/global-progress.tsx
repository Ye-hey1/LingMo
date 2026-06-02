'use client'

import React, { useState, useEffect, useRef } from 'react'
import useMarkStore from '@/stores/mark'
import { 
  LoaderCircle, 
  ChevronUp, 
  ChevronDown, 
  Sparkles,
  Globe, 
  FileText, 
  Image as ImageIcon, 
  Video, 
  Mic, 
  Link
} from 'lucide-react'
import { useTranslations } from 'next-intl'

export function GlobalProgress() {
  const { queues } = useMarkStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeNow, setTimeNow] = useState(Date.now())
  const timer = useRef<NodeJS.Timeout>()
  const t = useTranslations('record.mark.type')

  // 定时刷新时间戳，用于计算各任务运行秒数
  useEffect(() => {
    if (queues && queues.length > 0) {
      timer.current = setInterval(() => {
        setTimeNow(Date.now())
      }, 1000)
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current)
      }
    }
  }, [queues])

  // 如果没有后台任务，则隐藏不渲染
  if (!queues || queues.length === 0) {
    return null
  }

  // 提取进度字符串中的百分比（例如：90% -> 90）
  const parsePercent = (progressStr: string): number | null => {
    const match = progressStr.match(/(\d+)%/)
    return match ? parseInt(match[1], 10) : null
  }

  const totalCount = queues.length
  const percentList = queues.map(q => parsePercent(q.progress)).filter((p): p is number => p !== null)
  const hasAvgPercent = percentList.length > 0
  const avgPercent = hasAvgPercent 
    ? Math.round(percentList.reduce((sum, val) => sum + val, 0) / percentList.length) 
    : 0

  // 根据类型获取更高级的图标
  const getTaskIcon = (type: string, className = "size-3.5") => {
    switch (type) {
      case 'link':
        return <Globe className={`${className} text-emerald-500`} />
      case 'file':
        return <FileText className={`${className} text-amber-500`} />
      case 'image':
        return <ImageIcon className={`${className} text-blue-500`} />
      case 'video':
        return <Video className={`${className} text-indigo-500`} />
      case 'recording':
        return <Mic className={`${className} text-rose-500`} />
      default:
        return <Link className={`${className} text-zinc-500`} />
    }
  }

  // 确定主显示文本信息
  const getMainMessage = () => {
    if (totalCount === 1) {
      return queues[0].progress
    }
    // 多任务时，找出当前进度最低或最近更新的任务作为主要提示
    return `正在处理 ${totalCount} 个后台任务...`
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[380px] max-w-[90vw] animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="relative overflow-hidden rounded-2xl border border-white/20 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-950/85 backdrop-blur-md shadow-2xl transition-all duration-300">
        
        {/* 精致头部信息栏 */}
        <div className="flex items-center justify-between p-3.5 gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="relative flex items-center justify-center size-7 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              {totalCount === 1 ? (
                getTaskIcon(queues[0].type, "size-4 animate-pulse")
              ) : (
                <Sparkles className="size-4 animate-pulse text-indigo-500" />
              )}
            </div>
            
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">
                  {totalCount === 1 ? `后台抓取分析中` : `多任务并行抓取中`}
                </span>
                {hasAvgPercent && (
                  <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-bold tabular-nums">
                    {avgPercent}%
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5" title={getMainMessage()}>
                {getMainMessage()}
              </p>
            </div>
          </div>

          {/* 展开/折叠控件 */}
          <div className="flex items-center gap-1">
            {totalCount > 1 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 dark:text-zinc-500 transition-colors"
                aria-label={isExpanded ? "收起明细" : "展开明细"}
              >
                {isExpanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </button>
            )}
          </div>
        </div>

        {/* 多任务展开明细列表 */}
        {isExpanded && totalCount > 1 && (
          <div className="border-t border-zinc-100 dark:border-zinc-800/40 max-h-[160px] overflow-y-auto divide-y divide-zinc-100/50 dark:divide-zinc-800/20 px-3.5 py-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
            {queues.map((queue) => {
              const runSeconds = Math.round((timeNow - queue.startTime) / 1000)
              return (
                <div key={queue.queueId} className="flex items-center justify-between py-2.5 gap-2 text-[11px]">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <LoaderCircle className="animate-spin size-3.5 text-blue-500 shrink-0" />
                    <span className="bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded text-[9px] shrink-0 font-bold">
                      {t(queue.type) || queue.type}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-300 truncate" title={queue.progress}>
                      {queue.progress}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono shrink-0 tabular-nums">
                    {runSeconds > 0 ? `${runSeconds}s` : '0s'}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 底部精美微细流光进度条 */}
        <div className="h-[3px] w-full bg-zinc-100 dark:bg-zinc-900/50 relative overflow-hidden shrink-0">
          {hasAvgPercent ? (
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 transition-all duration-500 relative rounded-full"
              style={{ width: `${avgPercent}%` }}
            >
              <div className="absolute inset-0 bg-white/25 animate-pulse" />
            </div>
          ) : (
            <div className="h-full bg-blue-500 animate-pulse w-full" />
          )}
        </div>
      </div>
    </div>
  )
}
