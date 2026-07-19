'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react'
import { getLatestLinkJobForMark, getLinkJobBundle, type LinkJobBundle } from '@/db/link-pipeline'
import { retryLinkOrganizationJob } from '@/lib/link-pipeline/organize-runner'
import { retryLinkCaptureJob } from '@/lib/link-pipeline/capture-runner'
import { isVideoTranscriptMark } from '@/lib/video-transcript-record'
import useMarkStore from '@/stores/mark'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'

export function LinkJobStatus({ markId, disabled = false }: { markId: number; disabled?: boolean }) {
  const [bundle, setBundle] = useState<LinkJobBundle | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const allMarks = useMarkStore(state => state.allMarks)
  const mark = allMarks.find(item => item.id === markId)
  const isVideoTranscript = mark ? isVideoTranscriptMark(mark) : false

  const loadStatus = useCallback(async () => {
    try {
      const job = await getLatestLinkJobForMark(markId)
      const nextBundle = job ? await getLinkJobBundle(job.id) : null
      setBundle(nextBundle)
      return nextBundle
    } catch {
      setBundle(null)
      return null
    }
  }, [markId])

  useEffect(() => {
    let disposed = false

    const handleJobUpdated = (event: { jobId: string; markId?: number }) => {
      if (!disposed && event.markId === markId) {
        void loadStatus()
      }
    }

    emitter.on('link-pipeline-job-updated', handleJobUpdated)
    void loadStatus()
    return () => {
      disposed = true
      emitter.off('link-pipeline-job-updated', handleJobUpdated)
    }
  }, [loadStatus, markId])

  const handleRetry = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!bundle || isRetrying || disabled) return

    setIsRetrying(true)
    try {
      if (bundle.job.currentStage === 'capture') {
        const outcome = await retryLinkCaptureJob(bundle.job.id)
        const { fetchAllMarks, fetchMarks } = useMarkStore.getState()
        await Promise.all([fetchMarks(), fetchAllMarks()])
        await loadStatus()
        if (outcome.status === 'succeeded') {
          toast({ title: '链接抓取完成', description: '网页正文已安全保存。' })
        } else if (outcome.status === 'failed') {
          toast({
            title: '链接抓取重试失败',
            description: outcome.error || '任务已保留，可稍后再次重试。',
            variant: 'destructive',
          })
        }
        return
      }
      const outcome = await retryLinkOrganizationJob(bundle.job.id)
      const { fetchAllMarks, fetchMarks } = useMarkStore.getState()
      await Promise.all([fetchMarks(), fetchAllMarks()])
      await loadStatus()

      if (outcome.status === 'succeeded') {
        toast({
          title: outcome.appliedToMark ? 'AI 整理完成' : 'AI 整理结果已保留',
          description: outcome.appliedToMark
            ? '记录已更新为结构化资料卡。'
            : '检测到正文已被编辑，因此没有自动覆盖。',
        })
      } else if (outcome.status === 'failed') {
        toast({
          title: 'AI 整理重试失败',
          description: outcome.error || '原始正文仍然安全保留。',
          variant: 'destructive',
        })
      }
    } finally {
      setIsRetrying(false)
    }
  }, [bundle, disabled, isRetrying, loadStatus])

  const job = bundle?.job
  if (!job || job.status === 'cancelled') return null
  const isCaptureStage = job.currentStage === 'capture'

  if (job.status === 'queued' || job.status === 'running' || isRetrying) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400"
        title={`${isCaptureStage ? '链接抓取' : 'AI 整理'}：${job.currentStage} ${job.progress}%`}
      >
        <Loader2 className="size-2.5 animate-spin" />
        {isCaptureStage ? '抓取' : 'AI'} {isRetrying ? '重试中' : `${job.progress}%`}
      </span>
    )
  }

  if (job.status === 'failed') {
    return (
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400"
        onClick={handleRetry}
        disabled={disabled}
        title={job.errorMessage || `${isCaptureStage ? '链接抓取' : 'AI 整理'}失败，点击重试`}
      >
        <RefreshCw className="size-2.5" />
        {isCaptureStage ? '链接抓取失败' : 'AI 整理失败'}
      </button>
    )
  }

  const activeOutput = bundle.outputs.find(output => output.isActive) || bundle.outputs[0]
  const hasOrganizedOutput = Boolean(activeOutput)
    || bundle.stages.some(stage => stage.stage === 'organize' && stage.status === 'succeeded')
  if (!hasOrganizedOutput) {
    // 视频转写记录的抓取结果即为最终内容（AI 总结在弹窗内按需触发），
    // 不存在单独的"整理"阶段，因此成功后无需常驻提示。
    if (isVideoTranscript) return null
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-500/10 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400"
        title="链接内容已提取并安全保存"
      >
        <Check className="size-2.5" />
        链接已提取
      </span>
    )
  }
  const hasConflict = activeOutput?.metadata?.conflict === true
  if (hasConflict) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
        title="AI 结果已保存为独立版本；当前记录因人工编辑未被覆盖。"
      >
        <AlertTriangle className="size-2.5" />
        结果待应用
      </span>
    )
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
      title="AI 整理已完成"
    >
      <Check className="size-2.5" />
      AI 已整理
    </span>
  )
}
