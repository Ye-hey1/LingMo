'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import React, { useEffect, useRef, useState } from 'react'
import { Play, Pause, FileText, Video, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilePreviewAttrs {
  src: string
  name: string
  type: 'audio' | 'video' | 'pdf' | 'file'
  size: string
}

function FilePreviewView({ node }: ReactNodeViewProps) {
  const { src, name, type, size } = node.attrs as FilePreviewAttrs
  
  // 音频播放控制相关状态
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (type !== 'audio') return

    const audio = new Audio(src)
    audioRef.current = audio

    const updateTime = () => setCurrentTime(audio.currentTime)
    const updateDuration = () => setDuration(audio.duration || 0)
    const handleEnded = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [src, type])

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play().catch(console.error)
      setIsPlaying(true)
    }
  }

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(src, '_blank')
  }

  // 渲染音频高级卡片
  if (type === 'audio') {
    return (
      <NodeViewWrapper className="file-preview-wrapper my-5 select-none">
        <div className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card shadow-sm/50 transition-all duration-300 hover:shadow-md max-w-lg relative overflow-hidden group border-l-4 border-l-violet-500">
          
          {/* 左侧播放按钮 */}
          <button
            onClick={togglePlay}
            className="flex items-center justify-center w-11 h-11 bg-violet-600 hover:bg-violet-500 text-white rounded-full transition-all duration-200 shadow-md active:scale-90 shrink-0"
            type="button"
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-[1px]" />}
          </button>

          {/* 中间音频信息 */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground truncate">{name || '未知音频文件'}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{size}</span>
            </div>
            
            {/* 精巧的波形指示器（通过 CSS 动效跳动） */}
            <div className="flex items-center gap-2 h-6">
              <div className="flex items-end gap-[2px] h-4 w-28 shrink-0">
                {Array.from({ length: 18 }).map((_, i) => {
                  const h = [20, 45, 75, 30, 60, 90, 40, 70, 50, 30, 65, 80, 45, 35, 70, 55, 30, 20][i]
                  return (
                    <span 
                      key={i}
                      className={cn(
                        "w-[3px] bg-violet-500/30 rounded-full transition-all duration-200",
                        isPlaying ? "animate-pulse" : ""
                      )}
                      style={{ 
                        height: isPlaying ? '100%' : '3px',
                        animationDelay: `${i * 0.08}s`,
                        animationDuration: `${0.8 + (i % 3) * 0.2}s`,
                        maxHeight: `${h}%`
                      }}
                    />
                  )
                })}
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* 右侧下载图标 */}
          <button
            onClick={handleDownload}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground shrink-0"
            type="button"
            title="查看或下载"
          >
            <Download size={15} />
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  // 渲染 PDF/视频等普通附件的高颜值文件预览卡片
  const iconMap = {
    pdf: <FileText className="text-rose-500" size={24} />,
    video: <Video className="text-blue-500" size={24} />,
    file: <FileText className="text-gray-500" size={24} />,
  }

  const colorMap = {
    pdf: 'border-l-rose-500',
    video: 'border-l-blue-500',
    file: 'border-l-gray-400',
  }

  return (
    <NodeViewWrapper className="file-preview-wrapper my-5 select-none">
      <div 
        onClick={handleDownload}
        className={cn(
          "flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/20 cursor-pointer shadow-sm/50 transition-all duration-300 hover:shadow-md active:scale-[0.99] max-w-md relative group border-l-4",
          colorMap[type] || 'border-l-border'
        )}
      >
        <div className="flex items-center justify-center w-12 h-12 bg-muted rounded-xl shrink-0">
          {iconMap[type] || <FileText size={24} />}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <h4 className="text-sm font-semibold text-foreground truncate leading-snug">{name || '文件附件'}</h4>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{type.toUpperCase()} 附件</span>
            <span>•</span>
            <span>{size || '未知大小'}</span>
          </div>
        </div>

        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground shrink-0"
          type="button"
        >
          <Download size={15} />
        </button>
      </div>
    </NodeViewWrapper>
  )
}

export const FilePreviewExtension = Node.create({
  name: 'filePreview',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: {
        default: '',
      },
      name: {
        default: '',
      },
      type: {
        default: 'file', // audio, video, pdf, file
      },
      size: {
        default: '0 KB',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="file-preview"]',
        getAttrs: (element) => ({
          src: element.getAttribute('data-src') || '',
          name: element.getAttribute('data-name') || '',
          type: element.getAttribute('data-file-type') || 'file',
          size: element.getAttribute('data-size') || '0 KB',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'file-preview',
        'data-src': node.attrs.src,
        'data-name': node.attrs.name,
        'data-file-type': node.attrs.type,
        'data-size': node.attrs.size,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FilePreviewView)
  },

  markdownTokenName: 'filePreview',

  // 反序列化多媒体预览标签，格式为：[预览-音频-1.2MB](src)
  markdownTokenizer: {
    name: 'filePreview',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^\[预览-(audio|video|pdf|file)-([^\]]*)\]\((https?:\/\/[^\s)]+|file:\/\/[^\s)]+)\)/i)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src) => {
      const match = /^\[预览-(audio|video|pdf|file)-([^\]]*)\]\((https?:\/\/[^\s)]+|file:\/\/[^\s)]+)\)/i.exec(src)
      if (!match) return undefined

      // 解析出 size 和 name
      const meta = match[2] || ''
      const parts = meta.split('|')
      const name = parts[0] || '附件'
      const size = parts[1] || '0 KB'

      return {
        type: 'filePreview',
        raw: match[0],
        attrs: {
          src: match[3],
          type: match[1].toLowerCase(),
          name,
          size,
        },
      }
    },
  },

  // 序列化
  renderMarkdown(node) {
    return `\n[预览-${node.attrs?.type || 'file'}-${node.attrs?.name || '附件'}|${node.attrs?.size || '0 KB'}](${node.attrs?.src || ''})\n`
  },

  parseMarkdown(token) {
    return {
      type: 'filePreview',
      attrs: {
        src: token.attrs?.src || '',
        type: token.attrs?.type || 'file',
        name: token.attrs?.name || '附件',
        size: token.attrs?.size || '0 KB',
      },
    }
  },
})

export default FilePreviewExtension
