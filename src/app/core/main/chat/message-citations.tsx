import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { toast } from '@/hooks/use-toast'
import { getToolByName } from '@/lib/agent/tools'
import type { MessageCitationDetail } from '@/lib/ai/citations'
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'
import { ChevronRight, Download, ExternalLink, Link2, Loader2, LocateFixed } from 'lucide-react'

interface MessageCitationsProps {
  sources?: string[]
  details: MessageCitationDetail[]
  content?: string
}

function getCitationLabel(detail: MessageCitationDetail, index: number) {
  return detail.title || detail.filename || detail.url || `Citation ${index + 1}`
}

function getSourceTypeLabel(sourceType?: MessageCitationDetail['sourceType']) {
  switch (sourceType) {
    case 'web':
      return 'Web'
    case 'note':
      return '笔记'
    case 'pdf':
      return 'PDF'
    case 'image':
      return '图片'
    case 'agent':
      return 'Agent'
    case 'rag':
      return 'RAG'
    case 'current':
      return '当前文件'
    case 'linked':
      return '关联文件'
    case 'quote':
      return '引用'
    default:
      return '来源'
  }
}

function getCitationPath(detail: MessageCitationDetail) {
  return (detail.filepath || detail.articlePath || '').trim()
}

function getCitationSearchText(detail: MessageCitationDetail) {
  if (!detail.content) {
    return ''
  }

  const line = detail.content
    .split('\n')
    .map(item => item.trim())
    .find(Boolean)

  return (line || detail.content.trim()).slice(0, 180)
}

export function MessageCitations({ details }: MessageCitationsProps) {
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const summary = useMemo(() => {
    if (!details.length) {
      return ''
    }

    const first = getCitationLabel(details[0], 0)
    return details.length === 1 ? first : `${first} 等 ${details.length} 项`
  }, [details])

  const handleSaveCitation = useCallback(async (detail: MessageCitationDetail, index: number) => {
    const url = detail.url?.trim()
    if (!url) {
      return
    }

    const tool = getToolByName('clip_web_content')
    if (!tool) {
      toast({
        title: '保存失败',
        description: '未找到 clip_web_content 工具',
        variant: 'destructive',
      })
      return
    }

    const key = `${url}-${index}`
    setSavingKey(key)

    try {
      const result = await tool.execute({
        url,
        title: detail.title || detail.filename || getCitationLabel(detail, index),
        content: detail.content || '',
        folderPath: 'web-clips',
        maxChars: 20000,
      })

      if (!result.success) {
        toast({
          title: '保存失败',
          description: result.error || '网页内容保存失败',
          variant: 'destructive',
        })
        return
      }

      toast({
        title: '已保存到知识库',
        description: result.data?.filePath
          ? `文件路径：${result.data.filePath}`
          : '网页内容已保存为笔记',
      })
    } finally {
      setSavingKey(null)
    }
  }, [])

  const handleOpenCitation = useCallback((detail: MessageCitationDetail) => {
    const targetPath = getCitationPath(detail)
    if (!targetPath) {
      return
    }

    const articleStore = useArticleStore.getState()
    const currentPath = articleStore.activeFilePath
    const isPdf = /\.pdf$/i.test(targetPath)

    if (currentPath !== targetPath) {
      void articleStore.setActiveFilePath(targetPath)
    }

    const emitJump = () => {
      if (isPdf) {
        const pageNumber = detail.startLine && detail.startLine > 0 ? detail.startLine : 1
        emitter.emit('pdf-jump-to-page', {
          filePath: targetPath,
          pageNumber,
        })
        return
      }

      emitter.emit('editor-focus-citation', {
        filePath: targetPath,
        startLine: detail.startLine,
        endLine: detail.endLine,
        from: detail.from,
        to: detail.to,
        searchText: getCitationSearchText(detail),
      })
    }

    if (currentPath === targetPath) {
      emitJump()
      return
    }

    window.setTimeout(emitJump, 140)
    window.setTimeout(emitJump, 460)
  }, [])

  if (!details.length) {
    return null
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="rounded-md border border-border/45 bg-muted/5"
    >
      <div className="flex items-center justify-between gap-1.5 px-2 py-1">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
            <Link2 className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-[11px] font-medium text-foreground/90">引用来源</span>
            <span className="shrink-0 rounded-full bg-background px-1.5 py-0 text-[10px] text-muted-foreground">{details.length}</span>
          </button>
        </CollapsibleTrigger>
        <span className="max-w-[58%] truncate text-[10px] text-muted-foreground">{summary}</span>
      </div>

      <CollapsibleContent className="border-t border-border/45 px-2 pb-1.5 pt-1">
        <div className="max-h-[118px] space-y-1 overflow-y-auto pr-0.5">
          {details.map((detail, index) => {
            const label = getCitationLabel(detail, index)
            const url = detail.url?.trim()
            const sourcePath = getCitationPath(detail)
            const isWebSource = detail.sourceType === 'web' && !!url
            const canJump = !!sourcePath
            const citationKey = `${url || label}-${index}`
            const isSaving = savingKey === citationKey

            return (
              <div key={`${label}-${index}`} className="rounded-md border border-border/50 bg-background/70 px-1.5 py-1">
                <div className="mb-0.5 flex items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    {canJump ? (
                      <button
                        type="button"
                        onClick={() => handleOpenCitation(detail)}
                        className="truncate text-[11px] font-medium text-foreground/90 hover:underline"
                        title="定位到编辑器"
                      >
                        {label}
                      </button>
                    ) : (
                      <div className="truncate text-[11px] font-medium text-foreground/90">{label}</div>
                    )}
                    {url && (
                      <div className="truncate text-[10px] text-muted-foreground">{url}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {detail.sourceType && (
                      <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                        {getSourceTypeLabel(detail.sourceType)}
                      </Badge>
                    )}
                    {canJump && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-4.5"
                        onClick={() => handleOpenCitation(detail)}
                        aria-label="定位到编辑器"
                        title="定位到编辑器"
                      >
                        <LocateFixed className="size-2.5" />
                      </Button>
                    )}
                    {isWebSource && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-4.5"
                        onClick={() => void handleSaveCitation(detail, index)}
                        disabled={isSaving}
                        aria-label="保存到知识库"
                        title="保存到知识库"
                      >
                        {isSaving ? (
                          <Loader2 className="size-2.5 animate-spin" />
                        ) : (
                          <Download className="size-2.5" />
                        )}
                      </Button>
                    )}
                    {url && (
                      <Button asChild variant="ghost" size="icon" className="size-4.5">
                        <a href={url} target="_blank" rel="noreferrer" aria-label="打开来源链接" title="打开来源链接">
                          <ExternalLink className="size-2.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                {detail.content && (
                  canJump ? (
                    <button
                      type="button"
                      className="line-clamp-1 w-full text-left text-[10px] leading-4 text-muted-foreground/90 hover:text-foreground"
                      onClick={() => handleOpenCitation(detail)}
                      title="点击定位到原文"
                    >
                      {detail.content}
                    </button>
                  ) : (
                    <div className="line-clamp-1 text-[10px] leading-4 text-muted-foreground/90">
                      {detail.content}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
