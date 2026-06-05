'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  CheckCircle, 
  XCircle, 
  Edit3, 
  Save, 
  RotateCcw,
  Copy,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'

interface RecognitionPreviewProps {
  content: string
  desc: string
  imageUrl?: string
  onConfirm: (content: string, desc: string) => void
  onCancel: () => void
  onRetry?: () => void
  isProcessing?: boolean
  className?: string
}

export function RecognitionPreview({
  content,
  desc,
  onConfirm,
  onCancel,
  onRetry,
  isProcessing = false,
  className
}: RecognitionPreviewProps) {
  const t = useTranslations()
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)
  const [editedDesc, setEditedDesc] = useState(desc)
  const [isExpanded, setIsExpanded] = useState(true)

  const handleSave = useCallback(() => {
    onConfirm(editedContent, editedDesc)
    setIsEditing(false)
  }, [editedContent, editedDesc, onConfirm])

  const handleCancelEdit = useCallback(() => {
    setEditedContent(content)
    setEditedDesc(desc)
    setIsEditing(false)
  }, [content, desc])

  const handleCopyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast({ title: t('record.mark.clipboard.copied') })
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }, [content, t])

  const handleCopyDesc = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(desc)
      toast({ title: t('record.mark.clipboard.copied') })
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }, [desc, t])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={cn(
        "overflow-hidden rounded-xl border border-border/50 bg-card shadow-lg",
        className
      )}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-gradient-to-r from-muted/50 to-muted/30">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/20">
            <Sparkles className="size-3.5" />
            <span className="text-xs font-medium">
              {t('record.mark.clipboard.recognitionComplete')}
            </span>
          </div>
          {desc && (
            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full max-w-[200px] truncate">
              {desc}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 px-2"
          >
            {isExpanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* 内容区域 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="p-4 space-y-4">
              {/* 描述编辑 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('record.mark.clipboard.description')}
                  </label>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyDesc}
                      className="h-6 px-2 text-xs"
                    >
                      <Copy className="size-3 mr-1" />
                      {t('common.copy')}
                    </Button>
                  </div>
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedDesc}
                    onChange={(e) => setEditedDesc(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder={t('record.mark.clipboard.enterDescription')}
                  />
                ) : (
                  <p className="text-sm text-foreground/80 px-3 py-2 bg-muted/30 rounded-lg">
                    {desc || t('record.mark.clipboard.noDescription')}
                  </p>
                )}
              </div>

              {/* 内容编辑 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('record.mark.clipboard.recognizedContent')}
                  </label>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyContent}
                      className="h-6 px-2 text-xs"
                    >
                      <Copy className="size-3 mr-1" />
                      {t('common.copy')}
                    </Button>
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditing(true)}
                        className="h-6 px-2 text-xs"
                      >
                        <Edit3 className="size-3 mr-1" />
                        {t('common.edit')}
                      </Button>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <Textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="min-h-[120px] text-sm font-mono"
                    placeholder={t('record.mark.clipboard.enterContent')}
                  />
                ) : (
                  <div className="max-h-[200px] overflow-y-auto px-3 py-2 bg-muted/30 rounded-lg scrollbar-thin">
                    <pre className="text-sm text-foreground/80 whitespace-pre-wrap break-words font-mono">
                      {content || t('record.mark.clipboard.noContent')}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/20">
        <div className="flex gap-2">
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={isProcessing}
              className="text-xs"
            >
              <RotateCcw className="size-3.5 mr-1.5" />
              {t('record.mark.clipboard.retry')}
            </Button>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isProcessing}
            className="text-xs"
          >
            <XCircle className="size-3.5 mr-1.5" />
            {t('common.cancel')}
          </Button>
          
          {isEditing ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                className="text-xs"
              >
                {t('common.cancelEdit')}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="text-xs"
              >
                <Save className="size-3.5 mr-1.5" />
                {t('common.save')}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => onConfirm(content, desc)}
              disabled={isProcessing}
              className="text-xs"
            >
              {isProcessing ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <Sparkles className="size-3.5 mr-1.5" />
                </motion.div>
              ) : (
                <CheckCircle className="size-3.5 mr-1.5" />
              )}
              {isProcessing ? t('record.mark.progress.processing') : t('common.confirm')}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
