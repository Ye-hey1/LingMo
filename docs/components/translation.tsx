'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

export type Lang = 'zh' | 'en' | 'bilingual'

const LangContext = createContext<{
  lang: Lang
  setLang: (lang: Lang) => void
}>({
  lang: 'zh',
  setLang: () => {},
})

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh')
  
  useEffect(() => {
    const saved = window.localStorage.getItem('lingmo-docs-lang') as Lang
    if (saved === 'zh' || saved === 'en' || saved === 'bilingual') {
      setLangState(saved)
    }
  }, [])
  
  const setLang = (newLang: Lang) => {
    setLangState(newLang)
    window.localStorage.setItem('lingmo-docs-lang', newLang)
    
    // 同步触发一个自定义事件，通知页面重新对齐
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('lingmo-lang-changed'))
    }
  }
  
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}

// 核心中英双语对照渲染组件
export function DualLang({
  zh,
  en,
  className = '',
}: {
  zh: React.ReactNode
  en: React.ReactNode
  className?: string
}) {
  const { lang } = useLang()
  
  if (lang === 'zh') {
    return <div className={`zh-only-view ${className}`}>{zh}</div>
  }
  
  if (lang === 'en') {
    return <div className={`en-only-view ${className}`}>{en}</div>
  }
  
  // bilingual 对照模式
  return (
    <div className={`bilingual-layout ${className}`}>
      <div className="bilingual-pane zh-pane">{zh}</div>
      <div className="bilingual-pane en-pane">{en}</div>
    </div>
  )
}

// 适用于个别小词汇、按钮、表头的双语翻译融合组件
export function T({ zh, en }: { zh: string; en: string }) {
  const { lang } = useLang()
  
  if (lang === 'en') {
    return <>{en}</>
  }
  
  if (lang === 'bilingual') {
    return (
      <span className="bilingual-text-inline">
        {zh} <span className="opacity-50 text-[0.85em] font-normal font-sans">/ {en}</span>
      </span>
    )
  }
  
  return <>{zh}</>
}
