import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';

// 加载语言文件
async function loadMessages(locale: string) {
  try {
    return (await import(`../../../messages/${locale}.json`)).default;
  } catch (error) {
    console.error(`Failed to load messages for locale: ${locale}`, error);
    // 如果加载失败，返回中文作为后备
    return (await import(`../../../messages/zh.json`)).default;
  }
}

// 加载中文消息作为回退
async function loadFallbackMessages() {
  return (await import(`../../../messages/zh.json`)).default;
}

// 深度合并对象，用中文填充缺失的翻译
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        // 如果是对象，递归合并
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else if (!(key in target)) {
        // 如果目标中不存在该键，使用源（中文）的值
        result[key] = source[key];
      }
    }
  }
  
  return result;
}

export function NextIntlProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<any>(null);
  const [locale, setLocale] = useState<string>('zh');

  useEffect(() => {
    // 从 localStorage 获取语言设置
    const savedLocale = localStorage.getItem('app-language') || 'zh';
    setLocale(savedLocale);
    
    // 加载对应的语言文件和中文回退
    Promise.all([
      loadMessages(savedLocale),
      loadFallbackMessages()
    ]).then(([currentMessages, fallbackMessages]) => {
      // 如果是中文，直接使用
      if (savedLocale === 'zh') {
        setMessages(currentMessages);
      } else {
        // 其他语言，用中文填充缺失的翻译
        const mergedMessages = deepMerge(currentMessages, fallbackMessages);
        setMessages(mergedMessages);
      }
    });
  }, []);

  // 等待消息加载完成
  if (!messages) {
    return null;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
