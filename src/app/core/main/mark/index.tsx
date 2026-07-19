'use client'

import React, { useState, useEffect } from "react"
import { TagManage } from './tag-manage'
import { MarkList } from './mark-list'
import { MarkToolbar } from './mark-toolbar'
import { MarkFilterPopover } from './mark-filter-popover'
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { toast } from '@/hooks/use-toast'
import { transcribeRecording } from '@/lib/audio'
import { extractAudioTrack, segmentAudio } from '@/lib/ffmpeg-wasm'
import { Sparkles } from 'lucide-react'
import { createAudioTranscriptionRecord } from '@/lib/audio-transcription-record'

export function NoteSidebar() {
  const {
    trashState,
    initRecordViewMode,
    fetchMarks,
    addQueue,
    setQueue,
    removeQueue
  } = useMarkStore()
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    initRecordViewMode()
  }, [initRecordViewMode])


  // 1. 处理拖入事件，监控是否是音视频文件
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (trashState) return // 回收站下不处理

    const items = Array.from(e.dataTransfer.items)
    const hasMedia = items.some(item =>
      item.kind === 'file' && (item.type.startsWith('audio/') || item.type.startsWith('video/') || /\.(mp3|mp4|m4a|wav|mov|webm|ogg|flac|aac)$/i.test(item.type))
    )

    if (hasMedia) {
      setIsDragging(true)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!trashState) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  // 2. 本地音视频 WASM 提取音轨并并发切片转录核心
  const processWasmTranscription = async (file: File) => {
    const queueId = `wasm-media-${Date.now()}`
    const formatSeconds = (val: number) => {
      const pad = (v: number) => String(v).padStart(2, '0')
      const total = Math.max(0, Math.floor(val))
      const mins = Math.floor(total / 60)
      const secs = total % 60
      return `${pad(mins)}:${pad(secs)}`
    }

    try {
      // 在侧边栏添加流式处理队列
      addQueue({
        queueId,
        tagId: currentTagId!,
        type: 'recording',
        progress: '加载 WASM 引擎 15%...',
        startTime: Date.now()
      })

      toast({
        title: '多媒体已装载 (WASM)',
        description: `状态：提取中。正在从「${file.name}」中安全提取并优化音轨...`,
      })

      // 第一步：调用 FFmpeg.wasm 提取音轨并降噪重采样（16kHz Mono MP3）
      const audioBlob = await extractAudioTrack(file, (progress) => {
        setQueue(queueId, { progress: `音轨提取中 ${progress}%...` })
      })

      setQueue(queueId, { progress: '极速切片分片中 40%...' })

      // 第二步：使用 WASM 快速无损切片（每 180s 一段，Whisper 最佳）
      const chunks = await segmentAudio(audioBlob, 180)

      let transcription = ''
      if (chunks.length === 0) {
        throw new Error('未提取到任何有效的音频流')
      } else if (chunks.length === 1) {
        setQueue(queueId, { progress: '语音识别中 60%...' })
        transcription = await transcribeRecording(chunks[0])
      } else {
        // 多片并发 Whisper 转录，展示优雅进度
        const transcriptions = new Array<string>(chunks.length)
        let finishedCount = 0

        setQueue(queueId, { progress: `并发识别中 0/${chunks.length}...` })

        await Promise.all(chunks.map(async (chunk, index) => {
          try {
            const chunkText = await transcribeRecording(chunk)
            if (chunkText && chunkText.trim()) {
              transcriptions[index] = `- ${formatSeconds(index * 180)} ${chunkText.trim()}`
            }
          } catch (chunkError) {
            console.error(`[WASM STT] Chunk ${index} failed:`, chunkError)
          }
          finishedCount += 1
          setQueue(queueId, {
            progress: `并发识别中 ${finishedCount}/${chunks.length} (${Math.round((finishedCount / chunks.length) * 45 + 50)}%)...`
          })
        }))

        transcription = transcriptions.filter(Boolean).join('\n\n')
      }

      if (!transcription || !transcription.trim()) {
        throw new Error('语音识别未捕获到有效文本')
      }

      // 第三步：将提取出的音频保存到 AppData recordings 下以支持卡片本地播放
      const saveLocalAudio = async (blob: Blob): Promise<string> => {
        const { exists, mkdir, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        const filename = `recording_${Date.now()}.mp3`
        const audioDir = 'recordings'

        if (!(await exists(audioDir, { baseDir: BaseDirectory.AppData }))) {
          await mkdir(audioDir, { baseDir: BaseDirectory.AppData, recursive: true })
        }

        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        const filePath = `${audioDir}/${filename}`
        await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })
        return filePath
      }

      const audioPath = await saveLocalAudio(audioBlob)

      // 第四步：先保存原始转写，再生成结构化会话纪要
      const recordResult = await createAudioTranscriptionRecord({
        tagId: currentTagId!,
        transcript: transcription,
        audioPath,
        sourceFileName: file.name,
        organize: true,
        onProgress: progress => setQueue(queueId, { progress }),
        onRawSaved: async () => {
          await fetchMarks()
          await fetchTags()
          getCurrentTag()
        },
      })

      // 清除队列与更新 UI
      removeQueue(queueId)
      await fetchMarks()
      await fetchTags()
      getCurrentTag()

      if (recordResult.organizationError) {
        toast({
          title: '转写已保存，智能纪要生成失败',
          description: '原始转写和音频已保留，可在详情页重新生成。',
          variant: 'destructive',
        })
      } else {
        toast({
          title: recordResult.conflict ? '转写已保存' : '会话纪要已生成',
          description: recordResult.conflict
            ? '检测到期间发生编辑，AI 结果未覆盖你的内容。'
            : '已整理重点、需求、决策、行动项与待确认问题。',
        })
      }

    } catch (error) {
      console.error('[WASM Drag Drop] Failed:', error)
      removeQueue(queueId)
      toast({
        title: '音视频拖拽转录失败',
        description: error instanceof Error ? error.message : '请重试',
        variant: 'destructive'
      })
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (trashState) return

    const files = Array.from(e.dataTransfer.files)
    const mediaFile = files.find(file =>
      file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|mp4|m4a|wav|mov|webm|ogg|flac|aac)$/i.test(file.name)
    )

    if (mediaFile) {
      void processWasmTranscription(mediaFile)
    }
  }

  return (
    <div
      id="record-sidebar"
      className="w-full h-full hidden md:flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 极富科技感的 WASM 拖拽上传蒙层 */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-4 bg-background/95 border-2 border-dashed border-primary/70 rounded-lg backdrop-blur-md transition-all animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3 text-center pointer-events-none select-none">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary animate-bounce">
              <Sparkles className="size-6 text-primary animate-pulse" />
            </div>
            <h3 className="text-sm font-semibold text-foreground tracking-normal">松开鼠标即可转录 🚀</h3>
            <p className="max-w-[200px] text-xs text-muted-foreground leading-5">
              视频 (MP4/MOV/WEBM) 与音频 (MP3/M4A/WAV) 将经由纯前端 WASM 智能提取，无任何系统依赖。
            </p>
          </div>
        </div>
      )}

      {trashState ? (
        <div className="flex-1 overflow-y-auto">
          <div className="border-b bg-background px-3 py-2">
            <MarkFilterPopover />
          </div>
          <MarkList />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TagManage />
        </div>
      )}

      <MarkToolbar />
    </div>
  )
}
