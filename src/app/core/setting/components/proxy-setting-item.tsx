'use client'

import { useEffect, useState } from 'react'
import { Network } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { getProxyUrl, setProxyUrl } from '@/lib/network-proxy'

export function ProxySettingItem({ className }: { className?: string }) {
  const t = useTranslations()
  const [proxy, setProxy] = useState('')

  async function proxyChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setProxy(value)
    await setProxyUrl(value)
  }

  useEffect(() => {
    let cancelled = false

    async function init() {
      const proxyUrl = await getProxyUrl()
      if (!cancelled) {
        setProxy(proxyUrl)
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Item variant="outline" className={className}>
      <ItemMedia variant="icon"><Network className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('settings.networkProxy.title')}</ItemTitle>
        <ItemDescription>{t('settings.networkProxy.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Input
          className="w-[300px]"
          placeholder={t('settings.networkProxy.placeholder')}
          value={proxy}
          onChange={proxyChangeHandler}
        />
      </ItemActions>
    </Item>
  )
}
