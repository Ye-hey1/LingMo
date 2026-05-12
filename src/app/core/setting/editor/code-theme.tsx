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

const CODE_THEMES = [
  { value: 'github', label: 'GitHub' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'one-dark-pro', label: 'One Dark Pro' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'nord', label: 'Nord' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'vs', label: 'VS Light' },
  { value: 'vitesse-dark', label: 'Vitesse Dark' },
  { value: 'vitesse-light', label: 'Vitesse Light' },
]

export default function CodeTheme() {
  const t = useTranslations('settings.editor')
  const { codeTheme, setCodeTheme } = useSettingStore()

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('codeTheme')}</ItemTitle>
      <ItemDescription>{t('codeThemeDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Select value={codeTheme} onValueChange={setCodeTheme}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CODE_THEMES.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ItemActions>
  </Item>
}
