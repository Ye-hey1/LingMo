'use client'

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Star } from 'lucide-react'
import { useTranslations } from 'next-intl'

import useArticleStore from '@/stores/article'
import useFavoritesStore from '@/stores/favorites'

import { KnowledgeGraphTagsPanel } from './knowledge-graph-tags-panel'

interface FavoritesSectionProps {
  showEmpty?: boolean
  standalone?: boolean
}

function FavoriteNameLabel({ name }: { name: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scrollState, setScrollState] = useState({ enabled: false, distance: 0, duration: 5 })

  const updateScrollState = useCallback(() => {
    const wrap = wrapRef.current
    const text = textRef.current
    if (!wrap || !text) return

    const distance = Math.ceil(text.scrollWidth - wrap.clientWidth)
    setScrollState({
      enabled: distance > 6,
      distance: Math.max(0, distance),
      duration: Math.min(12, Math.max(4, distance / 18)),
    })
  }, [])

  useEffect(() => {
    updateScrollState()
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(wrap)

    return () => resizeObserver.disconnect()
  }, [name, updateScrollState])

  const style = {
    '--favorite-name-scroll-distance': `${scrollState.distance}px`,
    '--favorite-name-scroll-duration': `${scrollState.duration}s`,
  } as CSSProperties

  return (
    <span
      ref={wrapRef}
      className={`favorite-file-name block min-w-0 max-w-full flex-1 overflow-hidden whitespace-nowrap text-foreground ${scrollState.enabled ? 'is-scrollable' : ''}`}
      style={style}
      title={name}
      onMouseEnter={updateScrollState}
    >
      <span ref={textRef} className="favorite-file-name-text inline-block whitespace-nowrap align-bottom">
        {name}
      </span>
    </span>
  )
}

export function FavoritesSection({ showEmpty = false, standalone = false }: FavoritesSectionProps) {
  const t = useTranslations()
  const { favorites, removeFavorite, initFavorites } = useFavoritesStore()
  const { setActiveFilePath } = useArticleStore()
  const [isExpanded, setIsExpanded] = useState(true)

  useEffect(() => {
    void initFavorites()
  }, [initFavorites])

  const favoriteList = (
    <section className={standalone ? 'overflow-hidden rounded-lg border border-border/60 bg-background' : ''}>
      <button
        type="button"
        className={standalone
          ? 'flex h-9 w-full items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
          : 'flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Star className="size-3.5 text-muted-foreground" />
        <span>{t('navigation.favorites')}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
          {favorites.length}
        </span>
      </button>

      {isExpanded ? (
        <div className={standalone ? 'p-1.5' : 'space-y-0.5 px-2 pb-1'}>
          {favorites.length > 0 ? favorites.map((fav) => (
            <div
              key={fav.path}
              className="favorite-file-row group flex h-9 min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-sm leading-none whitespace-nowrap transition-colors hover:bg-muted/55"
              onClick={() => setActiveFilePath(fav.path)}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <FavoriteNameLabel name={fav.name} />
              <button
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-amber-500 opacity-100 transition hover:bg-background hover:text-amber-600"
                onClick={(event) => {
                  event.stopPropagation()
                  void removeFavorite(fav.path)
                }}
                title={t('navigation.removeFavorite')}
              >
                <Star className="size-3.5" fill="currentColor" />
              </button>
            </div>
          )) : (
            <div className="flex flex-col items-center justify-center px-5 py-7 text-center">
              <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted/55 text-muted-foreground">
                <Star className="size-4" />
              </div>
              <p className="text-sm font-medium text-foreground">还没有收藏</p>
              <p className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">
                悬停在文件行上，点击右侧星标即可加入收藏夹。
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )

  if (favorites.length === 0 && !showEmpty && !standalone) {
    return null
  }

  if (standalone) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
          {favoriteList}
          <KnowledgeGraphTagsPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="border-b">
      {favoriteList}
    </div>
  )
}
