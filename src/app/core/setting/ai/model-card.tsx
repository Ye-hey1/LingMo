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
import { Badge } from "@/components/ui/badge"
import { Trash2 } from "lucide-react"
import { ModelConfig, ModelType, AiConfig } from "../config"
import { useTranslations } from 'next-intl'
import ModelSelect from "./modelSelect"

interface ModelCardProps {
  modelConfig: ModelConfig
  aiConfig: AiConfig
  onUpdate: (modelId: string, field: keyof ModelConfig, value: any) => void
  onDelete: (modelId: string) => void
}

export default function ModelCard({ modelConfig, aiConfig, onUpdate, onDelete }: ModelCardProps) {
  const t = useTranslations('settings.ai')

  return (
    <AccordionItem value={modelConfig.id} className="rounded-lg border text-sm">
      <div className="flex items-center justify-between flex-wrap">
        <div className="flex-1">
          <AccordionTrigger className="w-full px-3 py-3 hover:no-underline">
            <div className="flex items-center">
              <span className="text-sm font-semibold">
                {modelConfig.model || t('newModel')}
              </span>
              <Badge variant="secondary" className="ml-2 text-[11px]">
                {t(`modelType.${modelConfig.modelType}`)}
              </Badge>
            </div>
          </AccordionTrigger>
        </div>
        <div className="flex items-center justify-end gap-2 p-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            onClick={() => onDelete(modelConfig.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <AccordionContent className="space-y-4 px-3 pb-3">
        <div className="space-y-2">
          <Label>{t('model')}</Label>
          <ModelSelect
            model={modelConfig.model}
            setModel={(model) => onUpdate(modelConfig.id, 'model', model)}
            aiConfig={aiConfig}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('modelType.title')}</Label>
          <RadioGroup
            value={modelConfig.modelType}
            onValueChange={(value) => onUpdate(modelConfig.id, 'modelType', value as ModelType)}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="chat" id={`chat-${modelConfig.id}`} />
              <Label htmlFor={`chat-${modelConfig.id}`}>{t('modelType.chat')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="tts" id={`tts-${modelConfig.id}`} />
              <Label htmlFor={`tts-${modelConfig.id}`}>{t('modelType.tts')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="stt" id={`stt-${modelConfig.id}`} />
              <Label htmlFor={`stt-${modelConfig.id}`}>{t('modelType.stt')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="embedding" id={`embedding-${modelConfig.id}`} />
              <Label htmlFor={`embedding-${modelConfig.id}`}>{t('modelType.embedding')}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="rerank" id={`rerank-${modelConfig.id}`} />
              <Label htmlFor={`rerank-${modelConfig.id}`}>{t('modelType.rerank')}</Label>
            </div>
          </RadioGroup>
        </div>

        {modelConfig.modelType === 'chat' && (
          <>
            <div className="space-y-2">
              <Label>Temperature</Label>
              <div className="flex gap-2 items-center">
                <Slider
                  className="flex-1"
                  value={[modelConfig.temperature || 0.7]}
                  max={2}
                  step={0.01}
                  onValueChange={(value) => onUpdate(modelConfig.id, 'temperature', value[0])}
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(modelConfig.temperature || 0.7).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Top P</Label>
              <div className="flex gap-2 items-center">
                <Slider
                  className="flex-1"
                  value={[modelConfig.topP || 1.0]}
                  max={1}
                  min={0}
                  step={0.01}
                  onValueChange={(value) => onUpdate(modelConfig.id, 'topP', value[0])}
                />
                <span className="text-sm text-muted-foreground w-12">
                  {(modelConfig.topP || 1.0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('enableStream')}</Label>
                <div className="text-sm text-muted-foreground">
                  {t('enableStreamDesc')}
                </div>
              </div>
              <Switch
                checked={modelConfig.enableStream !== false}
                onCheckedChange={(checked) => onUpdate(modelConfig.id, 'enableStream', checked)}
              />
            </div>
          </>
        )}

        {modelConfig.modelType === 'tts' && (
          <div className="space-y-2">
            <Label>{t('voice')}</Label>
            <Input
              value={modelConfig.voice || ''}
              onChange={(e) => onUpdate(modelConfig.id, 'voice', e.target.value)}
              placeholder={t('voicePlaceholder')}
            />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
