'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  CheckCircle2,
  Eye,
  Sparkles,
  History,
  RotateCcw,
  Save,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ModelSelect } from '@/app/core/setting/components/model-select'

const SETTINGS_KEY = 'recognition-settings'

const DEFAULT_LOCAL_SETTINGS = {
  autoRecognize: true,
  autoOrganizeAfterRecognize: false,
  autoTagAfterOrganize: false,
  autoTitleBeforeImport: false,
  saveHistory: true,
  maxHistoryItems: 50,
}

interface RecognitionSettingsProps {
  className?: string
}

export function RecognitionSettings({ className }: RecognitionSettingsProps) {
  const t = useTranslations()
  const [savedSettings, setSavedSettings] = useState({ ...DEFAULT_LOCAL_SETTINGS })
  const [localSettings, setLocalSettings] = useState({
    ...DEFAULT_LOCAL_SETTINGS,
  })
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY)
      const saved = raw ? JSON.parse(raw) : {}
      const nextSettings = {
        autoRecognize: saved.autoRecognize !== false,
        autoOrganizeAfterRecognize: saved.autoOrganizeAfterRecognize === true,
        autoTagAfterOrganize: saved.autoTagAfterOrganize === true,
        autoTitleBeforeImport: saved.autoTitleBeforeImport === true,
        saveHistory: saved.saveHistory !== false,
        maxHistoryItems: Number(saved.maxHistoryItems) > 0
          ? Number(saved.maxHistoryItems)
          : DEFAULT_LOCAL_SETTINGS.maxHistoryItems,
      }
      setLocalSettings(nextSettings)
      setSavedSettings(nextSettings)
    } catch {
      setLocalSettings({ ...DEFAULT_LOCAL_SETTINGS })
      setSavedSettings({ ...DEFAULT_LOCAL_SETTINGS })
    }
  }, [])

  const hasUnsavedChanges = JSON.stringify(localSettings) !== JSON.stringify(savedSettings)

  const handleSave = useCallback(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      autoRecognize: localSettings.autoRecognize,
      autoOrganizeAfterRecognize: localSettings.autoOrganizeAfterRecognize,
      autoTagAfterOrganize: localSettings.autoTagAfterOrganize,
      autoTitleBeforeImport: localSettings.autoTitleBeforeImport,
      saveHistory: localSettings.saveHistory,
      maxHistoryItems: localSettings.maxHistoryItems
    }))
    setSavedSettings(localSettings)
    setSaveState('saved')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }, [localSettings])

  const handleReset = useCallback(() => {
    setLocalSettings({ ...DEFAULT_LOCAL_SETTINGS })
    setSaveState('idle')
  }, [])

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex-1 space-y-4 p-1">
        {/* 视觉模型 */}
        <section className="rounded-md border border-border/50 bg-background p-3">
          <div className="mb-2 flex items-center gap-2">
            <Eye className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {t('record.mark.recognitionSettings.visionModel')}
            </span>
          </div>
          <ModelSelect modelKey="knowledgeRelayVision" hideClear />
        </section>

        {/* AI 工作流 */}
        <section className="rounded-md border border-border/50 bg-background p-3">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              {t('record.mark.recognitionSettings.aiWorkflow')}
            </span>
          </div>
          <div className="space-y-3">
            <ToggleRow
              label={t('record.mark.recognitionSettings.autoRecognize')}
              checked={localSettings.autoRecognize}
              onChange={(v) => setLocalSettings(p => ({ ...p, autoRecognize: v }))}
            />
            <ToggleRow
              label={t('record.mark.recognitionSettings.autoOrganizeAfterRecognize')}
              checked={localSettings.autoOrganizeAfterRecognize}
              onChange={(v) => setLocalSettings(p => ({ ...p, autoOrganizeAfterRecognize: v }))}
            />
            <ToggleRow
              label={t('record.mark.recognitionSettings.autoTagAfterOrganize')}
              checked={localSettings.autoTagAfterOrganize}
              onChange={(v) => setLocalSettings(p => ({ ...p, autoTagAfterOrganize: v }))}
            />
            <ToggleRow
              label={t('record.mark.recognitionSettings.autoTitleBeforeImport')}
              checked={localSettings.autoTitleBeforeImport}
              onChange={(v) => setLocalSettings(p => ({ ...p, autoTitleBeforeImport: v }))}
            />
          </div>
        </section>

        {/* 历史记录 */}
        <section className="rounded-md border border-border/50 bg-background p-3">
          <div className="mb-3 flex items-center gap-2">
            <History className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {t('record.mark.recognitionSettings.saveHistory')}
            </span>
            <div className="ml-auto">
              <Switch
                checked={localSettings.saveHistory}
                onCheckedChange={(v) => setLocalSettings(p => ({ ...p, saveHistory: v }))}
              />
            </div>
          </div>
          {localSettings.saveHistory && (
            <div className="space-y-2 pl-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t('record.mark.recognitionSettings.maxHistoryItems')}
                </span>
                <span className="text-xs font-medium tabular-nums">
                  {localSettings.maxHistoryItems}
                </span>
              </div>
              <Slider
                value={[localSettings.maxHistoryItems]}
                onValueChange={([v]) => setLocalSettings(p => ({ ...p, maxHistoryItems: v }))}
                min={10}
                max={100}
                step={10}
                className="w-full"
              />
            </div>
          )}
        </section>
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="h-7 text-[11px]"
        >
          <RotateCcw className="size-3 mr-1" />
          {t('record.mark.recognitionSettings.reset')}
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasUnsavedChanges && saveState !== 'saved'}
          className="h-7 text-[11px]"
        >
          {saveState === 'saved' ? (
            <CheckCircle2 className="size-3 mr-1" />
          ) : (
            <Save className="size-3 mr-1" />
          )}
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
