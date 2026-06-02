"use client"

import { useEffect, useState } from "react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { Loader2, RotateCcw, Trash2, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "@/hooks/use-toast"
import {
  deleteWorkspaceTrashEntries,
  emptyWorkspaceTrash,
  getWorkspaceTrashEntries,
  restoreWorkspaceTrashEntry,
  type WorkspaceTrashEntry,
} from "@/lib/file-trash"
import useArticleStore from "@/stores/article"

function formatDeletedAt(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

function getParentPath(path: string) {
  return path.split('/').slice(0, -1).join('/')
}

export function FileTrashDialog() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<WorkspaceTrashEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)
  const { ensurePathExpanded, loadFileTree, setActiveFilePath } = useArticleStore()

  async function refreshTrashEntries() {
    setLoading(true)
    try {
      setEntries(await getWorkspaceTrashEntries())
    } catch (error) {
      console.error('读取文件回收站失败:', error)
      toast({
        title: '读取回收站失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      void refreshTrashEntries()
    }
  }, [open])

  async function handleRestore(entry: WorkspaceTrashEntry) {
    setBusyId(entry.id)
    try {
      const restored = await restoreWorkspaceTrashEntry(entry.id)
      await loadFileTree({ skipRemoteSync: true })

      const parentPath = getParentPath(restored.restoredPath)
      if (parentPath) {
        await ensurePathExpanded(parentPath)
      }

      if (restored.kind === 'file') {
        await setActiveFilePath(restored.restoredPath)
      }

      toast({
        title: '已还原',
        description: restored.restoredPath,
      })
      await refreshTrashEntries()
    } catch (error) {
      console.error('还原文件失败:', error)
      toast({
        title: '还原失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDeleteForever(entry: WorkspaceTrashEntry) {
    const confirmed = await confirm(`确定要彻底删除「${entry.name}」吗？此操作不可恢复。`, {
      title: '彻底删除',
      kind: 'warning',
    })

    if (!confirmed) return

    setBusyId(entry.id)
    try {
      await deleteWorkspaceTrashEntries([entry.id])
      toast({ title: '已彻底删除' })
      await refreshTrashEntries()
    } catch (error) {
      console.error('彻底删除文件失败:', error)
      toast({
        title: '彻底删除失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function handleEmptyTrash() {
    const confirmed = await confirm('确定要清空文件回收站吗？此操作不可恢复。', {
      title: '清空文件回收站',
      kind: 'warning',
    })

    if (!confirmed) return

    setEmptying(true)
    try {
      await emptyWorkspaceTrash()
      setEntries([])
      toast({ title: '文件回收站已清空' })
    } catch (error) {
      console.error('清空文件回收站失败:', error)
      toast({
        title: '清空回收站失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
      await refreshTrashEntries()
    } finally {
      setEmptying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-md text-muted-foreground"
          title="文件回收站"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>文件回收站</DialogTitle>
          <DialogDescription>
            删除的本地文件会先移动到这里，可以还原或彻底删除。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{entries.length} 个文件可还原</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-md px-2 text-xs"
            disabled={entries.length === 0 || emptying || loading}
            onClick={handleEmptyTrash}
          >
            {emptying ? <Loader2 className="mr-1 size-3 animate-spin" /> : <XCircle className="mr-1 size-3" />}
            清空
          </Button>
        </div>

        <ScrollArea className="h-[320px] rounded-md border">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在读取回收站
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              回收站为空
            </div>
          ) : (
            <div className="divide-y">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{entry.originalPath}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDeletedAt(entry.deletedAt)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-md"
                    disabled={busyId === entry.id || emptying}
                    onClick={() => handleRestore(entry)}
                    title="还原"
                  >
                    {busyId === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-md text-red-600"
                    disabled={busyId === entry.id || emptying}
                    onClick={() => handleDeleteForever(entry)}
                    title="彻底删除"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
