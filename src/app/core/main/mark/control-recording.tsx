import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import useRecordingStore from "@/stores/recording"
import { Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { transcribeRecording } from '@/lib/audio'
import { extractAudioTrack, segmentAudio } from '@/lib/ffmpeg-wasm'
import { useRouter } from 'next/navigation'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { useRef } from 'react'
import { isMobileDevice } from '@/lib/check'
import { convertToWav } from '@/lib/audio-converter'
import { useEffect } from 'react'
import emitter from '@/lib/emitter'
import { handleRecordComplete } from '@/lib/record-navigation'

export function ControlRecording() {
  const t = useTranslations();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();
  const lastClickTime = useRef<number>(0);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()
  
  // 大模型录音
  const {
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useRecordingStore()
  
  // 监听快捷键
  useEffect(() => {
    const handleToggleRecording = () => {
      if (isRecording) {
        handleStop()
      } else {
        handleStart()
      }
    }
    
    emitter.on('toolbar-shortcut-recording', handleToggleRecording)
    return () => {
      emitter.off('toolbar-shortcut-recording', handleToggleRecording)
    }
  }, [isRecording])

  // 格式化录音时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // 开始录音
  const handleStart = async () => {
    try {
      await startRecording()
      
      // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
      handleRecordComplete(router)
    } catch (error) {
      cancelRecording()
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  // 停止录音
  const handleStop = async () => {
    try {
      const audioBlob = await stopRecording()
      if (!audioBlob) {
        throw new Error(t('recording.noAudioData'))
      }
      
      // 转换为 WAV 格式
      const wavBlob = await convertToWav(audioBlob)
      
      // 创建队列ID
      const queueId = `recording-${Date.now()}`
      
      // 添加到队列中显示识别中的状态
      addQueue({
        queueId,
        tagId: currentTagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // 后台异步识别（使用转换后的 WAV）
      processTranscription(wavBlob, queueId)
      
    } catch (error) {
      console.error('停止录音失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  // 后台处理识别（升级为高性能 WASM 媒体抽取与切片版本）
  const processTranscription = async (
    mediaBlob: Blob,
    queueId: string,
  ) => {
    const formatSeconds = (val: number) => {
      const pad = (v: number) => String(v).padStart(2, '0')
      const total = Math.max(0, Math.floor(val))
      const mins = Math.floor(total / 60)
      const secs = total % 60
      return `${pad(mins)}:${pad(secs)}`
    }

    try {
      // 先验证 Blob 是否有效
      if (!mediaBlob || mediaBlob.size === 0) {
        throw new Error('多媒体文件数据为空')
      }
      
      toast({
        title: '多媒体已载入 (WASM)',
        description: '状态：提取中。正在使用 WASM 引擎优化抽取并标准化音轨...',
      })

      // 1. 调用 WASM 前端引擎提取标准化音轨（16kHz Mono MP3）
      const audioBlob = await extractAudioTrack(mediaBlob, (progress) => {
        setQueue(queueId, { progress: `音轨提取中 ${progress}%...` })
      })

      setQueue(queueId, { progress: '极速切片分片中 40%...' })

      // 2. 使用 WASM 进行高速音频无损分片
      const chunks = await segmentAudio(audioBlob, 180)
      
      let transcription = ''
      if (chunks.length === 0) {
        throw new Error('未提取到任何有效音频数据')
      } else if (chunks.length === 1) {
        setQueue(queueId, { progress: '语音识别中 60%...' })
        transcription = await transcribeRecording(chunks[0])
      } else {
        // 多片并发 Whisper 转录
        const transcriptions = new Array<string>(chunks.length)
        let finished = 0
        
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
          finished += 1
          setQueue(queueId, { 
            progress: `并发识别中 ${finished}/${chunks.length} (${Math.round((finished / chunks.length) * 45 + 50)}%)...` 
          })
        }))
        
        transcription = transcriptions.filter(Boolean).join('\n\n')
      }

      if (!transcription || !transcription.trim()) {
        throw new Error('未检测到有效的语音文本')
      }

      // 3. 将标准化音轨保存为本地 recordings 文件以支持卡片本地播放
      const saveLocalAudioFile = async (blob: Blob): Promise<string> => {
        const timestamp = Date.now()
        const filename = `recording_${timestamp}.mp3`
        const audioDir = 'recordings'
        
        const dirExists = await exists(audioDir, { baseDir: BaseDirectory.AppData })
        if (!dirExists) {
          await mkdir(audioDir, { baseDir: BaseDirectory.AppData, recursive: true })
        }
        
        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        const filePath = `${audioDir}/${filename}`
        await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })
        return filePath
      }

      const audioPath = await saveLocalAudioFile(audioBlob)
      
      // 4. 插入记录
      await insertMark({
        tagId: currentTagId!,
        type: 'recording',
        desc: transcription.substring(0, 100),
        content: transcription,
        url: audioPath
      })
      
      removeQueue(queueId)
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
      
      toast({
        title: '音视频文件转录完成',
        description: `已成功保存为语音记录。双击即可查阅并一键直绘精美卡片！`,
      })

    } catch (error) {
      console.error('[WASM Media Select] Failed:', error)
      removeQueue(queueId)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : '转写识别失败，请重试',
        variant: 'destructive'
      })
    }
  }
  
  // 选择音频文件并识别
  const handleFileSelect = async () => {
    try {
      // 移动端使用 HTML5 file input
      if (isMobile) {
        fileInputRef.current?.click()
        return
      }

      // PC端使用 Tauri dialog
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Media',
          extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma', 'webm', 'mp4', 'mov']
        }]
      })

      if (!selected) return

      // 读取文件
      const filePath = selected as string
      const fileData = await readFile(filePath)
      
      // 根据文件扩展名确定 MIME 类型
      const extension = filePath.split('.').pop()?.toLowerCase()
      const mimeType = extension === 'wav' ? 'audio/wav' :
                      extension === 'mp3' ? 'audio/mpeg' :
                      extension === 'm4a' ? 'audio/mp4' :
                      extension === 'mp4' ? 'audio/mp4' :
                      extension === 'ogg' ? 'audio/ogg' :
                      extension === 'webm' ? 'audio/webm' :
                      'audio/mpeg'
      
      // 将 Uint8Array 转换为 ArrayBuffer
      const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
      const audioBlob = new Blob([buffer], { type: mimeType })

      // 创建队列ID
      const queueId = `recording-${Date.now()}`
      
      // 添加到队列中显示识别中的状态
      addQueue({
        queueId,
        tagId: currentTagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // 后台异步识别
      processTranscription(audioBlob, queueId)
      
    } catch (error) {
      console.error('文件选择失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : '文件选择失败',
        variant: 'destructive'
      })
    }
  }
  
  // 处理移动端文件选择
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      // 创建队列ID
      const queueId = `recording-${Date.now()}`
      
      // 添加到队列中显示识别中的状态
      addQueue({
        queueId,
        tagId: currentTagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // 后台异步识别（File 对象就是 Blob，直接传递）
      processTranscription(file, queueId)
      
      // 重置 input
      event.target.value = ''
    } catch (error) {
      console.error('文件处理失败:', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : '文件处理失败',
        variant: 'destructive'
      })
    }
  }

  // 处理点击事件（单击录音，双击选择文件）
  const handleClick = () => {
    const now = Date.now()
    const timeSinceLastClick = now - lastClickTime.current
    
    // 双击判定：300ms内的第二次点击
    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      // 双击：取消单击的延迟执行，直接选择文件
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      lastClickTime.current = 0 // 重置，避免三连击
      handleFileSelect()
    } else {
      // 单击：延迟执行，等待可能的第二次点击
      lastClickTime.current = now
      
      // 清除之前的定时器
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
      }
      
      // 延迟300ms执行单击操作，如果期间有第二次点击则会被取消
      clickTimer.current = setTimeout(() => {
        if (isRecording) {
          handleStop()
        } else {
          handleStart()
        }
        clickTimer.current = null
      }, 300)
    }
  }
  
  // 生成tooltip文本
  const getTooltipText = () => {
    if (isRecording) {
      return `${t('recording.recording')} ${formatDuration(recordingDuration)}`
    }
    return `${t('record.mark.type.recording')} (${t('recording.doubleClickToSelectFile')})`
  }

  return (
    <>
      {/* 移动端文件选择 */}
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.wma,.webm,.mp4,.mov"
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}
      
      <Tooltip>
        <TooltipTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={handleClick}
          className={`relative ${isRecording ? 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950' : ''}`}
        >
          <Mic className="size-4" />
          {isRecording && (
            <span className="absolute top-1 right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
      </Tooltip>
    </>
  )
}
