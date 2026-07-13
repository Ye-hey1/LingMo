'use client';
import { Eye, ImageIcon } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { OcrSetting } from "./ocr";
import { VlmSetting } from "./vlm";
import useSettingStore from "@/stores/setting";
import { Switch } from "@/components/ui/switch";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";

export default function ImageMethod() {
  const t = useTranslations('settings.imageMethod');
  const { enableImageRecognition, setEnableImageRecognition } = useSettingStore()

  return (
    <SettingType id="imageMethod" icon={<ImageIcon />} title={t('title')} desc={t('desc')}>
      <ItemGroup className="gap-4">
        <Item variant="outline" className="max-md:flex-col max-md:items-start">
          <ItemMedia variant="icon"><Eye className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('enable.title')}</ItemTitle>
            <ItemDescription>{t('enable.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={enableImageRecognition}
              onCheckedChange={setEnableImageRecognition}
            />
          </ItemActions>
        </Item>
        <OcrSetting />
        <VlmSetting />
      </ItemGroup>
    </SettingType>
  )
}
