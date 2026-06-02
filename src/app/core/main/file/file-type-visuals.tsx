import {
  Braces,
  Clock3,
  Code2,
  DraftingCompass,
  File,
  FileCode2,
  FileText,
  FileType2,
  FolderTree,
  ImageIcon,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import type { FileBrowserFilter } from "./file-browser-utils"

type FileVisualTone = "slate" | "blue" | "orange" | "rose" | "teal" | "violet" | "emerald" | "amber" | "cyan"

export type FileVisualInfo = {
  label: string
  icon: LucideIcon
  tone: FileVisualTone
  className: string
}

export const FILTER_LABELS: Record<FileBrowserFilter, string> = {
  all: "全部",
  markdown: "Markdown",
  html: "HTML",
  pdf: "PDF",
  drawio: "Draw.io",
  json: "JSON",
  folder: "文件夹",
  "recent-created": "最近创建",
  generated: "生成文件",
}

export const FILTER_ITEMS: Array<{
  value: FileBrowserFilter
  icon: LucideIcon
  className: string
}> = [
  { value: "all", icon: FileType2, className: "text-slate-500" },
  { value: "markdown", icon: FileText, className: "text-blue-600 dark:text-blue-400" },
  { value: "html", icon: Code2, className: "text-orange-600 dark:text-orange-400" },
  { value: "pdf", icon: FileText, className: "text-rose-600 dark:text-rose-400" },
  { value: "drawio", icon: DraftingCompass, className: "text-teal-600 dark:text-teal-400" },
  { value: "json", icon: Braces, className: "text-violet-600 dark:text-violet-400" },
  { value: "folder", icon: FolderTree, className: "text-amber-600 dark:text-amber-400" },
  { value: "recent-created", icon: Clock3, className: "text-cyan-600 dark:text-cyan-400" },
  { value: "generated", icon: Sparkles, className: "text-amber-600 dark:text-amber-400" },
]

const FILE_VISUALS = {
  markdown: {
    label: "Markdown",
    icon: FileText,
    tone: "blue",
    className: "text-blue-600 dark:text-blue-400",
  },
  html: {
    label: "HTML",
    icon: Code2,
    tone: "orange",
    className: "text-orange-600 dark:text-orange-400",
  },
  pdf: {
    label: "PDF",
    icon: FileText,
    tone: "rose",
    className: "text-rose-600 dark:text-rose-400",
  },
  drawio: {
    label: "Draw.io",
    icon: DraftingCompass,
    tone: "teal",
    className: "text-teal-600 dark:text-teal-400",
  },
  json: {
    label: "JSON",
    icon: Braces,
    tone: "violet",
    className: "text-violet-600 dark:text-violet-400",
  },
  image: {
    label: "图片",
    icon: ImageIcon,
    tone: "emerald",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  code: {
    label: "代码",
    icon: FileCode2,
    tone: "cyan",
    className: "text-cyan-600 dark:text-cyan-400",
  },
  text: {
    label: "文本",
    icon: FileText,
    tone: "slate",
    className: "text-slate-600 dark:text-slate-300",
  },
  generic: {
    label: "文件",
    icon: File,
    tone: "slate",
    className: "text-muted-foreground",
  },
} satisfies Record<string, FileVisualInfo>

export function getFileVisualInfo(fileName: string): FileVisualInfo {
  if (/\.(md|markdown)$/i.test(fileName)) return FILE_VISUALS.markdown
  if (/\.html?$/i.test(fileName)) return FILE_VISUALS.html
  if (/\.pdf$/i.test(fileName)) return FILE_VISUALS.pdf
  if (/\.(drawio|drawio\.xml|excalidraw|excalidraw\.json|diagram\.json)$/i.test(fileName)) return FILE_VISUALS.drawio
  if (/\.json$/i.test(fileName)) return FILE_VISUALS.json
  if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(fileName)) return FILE_VISUALS.image
  if (/\.(py|js|ts|jsx|tsx|css|scss|less|xml|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i.test(fileName)) {
    return FILE_VISUALS.code
  }
  if (/\.txt$/i.test(fileName)) return FILE_VISUALS.text

  return FILE_VISUALS.generic
}

export function FileTypeIcon({
  fileName,
  className,
  muted = false,
}: {
  fileName: string
  className?: string
  muted?: boolean
}) {
  const visual = getFileVisualInfo(fileName)
  const Icon = visual.icon

  return (
    <Icon
      className={cn(
        className,
        visual.className,
        muted && "opacity-65",
      )}
      aria-label={visual.label}
    />
  )
}
