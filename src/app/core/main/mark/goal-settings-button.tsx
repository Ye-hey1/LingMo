'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Target } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  DEFAULT_ACTIVITY_GOALS,
  loadActivityGoalSettings,
  saveActivityGoalSettings,
  type ActivityGoalSettings,
} from '@/lib/activity/goals'

interface GoalSettingsButtonProps {
  className?: string
}

const GOAL_FIELDS: Array<{
  key: keyof ActivityGoalSettings
  label: string
  hint: string
}> = [
  { key: 'record', label: '记录', hint: '每日新增记录条数' },
  { key: 'writing', label: '写作', hint: '每日新增写作篇数' },
  { key: 'conversation', label: '有效对话', hint: '每日有效会话数' },
]

export function GoalSettingsButton({ className }: GoalSettingsButtonProps) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<ActivityGoalSettings>(DEFAULT_ACTIVITY_GOALS)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    void loadActivityGoalSettings().then((next) => {
      if (!cancelled) {
        setSettings(next)
        setLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, loaded])

  async function persist(next: ActivityGoalSettings) {
    setSaving(true)
    try {
      await saveActivityGoalSettings(next)
      setSettings(next)
    } catch (error) {
      toast({
        title: '保存目标失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="目标设置"
          className={cn('h-7 w-7 p-0 text-muted-foreground hover:text-foreground', className)}
        >
          <Target className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="text-sm font-medium">每日目标</div>
          {saving ? <span className="text-[11px] text-muted-foreground">保存中…</span> : null}
        </div>
        <div className="space-y-2.5">
          {GOAL_FIELDS.map((field) => (
            <div key={field.key} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{field.label}</div>
                <div className="text-[11px] text-muted-foreground">{field.hint}</div>
              </div>
              <Input
                type="number"
                min={0}
                value={settings[field.key]}
                className="h-7 w-16 text-center text-xs"
                onChange={(event) => {
                  const value = Math.max(0, Number(event.target.value) || 0)
                  setSettings((prev) => ({ ...prev, [field.key]: value }))
                }}
                onBlur={() => void persist(settings)}
              />
            </div>
          ))}
        </div>
        <div className="mt-2.5 rounded-md border border-dashed border-border/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          目标用于「本周回顾 / 知识盘点 / 月度复盘」中的目标对照。修改后失焦自动保存。
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface GoalPanelProps {
  className?: string
}

/** 始终展示的目标设置行：三栏数字输入 + 标签，不折叠 */
export function GoalPanel({ className }: GoalPanelProps) {
  const [settings, setSettings] = useState<ActivityGoalSettings>(DEFAULT_ACTIVITY_GOALS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadActivityGoalSettings().then((next) => {
      if (!cancelled) setSettings(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function persist(next: ActivityGoalSettings) {
    setSaving(true)
    try {
      await saveActivityGoalSettings(next)
      setSettings(next)
    } catch (error) {
      toast({
        title: '保存目标失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2.5', className)}>
      <div className="mb-2 flex items-center gap-2">
        <Target className="size-3.5 text-primary" />
        <span className="text-xs font-medium">每日目标</span>
        {saving ? (
          <span className="ml-auto text-[11px] text-muted-foreground">保存中…</span>
        ) : (
          <span className="ml-auto text-[10px] text-muted-foreground">用于 AI 回顾对照 · 失焦自动保存</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {GOAL_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium leading-tight">{field.label}</div>
            </div>
            <Input
              type="number"
              min={0}
              value={settings[field.key]}
              className="h-6 w-12 border-0 bg-transparent p-0 text-center text-xs shadow-none focus-visible:ring-0"
              onChange={(event) => {
                const value = Math.max(0, Number(event.target.value) || 0)
                setSettings((prev) => ({ ...prev, [field.key]: value }))
              }}
              onBlur={() => void persist(settings)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
