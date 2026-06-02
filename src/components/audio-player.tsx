'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs'

interface AudioPlayerProps {
  audioPath: string
  compact?: boolean
}

export function AudioPlayer({ audioPath, compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioSrc, setAudioSrc] = useState<string>('')
  const [isReady, setIsReady] = useState(false)
  const [isError, setIsError] = useState(false)

  // 加载音频文件
  useEffect(() => {
    let blobUrl: string | null = null
    
    const loadAudio = async () => {
      try {
        setIsError(false)
        // 读取音频文件
        const fileData = await readFile(audioPath, { baseDir: BaseDirectory.AppData })
        
        // 根据文件扩展名确定 MIME 类型
        const extension = audioPath.split('.').pop()?.toLowerCase()
        const mimeType = extension === 'mp4' ? 'audio/mp4' :
                        extension === 'webm' ? 'audio/webm' :
                        extension === 'ogg' ? 'audio/ogg' :
                        extension === 'wav' ? 'audio/wav' :
                        extension === 'm4a' ? 'audio/mp4' :
                        extension === 'mp3' ? 'audio/mpeg' :
                        'audio/webm'
        
        // 创建 Blob URL
        const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
        const blob = new Blob([buffer], { type: mimeType })
        blobUrl = URL.createObjectURL(blob)
        
        setAudioSrc(blobUrl)
      } catch (error) {
        // 将 console.error 改为 console.warn，防止 Next.js 报错弹出红色 Overlay 阻挡用户操作
        console.warn('加载音频失败:', error, '路径:', audioPath)
        setIsError(true)
      }
    }
    
    loadAudio()
    
    // 清理函数
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [audioPath])


  // 播放/暂停
  const togglePlay = async () => {
    if (!audioRef.current || !isReady) return
    
    try {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        await audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    } catch (error) {
      console.error('播放失败:', error)
      setIsPlaying(false)
    }
  }

  // 进度调整
  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return
    const newTime = value[0]
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  // 格式化时间
  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) {
      return '0:00'
    }
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // 若音频加载失败，显示友好提示
  if (isError) {
    if (compact) {
      return (
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="size-5 shrink-0 text-destructive/50"
          title="音频文件不存在或已损坏"
        >
          <Play className="size-3 text-zinc-400" />
        </Button>
      )
    }

    return (
      <div className="w-full py-1.5 px-3 bg-red-500/10 text-red-600 dark:text-red-400 rounded text-center text-xs font-medium border border-red-500/20">
        音频源文件已丢失或不存在
      </div>
    )
  }

  // 如果音频源未加载，显示加载提示
  if (!audioSrc) {
    if (compact) {
      return (
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="size-5 shrink-0"
        >
          <Play className="size-3" />
        </Button>
      )
    }

    return (
      <div className="w-full py-1 px-2 bg-muted/30 rounded text-center text-xs text-muted-foreground">
        加载音频中...
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex items-center">
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const duration = e.currentTarget.duration
            setDuration(duration)
            setIsReady(true)
          }}
          onCanPlay={() => {
            setIsReady(true)
          }}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={(e) => {
            console.error('音频加载错误:', e.currentTarget.error)
            setIsReady(false)
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePlay}
          disabled={!isReady}
          className="size-5 shrink-0"
        >
          {isPlaying ? (
            <Pause className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full flex items-center gap-1.5 py-1 pl-2 bg-muted/30 rounded">
      {/* 音频元素 */}
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const duration = e.currentTarget.duration
          setDuration(duration)
          setIsReady(true)
        }}
        onCanPlay={() => {
          setIsReady(true)
        }}
        onEnded={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={(e) => {
          console.error('音频加载错误:', e.currentTarget.error)
          setIsReady(false)
        }}
        onLoadStart={() => {}}
        onLoadedData={() => {}}
      />

      {/* 播放/暂停按钮 */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        disabled={!isReady}
        className="size-3 shrink-0"
      >
        {isPlaying ? (
          <Pause className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
      </Button>

      {/* 当前时间 */}
      <span className="text-xs text-muted-foreground shrink-0 w-9 text-right">
        {formatTime(currentTime)}
      </span>

      {/* 进度条 */}
      <Slider
        value={[currentTime]}
        max={duration || 100}
        step={0.1}
        onValueChange={handleSeek}
        className="flex-1 cursor-pointer"
      />

      {/* 总时长 */}
      <span className="text-xs text-muted-foreground shrink-0 w-9">
        {formatTime(duration)}
      </span>
    </div>
  )
}
