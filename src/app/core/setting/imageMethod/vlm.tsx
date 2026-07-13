import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { ModelSelect } from "../components/model-select";
import { Bot } from "lucide-react";
import { useTranslations } from 'next-intl';
import { SetDefault } from "./setDefault";

export function VlmSetting() {
  const t = useTranslations('settings.imageMethod.vlm')
  return (
    <Item variant="outline" className="max-md:flex-col max-md:items-start">
      <ItemMedia variant="icon"><Bot className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription className="line-clamp-none">{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className='w-96 max-md:w-full'>
        <div className="flex w-full items-center gap-2 max-md:flex-col max-md:items-stretch">
          <ModelSelect
            className="min-w-0 flex-1"
            modelKey={'imageMethod'}
            emptyLabel={t('noModel')}
            clearTooltip={t('clearModel')}
          />
          <SetDefault type="vlm" />
        </div>
      </ItemActions>
    </Item>
  )
}
