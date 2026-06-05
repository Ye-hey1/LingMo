'use client'

import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Image as ImageIcon, FileText } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface ClipboardDropzoneProps {
  onImageDrop: (file: File) => void
  onTextDrop: (text: string) => void
  className?: string
  compact?: boolean
}

export function ClipboardDropzone({ onImageDrop, onTextDrop, className, compact = false }: ClipboardDropzoneProps) {
  const t = useTranslations()
  const [isDragging, setIsDragging] = useState(false)
  const dragCountRef = useRef(0)
  const dropzoneRef = useRef<HTMLDivElement>(null)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current += 1
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current = Math.max(0, dragCountRef.current - 1)
    if (dragCountRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCountRef.current = 0

    const files = Array.from(e.dataTransfer.files)
    const text = e.dataTransfer.getData('text/plain')

    if (files.length > 0) {
      const imageFile = files.find(file => file.type.startsWith('image/'))
      if (imageFile) {
        onImageDrop(imageFile)
      }
    } else if (text) {
      onTextDrop(text)
    }
  }, [onImageDrop, onTextDrop])

  return (
    <div
      ref={dropzoneRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300",
        isDragging 
          ? "border-primary bg-primary/5 scale-[1.02]" 
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        className
      )}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-primary/5 backdrop-blur-sm z-10"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="p-4 rounded-full bg-primary/10 border border-primary/20">
                  <Upload className="size-8 text-primary animate-bounce" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-primary">
                    {t('record.mark.clipboard.dropzone.title')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('record.mark.clipboard.dropzone.subtitle')}
                  </p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn("text-center", compact ? "p-4" : "p-8")}>
        <div className={cn("flex flex-col items-center", compact ? "gap-2.5" : "gap-4")}>
          <div className={cn("rounded-full bg-muted/50", compact ? "p-2" : "p-3")}>
            <Upload className={cn("text-muted-foreground", compact ? "size-4" : "size-6")} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('record.mark.clipboard.dropzone.upload')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('record.mark.clipboard.dropzone.formats')}
            </p>
          </div>
          <div className={cn("flex text-xs text-muted-foreground", compact ? "gap-3" : "gap-4")}>
            <div className="flex items-center gap-1.5">
              <ImageIcon className="size-3.5" />
              <span>{t('record.mark.clipboard.dropzone.image')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileText className="size-3.5" />
              <span>{t('record.mark.clipboard.dropzone.text')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
