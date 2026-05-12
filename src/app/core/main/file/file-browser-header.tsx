"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Braces,
  DraftingCompass,
  FileText,
  FolderTree,
  ListFilter,
  Search,
  X,
  FileType2,
} from "lucide-react"
import { useTranslations } from "next-intl"

import type { FileBrowserFilter, FileBrowserStats } from "./file-browser-utils"

const FILTER_ITEMS: Array<{
  value: FileBrowserFilter
  icon: typeof FileText
}> = [
  { value: "all", icon: FileType2 },
  { value: "markdown", icon: FileText },
  { value: "pdf", icon: FileType2 },
  { value: "drawio", icon: DraftingCompass },
  { value: "json", icon: Braces },
  { value: "folder", icon: FolderTree },
]

const FILTER_LABELS: Record<FileBrowserFilter, string> = {
  all: "全部",
  markdown: "Markdown",
  pdf: "PDF",
  drawio: "Draw.io",
  json: "JSON",
  folder: "文件夹",
}

interface FileBrowserHeaderProps {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  activeFilter: FileBrowserFilter
  onFilterChange: (value: FileBrowserFilter) => void
  visibleStats: FileBrowserStats
  totalStats: FileBrowserStats
}

export function FileBrowserHeader({
  searchQuery,
  onSearchQueryChange,
  activeFilter,
  onFilterChange,
  visibleStats: _visibleStats,
  totalStats: _totalStats,
}: FileBrowserHeaderProps) {
  const tBrowser = useTranslations("article.file.browser")

  const activeFilterLabel = FILTER_LABELS[activeFilter]

  return (
    <div className="border-b bg-muted/25 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={tBrowser("searchPlaceholder")}
            className="h-7 rounded-md border-border/70 bg-background/85 pl-7 pr-7 text-xs shadow-none focus-visible:ring-1"
          />
          {searchQuery ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2 rounded-sm"
              onClick={() => onSearchQueryChange("")}
              aria-label={tBrowser("clearSearch")}
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 rounded-md bg-background/85 px-2 text-xs font-normal text-muted-foreground shadow-none"
              aria-label={tBrowser("filters.all")}
            >
              <ListFilter className="size-3.5" />
              <span className="max-w-14 truncate">{activeFilterLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {FILTER_ITEMS.map(({ value, icon: Icon }) => (
              <DropdownMenuItem key={value} onClick={() => onFilterChange(value)} className={activeFilter === value ? "bg-accent" : ""}>
                <Icon className="mr-2 h-4 w-4" />
                {FILTER_LABELS[value]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {searchQuery || activeFilter !== "all" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 rounded-md px-1.5 text-[11px] text-muted-foreground"
            onClick={() => {
              onSearchQueryChange("")
              onFilterChange("all")
            }}
          >
            {tBrowser("reset")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
