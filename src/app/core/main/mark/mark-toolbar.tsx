'use client'

import { CheckCircle2, ChevronsDownUp, ChevronsUpDown, FileInput, FilePlus, ListChecks, SquareCheckBig, XCircle } from "lucide-react";
import { useTranslations } from 'next-intl';
import useMarkStore from "@/stores/mark";
import { MarkViewModeToggle } from "./mark-view-mode-toggle";
import { BottomBarIconButton } from "@/components/bottom-bar-icon-button";
import useTagStore from "@/stores/tag";
import useArticleStore from "@/stores/article";
import { useSidebarStore } from "@/stores/sidebar";
import { appendRecordsToNote, createNoteFromRecords } from "@/lib/record-to-note";
import { toast } from "@/hooks/use-toast";

export function MarkToolbar() {
  const { 
    marks, 
    visibleMarkIds,
    isMultiSelectMode, 
    setMultiSelectMode, 
    selectedMarkIds, 
    setSelectedMarkIds,
    selectAll, 
    clearSelection,
    recordViewMode,
    setRecordViewMode,
    expandedRecordTagIds,
    setExpandedRecordTagIds,
    setMarksProcessed,
  } = useMarkStore()
  const { tags, currentTagId } = useTagStore()
  const {
    activeFilePath,
    currentArticle,
    loadFileTree,
    setActiveFilePath,
    setCurrentArticle,
    saveCurrentArticle,
  } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations('record.mark.toolbar')

  const handleToggleMultiSelect = () => {
    setMultiSelectMode(!isMultiSelectMode)
  }

  const recordTagIds = tags.map((tag) => tag.id.toString())
  const areRecordTagsExpanded = recordTagIds.length > 0 && recordTagIds.every((tagId) => expandedRecordTagIds.includes(tagId))

  const handleToggleRecordTagsExpanded = () => {
    setExpandedRecordTagIds(areRecordTagsExpanded ? [] : recordTagIds)
  }

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedMarkIds(new Set())
    } else {
      selectAll()
    }
  }

  const visibleCount = visibleMarkIds.length > 0 ? visibleMarkIds.length : marks.length
  const isAllSelected = visibleCount > 0 && selectedMarkIds.size === visibleCount
  const selectedMarks = marks.filter(mark => selectedMarkIds.has(mark.id))
  const selectedTagName = tags.find(tag => tag.id === currentTagId)?.name
  const canAppendToCurrentNote = Boolean(activeFilePath && /\.md$/i.test(activeFilePath))

  const markSelectionAsProcessed = async () => {
    if (selectedMarks.length === 0) return

    try {
      await setMarksProcessed(selectedMarks.map(mark => mark.id), true)
    } catch (error) {
      console.error('标记记录为已处理失败:', error)
    }
  }

  const handleMarkSelectionProcessed = async () => {
    await markSelectionAsProcessed()
    clearSelection()
    toast({
      title: '已标记为已处理',
      description: `${selectedMarks.length} 条记录`,
    })
  }

  const handleCreateNoteFromSelection = async () => {
    if (selectedMarks.length === 0) return

    try {
      const { filePath } = await createNoteFromRecords(selectedMarks, { tagName: selectedTagName })
      await loadFileTree({ skipRemoteSync: true })
      await setLeftSidebarTab('files')
      setActiveFilePath(filePath)
      await markSelectionAsProcessed()
      clearSelection()
      toast({
        title: '已转为笔记',
        description: filePath,
      })
    } catch (error) {
      toast({
        title: '转为笔记失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const handleAppendSelectionToCurrentNote = async () => {
    if (selectedMarks.length === 0 || !activeFilePath) return

    if (!canAppendToCurrentNote) {
      toast({
        title: '请先打开一篇 Markdown 笔记',
        description: '打开目标笔记后，可以把选中的记录追加到正文末尾。',
        variant: 'destructive',
      })
      return
    }

    try {
      const nextContent = await appendRecordsToNote(activeFilePath, selectedMarks, {
        currentContent: currentArticle || undefined,
        tagName: selectedTagName,
      })
      setCurrentArticle(nextContent)
      await saveCurrentArticle(nextContent)
      await markSelectionAsProcessed()
      clearSelection()
      toast({
        title: '已追加到当前笔记',
        description: activeFilePath,
      })
    } catch (error) {
      toast({
        title: '追加失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  if (marks.length === 0) {
    return null
  }

  return (
    <div className="flex h-6 items-center justify-between overflow-hidden border-t border-border bg-background px-2 text-xs text-muted-foreground">
      <div className="min-w-0">
        {isMultiSelectMode ? (
          <span className="text-xs text-muted-foreground">
            {t('selectedCount', { count: selectedMarkIds.size })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('visibleCount', { count: visibleCount })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {isMultiSelectMode ? (
          <>
            <BottomBarIconButton
              icon={<FilePlus className="size-3" />}
              label="转为笔记"
              onClick={handleCreateNoteFromSelection}
              disabled={selectedMarks.length === 0}
            />
            <BottomBarIconButton
              icon={<FileInput className="size-3" />}
              label="追加到当前笔记"
              onClick={handleAppendSelectionToCurrentNote}
              disabled={selectedMarks.length === 0 || !canAppendToCurrentNote}
            />
            <BottomBarIconButton
              icon={<CheckCircle2 className="size-3" />}
              label="标记为已处理"
              onClick={handleMarkSelectionProcessed}
              disabled={selectedMarks.length === 0}
            />
            <BottomBarIconButton
              icon={<ListChecks className="size-3" />}
              label={isAllSelected ? t('deselectAll') : t('selectAll')}
              onClick={handleSelectAll}
            />
            <BottomBarIconButton
              icon={<XCircle className="size-3" />}
              label={t('exitMultiSelect')}
              onClick={clearSelection}
            />
          </>
        ) : (
          <>
            <MarkViewModeToggle value={recordViewMode} onChange={setRecordViewMode} />
            <BottomBarIconButton
              icon={areRecordTagsExpanded ? <ChevronsDownUp className="size-3" /> : <ChevronsUpDown className="size-3" />}
              label={areRecordTagsExpanded ? '全部折叠文件夹' : '全部展开文件夹'}
              onClick={handleToggleRecordTagsExpanded}
              active={areRecordTagsExpanded}
              disabled={recordTagIds.length === 0}
            />
            <BottomBarIconButton
              icon={<SquareCheckBig className="size-3" />}
              label={t('multiSelect')}
              onClick={handleToggleMultiSelect}
            />
          </>
        )}
      </div>
    </div>
  )
}
