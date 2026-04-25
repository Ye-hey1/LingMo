'use client'

import { useTranslations } from 'next-intl'
import { InterfaceSettings } from '@/app/core/setting/general/interface-settings'
import { ToolSettings } from '@/app/core/setting/general/tool-settings'

export default function GeneralSettingsPage() {
  const t = useTranslations('settings.general')

  return (
    <div className='space-y-6'>
      <div>
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <InterfaceSettings />
      <ToolSettings />
    </div>
  )
}
