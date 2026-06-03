'use client';
import { Switch } from "@/components/ui/switch";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import useSettingStore from '@/stores/setting';

export default function CenteredContent() {
  const t = useTranslations('settings.editor');
  const { centeredContent, setCenteredContent } = useSettingStore()

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('centeredContent')}</ItemTitle>
      <ItemDescription>{t('centeredContentDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch checked={centeredContent} onCheckedChange={setCenteredContent}/>
    </ItemActions>
  </Item>
}
