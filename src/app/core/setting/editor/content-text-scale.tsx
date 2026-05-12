'use client'

import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SCALE_OPTIONS = [
  { value: '75', label: '75%' },
  { value: '85', label: '85%' },
  { value: '100', label: '100%' },
  { value: '115', label: '115%' },
  { value: '125', label: '125%' },
  { value: '150', label: '150%' },
]

export default function ContentTextScale() {
  const t = useTranslations('settings.editor')
  const { contentTextScale, setContentTextScale } = useSettingStore()

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('contentTextScale')}</ItemTitle>
      <ItemDescription>{t('contentTextScaleDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Select
        value={String(contentTextScale)}
        onValueChange={(value) => setContentTextScale(Number(value))}
      >
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCALE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ItemActions>
  </Item>
}
