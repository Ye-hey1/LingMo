'use client'

import { SettingTab } from "./components/setting-tab"

export default function SettingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div id="setting-page" className="flex h-full">
      <SettingTab />
      <div className="h-full flex-1 overflow-y-auto px-6 py-6 lg:px-8">
        {children}
      </div>
    </div>
  )
}
