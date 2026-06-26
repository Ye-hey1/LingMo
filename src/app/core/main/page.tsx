'use client'

import dynamic from 'next/dynamic'

const MainClient = dynamic(() => import('./main-client'), { ssr: false })

export default function Page() {
  return <MainClient />
}
