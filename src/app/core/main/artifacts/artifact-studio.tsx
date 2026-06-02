'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ArrowUpRight,
  BarChart3,
  Check,
  Clipboard,
  Eye,
  FileInput,
  FileText,
  LayoutTemplate,
  LoaderCircle,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { ARTIFACT_TEMPLATES, buildArtifactGenerationPrompt, summarizeArtifactInput, type ArtifactTemplateId } from '@/lib/artifacts'
import emitter from '@/lib/emitter'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { cn } from '@/lib/utils'
import { formatFileActivityTime } from '@/lib/file-activity'
import { listRecentVisualReports, type VisualReportListItem } from '@/lib/visual-report-index'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'

interface ArtifactStudioProps {
  sourcePath?: string | null
}

const templateIcons: Record<ArtifactTemplateId, typeof FileText> = {
  'article-report': FileText,
  'data-report': BarChart3,
  'deck-brief': LayoutTemplate,
  'poster-card': Sparkles,
}

const textSourceExtensions = [
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.json',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.sql',
]

function getFileName(path?: string | null) {
  if (!path) return ''
  return path.replace(/\\/g, '/').split('/').pop() || path
}

function getTitleFromPath(path?: string | null) {
  const name = getFileName(path)
  return name.replace(/\.[^.]+$/, '') || 'LingMo 输出'
}

function isReadableSourcePath(path?: string | null) {
  if (!path || path.includes('://')) return false
  const lower = path.toLowerCase()
  return textSourceExtensions.some((extension) => lower.endsWith(extension))
}

