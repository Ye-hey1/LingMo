'use client'

import { useEffect, useRef, useState } from 'react'

import { ActivityPanel } from '@/components/activity/activity-panel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { loadActivityCalendarData, loadCachedActivityCalendarData } from '@/lib/activity'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'

interface ActivityDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ActivityDrawer({ open, onOpenChange }: ActivityDrawerProps) {
  const [data, setData] = useState<ActivityCalendarData | null>(null)
  const [selectedDay, setSelectedDay] = useState<ActivityDaySummary | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const refreshRequestIdRef = useRef(0)

  async function refreshData(resetSelection = false, force = false) {
    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId
    setLoading(true)

    const syncSelection = (nextData: ActivityCalendarData) => {
      setSelectedDay((currentSelectedDay) => {
        if (!resetSelection && currentSelectedDay) {
          return nextData.days.find((day) => day.day === currentSelectedDay.day) || currentSelectedDay
        }

        return undefined
      })
    }

    try {
      const fastData = await loadActivityCalendarData({ includeExternalAiDetails: false, force })
      if (refreshRequestIdRef.current !== requestId) return

      setData(fastData)
      syncSelection(fastData)
      setLoading(false)

      const fullData = await loadActivityCalendarData({ includeExternalAiDetails: true, force })
      if (refreshRequestIdRef.current !== requestId) return

      setData(fullData)
      syncSelection(fullData)
    } catch (error) {
      if (refreshRequestIdRef.current === requestId) {
        console.error('Failed to refresh activity data:', error)
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (open) {
      void (async () => {
        const cachedData = await loadCachedActivityCalendarData({ includeExternalAiDetails: true })
          || await loadCachedActivityCalendarData({ includeExternalAiDetails: false })

        if (cachedData) {
          setData(cachedData)
        }
      })()
      void refreshData(true)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] w-[min(1080px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden rounded-xl border-border/80 p-0 shadow-2xl" showCloseButton>
        <DialogHeader className="sr-only">
          <DialogTitle>活跃度中心</DialogTitle>
          <DialogDescription>查看活动、AI 交互与记忆统计。</DialogDescription>
        </DialogHeader>
        <div className="h-[82vh] min-h-[620px] p-5">
          <ActivityPanel
            data={data}
            selectedDay={selectedDay}
            loading={loading}
            onSelectDay={setSelectedDay}
            onRefresh={() => void refreshData(false, true)}
            onEntryPathOpen={() => onOpenChange(false)}
            mode="drawer"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
