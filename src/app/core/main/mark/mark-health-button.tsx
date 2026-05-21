'use client'

import { Activity } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BottomBarIconButton } from '@/components/bottom-bar-icon-button'
import { restoreMarks } from '@/db/marks'
import { toast } from '@/hooks/use-toast'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'

export function MarkHealthButton() {
  const [healthOpen, setHealthOpen] = useState(false)
  const {
    allMarks,
    fetchAllMarks,
    fetchMarks,
    trashState,
  } = useMarkStore()
  const { tags, fetchTags, getCurrentTag } = useTagStore()

  useEffect(() => {
    void fetchAllMarks()
  }, [fetchAllMarks, trashState])

  const health = useMemo(() => {
    const tagIds = new Set(tags.map(tag => tag.id))
    const activeMarks = allMarks.filter(mark => mark.deleted === 0)
    const trashMarks = allMarks.filter(mark => mark.deleted === 1)
    const orphanMarks = allMarks.filter(mark => !tagIds.has(mark.tagId))

    return {
      tagCount: tags.length,
      activeCount: activeMarks.length,
      trashCount: trashMarks.length,
      orphanCount: orphanMarks.length,
      trashIds: trashMarks.map(mark => mark.id),
    }
  }, [allMarks, tags])

  const handleRestoreTrash = async () => {
    if (health.trashIds.length === 0) return
    await restoreMarks(health.trashIds)
    await fetchAllMarks()
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
    toast({
      title: '已恢复回收站记录',
      description: `${health.trashIds.length} 条记录`,
    })
  }

  return (
    <Popover open={healthOpen} onOpenChange={setHealthOpen}>
      <PopoverTrigger asChild>
        <span>
          <BottomBarIconButton
            icon={<Activity className="size-3" />}
            label="记录健康检查"
            active={health.trashCount > 0 || health.orphanCount > 0}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 p-3">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">记录健康检查</div>
            <p className="text-xs text-muted-foreground">快速确认标签、正常记录、回收站和孤儿记录状态。</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">标签</div>
              <div className="mt-1 text-lg font-semibold">{health.tagCount}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">正常记录</div>
              <div className="mt-1 text-lg font-semibold">{health.activeCount}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">回收站</div>
              <div className="mt-1 text-lg font-semibold">{health.trashCount}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">孤儿记录</div>
              <div className="mt-1 text-lg font-semibold">{health.orphanCount}</div>
            </div>
          </div>
          {health.trashCount > 0 ? (
            <Button size="sm" variant="outline" className="h-8 w-full text-xs" onClick={handleRestoreTrash}>
              恢复回收站 {health.trashCount} 条记录
            </Button>
          ) : null}
          {health.orphanCount > 0 ? (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              检测到孤儿记录。重新进入记录页会触发标签修复，也可以先导出备份后处理。
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
