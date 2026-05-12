'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { debounce } from 'lodash-es'
import { highlightTextReact } from '@/lib/highlight'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { File, FolderTree, NotebookPen, SearchX, Tags } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'
import useArticleStore from '@/stores/article'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { useSidebarStore } from '@/stores/sidebar'
import { usePathname, useRouter } from 'next/navigation'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'
import { search, type SearchableItem } from '@/lib/search-utils'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SearchFilter = 'all' | 'record' | 'article'

interface EnhancedSearchResult {
  id: string
  markId?: number
  path?: string
  article?: string
  content?: string
  desc?: string
  title: string
  searchType: 'article' | 'record'
  tagId?: number
  tagName?: string
  type?: string
  url?: string
  highlightText: string
  score: number
  firstMatchIndex?: number
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [searchValue, setSearchValue] = useState('')
  const [searchResult, setSearchResult] = useState<EnhancedSearchResult[]>([])
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all')
  const { allArticle, loadAllArticle, setActiveFilePath, setMatchPosition, setPendingSearchKeyword, setCollapsibleList } = useArticleStore()
  const { allMarks, fetchAllMarks, setPendingScrollMarkId } = useMarkStore()
  const { tags, fetchTags, setCurrentTagId } = useTagStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const isMobileRoute = pathname.startsWith('/mobile')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  function extractTitleFromPath(path: string): string {
    if (!path) return ''
    const parts = path.split(/[\/\\]/)
    const fileName = parts[parts.length - 1]
    return fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  }

  // 高亮搜索关键词（使用共享工具函数）


  function getResultMeta(item: EnhancedSearchResult) {
    if (item.searchType === 'record') {
      return {
        icon: Tags,
        primary: item.tagName || t('search.item.record'),
        secondary: item.type || null,
      }
    }

    return {
      icon: FolderTree,
      primary: item.path || t('search.item.article'),
      secondary: null,
    }
  }

  function getResultTone(item: EnhancedSearchResult) {
    return item.searchType === 'record'
      ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
  }

  const performSearch = useCallback((value: string) => {
    if (!value.trim()) {
      setSearchResult([])
      return
    }
    
    // 构建文章搜索项
    const articleItems: SearchableItem[] = allArticle.map((item, index) => ({
      id: `article-${index}-${item.path?.replace(/[^a-zA-Z0-9]/g, '-')}`,
      title: extractTitleFromPath(item.path || ''),
      content: item.article || '',
      metadata: {
        path: item.path,
        article: item.article,
        searchType: 'article'
      }
    }))
    
    // 准备记录搜索数据
    const markItems: SearchableItem[] = allMarks.map((item, index) => {
      const tag = tags.find(tag => tag.id === item.tagId)
      return {
        id: `mark-${index}-${item.id}`,
        title: item.desc || item.content?.slice(0, 50) || '',
        content: `${item.content || ''} ${item.desc || ''} ${tag?.name || ''}`,
        metadata: {
          markId: item.id,
          content: item.content,
          desc: item.desc,
          tagName: tag?.name,
          tagId: item.tagId,
          type: item.type,
          url: item.url,
          searchType: 'record'
        }
      }
    })
    
    // 合并所有搜索项
    const allItems = [...articleItems, ...markItems]
    
    // 执行搜索（自动合并精确和模糊结果）
    const searchResults = search(allItems, value, { 
      maxResults: 50 
    })
    
    // 转换为组件需要的格式
    const results: EnhancedSearchResult[] = searchResults.map(result => {
      const metadata = result.item.metadata || {}
      const firstMatch = result.matches[0]
      
      return {
        id: result.item.id,
        title: result.item.title,
        searchType: metadata.searchType as 'article' | 'record',
        highlightText: result.highlightText,
        score: result.score,
        firstMatchIndex: firstMatch?.index,
        // 文章特定字段
        path: metadata.path,
        article: metadata.article,
        // 记录特定字段
        markId: metadata.markId,
        content: metadata.content,
        desc: metadata.desc,
        tagName: metadata.tagName,
        tagId: metadata.tagId,
        type: metadata.type,
        url: metadata.url
      }
    })
    
    setSearchResult(results)
  }, [allArticle, allMarks, tags])

