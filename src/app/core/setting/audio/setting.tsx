import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { CheckCircle2, ExternalLink, Eye, EyeOff, Gauge, KeyRound, Loader2, Mic, Volume2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useSettingStore from "@/stores/setting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SpeechMode } from '@/lib/speech/types';
import { cn } from '@/lib/utils';
import type { AiConfig } from '../config';
import {
  getAsrPresetModelSelection,
  isOpenLessAsrPresetReady,
  OPENLESS_ASR_PRESETS,
} from '@/lib/speech/asr-presets';
import { toast } from '@/hooks/use-toast';
import { open } from '@tauri-apps/plugin-shell';

type AsrPresetStatus = 'unconfigured' | 'missing-key' | 'incomplete' | 'ready' | 'current'

function findAsrPresetConfig(models: AiConfig[], preset: AiConfig) {
  return models.find((config) =>
    config.templateKey === preset.key ||
    config.key === preset.key ||
    config.key.startsWith(`${preset.key}-`)
  )
}

function copyPresetModels(preset: AiConfig) {
  return preset.models?.map(model => ({ ...model })) || []
}

function buildAsrPresetConfig(preset: AiConfig, apiKey: string): AiConfig {
  return {
    ...preset,
    key: `${preset.key}-${Date.now()}`,
    templateKey: preset.key,
    templateSource: 'custom',
    enabled: true,
    apiKey,
    models: copyPresetModels(preset),
  }
}

function mergeAsrPresetModels(config: AiConfig, preset: AiConfig) {
  const hasSttModel = config.models?.some((model) =>
    model.modelType === 'stt' && Boolean(model.model?.trim())
  ) || (config.modelType === 'stt' && Boolean(config.model?.trim()))

  return hasSttModel ? config.models : copyPresetModels(preset)
}

function mergeAsrPresetConfig(config: AiConfig, preset: AiConfig, apiKey: string): AiConfig {
  return {
    ...config,
    title: config.title || preset.title,
    baseURL: config.baseURL || preset.baseURL,
    apiKey,
    apiKeyUrl: config.apiKeyUrl || preset.apiKeyUrl,
    templateKey: preset.key,
    templateSource: 'custom',
    enabled: true,
    models: mergeAsrPresetModels(config, preset),
  }
}

function getAsrPresetStatus(config: AiConfig | undefined, selected: boolean): AsrPresetStatus {
  if (!config) {
    return 'unconfigured'
  }

  if (config.enabled === false) {
    return 'incomplete'
  }

  if (!config.apiKey?.trim()) {
    return 'missing-key'
  }

  if (!isOpenLessAsrPresetReady(config)) {
    return 'incomplete'
  }

  return selected ? 'current' : 'ready'
}

function getAsrPresetStatusMeta(status: AsrPresetStatus) {
  switch (status) {
    case 'current':
      return {
        label: '当前使用',
        className: 'bg-primary/10 text-primary',
      }
    case 'ready':
      return {
        label: '可使用',
        className: 'bg-emerald-100 text-emerald-700',
      }
    case 'missing-key':
      return {
        label: '待填密钥',
        className: 'bg-amber-100 text-amber-700',
      }
    case 'incomplete':
      return {
        label: '配置不完整',
        className: 'bg-destructive/10 text-destructive',
      }
    case 'unconfigured':
    default:
      return {
        label: '未配置',
        className: 'bg-muted text-muted-foreground',
      }
  }
}

export function Setting() {
  const t = useTranslations('settings.audio');
  const {
    audioModel,
    aiModelList,
    sttModel,
    textToSpeechMode,
    setAiModelList,
    setSttModel,
    setTextToSpeechMode,
  } = useSettingStore();
  const [speed, setSpeed] = useState(1);
  const [savingAsrPresetKey, setSavingAsrPresetKey] = useState<string | null>(null);
  const [asrApiKeyDrafts, setAsrApiKeyDrafts] = useState<Record<string, string>>({});
  const [visibleAsrApiKeys, setVisibleAsrApiKeys] = useState<Record<string, boolean>>({});
  const modeOptions: Array<{ value: SpeechMode; label: string }> = [
    { value: 'auto', label: t('mode.auto') },
    { value: 'local', label: t('mode.local') },
    { value: 'model', label: t('mode.model') },
  ];

  // 加载TTS语速设置
  useEffect(() => {
    async function loadSpeed() {
      if (!audioModel) return;
      const store = await Store.load('store.json');
      const models = await store.get<any[]>('aiModelList');
      if (!models) return;
      
      // 查找TTS模型配置，适配新的多模型数据结构
      let currentSpeed = 1;
      for (const config of models) {
        // 检查新的 models 数组结构
        if (config.models && config.models.length > 0) {
          const targetModel = config.models.find((model: any) => 
            model.id === audioModel && model.modelType === 'tts'
          );
          if (targetModel && targetModel.speed !== undefined) {
            currentSpeed = targetModel.speed;
            break;
          }
        } else {
          // 向后兼容：处理旧的单模型结构
          if (config.key === audioModel && config.modelType === 'tts' && config.speed !== undefined) {
            currentSpeed = config.speed;
            break;
          }
        }
      }
      
      setSpeed(currentSpeed);
      setAiModelList(models);
    }
    loadSpeed();
  }, [audioModel]);

  // 保存TTS语速设置
  const handleSpeedChange = async (value: number[]) => {
    const newSpeed = value[0];
    setSpeed(newSpeed);
    
    if (!audioModel) return;
    
    const store = await Store.load('store.json');
    const models = await store.get<any[]>('aiModelList') || [];
    
    // 更新TTS模型的语速设置，适配新的多模型数据结构
    const updatedModels = models.map(config => {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const updatedConfig = { ...config };
        updatedConfig.models = config.models.map((model: any) => {
          if (model.id === audioModel && model.modelType === 'tts') {
            return { ...model, speed: newSpeed };
          }
          return model;
        });
        return updatedConfig;
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === audioModel && config.modelType === 'tts') {
          return { ...config, speed: newSpeed };
        }
        return config;
      }
    });
    
    setAiModelList(updatedModels);
    await store.set('aiModelList', updatedModels);
    await store.save();
  };

  useEffect(() => {
    setAsrApiKeyDrafts((current) => {
      const next = { ...current }

      OPENLESS_ASR_PRESETS.forEach((preset) => {
        const config = findAsrPresetConfig(aiModelList || [], preset)
        if (next[preset.key] === undefined) {
          next[preset.key] = config?.apiKey || ''
        }
      })

      return next
    })
  }, [aiModelList])

  const saveAsrPresetApiKey = async (preset: AiConfig) => {
    const apiKey = asrApiKeyDrafts[preset.key]?.trim() || ''

    if (!apiKey) {
      toast({
        title: '请先填写 API Key',
        description: `${preset.title} 需要 API Key 才能用于语音识别。`,
        variant: 'destructive',
      })
      return
    }

    setSavingAsrPresetKey(preset.key)

    try {
      const store = await Store.load('store.json')
      const models = (await store.get<AiConfig[]>('aiModelList')) || []
      const existing = findAsrPresetConfig(models, preset)
      let targetConfig: AiConfig
      let updatedModels: AiConfig[]

      if (existing) {
        targetConfig = mergeAsrPresetConfig(existing, preset, apiKey)
        updatedModels = models.map(config =>
          config.key === existing.key ? targetConfig : config
        )
      } else {
        targetConfig = buildAsrPresetConfig(preset, apiKey)
        updatedModels = [targetConfig, ...models]
      }

      await store.set('aiModelList', updatedModels)
      await store.save()
      setAiModelList(updatedModels)
      await setSttModel(getAsrPresetModelSelection(targetConfig))

      toast({
        title: '语音识别服务已配置',
        description: `已选择 ${preset.title}。`,
      })
    } finally {
      setSavingAsrPresetKey(null)
    }
  }

  const selectAsrPreset = async (config: AiConfig | undefined, preset: AiConfig) => {
    if (!config || !isOpenLessAsrPresetReady(config)) {
      toast({
        title: '该 ASR 预设还不能使用',
        description: '请先在语音设置里填写 API Key，并确认模型和接口地址完整。',
        variant: 'destructive',
      })
      return
    }

    await setSttModel(getAsrPresetModelSelection(config))
    toast({
      title: '已切换语音识别模型',
      description: preset.title,
    })
  }

  return (
    <ItemGroup className="gap-6">
      {/* TTS朗读设置部分 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('tts.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('tts.desc')}</p>
      </div>

      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('mode.title')}</ItemTitle>
            <ItemDescription>{t('tts.modeDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select value={textToSpeechMode} onValueChange={(value) => setTextToSpeechMode(value as SpeechMode)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('tts.model.title')}</ItemTitle>
            <ItemDescription>{t('tts.model.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="tts" />
          </ItemActions>
        </Item>

        {audioModel && (
          <Item variant="outline">
            <ItemMedia variant="icon"><Gauge className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('tts.speed.title')}</ItemTitle>
              <ItemDescription>{t('tts.speed.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="flex items-center gap-4">
                <Slider
                  value={[speed]}
                  onValueChange={handleSpeedChange}
                  min={0.5}
                  max={2}
                  step={0.1}
                  className="w-[180px]"
                />
                <span className="text-zinc-500 w-10">{speed}x</span>
              </div>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>

      {/* STT语音识别设置部分 */}
      <div className="space-y-2 mt-8">
        <h3 className="text-sm font-medium text-foreground">{t('stt.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('stt.desc')}</p>
      </div>

      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('stt.model.title')}</ItemTitle>
            <ItemDescription>{t('stt.model.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="stt" />
          </ItemActions>
        </Item>

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
              <Mic className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <h4 className="text-sm font-medium text-foreground">OpenLess ASR 服务</h4>
              <p className="text-xs text-muted-foreground">
                这些是 OpenLess 参考的 Whisper-compatible ASR 服务模板，不是已内置的免费模型；填写对应平台 API Key 后才能选择使用。
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {OPENLESS_ASR_PRESETS.map((preset) => {
              const configuredConfig = findAsrPresetConfig(aiModelList || [], preset)
              const selected = Boolean(
                configuredConfig &&
                getAsrPresetModelSelection(configuredConfig) === sttModel &&
                isOpenLessAsrPresetReady(configuredConfig)
              )
              const status = getAsrPresetStatus(configuredConfig, selected)
              const statusMeta = getAsrPresetStatusMeta(status)
              const ready = isOpenLessAsrPresetReady(configuredConfig)
              const modelName = preset.models?.[0]?.model || 'STT'
              const apiKeyValue = asrApiKeyDrafts[preset.key] ?? configuredConfig?.apiKey ?? ''
              const savedApiKey = configuredConfig?.apiKey?.trim() || ''
              const draftApiKey = apiKeyValue.trim()
              const apiKeyChanged = draftApiKey !== savedApiKey
              const shouldSaveBeforeUse = !ready || apiKeyChanged
              const apiKeyVisible = visibleAsrApiKeys[preset.key] || false
              const saving = savingAsrPresetKey === preset.key

              return (
                <div
                  key={preset.key}
                  className={cn(
                    'rounded-md border p-3 transition-colors',
                    selected
                      ? 'border-primary/70 bg-primary/5'
                      : 'border-border bg-background'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm font-medium text-foreground">{preset.title}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{modelName}</div>
                    </div>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px]', statusMeta.className)}>
                      {statusMeta.label}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                    <div className="flex gap-2">
                      <span className="shrink-0 text-foreground/70">接口</span>
                      <span className="min-w-0 truncate">{preset.baseURL}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="shrink-0 text-foreground/70">用途</span>
                      <span>仅语音识别转文字</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Input
                        type={apiKeyVisible ? 'text' : 'password'}
                        value={apiKeyValue}
                        onChange={(event) => {
                          const value = event.target.value
                          setAsrApiKeyDrafts((current) => ({
                            ...current,
                            [preset.key]: value,
                          }))
                        }}
                        placeholder="填写该服务的 API Key"
                        className="h-8 pr-8 text-xs"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setVisibleAsrApiKeys((current) => ({
                            ...current,
                            [preset.key]: !apiKeyVisible,
                          }))
                        }}
                        aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                      >
                        {apiKeyVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={shouldSaveBeforeUse ? 'default' : 'outline'}
                      disabled={saving || (!shouldSaveBeforeUse && selected) || (shouldSaveBeforeUse && !draftApiKey)}
                      onClick={() => {
                        if (!shouldSaveBeforeUse) {
                          void selectAsrPreset(configuredConfig, preset)
                          return
                        }
                        void saveAsrPresetApiKey(preset)
                      }}
                    >
                      {saving ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : !shouldSaveBeforeUse && selected ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <KeyRound className="size-3.5" />
                      )}
                      {shouldSaveBeforeUse ? '保存并使用' : selected ? '使用中' : '使用'}
                    </Button>
                  </div>

                  {preset.apiKeyUrl && (
                    <div className="mt-2 text-right text-[11px] text-muted-foreground">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        onClick={() => void open(preset.apiKeyUrl || '')}
                      >
                        获取 API Key
                        <ExternalLink className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </ItemGroup>
    </ItemGroup>
  )
}
