"use client";

import { useRouter } from "next/navigation";
import baseConfig from '@/app/core/setting/config'
import { useTranslations } from 'next-intl'
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

const MOBILE_ME_SCROLL_KEY = 'mobile-me-scroll-top'

export function SettingTab() {
  const router = useRouter()
  const t = useTranslations('settings')
  const notMobilePages = ['about', 'file', 'shortcuts', 'memories']
  
  const config = baseConfig
    .filter(item => !notMobilePages.includes(item.anchor))
    .map(item => ({
      ...item,
      title: t(`${item.anchor}.title`),
      groupTitle: t(`sections.${item.group}`),
    }))

  function handleNavigation(anchor: string) {
    const mePage = document.getElementById('mobile-me')
    if (mePage) {
      window.sessionStorage.setItem(MOBILE_ME_SCROLL_KEY, String(mePage.scrollTop))
    }
    router.push(`/mobile/setting/pages/${anchor}`)
  }

  return (
    <ul className="flex flex-col w-full">
      {
        config.map((item, index) => {
          const previous = config[index - 1]
          const showGroupTitle = !previous || previous.group !== item.group
          
          return (
            <Fragment key={item.anchor}>
              {showGroupTitle && (
                <li className="bg-muted/35 px-4 py-2 text-xs font-medium text-muted-foreground">
                  {item.groupTitle}
                </li>
              )}
              <li
                className="flex w-full items-center justify-between gap-2 p-4 active:bg-accent"
                onClick={() => handleNavigation(item.anchor)}
              >
                <div className="flex items-center gap-4">
                  {item.icon}
                  <span className="text-sm">{item.title}</span>
                </div>
                <ChevronRight className="size-4" />
              </li>
            </Fragment>
          )
        })
      }
    </ul>
  )
}
