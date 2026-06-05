'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlarmClock,
  Bell,
  BellRing,
  Bot,
  CalendarClock,
  Check,
  MessageSquareText,
  Timer,
  X,
} from 'lucide-react'

import { SettingType } from '../components/setting-base'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import useSettingStore from '@/stores/setting'
import { checkIsTauri } from '@/lib/check'
import type { Reminder } from '@/lib/reminders/types'
import { sendReminderNotificationWithResult } from '@/lib/reminders/notification'
import { formatReminderTime, reminderScheduler } from '@/lib/reminders/scheduler'

function formatRepeat(repeat: Reminder['repeat'], t: ReturnType<typeof useTranslations>) {
  if (repeat === 'daily') return t('repeat.daily')
  if (repeat === 'weekly') return t('repeat.weekly')
  if (repeat === 'monthly') return t('repeat.monthly')
  return t('repeat.none')
}

export default function ReminderSettingsPage() {
  const t = useTranslations('settings.reminders')
  const {
    reminderEnabled,
    setReminderEnabled,
    reminderAllowAgentCreate,
    setReminderAllowAgentCreate,
    reminderDefaultAdvanceMinutes,
    setReminderDefaultAdvanceMinutes,
    reminderShowContext,
    setReminderShowContext,
    reminderTitlePrefix,
    setReminderTitlePrefix,
  } = useSettingStore()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [prefixDraft, setPrefixDraft] = useState(reminderTitlePrefix)

  useEffect(() => {
    setPrefixDraft(reminderTitlePrefix)
  }, [reminderTitlePrefix])

  const settings = useMemo(() => ({
    reminderEnabled,
    reminderAllowAgentCreate,
    reminderDefaultAdvanceMinutes,
    reminderShowContext,
    reminderTitlePrefix,
  }), [
    reminderEnabled,
    reminderAllowAgentCreate,
    reminderDefaultAdvanceMinutes,
    reminderShowContext,
    reminderTitlePrefix,
  ])

  const loadReminders = useCallback(async () => {
    setLoading(true)
    try {
      setReminders(await reminderScheduler.list())
    } catch (error) {
      toast({
        title: t('toast.loadFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadReminders()
  }, [loadReminders])

  const handleTestNotification = async () => {
    setTesting(true)
    try {
      if (!checkIsTauri()) {
        toast({
          title: t('toast.unsupportedRuntime'),
          description: t('toast.unsupportedRuntimeDesc'),
          variant: 'destructive',
          duration: 4000,
        })
        return
      }

      const now = Date.now()
      const result = await sendReminderNotificationWithResult({
        id: 'settings-test-reminder',
        title: t('test.title'),
        message: t('test.message'),
        dueAt: now,
        remindAt: now,
        advanceNoticeMinutes: 0,
        repeat: 'none',
        status: 'scheduled',
        source: {
          type: 'manual',
          label: t('test.source'),
        },
        createdAt: now,
        updatedAt: now,
      }, {
        ...settings,
        reminderEnabled: true,
      })
      const failedTitle = result.permissionDenied ? t('toast.permissionDenied') : t('toast.testFailed')
      const failedDescription = result.error || (
        result.permissionDenied ? t('toast.permissionDeniedDesc') : t('toast.testSentDesc')
      )

      toast({
        title: result.delivered ? t('toast.testSent') : failedTitle,
        description: result.delivered ? t('toast.testSentDesc') : failedDescription,
        variant: result.delivered ? 'default' : 'destructive',
        duration: 4000,
      })
    } catch (error) {
      toast({
        title: t('toast.testFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 4000,
      })
    } finally {
      setTesting(false)
    }
  }

  const handleCancel = async (id: string) => {
    await reminderScheduler.cancel(id)
    await loadReminders()
    toast({ title: t('toast.cancelled') })
  }

  const handleComplete = async (id: string) => {
    await reminderScheduler.complete(id)
    await loadReminders()
    toast({ title: t('toast.completed') })
  }

  const handlePrefixBlur = () => {
    void setReminderTitlePrefix(prefixDraft)
  }

  return (
    <SettingType
      id="reminders"
      title={t('title')}
      desc={t('desc')}
      icon={<AlarmClock className="size-4 lg:size-6" />}
    >
      <ItemGroup className="gap-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">{t('desktop.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('desktop.desc')}</p>
        </div>

        <ItemGroup className="gap-4">
          <Item variant="outline">
            <ItemMedia variant="icon"><BellRing className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('enabled.title')}</ItemTitle>
              <ItemDescription>{t('enabled.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon"><Bot className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('agent.title')}</ItemTitle>
              <ItemDescription>{t('agent.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch checked={reminderAllowAgentCreate} onCheckedChange={setReminderAllowAgentCreate} />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon"><Timer className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('advance.title')}</ItemTitle>
              <ItemDescription>{t('advance.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="w-[220px] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">0</span>
                  <span className="font-medium">{t('advance.value', { minutes: reminderDefaultAdvanceMinutes })}</span>
                  <span className="text-muted-foreground">120</span>
                </div>
                <Slider
                  value={[Math.min(120, reminderDefaultAdvanceMinutes)]}
                  min={0}
                  max={120}
                  step={5}
                  onValueChange={(value) => void setReminderDefaultAdvanceMinutes(value[0])}
                />
              </div>
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon"><MessageSquareText className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('context.title')}</ItemTitle>
              <ItemDescription>{t('context.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch checked={reminderShowContext} onCheckedChange={setReminderShowContext} />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon"><Bell className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('prefix.title')}</ItemTitle>
              <ItemDescription>{t('prefix.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="w-[260px]">
              <Input
                value={prefixDraft}
                onChange={(event) => setPrefixDraft(event.target.value)}
                onBlur={handlePrefixBlur}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
                placeholder={t('prefix.placeholder')}
              />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon"><BellRing className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('test.button')}</ItemTitle>
              <ItemDescription>{t('test.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="outline" size="sm" onClick={handleTestNotification} disabled={testing}>
                <BellRing className="size-4" />
                {testing ? t('test.sending') : t('test.button')}
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">{t('list.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('list.desc')}</p>
        </div>

        <ItemGroup className="gap-3">
          {loading ? (
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>{t('list.loading')}</ItemTitle>
              </ItemContent>
            </Item>
          ) : reminders.length === 0 ? (
            <Item variant="outline">
              <ItemMedia variant="icon"><CalendarClock className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('list.empty')}</ItemTitle>
                <ItemDescription>{t('list.emptyDesc')}</ItemDescription>
              </ItemContent>
            </Item>
          ) : reminders.map((reminder) => (
            <Item key={reminder.id} variant="outline" size="sm">
              <ItemMedia variant="icon"><CalendarClock className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle className="w-full max-w-full justify-between gap-3">
                  <span className="truncate">{reminder.title}</span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {formatRepeat(reminder.repeat, t)}
                  </Badge>
                </ItemTitle>
                <ItemDescription className="line-clamp-1">
                  {formatReminderTime(reminder.dueAt)}
                  {reminder.message ? ` · ${reminder.message}` : ''}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="ghost" size="icon" onClick={() => void handleComplete(reminder.id)} title={t('list.complete')}>
                  <Check className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void handleCancel(reminder.id)} title={t('list.cancel')}>
                  <X className="size-4" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </ItemGroup>
    </SettingType>
  )
}
