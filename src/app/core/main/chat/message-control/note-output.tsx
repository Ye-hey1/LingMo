'use client'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { extractTitle } from "@/lib/markdown"
import { getFilePathOptions, getWorkspacePath, getGenericPathOptions } from "@/lib/workspace"
import useTagStore from "@/stores/tag"
import { CheckedState } from "@radix-ui/react-checkbox"
import { BaseDirectory, readDir, writeTextFile } from "@tauri-apps/plugin-fs"
import { SquarePen, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Chat } from "@/db/chats"
import { useTranslations } from "next-intl"
import useArticleStore from "@/stores/article"
import { useSidebarStore } from "@/stores/sidebar"
import { getMarks, deleteMarks, TRASH_RETENTION_DAYS } from "@/db/marks"

export function NoteOutput({chat, compact = false}: {chat: Chat, compact?: boolean}) {
  const { deleteTag, currentTagId, tags } = useTagStore()
  const { loadFileTree, setActiveFilePath } = useArticleStore()
  const { centerPanelVisible, toggleCenterPanel } = useSidebarStore()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('/')
  const [folders, setFolders] = useState<string[]>([])
  const [isRemove, setIsRemove] = useState<CheckedState>(true)
  const [transforming, setTransforming] = useState(false)
  const t = useTranslations('record.chat')
  const chatTag = tags.find(tag => tag.id === chat?.tagId)
  const isChatTagLocked = Boolean(chatTag?.isLocked)
  const actionButtonClass = compact
    ? "inline-flex size-6 cursor-pointer items-center justify-center rounded-none p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
    : "inline-flex size-6.5 cursor-pointer items-center justify-center rounded-none p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"

  async function handleTransform() {
    setTransforming(true)
    try {
      const content = chat?.content || ''
      const sanitizedTitle = title.replace(/\s+/g, '_')
      const writePath = `${path}/${sanitizedTitle}`
      
      const pathOptions = await getFilePathOptions(writePath)
      if (pathOptions.baseDir) {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      } else {
        await writeTextFile(pathOptions.path, content)
      }
      
      if (isRemove) {
        // 将该标签下的记录软删除（移入回收站，保留 ${TRASH_RETENTION_DAYS} 天可恢复）
        const marks = await getMarks(currentTagId)
        const markIds = marks.filter(m => m.deleted === 0).map(m => m.id)
        if (markIds.length > 0) {
          await deleteMarks(markIds)
        }
        await deleteTag(currentTagId)
      }
      setOpen(false)
      await loadFileTree()
      await setActiveFilePath(writePath)
      if (!centerPanelVisible) {
        await toggleCenterPanel()
      }
    } finally {
      setTransforming(false)
    }
  }

  async function readArticleDir() {
    const workspace = await getWorkspacePath()
    let folders = []
    
    if (workspace.isCustom) {
      const pathOptions = await getGenericPathOptions('', '')
      const dirs = (await readDir(pathOptions.path)).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
      folders = dirs
    } else {
      const dirs = (await readDir('article', { baseDir: BaseDirectory.AppData })).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
      folders = dirs
    }
    
    setFolders(folders)
  }

  useEffect(() => {
    setIsRemove(!isChatTagLocked)
    setTitle(extractTitle(chat?.content || '') + '.md')
    readArticleDir()
  }, [chat, isChatTagLocked])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <a className={actionButtonClass}>
          <SquarePen className="size-4" />
        </a>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 p-3">
        <div className="space-y-2.5">
          <div className="text-xs font-medium">{t('note.convert')}</div>
          <div className="flex items-center gap-1 rounded-md border border-border">
            <Select value={path} onValueChange={setPath}>
              <SelectTrigger className="h-8 w-[120px] shrink-0 border-0 text-xs shadow-none focus:ring-0">
                <SelectValue placeholder={t('note.selectFolder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="/">{t('note.rootDirectory')}</SelectItem>
                  {folders.map((folder, index) => (
                    <SelectItem key={index} value={folder}>{folder}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="h-4 w-px bg-border" />
            <Input
              className="h-8 border-0 text-xs shadow-none focus-visible:ring-0"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Checkbox
                disabled={isChatTagLocked}
                id={`remove-${chat.id}`}
                checked={isRemove}
                onCheckedChange={value => setIsRemove(value)}
                className="size-3.5"
              />
              <label htmlFor={`remove-${chat.id}`} className="text-[11px] text-muted-foreground">
                {t('note.deleteTag')}（{TRASH_RETENTION_DAYS}天内可恢复）
              </label>
            </div>
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={!title.trim() || transforming}
              onClick={handleTransform}
            >
              {transforming ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
              {t('note.convert_button')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
