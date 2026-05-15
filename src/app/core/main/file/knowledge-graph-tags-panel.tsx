'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Plus, Tag, Trash2, X } from 'lucide-react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { getAllMarkdownFiles, type MarkdownFile } from '@/lib/files'
import { createGraphTagGroup, getGraphTagNameFromPath } from '@/lib/knowledge-graph-tags'
import { useKnowledgeGraphTagsStore } from '@/stores/knowledge-graph-tags'

function normalizeKeywordTokens(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function removeActiveMention(value: string) {
  return value.replace(/(^|\s)@[^\s@]*$/, '$1').replace(/\s{2,}/g, ' ').trim()
}

function mergeFiles(current: MarkdownFile[], next: MarkdownFile[]) {
  const map = new Map(current.map((file) => [file.relativePath, file]))
  next.forEach((file) => {
    map.set(file.relativePath, file)
  })
  return Array.from(map.values())
}

function buildTagQuery(keywordInput: string, files: MarkdownFile[]) {
  const keywordTokens = normalizeKeywordTokens(keywordInput)
  const fileTokens = files.map((file) => file.relativePath)
  return [...keywordTokens, ...fileTokens].join(', ')
}

export function KnowledgeGraphTagsPanel() {
  const { tagGroups, initTagGroups, addTagGroup, updateTagGroup, removeTagGroup } = useKnowledgeGraphTagsStore()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [name, setName] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [linkedFiles, setLinkedFiles] = useState<MarkdownFile[]>([])
  const [allFiles, setAllFiles] = useState<MarkdownFile[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [pendingSelection, setPendingSelection] = useState<string[]>([])
  const queryInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    initTagGroups()
  }, [initTagGroups])

  useEffect(() => {
    if (tagGroups.length > 0) {
      setIsComposerOpen(false)
    }
  }, [tagGroups.length])

  const ensureFilesLoaded = useCallback(async () => {
    if (allFiles.length > 0 || isLoadingFiles) {
      return
    }

    setIsLoadingFiles(true)
    try {
      const files = await getAllMarkdownFiles()
      setAllFiles(files)
    } catch (error) {
      console.error('Failed to load markdown files for tag picker:', error)
    } finally {
      setIsLoadingFiles(false)
    }
  }, [allFiles.length, isLoadingFiles])

  const resetComposer = useCallback(() => {
    setName('')
    setKeywordInput('')
    setLinkedFiles([])
    setPendingSelection([])
    setMentionQuery('')
    setIsPickerOpen(false)
  }, [])

  const handleAddTagGroup = useCallback(() => {
    const query = buildTagQuery(keywordInput, linkedFiles)
    const fallbackName = name.trim() || (linkedFiles[0] ? getGraphTagNameFromPath(linkedFiles[0].relativePath) : '')
    const group = createGraphTagGroup(fallbackName, query)
    if (!group) return

    addTagGroup(group.name, group.query)
    resetComposer()
    setIsComposerOpen(false)
  }, [addTagGroup, keywordInput, linkedFiles, name, resetComposer])

  const handleKeywordInputChange = useCallback((value: string) => {
    setKeywordInput(value)

    const match = value.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionQuery(match[1] ?? '')
      setPendingSelection(linkedFiles.map((file) => file.relativePath))
      setIsPickerOpen(true)
      void ensureFilesLoaded()
      return
    }

    setMentionQuery('')
    setIsPickerOpen(false)
  }, [ensureFilesLoaded, linkedFiles])

  const filteredFiles = useMemo(() => {
    const query = mentionQuery.trim().toLowerCase()
    const source = allFiles

    if (!query) {
      return source
    }

    return source.filter((file) => (
      file.name.toLowerCase().includes(query)
      || file.relativePath.toLowerCase().includes(query)
    ))
  }, [allFiles, mentionQuery])

  const togglePendingFile = useCallback((relativePath: string) => {
    setPendingSelection((current) => (
      current.includes(relativePath)
        ? current.filter((item) => item !== relativePath)
        : [...current, relativePath]
    ))
  }, [])

  const handleConfirmLinkedFiles = useCallback(() => {
    const selectedFiles = allFiles.filter((file) => pendingSelection.includes(file.relativePath))
    setLinkedFiles((current) => mergeFiles(current, selectedFiles))
    setKeywordInput((current) => removeActiveMention(current))
    setMentionQuery('')
    setIsPickerOpen(false)

    requestAnimationFrame(() => {
      queryInputRef.current?.focus()
    })
  }, [allFiles, pendingSelection])

  const handleRemoveLinkedFile = useCallback((relativePath: string) => {
    setLinkedFiles((current) => current.filter((file) => file.relativePath !== relativePath))
    setPendingSelection((current) => current.filter((item) => item !== relativePath))
  }, [])

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex h-9 items-center border-b border-border/60 bg-muted/20 px-2.5 text-xs font-medium text-muted-foreground">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Tag className="size-3.5 text-muted-foreground" />
          <span>标签</span>
        </button>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
          {tagGroups.length} 组
        </span>
        {tagGroups.length === 0 ? (
          <button
            type="button"
            className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground"
            title="新建标签"
            onClick={() => {
              setIsExpanded(true)
              setIsComposerOpen((current) => !current)
            }}
          >
            {isComposerOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="p-1.5">
          {tagGroups.length === 0 && isComposerOpen ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-2">
              <div className="space-y-2">
                <input
                  value={name}
                  placeholder="标签名"
                  onChange={(event) => setName(event.target.value)}
                  className="h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/70"
                />

                <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                  <PopoverAnchor asChild>
                    <div className="space-y-2">
                      <input
                        ref={queryInputRef}
                        value={keywordInput}
                        placeholder="输入关键词，输入 @ 关联笔记"
                        onChange={(event) => handleKeywordInputChange(event.target.value)}
                        className="h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/70"
                      />

                      {linkedFiles.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {linkedFiles.map((file) => (
                            <span
                              key={file.relativePath}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] text-muted-foreground"
                              title={file.relativePath}
                            >
                              <span className="truncate">{file.name.replace(/\.md$/i, '')}</span>
                              <button
                                type="button"
                                className="flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                onClick={() => handleRemoveLinkedFile(file.relativePath)}
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </PopoverAnchor>

                  <PopoverContent align="start" sideOffset={6} className="w-[320px] p-2">
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-foreground">选择笔记</div>

                      <div className="max-h-56 overflow-y-auto">
                        {isLoadingFiles ? (
                          <div className="px-2 py-4 text-center text-xs text-muted-foreground">正在加载笔记...</div>
                        ) : filteredFiles.length > 0 ? (
                          <div className="space-y-1">
                            {filteredFiles.map((file) => {
                              const checked = pendingSelection.includes(file.relativePath)
                              return (
                                <button
                                  key={file.relativePath}
                                  type="button"
                                  className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                                    checked ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/55'
                                  }`}
                                  onClick={() => togglePendingFile(file.relativePath)}
                                >
                                  <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70'
                                  }`}>
                                    {checked ? <Check className="size-3" /> : null}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">{file.name.replace(/\.md$/i, '')}</span>
                                    <span className="block truncate text-[11px] text-muted-foreground">
                                      {file.relativePath}
                                    </span>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="px-2 py-4 text-center text-xs text-muted-foreground">没有匹配的笔记</div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2">
                        <button
                          type="button"
                          className="flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-3 text-sm text-muted-foreground transition hover:text-foreground"
                          onClick={() => {
                            setIsPickerOpen(false)
                            setPendingSelection(linkedFiles.map((file) => file.relativePath))
                          }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                          onClick={handleConfirmLinkedFiles}
                        >
                          确定
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="flex justify-end">
                  <button
                    type="button"
                    className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted active:scale-[0.98]"
                    title="添加标签"
                    onClick={handleAddTagGroup}
                  >
                    <Plus className="size-3.5" />
                    添加
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tagGroups.length > 0 ? (
            <div className="space-y-1">
              {tagGroups.map((group) => (
                <div
                  key={group.id}
                  className="group rounded-md border border-border/60 bg-background px-2 py-1.5 transition-colors hover:bg-muted/35"
                >
                  <div className="flex items-center gap-1.5">
                    <Tag className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={group.name}
                      aria-label="标签名"
                      onChange={(event) => updateTagGroup(group.id, { name: event.target.value })}
                      className="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs font-medium text-foreground outline-none"
                    />
                    <button
                      type="button"
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      title="删除标签组"
                      onClick={() => removeTagGroup(group.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <input
                    value={group.query}
                    aria-label="关联内容"
                    onChange={(event) => updateTagGroup(group.id, { query: event.target.value })}
                    placeholder="关键词或关联笔记"
                    className="mt-0.5 h-6 w-full rounded border border-transparent bg-transparent px-5 text-[11px] text-muted-foreground outline-none transition-colors hover:border-border/60 hover:bg-background focus:border-foreground/60 focus:bg-background focus:text-foreground"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
