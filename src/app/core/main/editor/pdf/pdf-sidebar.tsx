'use client'

import { usePDFAnnotationStore, type Annotation } from '@/stores/pdf-annotation'
import { useTranslations } from 'next-intl'
import { Download, FileText, MessageSquare, Trash2, X } from 'lucide-react'
import { TooltipButton } from '@/components/tooltip-button'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { toast } from '@/hooks/use-toast'

const COLOR_MAP: Record<string, string> = {
  yellow: 'bg-yellow-300/70',
  green: 'bg-green-300/70',
  blue: 'bg-blue-300/70',
  red: 'bg-red-300/70',
}

interface PdfSidebarProps {
  pdfPath: string
  onClose: () => void
  onJumpToAnnotation: (annotation: Annotation) => void
}

export function PdfSidebar({ pdfPath, onClose, onJumpToAnnotation }: PdfSidebarProps) {
  const t = useTranslations('article.pdf')
  const annotations = usePDFAnnotationStore(s => s.getAnnotations(pdfPath))
  const exportToMarkdown = usePDFAnnotationStore(s => s.exportToMarkdown)
  const removeAnnotation = usePDFAnnotationStore(s => s.removeAnnotation)

  const handleExport = async () => {
    const md = await exportToMarkdown(pdfPath)
    if (!md) {
      toast({ title: t('noAnnotations') })
      return
    }

    try {
      const basePath = pdfPath.replace(/\.pdf$/i, '') + '_批注.md'
      const pathOptions = await getFilePathOptions(basePath)
      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, md)
      } else {
        await writeTextFile(pathOptions.path, md, { baseDir: pathOptions.baseDir })
      }
      toast({ title: t('exportSuccess') })
    } catch {
      toast({ title: t('exportError'), variant: 'destructive' })
    }
  }

  return (
    <div className="flex w-72 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">{t('annotations')} ({annotations.length})</span>
        <div className="flex items-center gap-1">
          <TooltipButton
            icon={<Download className="h-3.5 w-3.5" />}
            tooltipText={t('exportAnnotations')}
            variant="ghost"
            size="icon"
            buttonClassName="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleExport}
          />
          <TooltipButton
            icon={<X className="h-3.5 w-3.5" />}
            tooltipText={t('closeSidebar')}
            variant="ghost"
            size="icon"
            buttonClassName="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          />
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-auto p-2">
        {annotations.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">{t('noAnnotations')}</p>
        )}
        {annotations.map(annotation => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            onJump={() => onJumpToAnnotation(annotation)}
            onRemove={() => removeAnnotation(pdfPath, annotation.id)}
          />
        ))}
      </div>
    </div>
  )
}

function AnnotationCard({
  annotation,
  onJump,
  onRemove,
}: {
  annotation: Annotation
  onJump: () => void
  onRemove: () => void
}) {
  const t = useTranslations('article.pdf')

  return (
    <div
      role="button"
      tabIndex={0}
      className="group w-full rounded-md border bg-card p-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-muted/35"
      onClick={onJump}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onJump()
        }
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {t('pageLabel')} {annotation.pageIndex + 1}
          <span className={`inline-block h-2 w-2 rounded-sm ${COLOR_MAP[annotation.color] || ''}`} />
        </span>
        <span onClick={(event) => event.stopPropagation()}>
          <TooltipButton
            icon={<Trash2 className="h-3 w-3" />}
            tooltipText={t('deleteAnnotation')}
            variant="ghost"
            size="icon"
            buttonClassName="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          />
        </span>
      </div>
      <p className="line-clamp-3 leading-5 text-foreground/85">{annotation.selectedText}</p>
      {annotation.note && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded bg-muted/50 px-2 py-1 text-muted-foreground">
          <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2 leading-4">{annotation.note}</span>
        </div>
      )}
    </div>
  )
}
