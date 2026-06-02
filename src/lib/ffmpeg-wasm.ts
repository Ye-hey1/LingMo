import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

/**
 * 获取并异步加载纯前端 FFmpeg.wasm 单例
 */
export async function getFFmpegInstance(onProgress?: (progress: number) => void): Promise<FFmpeg> {
  if (ffmpegInstance) {
    return ffmpegInstance
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg()

    ffmpeg.on('progress', ({ progress }) => {
      onProgress?.(Math.round(progress * 100))
    })

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg.wasm]', message)
    })

    // 从 unpkg 的 UMD 加载静态核心 WebAssembly 库
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })

    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  try {
    return await loadingPromise
  } catch (error) {
    loadingPromise = null
    throw error
  }
}

/**
 * 提取多媒体文件中的音轨并重采样标准化为 Whisper 最佳格式
 * @param mediaBlob 原始音视频 Blob (支持 mp4, mov, wav, mp3, webm 等)
 * @param onProgress 进度回调函数
 */
export async function extractAudioTrack(
  mediaBlob: Blob,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  if (!mediaBlob || mediaBlob.size === 0) {
    throw new Error('原始媒体文件内容为空')
  }

  const ffmpeg = await getFFmpegInstance(onProgress)
  const arrayBuffer = await mediaBlob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  // 1. 写入原始文件至虚拟内存中
  await ffmpeg.writeFile('input_media', bytes)

  // 2. 执行音轨转换与高标准降噪重采样
  // -vn: 剔除视频
  // -ac 1: 强制单声道，Whisper 识别极佳
  // -ar 16000: 采样率固定 16kHz，Whisper 精准度最高
  // -b:a 48k: 体积与音质的最佳折中
  await ffmpeg.exec([
    '-i', 'input_media',
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '48k',
    'output.mp3'
  ])

  // 3. 读取字节并构建 Blob
  const data = (await ffmpeg.readFile('output.mp3')) as Uint8Array
  const outputBlob = new Blob([data], { type: 'audio/mp3' })

  // 4. 清理内存缓存
  try {
    await ffmpeg.deleteFile('input_media')
    await ffmpeg.deleteFile('output.mp3')
  } catch {
    // 忽略删除异常
  }

  return outputBlob
}

/**
 * 将长音频按无损音频流分割为多片，以绕过 Whisper 大小限制并支持并发转写
 * @param audioBlob 提取出的标准化音频 Blob
 * @param chunkDurationSeconds 每片时间长度（默认 180s）
 */
export async function segmentAudio(
  audioBlob: Blob,
  chunkDurationSeconds = 180
): Promise<Blob[]> {
  if (!audioBlob || audioBlob.size === 0) {
    return []
  }

  const ffmpeg = await getFFmpegInstance()
  const arrayBuffer = await audioBlob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  // 1. 写入临时文件
  await ffmpeg.writeFile('input_audio.mp3', bytes)

  // 2. 进行无损无噪高速分片 (-c copy 零硬件转码压力)
  // -f segment: 采用分片复用器
  // -reset_timestamps 1: 每个分片重置时间戳，确保 Whisper 不会产生拼合偏差
  await ffmpeg.exec([
    '-i', 'input_audio.mp3',
    '-f', 'segment',
    '-segment_time', String(chunkDurationSeconds),
    '-reset_timestamps', '1',
    '-c', 'copy',
    'chunk-%03d.mp3'
  ])

  const chunks: Blob[] = []
  let index = 0

  // 3. 按序读取切片
  while (true) {
    const filename = `chunk-${String(index).padStart(3, '0')}.mp3`
    try {
      const data = (await ffmpeg.readFile(filename)) as Uint8Array
      if (data && data.length > 0) {
        chunks.push(new Blob([data], { type: 'audio/mp3' }))
        await ffmpeg.deleteFile(filename)
      } else {
        break
      }
    } catch {
      // 文件检索完毕时，捕获异常直接跳出
      break
    }
    index += 1
  }

  // 4. 清理输入缓存
  try {
    await ffmpeg.deleteFile('input_audio.mp3')
  } catch {
    // ignore
  }

  return chunks
}