  // 防抖搜索，300ms 延迟
  const debouncedSearch = useMemo(
    () => debounce(performSearch, 300),
    [performSearch]
  )

  const filteredSearchResult = useMemo(() => {
    if (searchFilter === 'all') {
      return searchResult
    }
    return searchResult.filter((item) => item.searchType === searchFilter)
  }, [searchFilter, searchResult])

  async function handleSelect(item: EnhancedSearchResult) {
    // 如果是记录类型，跳转到记录页面并设置对应的 tag
    if (item.searchType === 'record') {
      onOpenChange(false)
      setPendingSearchKeyword('')
      setMatchPosition(null)
      setPendingScrollMarkId(item.markId ?? null)

      if (item.tagId) {
        await setCurrentTagId(item.tagId)
      }

      if (!isMobileRoute) {
        // PC 端：切换到记录标签页
        await setLeftSidebarTab('notes')
      } else {
        // 移动端：进入记录页
        router.push('/mobile/record')
      }

      emitter.emit(EmitterRecordEvents.refreshMarks)

      return
    }
    
    onOpenChange(false)
    setPendingScrollMarkId(null)

    // PC 端切换到笔记标签页；移动端直接跳转写作页
    if (!isMobileRoute) {
      await setLeftSidebarTab('files')
    }
    
    // 如果是文章类型，跳转到文章页面
    if (item.firstMatchIndex !== undefined) {
      setMatchPosition(item.firstMatchIndex)
    }
    setPendingSearchKeyword(searchValue.trim())
    
    const filePath = item.path as string
    
    const setupAndNavigate = async () => {
      // 展开文件夹路径
      const pathParts = filePath.split('/')
      pathParts.pop()
      
      let currentPath = ''
      for (const part of pathParts) {
        if (currentPath) {
          currentPath += '/' + part
        } else {
          currentPath = part
        }
        
        if (currentPath) {
          await setCollapsibleList(currentPath, true)
        }
      }
      
      // 设置活动文件路径
      await setActiveFilePath(filePath)
      
      // 读取文件内容
      const { readArticle } = useArticleStore.getState()
      await readArticle(filePath)
      
      // 跳转到对应平台页面
      router.push(isMobileRoute ? '/mobile/writing' : '/core/main')
    }
    
    setupAndNavigate()
  }

  useEffect(() => {
    if (open) {
      loadAllArticle()
      fetchAllMarks()
      fetchTags()
    }
  }, [open])

  useEffect(() => {
    const loadSearchFilter = async () => {
      const store = await Store.load('store.json')
      const savedFilter = await store.get<SearchFilter>('globalSearchFilter')
      if (savedFilter === 'all' || savedFilter === 'record' || savedFilter === 'article') {
        setSearchFilter(savedFilter)
      }
    }

    loadSearchFilter()
  }, [])

  useEffect(() => {
    const persistSearchFilter = async () => {
      const store = await Store.load('store.json')
      await store.set('globalSearchFilter', searchFilter)
    }

    persistSearchFilter()
  }, [searchFilter])

