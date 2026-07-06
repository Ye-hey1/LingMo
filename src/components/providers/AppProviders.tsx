'use client'

import { Suspense, useEffect } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { ConsoleFilter } from '@/components/console-filter'
import { NextIntlProvider } from '@/components/providers/NextIntlProvider'

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false
    let uninstallSyncReindexHook: (() => void) | undefined
    let uninstallSemanticExtractionHook: (() => void) | undefined

    void import('@/lib/sync/sync-push-queue')
      .then(({ getSyncPushQueue }) => {
        if (!cancelled) {
          getSyncPushQueue()
        }
      })
      .catch((error) => {
        console.error('[AppProviders] Failed to initialize sync push queue:', error)
      })

    void import('@/lib/knowledge/sync-reindex-hook')
      .then(({ installSyncReindexHook }) => {
        if (!cancelled) {
          uninstallSyncReindexHook = installSyncReindexHook()
        }
      })
      .catch((error) => {
        console.error('[AppProviders] Failed to install sync reindex hook:', error)
      })

    void import('@/lib/structured-knowledge/semantic-extraction-hook')
      .then(({ installSemanticExtractionHook }) => {
        if (!cancelled) {
          uninstallSemanticExtractionHook = installSemanticExtractionHook()
        }
      })
      .catch((error) => {
        console.error('[AppProviders] Failed to install semantic extraction hook:', error)
      })

    return () => {
      cancelled = true
      try {
        uninstallSyncReindexHook?.()
      } catch (error) {
        console.error('[AppProviders] uninstall sync reindex hook failed:', error)
      }
      try {
        uninstallSemanticExtractionHook?.()
      } catch (error) {
        console.error('[AppProviders] uninstall semantic extraction hook failed:', error)
      }
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
