'use client'

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  FolderInput,
  FolderOpen,
  Gamepad2,
  Globe2,
  HelpCircle,
  Layers,
  Monitor,
  Palette,
  Plus,
  Shield,
  Smartphone,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type CategoryType = 'all' | 'uncategorized' | 'custom' | 'default' | 'extra'

interface CategoryItemData {
  value: string
  label: string
  count: number
  type: CategoryType
}

function getCategoryIcon(category: string, type: CategoryType) {
  if (type === 'all') return <Layers className="size-4 text-amber-500" />
  if (type === 'uncategorized') return <HelpCircle className="size-4 text-slate-400" />
  const value = category.toLowerCase()
  if (value.includes('教育') || value.includes('learning') || value.includes('course')) return <BookOpen className="size-4 text-emerald-500" />
  if (value.includes('ai') || value.includes('机器') || value.includes('llm') || value.includes('prompt')) return <Bot className="size-4 text-violet-500" />
  if (value.includes('web') || value.includes('前端')) return <Globe2 className="size-4 text-sky-500" />
  if (value.includes('移动') || value.includes('ios') || value.includes('android')) return <Smartphone className="size-4 text-indigo-500" />
  if (value.includes('桌面') || value.includes('electron') || value.includes('tauri')) return <Monitor className="size-4 text-cyan-500" />
  if (value.includes('数据') || value.includes('database')) return <Database className="size-4 text-purple-500" />
  if (value.includes('安全') || value.includes('security')) return <Shield className="size-4 text-blue-500" />
  if (value.includes('游戏') || value.includes('game')) return <Gamepad2 className="size-4 text-fuchsia-500" />
  if (value.includes('设计') || value.includes('design')) return <Palette className="size-4 text-rose-500" />
  if (value.includes('效率') || value.includes('productivity')) return <Zap className="size-4 text-orange-500" />
  if (value.includes('工具') || value.includes('tool')) return <Wrench className="size-4 text-slate-500" />
  return <Code2 className="size-4 text-muted-foreground" />
}

function CategoryItem({
  category,
  active,
  collapsed,
  onSelect,
  onDelete,
}: {
  category: CategoryItemData
  active: boolean
  collapsed: boolean
  onSelect: (value: string) => void
  onDelete?: (value: string) => void
}) {
  const isSpecial = category.type === 'all' || category.type === 'uncategorized'

  const inner = (
    <button
      type="button"
      onClick={() => onSelect(category.value)}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        collapsed ? 'lg:size-8 lg:justify-center lg:px-0' : 'lg:w-full',
        active
          ? isSpecial
            ? 'bg-primary/10 text-primary font-medium'
            : 'bg-muted text-foreground'
          : isSpecial
            ? 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      title={category.label}
    >
      <span className="shrink-0">{getCategoryIcon(category.label, category.type)}</span>
      {!collapsed ? (
        <>
          <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}>{category.label}</span>
          <span className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
            active
              ? isSpecial ? 'bg-primary/20 text-primary' : 'bg-background'
              : 'text-muted-foreground/60',
          )}>
            {category.count}
          </span>
        </>
      ) : null}
    </button>
  )

  // Only custom categories get a context menu for deletion
  if (onDelete && category.type === 'custom') {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{inner}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDelete(category.value)}
          >
            <Trash2 className="mr-2 size-4" />
            删除分类「{category.label}」
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return inner
}

function SectionLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  if (collapsed) return null
  return (
    <div className="mt-3 mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
      {children}
    </div>
  )
}

