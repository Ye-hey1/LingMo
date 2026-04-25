'use client'

import { useTranslations } from 'next-intl'
import { MessageSquare } from 'lucide-react'
import { DefaultModelsSettings } from '@/app/core/setting/components/default-models-settings'
import { ToolbarSettings } from '@/app/core/setting/chat/toolbar-settings'
import { CondenseSettings } from '@/app/core/setting/chat/condense-settings'

export default function ChatSettingsPage() {
  const t = useTranslations('settings.chat')

  return (
    <div className='space-y-6'>
      <div>
        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <MessageSquare className="size-6" />
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <DefaultModelsSettings type="chat" />
      <ToolbarSettings />
      <CondenseSettings />
    </div>
  )
}
