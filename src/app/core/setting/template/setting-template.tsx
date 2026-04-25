'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from "../components/setting-base"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PresetGallery } from './preset-gallery'
import { MyTemplates } from './my-templates'

export function SettingTemplate({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations()

  return (
    <SettingType id={id} icon={icon} title={t('settings.template.title')} desc={t('settings.template.desc')}>
      <Tabs defaultValue="preset" className="w-full">
        <div className="mb-4">
          <TabsList>
            <TabsTrigger value="preset">{t('settings.template.presetTab')}</TabsTrigger>
            <TabsTrigger value="my">{t('settings.template.myTab')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="preset">
          <PresetGallery />
        </TabsContent>

        <TabsContent value="my">
          <MyTemplates />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
