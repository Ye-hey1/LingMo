'use client'

import { useTranslations } from 'next-intl'
import { Type } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Slider } from '@/components/ui/slider'
import useSettingStore from '@/stores/setting'

export function ChatContentFontSizeSettings() {
  const t = useTranslations('settings.chat.contentFontSize')
  const { contentTextScale, setContentTextScale } = useSettingStore()

  const handleScaleChange = (value: number[]) => {
    setContentTextScale(value[0])
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Type className="size-4" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <div className="w-[180px] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">75%</span>
            <span className="text-xs font-medium">{contentTextScale}%</span>
            <span className="text-xs text-muted-foreground">150%</span>
          </div>
          <Slider
            value={[contentTextScale]}
            onValueChange={handleScaleChange}
            min={75}
            max={150}
            step={1}
            className="w-full"
          />
        </div>
      </ItemActions>
    </Item>
  )
}
