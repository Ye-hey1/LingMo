'use client'

import { useTranslations } from 'next-intl'
import { PenTool } from 'lucide-react'
import { DefaultModelsSettings } from '@/app/core/setting/components/default-models-settings'
import { ToolbarSettings } from '@/app/core/setting/record/toolbar-settings'

export default function RecordSettingsPage() {
  const t = useTranslations('settings.record')

  return (
    <div className='space-y-6'>
      <div>
        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <PenTool className="size-6" />
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <DefaultModelsSettings type="record" />
      <ToolbarSettings />
    </div>
  )
}
