'use client'

import { useState, useCallback, useEffect } from 'react'
import { 
  Settings, 
  Sparkles, 
  FileText, 
  Save,
  RotateCcw,
  Info
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import useSettingStore from '@/stores/setting'
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
  const { 
    enableImageRecognition, 
    setEnableImageRecognition,
    primaryImageMethod,
    setPrimaryImageMethod
  } = useSettingStore()
  
  const [localSettings, setLocalSettings] = useState({
    enableRecognition: enableImageRecognition,
    method: primaryImageMethod,
    ...DEFAULT_LOCAL_SETTINGS,
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY)
      const saved = raw ? JSON.parse(raw) : {}
      setLocalSettings({
        enableRecognition: enableImageRecognition,
        method: primaryImageMethod,
        autoRecognize: saved.autoRecognize !== false,
        autoOrganizeAfterRecognize: saved.autoOrganizeAfterRecognize === true,
        autoTagAfterOrganize: saved.autoTagAfterOrganize === true,
        autoTitleBeforeImport: saved.autoTitleBeforeImport === true,
        saveHistory: saved.saveHistory !== false,
        maxHistoryItems: Number(saved.maxHistoryItems) > 0
          ? Number(saved.maxHistoryItems)
          : DEFAULT_LOCAL_SETTINGS.maxHistoryItems,
      })
    } catch {
      setLocalSettings({
        enableRecognition: enableImageRecognition,
        method: primaryImageMethod,
        ...DEFAULT_LOCAL_SETTINGS,
      })
    }
  }, [enableImageRecognition, primaryImageMethod])

  const handleSave = useCallback(() => {
    setEnableImageRecognition(localSettings.enableRecognition)
    setPrimaryImageMethod(localSettings.method as 'ocr' | 'vlm')
    // 保存其他设置到本地存储
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      autoRecognize: localSettings.autoRecognize,
      autoOrganizeAfterRecognize: localSettings.autoOrganizeAfterRecognize,
      autoTagAfterOrganize: localSettings.autoTagAfterOrganize,
      autoTitleBeforeImport: localSettings.autoTitleBeforeImport,
      saveHistory: localSettings.saveHistory,
      maxHistoryItems: localSettings.maxHistoryItems
    }))
  }, [localSettings, setEnableImageRecognition, setPrimaryImageMethod])

  const handleReset = useCallback(() => {
    setLocalSettings({
      enableRecognition: true,
      method: 'ocr',
      autoRecognize: true,
      autoOrganizeAfterRecognize: false,
      autoTagAfterOrganize: false,
      autoTitleBeforeImport: false,
      saveHistory: true,
      maxHistoryItems: 50
    })
  }, [])

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/50 bg-card", className)}>
      {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t('record.mark.recognitionSettings.title')}
          </span>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-4 space-y-6">
        {/* 启用识别 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">
                {t('record.mark.recognitionSettings.enableRecognition')}
              </label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{t('record.mark.recognitionSettings.enableRecognitionHint')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('record.mark.recognitionSettings.enableRecognitionDesc')}
            </p>
          </div>
          <Switch
            checked={localSettings.enableRecognition}
            onCheckedChange={(checked) => 
              setLocalSettings(prev => ({ ...prev, enableRecognition: checked }))
            }
          />
        </div>

        {/* 识别方法 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">
              {t('record.mark.recognitionSettings.method')}
            </label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="size-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{t('record.mark.recognitionSettings.methodHint')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Select
            value={localSettings.method}
            onValueChange={(value) => 
              setLocalSettings(prev => ({ ...prev, method: value as 'ocr' | 'vlm' }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ocr">
                <div className="flex items-center gap-2">
                  <FileText className="size-4" />
                  <div>
                    <p className="font-medium">OCR</p>
                    <p className="text-xs text-muted-foreground">
                      {t('record.mark.recognitionSettings.methodOcr')}
                    </p>
                  </div>
                </div>
              </SelectItem>
              <SelectItem value="vlm">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4" />
                  <div>
                    <p className="font-medium">AI Vision</p>
                    <p className="text-xs text-muted-foreground">
                      {t('record.mark.recognitionSettings.methodVlm')}
                    </p>
                  </div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {localSettings.method === 'vlm' && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">
                    {t('record.mark.recognitionSettings.visionModel')}
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="size-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{t('record.mark.recognitionSettings.visionModelHint')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('record.mark.recognitionSettings.visionModelDesc')}
                </p>
              </div>
              <div className="shrink-0 max-md:w-full">
                <ModelSelect modelKey="knowledgeRelayVision" />
              </div>
            </div>
          </div>
        )}

        {/* 自动识别 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium">
              {t('record.mark.recognitionSettings.autoRecognize')}
            </label>
            <p className="text-xs text-muted-foreground">
              {t('record.mark.recognitionSettings.autoRecognizeDesc')}
            </p>
          </div>
          <Switch
            checked={localSettings.autoRecognize}
            onCheckedChange={(checked) => 
              setLocalSettings(prev => ({ ...prev, autoRecognize: checked }))
            }
          />
        </div>

        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <label className="text-sm font-medium">
              {t('record.mark.recognitionSettings.aiWorkflow')}
            </label>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">
                  {t('record.mark.recognitionSettings.autoOrganizeAfterRecognize')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('record.mark.recognitionSettings.autoOrganizeAfterRecognizeDesc')}
                </p>
              </div>
              <Switch
                checked={localSettings.autoOrganizeAfterRecognize}
                onCheckedChange={(checked) =>
                  setLocalSettings(prev => ({ ...prev, autoOrganizeAfterRecognize: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">
                  {t('record.mark.recognitionSettings.autoTagAfterOrganize')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('record.mark.recognitionSettings.autoTagAfterOrganizeDesc')}
                </p>
              </div>
              <Switch
                checked={localSettings.autoTagAfterOrganize}
                onCheckedChange={(checked) =>
                  setLocalSettings(prev => ({ ...prev, autoTagAfterOrganize: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">
                  {t('record.mark.recognitionSettings.autoTitleBeforeImport')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('record.mark.recognitionSettings.autoTitleBeforeImportDesc')}
                </p>
              </div>
              <Switch
                checked={localSettings.autoTitleBeforeImport}
                onCheckedChange={(checked) =>
                  setLocalSettings(prev => ({ ...prev, autoTitleBeforeImport: checked }))
                }
              />
            </div>
          </div>
        </div>

        {/* 保存历史 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium">
              {t('record.mark.recognitionSettings.saveHistory')}
            </label>
            <p className="text-xs text-muted-foreground">
              {t('record.mark.recognitionSettings.saveHistoryDesc')}
            </p>
          </div>
          <Switch
            checked={localSettings.saveHistory}
            onCheckedChange={(checked) => 
              setLocalSettings(prev => ({ ...prev, saveHistory: checked }))
            }
          />
        </div>

        {/* 历史记录数量 */}
        {localSettings.saveHistory && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                {t('record.mark.recognitionSettings.maxHistoryItems')}
              </label>
              <span className="text-sm text-muted-foreground">
                {localSettings.maxHistoryItems}
              </span>
            </div>
            <Slider
              value={[localSettings.maxHistoryItems]}
              onValueChange={([value]) => 
                setLocalSettings(prev => ({ ...prev, maxHistoryItems: value }))
              }
              min={10}
              max={100}
              step={10}
              className="w-full"
            />
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="text-xs"
        >
          <RotateCcw className="size-3.5 mr-1.5" />
          {t('record.mark.recognitionSettings.reset')}
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          className="text-xs"
        >
          <Save className="size-3.5 mr-1.5" />
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
