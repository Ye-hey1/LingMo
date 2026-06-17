import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import { Store } from "@tauri-apps/plugin-store";
import { Gauge, Mic, Volume2 } from "lucide-react";

import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSettingStore from "@/stores/setting";
import { ModelSelect } from "../components/model-select";
import type { SpeechMode } from '@/lib/speech/types';
import { matchesConfiguredModelSelection } from '@/lib/ai/model-selection';

export function Setting() {
  const t = useTranslations('settings.audio');
  const {
    audioModel,
    textToSpeechMode,
    setAiModelList,
    setTextToSpeechMode,
  } = useSettingStore();
  const [speed, setSpeed] = useState(1);
  const modeOptions: Array<{ value: SpeechMode; label: string }> = [
    { value: 'auto', label: t('mode.auto') },
    { value: 'local', label: t('mode.local') },
    { value: 'model', label: t('mode.model') },
  ];

  useEffect(() => {
    async function loadSpeed() {
      if (!audioModel) return;
      const store = await Store.load('store.json');
      const models = await store.get<any[]>('aiModelList');
      if (!models) return;

      let currentSpeed = 1;
      for (const config of models) {
        if (config.models && config.models.length > 0) {
          const targetModel = config.models.find((model: any) =>
            model.modelType === 'tts' && matchesConfiguredModelSelection({
              configKey: config.key,
              modelId: model.id,
              selectionId: audioModel,
            })
          );
          if (targetModel && targetModel.speed !== undefined) {
            currentSpeed = targetModel.speed;
            break;
          }
        } else if (config.key === audioModel && config.modelType === 'tts' && config.speed !== undefined) {
          currentSpeed = config.speed;
          break;
        }
      }

      setSpeed(currentSpeed);
      setAiModelList(models);
    }

    void loadSpeed();
  }, [audioModel, setAiModelList]);

  const handleSpeedChange = async (value: number[]) => {
    const newSpeed = value[0];
    setSpeed(newSpeed);

    if (!audioModel) return;

    const store = await Store.load('store.json');
    const models = await store.get<any[]>('aiModelList') || [];
    const updatedModels = models.map(config => {
      if (config.models && config.models.length > 0) {
        return {
          ...config,
          models: config.models.map((model: any) =>
            model.modelType === 'tts' && matchesConfiguredModelSelection({
              configKey: config.key,
              modelId: model.id,
              selectionId: audioModel,
            })
              ? { ...model, speed: newSpeed }
              : model
          ),
        };
      }

      if (config.key === audioModel && config.modelType === 'tts') {
        return { ...config, speed: newSpeed };
      }

      return config;
    });

    setAiModelList(updatedModels);
    await store.set('aiModelList', updatedModels);
    await store.save();
  };

  return (
    <ItemGroup className="gap-6">
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
            <Select value={textToSpeechMode} onValueChange={(value) => void setTextToSpeechMode(value as SpeechMode)}>
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
                <span className="w-10 text-zinc-500">{speed}x</span>
              </div>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>

      <div className="mt-8 space-y-2">
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
      </ItemGroup>
    </ItemGroup>
  );
}