function DesktopSidebar({
  categories,
  selected,
  collapsed,
  sidebarWidth,
  onSelect,
  onToggleCollapse,
  onSidebarWidthChange,
  onAddCategory,
  onDeleteCategory,
}: {
  categories: CategoryItemData[]
  selected: string
  collapsed: boolean
  sidebarWidth: number
  onSelect: (value: string) => void
  onToggleCollapse: () => void
  onSidebarWidthChange: (width: number) => void
  onAddCategory: () => void
  onDeleteCategory: (name: string) => void
}) {
  const [isResizing, setIsResizing] = useState(false)
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsResizing(true)
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current
      if (!state) return

      const nextWidth = Math.min(420, Math.max(180, state.startWidth + moveEvent.clientX - state.startX))
      onSidebarWidthChange(nextWidth)
    }

    const handlePointerUp = () => {
      resizeStateRef.current = null
      setIsResizing(false)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [onSidebarWidthChange, sidebarWidth])

  // Group categories by type
  const specialItems = categories.filter(c => c.type === 'all' || c.type === 'uncategorized')
  const customItems = categories.filter(c => c.type === 'custom')
  const defaultItems = categories.filter(c => c.type === 'default')
  const extraItems = categories.filter(c => c.type === 'extra')

  const totalCount = categories.find(c => c.value === 'all')?.count || 0

  return (
    <aside
      className={cn(
        'relative w-full shrink-0 border-b bg-background/70 hidden lg:flex lg:border-b-0 lg:border-r lg:flex-col will-change-[width]',
        !isResizing && 'transition-[width] duration-200 ease-out',
        collapsed ? 'lg:w-12' : 'lg:w-[var(--github-stars-sidebar-width)]',
      )}
      style={collapsed ? undefined : { '--github-stars-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-3 pt-3 pb-2">
          <div className="flex h-7 items-center justify-between gap-2">
            {!collapsed ? (
              <div className="flex min-w-0 items-center gap-2">
                <FolderOpen className="size-4 text-muted-foreground" />
                <h2 className="truncate text-sm font-medium">分类</h2>
                <span className="text-[11px] text-muted-foreground/60">{totalCount}</span>
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-0.5">
              {!collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" onClick={onAddCategory}>
                      <Plus className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">添加自定义分类</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" onClick={onToggleCollapse}>
                    {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{collapsed ? '展开分类' : '折叠分类'}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Scrollable category list */}
        <ScrollArea className="min-h-0 flex-1 pb-2">
          <div className={cn('flex flex-col px-2', collapsed && 'items-center px-0')}>
            {/* Special: All + Uncategorized */}
            {specialItems.map(category => (
              <CategoryItem
                key={category.value}
                category={category}
                active={selected === category.value}
                collapsed={collapsed}
                onSelect={onSelect}
              />
            ))}

            {/* Custom categories */}
            {customItems.length > 0 ? (
              <>
                <SectionLabel collapsed={collapsed}>自定义</SectionLabel>
                {customItems.map(category => (
                  <CategoryItem
                    key={category.value}
                    category={category}
                    active={selected === category.value}
                    collapsed={collapsed}
                    onSelect={onSelect}
                    onDelete={onDeleteCategory}
                  />
                ))}
              </>
            ) : null}

            {/* Default categories */}
            {defaultItems.length > 0 ? (
              <>
                <SectionLabel collapsed={collapsed}>自动分类</SectionLabel>
                {defaultItems.map(category => (
                  <CategoryItem
                    key={category.value}
                    category={category}
                    active={selected === category.value}
                    collapsed={collapsed}
                    onSelect={onSelect}
                  />
                ))}
              </>
            ) : null}

            {/* Extra categories */}
            {extraItems.length > 0 ? (
              <>
                <SectionLabel collapsed={collapsed}>其他</SectionLabel>
                {extraItems.map(category => (
                  <CategoryItem
                    key={category.value}
                    category={category}
                    active={selected === category.value}
                    collapsed={collapsed}
                    onSelect={onSelect}
                  />
                ))}
              </>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      {/* Resize handle */}
      {!collapsed ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 top-0 w-3 cursor-col-resize"
          style={{ transform: 'translateX(50%)' }}
          onPointerDown={handleResizeStart}
        >
          <div
            className={cn(
              'pointer-events-none absolute bottom-2 right-[5px] top-2 w-px rounded-full transition-colors',
              isResizing ? 'bg-primary/50' : 'bg-border/60',
            )}
          />
        </div>
      ) : null}
    </aside>
  )
}

export function CategorySidebar({
  categories,
  selected,
  collapsed,
  sidebarWidth,
  onSelect,
  onToggleCollapse,
  onSidebarWidthChange,
  onAddCategory,
  onDeleteCategory,
}: {
  categories: CategoryItemData[]
  selected: string
  collapsed: boolean
  sidebarWidth: number
  onSelect: (value: string) => void
  onToggleCollapse: () => void
  onSidebarWidthChange: (width: number) => void
  onAddCategory: () => void
  onDeleteCategory: (name: string) => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const activeLabel = categories.find(c => c.value === selected)?.label || '全部分类'
  const activeCount = categories.find(c => c.value === selected)?.count || 0

  const handleMobileSelect = (value: string) => {
    onSelect(value)
    setMobileOpen(false)
  }

  // Group for mobile
  const specialItems = categories.filter(c => c.type === 'all' || c.type === 'uncategorized')
  const customItems = categories.filter(c => c.type === 'custom')
  const defaultItems = categories.filter(c => c.type === 'default')
  const extraItems = categories.filter(c => c.type === 'extra')

  return (
    <>
      {/* Mobile: Sheet drawer with controlled open state */}
      <div className="flex items-center gap-2 border-b bg-background/70 px-3 py-2 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <FolderInput className="size-3.5" />
              {activeLabel}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">
                {activeCount}
              </span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] p-0">
            <SheetHeader className="border-b px-4 py-3">
              <div className="flex items-center justify-between">
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <FolderOpen className="size-4" />
                  分类筛选
                </SheetTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" onClick={onAddCategory}>
                      <Plus className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>添加自定义分类</TooltipContent>
                </Tooltip>
              </div>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-60px)]">
              <div className="flex flex-col gap-0.5 p-3">
                {specialItems.map(category => (
                  <CategoryItem
                    key={category.value}
                    category={category}
                    active={selected === category.value}
                    collapsed={false}
                    onSelect={handleMobileSelect}
                  />
                ))}

                {customItems.length > 0 ? (
                  <>
                    <SectionLabel collapsed={false}>自定义</SectionLabel>
                    {customItems.map(category => (
                      <CategoryItem
                        key={category.value}
                        category={category}
                        active={selected === category.value}
                        collapsed={false}
                        onSelect={handleMobileSelect}
                        onDelete={onDeleteCategory}
                      />
                    ))}
                  </>
                ) : null}

                {defaultItems.length > 0 ? (
                  <>
                    <SectionLabel collapsed={false}>自动分类</SectionLabel>
                    {defaultItems.map(category => (
                      <CategoryItem
                        key={category.value}
                        category={category}
                        active={selected === category.value}
                        collapsed={false}
                        onSelect={handleMobileSelect}
                      />
                    ))}
                  </>
                ) : null}

                {extraItems.length > 0 ? (
                  <>
                    <SectionLabel collapsed={false}>其他</SectionLabel>
                    {extraItems.map(category => (
                      <CategoryItem
                        key={category.value}
                        category={category}
                        active={selected === category.value}
                        collapsed={false}
                        onSelect={handleMobileSelect}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: Resizable sidebar */}
      <DesktopSidebar
        categories={categories}
        selected={selected}
        collapsed={collapsed}
        sidebarWidth={sidebarWidth}
        onSelect={onSelect}
        onToggleCollapse={onToggleCollapse}
        onSidebarWidthChange={onSidebarWidthChange}
        onAddCategory={onAddCategory}
        onDeleteCategory={onDeleteCategory}
      />
    </>
  )
}
