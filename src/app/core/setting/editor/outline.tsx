'use client'
import { Item, ItemGroup, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { Switch } from "@/components/ui/switch";
import { DEFAULT_OUTLINE_POSITION, normalizeOutlinePosition } from '@/lib/outline-preferences'
import useSettingStore from '@/stores/setting'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"


export default function Outline() {
  const t = useTranslations('settings.editor');
  const {
    enableOutline,
    setEnableOutline,
    outlinePosition,
    setOutlinePosition,
  } = useSettingStore()

  return <ItemGroup className="gap-4">
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('outlineEnable')}</ItemTitle>
        <ItemDescription>{t('outlineEnableDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={enableOutline}
          onCheckedChange={setEnableOutline}
        />
      </ItemActions>
    </Item>
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('outlinePosition')}</ItemTitle>
        <ItemDescription>{t('outlinePositionDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Tabs defaultValue={DEFAULT_OUTLINE_POSITION} value={outlinePosition} onValueChange={(value) => setOutlinePosition(normalizeOutlinePosition(value))}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="left">{t('outlinePositionOptions.left')}</TabsTrigger>
            <TabsTrigger value="right">{t('outlinePositionOptions.right')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </ItemActions>
    </Item>
  </ItemGroup>
}
