"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { NO_TRANSCRIPTION_MESSAGE, transcribeRecording } from "@/lib/audio"
import { polishDictationText, type DictationPolishMode } from "@/lib/ai/dictation-polish"
import { toast } from "@/hooks/use-toast"
import useRecordingStore from "@/stores/recording"

export type ChatDictationPhase = "idle" | "starting" | "listening" | "transcribing" | "polishing"

interface UseChatDictationOptions {
  blocked?: boolean
  sttModel: string
  polishMode?: DictationPolishMode
  onTranscript: (text: string) => void
}

const CHAT_VOICE_TRANSCRIPTION_EMPTY_MESSAGE = "没有识别到内容，请靠近麦克风后再试一次。"
const CHAT_DICTATION_OWNER_ID = "chat-input-dictation"
const CHAT_VOICE_MODEL_MISSING_MESSAGE = "请先在设置 > 音频里配置语音识别模型。"
const CHAT_DICTATION_START_TIMEOUT_MS = 12000
const CHAT_DICTATION_START_TIMEOUT_MESSAGE = "录音启动超时，请检查麦克风权限弹窗或系统权限设置。"

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

function withStartTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(CHAT_DICTATION_START_TIMEOUT_MESSAGE))
    }, CHAT_DICTATION_START_TIMEOUT_MS)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
}

export function useChatDictation({
  blocked = false,
  sttModel,
  polishMode = "raw",
  onTranscript,
}: UseChatDictationOptions) {
  const {
    isStarting,
    isRecording,
    recordingOwnerId,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useRecordingStore()
  const [phase, setPhase] = useState<ChatDictationPhase>("idle")
  const [ownsRecording, setOwnsRecording] = useState(false)
  const sessionIdRef = useRef(0)
  const polishAbortRef = useRef<AbortController | null>(null)
  const polishModeRef = useRef(polishMode)
  const pendingStopRef = useRef(false)
  const ownsRecordingRef = useRef(false)
  const mountedRef = useRef(true)

  const isListening = ownsRecording && isRecording && phase === "listening"
  const isOtherRecordingActive = (isStarting || isRecording)
    && recordingOwnerId !== CHAT_DICTATION_OWNER_ID
    && !ownsRecording
  const formattedDuration = formatDuration(recordingDuration)

  const clearOwnedRecording = useCallback(() => {
    ownsRecordingRef.current = false
    setOwnsRecording(false)
  }, [])

  const abortPolish = useCallback(() => {
    polishAbortRef.current?.abort()
    polishAbortRef.current = null
  }, [])

  const stopSession = useCallback(async (sessionId = sessionIdRef.current) => {
    if (!ownsRecordingRef.current && !ownsRecording) {
      return
    }

    let activeTask: "transcribing" | "polishing" = "transcribing"
    setPhase("transcribing")

    try {
      const audioBlob = await stopRecording(CHAT_DICTATION_OWNER_ID)

      if (!mountedRef.current || sessionIdRef.current !== sessionId) {
        return
      }

      clearOwnedRecording()

      if (!audioBlob) {
        toast({
          title: "语音识别失败",
          description: "没有录到音频数据。",
          variant: "destructive",
        })
        return
      }

      const transcript = await transcribeRecording(audioBlob)

      if (!mountedRef.current || sessionIdRef.current !== sessionId) {
        return
      }

      if (!transcript.trim()) {
        toast({
          title: "语音识别为空",
          description: sttModel ? CHAT_VOICE_TRANSCRIPTION_EMPTY_MESSAGE : NO_TRANSCRIPTION_MESSAGE,
          variant: "destructive",
        })
        return
      }

      let finalText = transcript
      const activePolishMode = polishModeRef.current
      if (activePolishMode !== "raw") {
        activeTask = "polishing"
        setPhase("polishing")
        abortPolish()
        const polishAbortController = new AbortController()
        polishAbortRef.current = polishAbortController

        finalText = await polishDictationText({
          text: transcript,
          mode: activePolishMode,
          signal: polishAbortController.signal,
        })

        if (polishAbortRef.current === polishAbortController) {
          polishAbortRef.current = null
        }

        if (!mountedRef.current || sessionIdRef.current !== sessionId) {
          return
        }
      }

      onTranscript(finalText)
    } catch (error) {
      if (mountedRef.current && sessionIdRef.current === sessionId) {
        console.error("聊天语音识别失败:", error)
        toast({
          title: activeTask === "polishing" ? "语音整理失败" : "语音识别失败",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        })
      }
    } finally {
      if (mountedRef.current && sessionIdRef.current === sessionId) {
        pendingStopRef.current = false
        abortPolish()
        clearOwnedRecording()
        setPhase("idle")
      }
    }
  }, [abortPolish, clearOwnedRecording, onTranscript, ownsRecording, sttModel, stopRecording])

  const startSession = useCallback(async () => {
    if (blocked || phase === "transcribing" || phase === "polishing" || isOtherRecordingActive) {
      return
    }

    if (!sttModel) {
      toast({
        title: "未配置语音识别模型",
        description: CHAT_VOICE_MODEL_MISSING_MESSAGE,
        variant: "destructive",
      })
      return
    }

    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId
    abortPolish()
    pendingStopRef.current = false
    setPhase("starting")

    try {
      await withStartTimeout(startRecording(CHAT_DICTATION_OWNER_ID))

      if (!mountedRef.current || sessionIdRef.current !== sessionId) {
        cancelRecording(CHAT_DICTATION_OWNER_ID)
        return
      }

      ownsRecordingRef.current = true
      setOwnsRecording(true)

      if (pendingStopRef.current) {
        await stopSession(sessionId)
        return
      }

      setPhase("listening")
    } catch (error) {
      if (mountedRef.current && sessionIdRef.current === sessionId) {
        pendingStopRef.current = false
        clearOwnedRecording()
        setPhase("idle")
        cancelRecording(CHAT_DICTATION_OWNER_ID)
        toast({
          title: "无法开始录音",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        })
      }
    }
  }, [
    blocked,
    abortPolish,
    cancelRecording,
    clearOwnedRecording,
    isOtherRecordingActive,
    phase,
    startRecording,
    stopSession,
    sttModel,
  ])

  const cancel = useCallback(() => {
    sessionIdRef.current += 1
    pendingStopRef.current = false
    abortPolish()

    const recordingState = useRecordingStore.getState()
    if (
      recordingState.recordingOwnerId === CHAT_DICTATION_OWNER_ID &&
      (recordingState.isStarting || recordingState.isRecording)
    ) {
      cancelRecording(CHAT_DICTATION_OWNER_ID)
    }

    clearOwnedRecording()
    setPhase("idle")
  }, [abortPolish, cancelRecording, clearOwnedRecording])

  const toggle = useCallback(() => {
    if (phase === "starting") {
      cancel()
      return
    }

    if (isListening) {
      void stopSession()
      return
    }

    if (phase === "idle") {
      void startSession()
    }
  }, [cancel, isListening, phase, startSession, stopSession])

  useEffect(() => {
    polishModeRef.current = polishMode
  }, [polishMode])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      const recordingState = useRecordingStore.getState()
      if (
        recordingState.recordingOwnerId === CHAT_DICTATION_OWNER_ID &&
        (recordingState.isStarting || recordingState.isRecording)
      ) {
        cancelRecording(CHAT_DICTATION_OWNER_ID)
      }
      abortPolish()
    }
  }, [abortPolish, cancelRecording])

  return {
    phase,
    isActive: phase !== "idle",
    isListening,
    isOtherRecordingActive,
    formattedDuration,
    recordingDuration,
    toggle,
    cancel,
  }
}
