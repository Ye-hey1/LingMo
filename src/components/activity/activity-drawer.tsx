'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [aiDetailsLoading, setAiDetailsLoading] = useState(false)
  const refreshRequestIdRef = useRef(0)
  const aiDetailsRequestIdRef = useRef(0)
  const aiDetailsLoadingRef = useRef(false)
  const hasAiDetailsRef = useRef(false)

  const updateHasAiDetails = useCallback((next: boolean) => {
    hasAiDetailsRef.current = next
  }, [])

  const syncSelection = useCallback((nextData: ActivityCalendarData, resetSelection = false) => {
    setSelectedDay((currentSelectedDay) => {
      if (!resetSelection && currentSelectedDay) {
        return nextData.days.find((day) => day.day === currentSelectedDay.day) || currentSelectedDay
      }

      return undefined
    })
  }, [])

  const refreshData = useCallback(async (resetSelection = false, force = false) => {
    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId
    aiDetailsRequestIdRef.current += 1
    aiDetailsLoadingRef.current = false
    setLoading(true)
    setAiDetailsLoading(false)

    try {
      const fastData = await loadActivityCalendarData({ includeExternalAiDetails: false, force })
      if (refreshRequestIdRef.current !== requestId) return

      setData(fastData)
      updateHasAiDetails(false)
      syncSelection(fastData, resetSelection)
    } catch (error) {
      if (refreshRequestIdRef.current === requestId) {
        console.error('Failed to refresh activity data:', error)
      }
    } finally {
      if (refreshRequestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [syncSelection, updateHasAiDetails])

  const loadAiDetails = useCallback(async (force = false) => {
    if (aiDetailsLoadingRef.current || (!force && hasAiDetailsRef.current)) {
      return
    }

    const requestId = aiDetailsRequestIdRef.current + 1
    const refreshRequestId = refreshRequestIdRef.current
    aiDetailsRequestIdRef.current = requestId
    aiDetailsLoadingRef.current = true
    setAiDetailsLoading(true)

    try {
      const fullData = await loadActivityCalendarData({ includeExternalAiDetails: true, force })
      if (aiDetailsRequestIdRef.current !== requestId || refreshRequestIdRef.current !== refreshRequestId) return

      setData(fullData)
      updateHasAiDetails(true)
      syncSelection(fullData)
    } catch (error) {
      if (aiDetailsRequestIdRef.current === requestId) {
        console.error('Failed to load activity AI details:', error)
      }
    } finally {
      if (aiDetailsRequestIdRef.current === requestId) {
        aiDetailsLoadingRef.current = false
        setAiDetailsLoading(false)
      }
    }
  }, [syncSelection, updateHasAiDetails])

  useEffect(() => {
    if (open) {
      let cancelled = false

      void (async () => {
        const cachedFullData = await loadCachedActivityCalendarData({ includeExternalAiDetails: true })
        if (cancelled) return

        if (cachedFullData) {
          setData(cachedFullData)
          updateHasAiDetails(true)
          return
        }

        const cachedFastData = await loadCachedActivityCalendarData({ includeExternalAiDetails: false })
        if (cancelled) return

        if (cachedFastData) {
          setData(cachedFastData)
          updateHasAiDetails(false)
        }
      })()
      void refreshData(true)

      return () => {
        cancelled = true
      }
    }
  }, [open, refreshData, updateHasAiDetails])

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
            aiDetailsLoading={aiDetailsLoading}
            onSelectDay={setSelectedDay}
            onRefresh={() => refreshData(false, true)}
            onRequestAiDetails={loadAiDetails}
            onEntryPathOpen={() => onOpenChange(false)}
            mode="drawer"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
