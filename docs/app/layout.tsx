import type { Metadata } from 'next'
import { LangProvider } from '@/components/translation'
import './globals.css'

export const metadata: Metadata = {
  title: 'LingMo 使用文档',
  description: 'LingMo 的安装、记录、写作、AI、知识库、同步与部署指南。',
  metadataBase: new URL('https://lingmonote.cc.cd'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <LangProvider>
          {children}
        </LangProvider>
      </body>
    </html>
  )
}