export function ArtifactStudio({ sourcePath }: ArtifactStudioProps) {
  const { rightSidebarVisible, toggleRightSidebar } = useSidebarStore()
  const { activeFilePath, setActiveFilePath } = useArticleStore()
  const [title, setTitle] = useState(getTitleFromPath(sourcePath))
  const [sourceLabel, setSourceLabel] = useState(sourcePath || '手动输入')
  const [sourceContent, setSourceContent] = useState('')
  const [templateId, setTemplateId] = useState<ArtifactTemplateId>('article-report')
  const [promptPreview, setPromptPreview] = useState('')
  const [loadingSource, setLoadingSource] = useState(false)
  const [loadingReports, setLoadingReports] = useState(false)
  const [recentReports, setRecentReports] = useState<VisualReportListItem[]>([])
  const [selectedReportPath, setSelectedReportPath] = useState('')
  const [selectedReportContent, setSelectedReportContent] = useState('')
  const [loadingReportPreview, setLoadingReportPreview] = useState(false)
  const [reportPreviewError, setReportPreviewError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const manualSourceRef = useRef(false)
  const previousSourcePathRef = useRef(sourcePath)

  const summary = useMemo(() => summarizeArtifactInput(sourceContent), [sourceContent])
  const activeTemplate = ARTIFACT_TEMPLATES.find((template) => template.id === templateId) || ARTIFACT_TEMPLATES[0]
  const canUseCurrentSource = isReadableSourcePath(sourcePath)
  const hasSourceContent = sourceContent.trim().length > 0
  const selectedReport = useMemo(
    () => recentReports.find((report) => report.path === selectedReportPath) || null,
    [recentReports, selectedReportPath],
  )

  const refreshRecentReports = useCallback(async () => {
    setLoadingReports(true)
    try {
      setRecentReports(await listRecentVisualReports(10))
    } catch (error) {
      toast({
        title: '读取最近输出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoadingReports(false)
    }
  }, [])

  useEffect(() => {
    void refreshRecentReports()
  }, [refreshRecentReports])

  useEffect(() => {
    if (recentReports.length === 0) {
      setSelectedReportPath('')
      setSelectedReportContent('')
      setReportPreviewError('')
      return
    }

    const selectedExists = recentReports.some((report) => report.path === selectedReportPath)
    if (!selectedExists) {
      setSelectedReportPath(recentReports[0].path)
    }
  }, [recentReports, selectedReportPath])

  useEffect(() => {
    if (!activeFilePath) return
    const matched = recentReports.find((report) => report.path === activeFilePath)
    if (matched && matched.path !== selectedReportPath) {
      setSelectedReportPath(matched.path)
    }
  }, [activeFilePath, recentReports, selectedReportPath])

  useEffect(() => {
    if (!selectedReportPath) {
      setSelectedReportContent('')
      setReportPreviewError('')
      return
    }

    let cancelled = false

    const loadPreview = async () => {
      setLoadingReportPreview(true)
      setReportPreviewError('')
      try {
        const content = await readWorkspaceTextFile(selectedReportPath)
        if (!cancelled) {
          setSelectedReportContent(content)
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedReportContent('')
          setReportPreviewError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setLoadingReportPreview(false)
        }
      }
    }

    void loadPreview()

    return () => {
      cancelled = true
    }
  }, [selectedReportPath])

  const loadCurrentSource = useCallback(async () => {
    if (!canUseCurrentSource || !sourcePath) {
      toast({
        title: '当前没有可读取的文本素材',
        description: '可打开 Markdown、HTML、JSON、CSV 等文件后再载入。',
        variant: 'destructive',
      })
      return
    }

    setLoadingSource(true)
    try {
      const content = await readWorkspaceTextFile(sourcePath)
      manualSourceRef.current = false
      setSourceContent(content)
      setSourceLabel(sourcePath)
      setTitle((current) => current.trim() ? current : getTitleFromPath(sourcePath))
      setPromptPreview('')
      toast({ title: '已载入当前文件', description: getFileName(sourcePath) })
    } catch (error) {
      toast({
        title: '读取当前文件失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoadingSource(false)
    }
  }, [canUseCurrentSource, sourcePath])

  useEffect(() => {
    if (!canUseCurrentSource || sourceContent.trim()) return
    void loadCurrentSource()
  }, [canUseCurrentSource, loadCurrentSource, sourceContent])

  useEffect(() => {
    if (sourcePath === previousSourcePathRef.current) return
    previousSourcePathRef.current = sourcePath

    if (!sourcePath) return
    setTitle(getTitleFromPath(sourcePath))

    if (!isReadableSourcePath(sourcePath)) {
      setSourceLabel(sourcePath)
      return
    }

    if (manualSourceRef.current && sourceContent.trim()) {
      return
    }

    void loadCurrentSource()
  }, [loadCurrentSource, sourceContent, sourcePath])

  const buildPrompt = useCallback(() => {
    const cleanContent = sourceContent.trim()
    if (!cleanContent) {
      toast({ title: '请先提供输入材料', variant: 'destructive' })
      return ''
    }

    const prompt = buildArtifactGenerationPrompt({
      title: title.trim() || getTitleFromPath(sourceLabel),
      sourceContent: cleanContent,
      sourceLabel,
      templateId,
    })
    setPromptPreview(prompt)
    return prompt
  }, [sourceContent, sourceLabel, templateId, title])

  const sendToChat = useCallback(async () => {
    const prompt = buildPrompt()
    if (!prompt) return

    if (!rightSidebarVisible) {
      await toggleRightSidebar()
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve())
      })
    })

    emitter.emit('quick-prompt-send', prompt)
    toast({
      title: '已发送到右侧聊天',
      description: '聊天侧会直接执行生成流程。',
    })

    window.setTimeout(() => {
      void refreshRecentReports()
    }, 1600)
  }, [buildPrompt, rightSidebarVisible, toggleRightSidebar])

  const copyPrompt = useCallback(async () => {
    const prompt = promptPreview || buildPrompt()
    if (!prompt) return

    try {
      await navigator.clipboard.writeText(prompt)
      toast({ title: '已复制生成提示词' })
    } catch (error) {
      toast({
        title: '复制失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [buildPrompt, promptPreview])

  const handleDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)

    const file = event.dataTransfer.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      manualSourceRef.current = false
      setSourceContent(content)
      setSourceLabel(file.name)
      setTitle((current) => current.trim() ? current : getTitleFromPath(file.name))
      setPromptPreview('')
      toast({ title: '已载入拖入文件', description: file.name })
    } catch (error) {
      toast({
        title: '读取拖入文件失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }, [])

  const openReport = useCallback(async (filePath: string) => {
    setSelectedReportPath(filePath)
    await setActiveFilePath(filePath)
  }, [setActiveFilePath])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
            <LayoutTemplate className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">输出工坊</div>
            <div className="truncate text-[11px] text-muted-foreground">{activeTemplate.name} · {summary.format}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="hidden font-normal text-muted-foreground sm:inline-flex">
            {sourceContent.length.toLocaleString()} 字符
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={copyPrompt} disabled={!hasSourceContent}>
            <Clipboard className="size-3.5" />
            复制提示词
          </Button>
          <Button type="button" size="sm" onClick={() => void sendToChat()} disabled={!hasSourceContent}>
            <Send className="size-3.5" />
            送到聊天
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(320px,1fr)_360px]">
        <section className="flex min-h-0 flex-col overflow-hidden border-r">
          <div className="grid shrink-0 gap-3 border-b bg-muted/15 p-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="artifact-title">标题</label>
              <Input
                id="artifact-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="输出标题"
                className="h-8"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="artifact-source">来源</label>
              <Input
                id="artifact-source"
                value={sourceLabel}
                onChange={(event) => setSourceLabel(event.target.value)}
                placeholder="来源名称"
                className="h-8"
              />
            </div>
          </div>

          <div
            className={cn(
              'relative flex min-h-0 flex-1 flex-col overflow-hidden p-4 transition-colors',
              isDragging && 'bg-primary/5',
            )}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => void handleDrop(event)}
          >
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileInput className="size-4 text-muted-foreground" />
                输入材料
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadCurrentSource()}
                disabled={!canUseCurrentSource || loadingSource}
              >
                {loadingSource ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                载入当前文件
              </Button>
            </div>
            <Textarea
              value={sourceContent}
              onChange={(event) => {
                manualSourceRef.current = true
                setSourceContent(event.target.value)
                setPromptPreview('')
              }}
              placeholder="粘贴笔记、HTML、JSON、CSV、SQL 或纯文本材料"
              className="min-h-0 flex-1 resize-none rounded-lg border-muted-foreground/20 bg-background text-sm leading-6 shadow-none"
            />
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="secondary" className="font-normal">{summary.format}</Badge>
              <span>{summary.preview.split('\n')[0]}</span>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden bg-muted/10">
          <div className="shrink-0 border-b p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <LayoutTemplate className="size-4 text-muted-foreground" />
              模板
            </div>
            <div className="grid gap-2">
              {ARTIFACT_TEMPLATES.map((template) => {
                const Icon = templateIcons[template.id]
                const selected = template.id === templateId

                return (
                  <button
                    key={template.id}
                    type="button"
                    className={cn(
                      'flex min-h-[72px] w-full items-start gap-3 rounded-lg border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/5',
                      selected && 'border-primary/60 bg-primary/10 ring-1 ring-primary/20',
                    )}
                    onClick={() => {
                      setTemplateId(template.id)
                      setPromptPreview('')
                    }}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{template.name}</span>
                        {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{template.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-[1.1] flex-col overflow-hidden p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-muted-foreground" />
                生成预览
              </div>
              <Button type="button" size="sm" variant="outline" onClick={buildPrompt} disabled={!hasSourceContent}>
                生成
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-background">
              <pre className="whitespace-pre-wrap break-words p-3 text-xs leading-5 text-muted-foreground">
                {promptPreview || '选择模板并生成后，这里会显示将发送给 AI Agent 的提示词。'}
              </pre>
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 text-muted-foreground" />
                最近输出
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => void refreshRecentReports()}
                disabled={loadingReports}
              >
                <RefreshCw className={cn('size-3.5', loadingReports && 'animate-spin')} />
                刷新
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <ScrollArea className="max-h-[220px] shrink-0">
                <div className="grid gap-2 pr-2">
                  {recentReports.length === 0 ? (
                    <div className="rounded-lg border border-dashed bg-background p-4 text-xs leading-5 text-muted-foreground">
                      暂无 HTML 输出。生成后会出现在这里，也会同步到文件树。
                    </div>
                  ) : recentReports.map((report) => {
                    const time = report.activityAt
                      ? formatFileActivityTime(report.activityAt)
                      : report.modifiedAt
                        ? formatFileActivityTime(new Date(report.modifiedAt).getTime())
                        : ''
                    const isSelected = report.path === selectedReportPath
                    const isOpened = report.path === activeFilePath

                    return (
                      <div
                        key={report.path}
                        className={cn(
                          'rounded-lg border bg-background p-3 transition',
                          isSelected && 'border-primary/60 bg-primary/5 ring-1 ring-primary/20',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setSelectedReportPath(report.path)}
                          >
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-foreground">{report.name}</div>
                                <div className="mt-1 truncate text-[11px] text-muted-foreground">{report.path}</div>
                              </div>
                              <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                                HTML
                              </Badge>
                            </div>
                            {time ? <div className="mt-2 text-[11px] text-muted-foreground">{time}</div> : null}
                          </button>
                          <Button
                            type="button"
                            size="sm"
                            variant={isOpened ? 'secondary' : 'ghost'}
                            className="h-7 shrink-0 px-2"
                            onClick={() => void openReport(report.path)}
                          >
                            <ArrowUpRight className="size-3.5" />
                            {isOpened ? '已打开' : '打开'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <Eye className="size-3.5 text-muted-foreground" />
                      结果预览
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {selectedReport?.path || '选择一份最近输出后预览'}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2"
                    onClick={() => selectedReport ? void openReport(selectedReport.path) : undefined}
                    disabled={!selectedReport}
                  >
                    <ArrowUpRight className="size-3.5" />
                    打开结果
                  </Button>
                </div>

                <div className="min-h-0 flex-1 bg-muted/10">
                  {loadingReportPreview ? (
                    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      正在载入预览
                    </div>
                  ) : reportPreviewError ? (
                    <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-5 text-muted-foreground">
                      {reportPreviewError}
                    </div>
                  ) : selectedReportContent ? (
                    <iframe
                      srcDoc={selectedReportContent}
                      title={selectedReport?.name || '最近输出预览'}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      className="h-full w-full border-0 bg-white"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-5 text-muted-foreground">
                      选择一份最近输出后，这里会显示 HTML 预览。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
