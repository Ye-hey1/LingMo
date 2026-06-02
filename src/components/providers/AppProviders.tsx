'use client'

import { Suspense, useEffect } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { ConsoleFilter } from '@/components/console-filter'
import { NextIntlProvider } from '@/components/providers/NextIntlProvider'

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false

    void import('@/lib/sync/sync-push-queue')
      .then(({ getSyncPushQueue }) => {
        if (!cancelled) {
          getSyncPushQueue()
        }
      })
      .catch((error) => {
        console.error('[AppProviders] Failed to initialize sync push queue:', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <ConsoleFilter />
      <Suspense>
        <NextIntlProvider>{children}</NextIntlProvider>
      </Suspense>
      <Toaster />
    </>
  )
}
