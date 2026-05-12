'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function FlashcardReviewPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/core/flashcard')
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      正在打开闪卡复习工作台...
    </div>
  )
}
