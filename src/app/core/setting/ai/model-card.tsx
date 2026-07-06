'use client'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Trash2 } from "lucide-react"
import { ModelConfig, ModelType, AiConfig, getModelDisplayName } from "../config"
import { useTranslations } from 'next-intl'
import ModelSelect from "./modelSelect"
import { inferModelContextWindow } from "@/lib/ai/context-window"

interface ModelCardProps {
  modelConfig: ModelConfig
  aiConfig: AiConfig
  onUpdate: (modelId: string, field: keyof ModelConfig, value: any) => void
  onDelete: (modelId: string) => void
}

const MODEL_TYPE_SHORT: Record<ModelType, string> = {
  chat: '对话',
  tts: '语音合成',
  stt: '语音识别',
  embedding: '向量',
  rerank: '重排',
  image: '图像',
  video: '视频',
}

export default function ModelCard({ modelConfig, aiConfig, onUpdate, onDelete }: ModelCardProps) {
  const t = useTranslations('settings.ai')
  const inferredContextWindow = inferModelContextWindow(modelConfig.model)
  const displayName = getModelDisplayName(modelConfig)

  const handleModelChange = (model: string) => {
    onUpdate(modelConfig.id, 'model', model)
  }

  const handleContextWindowChange = (value: string) => {
    if (!value.trim()) {
      onUpdate(modelConfig.id, 'contextWindow', undefined)
      return
    }

    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      onUpdate(modelConfig.id, 'contextWindow', parsed)
    }
  }

  return (
    <AccordionItem value={modelConfig.id} className="rounded-lg border px-1">
      <AccordionTrigger className="w-full px-2 py-2.5 hover:no-underline">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {displayName || t('newModel')}
          </span>
          <span className="shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {MODEL_TYPE_SHORT[modelConfig.modelType] || modelConfig.modelType}
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent className="space-y-3 px-2 pb-3 pt-1">
        <div className="space-y-1.5">
          <Label htmlFor={`name-${modelConfig.id}`} className="text-xs">{t('modelDisplayName')}</Label>
          <Input
            id={`name-${modelConfig.id}`}
            value={modelConfig.name || ''}
            onChange={(e) => onUpdate(modelConfig.id, 'name', e.target.value)}
            placeholder={modelConfig.model || t('modelDisplayNamePlaceholder')}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t('model')}</Label>
          <ModelSelect
            model={modelConfig.model}
            setModel={handleModelChange}
            aiConfig={aiConfig}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t('modelType.title')}</Label>
          <RadioGroup
            value={modelConfig.modelType}
            onValueChange={(value) => onUpdate(modelConfig.id, 'modelType', value as ModelType)}
            className="flex flex-wrap gap-x-4 gap-y-1"
          >
            {(['chat', 'tts', 'stt', 'embedding', 'rerank'] as ModelType[]).map((type) => (
              <div key={type} className="flex items-center space-x-1.5">
                <RadioGroupItem value={type} id={`${type}-${modelConfig.id}`} className="h-3.5 w-3.5" />
                <Label htmlFor={`${type}-${modelConfig.id}`} className="text-xs cursor-pointer">
                  {MODEL_TYPE_SHORT[type]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {modelConfig.modelType === 'chat' && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Temperature</Label>
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {(modelConfig.temperature || 0.7).toFixed(2)}
                </span>
              </div>
              <Slider
                value={[modelConfig.temperature || 0.7]}
                max={2}
                step={0.01}
                onValueChange={(value) => onUpdate(modelConfig.id, 'temperature', value[0])}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Top P</Label>
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {(modelConfig.topP || 1.0).toFixed(2)}
                </span>
              </div>
              <Slider
                value={[modelConfig.topP || 1.0]}
                max={1}
                min={0}
                step={0.01}
                onValueChange={(value) => onUpdate(modelConfig.id, 'topP', value[0])}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`ctx-${modelConfig.id}`} className="text-xs">{t('contextWindow')}</Label>
                <Input
                  id={`ctx-${modelConfig.id}`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={modelConfig.contextWindow ?? ''}
                  onChange={(e) => handleContextWindowChange(e.target.value)}
                  placeholder={`${inferredContextWindow}`}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex flex-col justify-between">
                <Label className="text-xs">{t('enableStream')}</Label>
                <Switch
                  checked={modelConfig.enableStream !== false}
                  onCheckedChange={(checked) => onUpdate(modelConfig.id, 'enableStream', checked)}
                />
              </div>
            </div>
          </>
        )}

        {modelConfig.modelType === 'tts' && (
          <div className="space-y-1.5">
            <Label className="text-xs">{t('voice')}</Label>
            <Input
              value={modelConfig.voice || ''}
              onChange={(e) => onUpdate(modelConfig.id, 'voice', e.target.value)}
              placeholder={t('voicePlaceholder')}
              className="h-8 text-xs"
            />
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground/60 hover:text-destructive"
            onClick={() => onDelete(modelConfig.id)}
          >
            <Trash2 className="h-3 w-3" />
            删除
          </Button>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