  useEffect(() => {
    debouncedSearch(searchValue)
  }, [searchValue, debouncedSearch])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 60)
    return () => clearTimeout(timer)
  }, [open, isMobileRoute])

  const searchContent = (
    <>
      <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <CommandInput
            ref={searchInputRef}
            autoFocus
            placeholder={t('search.placeholder')}
            value={searchValue}
            onValueChange={setSearchValue}
            className="h-10 text-base font-medium"
          />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-sm font-semibold tracking-tight text-foreground/90">
            {t('search.results', { count: filteredSearchResult.length })}
          </div>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 p-1">
            <Button
              type="button"
              variant={searchFilter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSearchFilter('all')}
            >
              {t('common.all')}
            </Button>
            <Button
              type="button"
              variant={searchFilter === 'record' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSearchFilter('record')}
            >
              {t('search.item.record')}
            </Button>
            <Button
              type="button"
              variant={searchFilter === 'article' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSearchFilter('article')}
            >
              {t('search.item.article')}
            </Button>
          </div>
        </div>
      </div>
      <CommandList className={isMobileRoute ? "h-[64vh] max-h-[64vh]" : "min-h-0 flex-1 max-h-none"}>
        {!searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.placeholder')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {filteredSearchResult.length === 0 && searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.noResults')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {searchResult.length > 0 && (
          <CommandGroup>
            <div className="flex flex-col divide-y divide-border/60">
              {filteredSearchResult.map((item) => {
              const resultMeta = getResultMeta(item)
              const MetaIcon = resultMeta.icon
              return (
                <CommandItem
                  key={item.id}
                  value={`${item.searchType}-${item.title || item.path}`}
                  onSelect={() => handleSelect(item)}
                  className={cn(
                    isMobileRoute
                      ? "group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                      : "group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                  )}
                >
                  {isMobileRoute ? (
                    <div className="w-full py-3">
                      <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                        <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", getResultTone(item))}>
                          {item.searchType === 'record' ? (
                            <NotebookPen className="size-3.5" />
                          ) : (
                            <File className="size-3.5" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {item.title ? (
                                <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {highlightTextReact(item.title, searchValue)}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {item.type ? (
                                  <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] capitalize">
                                    {item.type}
                                  </Badge>
                                ) : null}
                                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <MetaIcon className="size-3 shrink-0" />
                                  <span className="max-w-[120px] truncate">{resultMeta.primary}</span>
                                </div>
                            </div>
                          </div>

                          <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {highlightTextReact(item.highlightText, searchValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full py-3">
                      <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                        <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", getResultTone(item))}>
                          {item.searchType === 'record' ? (
                            <NotebookPen className="size-3.5" />
                          ) : (
                            <File className="size-3.5" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                          <div className="flex min-w-0 items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              {item.title && (
                                <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {highlightTextReact(item.title, searchValue)}
                                </div>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {item.type ? (
                                  <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] capitalize">
                                    {item.type}
                                  </Badge>
                                ) : null}
                                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <MetaIcon className="size-3 shrink-0" />
                                  <span className="max-w-[180px] truncate">{resultMeta.primary}</span>
                                </div>
                            </div>
                          </div>

                          <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                            {highlightTextReact(item.highlightText, searchValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CommandItem>
              )
            })}
            </div>
          </CommandGroup>
        )}
      </CommandList>
    </>
  )

  if (isMobileRoute) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[88vh] rounded-t-[28px] border-border/70 bg-background p-0 shadow-2xl">
          <div className="min-h-0 flex-1 px-3 pb-3 pt-3">
        <Command
          shouldFilter={false}
          className={cn(
            "h-full rounded-[22px] border border-border/70 bg-background shadow-sm",
            "[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-tight [&_[cmdk-group-heading]]:text-foreground/85",
                "[&_[cmdk-group]]:px-0 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-0",
                "[&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input-wrapper]_svg]:text-muted-foreground",
                "[&_[cmdk-input]]:h-10 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-medium [&_[cmdk-input]]:tracking-tight [&_[cmdk-input]]:placeholder:text-muted-foreground/60",
                "[&_[cmdk-list]]:px-0 [&_[cmdk-list]]:py-2 [&_[cmdk-item]]:rounded-2xl [&_[cmdk-item]]:px-0 [&_[cmdk-item]]:py-0"
              )}
            >
              {searchContent}
            </Command>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="h-[56vh] max-h-[56vh] max-w-4xl overflow-hidden border-border/70 bg-background p-0 shadow-2xl">
        <DialogTitle className="sr-only">{t('search.placeholder')}</DialogTitle>
        <Command
          shouldFilter={false}
          className={cn(
            "h-full bg-transparent",
            "[&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-base [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-tight [&_[cmdk-group-heading]]:text-foreground/85",
            "[&_[cmdk-group]]:px-0 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-0",
            "[&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input-wrapper]_svg]:text-muted-foreground",
            "[&_[cmdk-input]]:h-10 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-medium [&_[cmdk-input]]:tracking-tight [&_[cmdk-input]]:placeholder:text-muted-foreground/60",
            "[&_[cmdk-list]]:px-0 [&_[cmdk-list]]:py-2"
          )}
        >
          {searchContent}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
