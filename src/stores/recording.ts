import { create } from 'zustand'

interface RecordingState {
  // 录音状态
  isStarting: boolean
  isRecording: boolean
  isPaused: boolean
  recordingDuration: number // 录音时长（秒）

  // 录音数据
  audioChunks: Blob[]
  mediaRecorder: MediaRecorder | null
  mediaStream: MediaStream | null
  mimeType: string
  recordingOwnerId: string | null
  startRequestId: number

  // 计时器
  timerId?: NodeJS.Timeout

  // 控制方法
  startRecording: (ownerId?: string) => Promise<void>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: (ownerId?: string) => Promise<Blob | null>
  cancelRecording: (ownerId?: string) => void
  
  // 内部方法
  setRecordingDuration: (duration: number) => void
  resetState: () => void
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop())
}

function isOwnerMismatch(currentOwnerId: string | null, requestedOwnerId?: string) {
  return Boolean(requestedOwnerId && currentOwnerId !== requestedOwnerId)
}

const useRecordingStore = create<RecordingState>((set, get) => ({
  isStarting: false,
  isRecording: false,
  isPaused: false,
  recordingDuration: 0,
  audioChunks: [],
  mediaRecorder: null,
  mediaStream: null,
  mimeType: '',
  recordingOwnerId: null,
  startRequestId: 0,

  setRecordingDuration: (duration) => set({ recordingDuration: duration }),

  startRecording: async (ownerId) => {
    const initialState = get()
    if (initialState.isStarting || initialState.isRecording) {
      throw new Error('已有录音任务正在进行，请先停止当前录音')
    }

    const startRequestId = initialState.startRequestId + 1
    set({
      isStarting: true,
      recordingOwnerId: ownerId || null,
      startRequestId,
    })

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前环境不支持麦克风录音，请检查 Android WebView 或应用权限配置')
      }

      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const currentStartState = get()
      if (
        !currentStartState.isStarting ||
        currentStartState.startRequestId !== startRequestId ||
        isOwnerMismatch(currentStartState.recordingOwnerId, ownerId)
      ) {
        stopMediaStream(stream)
        throw new Error('录音已取消')
      }
      
      // 优先尝试更兼容的格式
      let mimeType = 'audio/webm'
      const supportedTypes = [
        'audio/wav',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm'
      ]
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          break
        }
      }
      
      // 创建MediaRecorder实例
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      
      const chunks: Blob[] = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      
      mediaRecorder.onstop = () => stopMediaStream(stream)
      
      mediaRecorder.start()
      
      // 启动计时器，保存到 state
      const timerId = setInterval(() => {
        const state = get()
        if (state.isRecording && !state.isPaused) {
          set({ recordingDuration: state.recordingDuration + 1 })
        } else {
          // 暂停时清除计时器
          clearInterval(state.timerId)
          set({ timerId: undefined })
        }
      }, 1000)

      set({
        isStarting: false,
        isRecording: true,
        isPaused: false,
        audioChunks: chunks,
        mediaRecorder,
        mediaStream: stream,
        mimeType,
        recordingOwnerId: ownerId || null,
        recordingDuration: 0,
        timerId
      })
      
    } catch (error) {
      console.error('启动录音失败:', error)
      const currentState = get()
      if (
        currentState.isStarting &&
        currentState.startRequestId === startRequestId &&
        !isOwnerMismatch(currentState.recordingOwnerId, ownerId)
      ) {
        get().resetState()
      }
      
      // 根据错误类型提供更具体的错误信息
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('麦克风权限被拒绝，请在系统设置中允许灵墨访问麦克风')
        } else if (error.name === 'NotFoundError') {
          throw new Error('未检测到麦克风设备，请连接麦克风后重试')
        } else if (error.name === 'NotReadableError') {
          throw new Error('麦克风正在被其他应用使用，请关闭其他应用后重试')
        }
      }
      
      throw new Error('无法启动录音，请检查麦克风设备和权限设置')
    }
  },

  pauseRecording: () => {
    const { mediaRecorder, timerId } = get()
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
      // 暂停时清除计时器
      if (timerId) {
        clearInterval(timerId)
      }
      set({ isPaused: true, timerId: undefined })
    }
  },

  resumeRecording: () => {
    const { mediaRecorder } = get()
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
      set({ isPaused: false })
    }
  },

  stopRecording: async (ownerId): Promise<Blob | null> => {
    const { mediaRecorder, mediaStream, audioChunks, mimeType, recordingOwnerId, timerId } = get()

    if (isOwnerMismatch(recordingOwnerId, ownerId)) {
      return null
    }

    // 停止时清除计时器
    if (timerId) {
      clearInterval(timerId)
    }

    if (!mediaRecorder) {
      return null
    }
    
    return new Promise((resolve) => {
      const finish = () => {
        stopMediaStream(mediaStream)
        const audioBlob = new Blob(audioChunks, { type: mimeType || mediaRecorder.mimeType || 'audio/webm' })
        get().resetState()
        resolve(audioBlob)
      }

      mediaRecorder.onstop = finish
      
      if (mediaRecorder.state === 'inactive') {
        finish()
      } else {
        mediaRecorder.stop()
      }
    })
  },

  cancelRecording: (ownerId) => {
    const { mediaRecorder, recordingOwnerId } = get()

    if (isOwnerMismatch(recordingOwnerId, ownerId)) {
      return
    }
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
    
    get().resetState()
  },

  resetState: () => {
    const { timerId, mediaStream, startRequestId } = get()
    // 重置时清除计时器
    if (timerId) {
      clearInterval(timerId)
    }
    stopMediaStream(mediaStream)
    set({
      isStarting: false,
      isRecording: false,
      isPaused: false,
      recordingDuration: 0,
      audioChunks: [],
      mediaRecorder: null,
      mediaStream: null,
      mimeType: '',
      recordingOwnerId: null,
      startRequestId: startRequestId + 1,
      timerId: undefined
    })
  }
}))

export default useRecordingStore
