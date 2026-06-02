'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import React, { useEffect, useState } from 'react'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { Loader2, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BookmarkAttrs {
  url: string
  title: string
  description: string
  icon: string
  cover: string
}

function BookmarkView({ node, updateAttributes }: ReactNodeViewProps) {
  const { url, title, description, icon, cover } = node.attrs as BookmarkAttrs
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // 如果已经有标题，就不重复抓取
    if (title || !url) return

    let active = true
    setLoading(true)

    async function fetchMeta() {
      try {
        // 使用 Tauri 绕过 CORS 的 fetch 请求
        const response = await tauriFetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        })

        if (!response.ok) throw new Error('Failed to fetch')

        const html = await response.text()
        if (!active) return

        // 用 DOMParser 解析 Meta 信息
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        
        const fetchedTitle = doc.querySelector('title')?.textContent || 
                             doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || 
                             url
        
        const fetchedDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || 
                            doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || 
                            '暂无网页详细描述。'

        let fetchedIcon = doc.querySelector('link[rel*="icon"]')?.getAttribute('href') || ''
        if (fetchedIcon && !fetchedIcon.startsWith('http')) {
          const origin = new URL(url).origin
          fetchedIcon = new URL(fetchedIcon, origin).toString()
        }

        let fetchedCover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || 
                             doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || ''
        if (fetchedCover && !fetchedCover.startsWith('http')) {
          const origin = new URL(url).origin
          fetchedCover = new URL(fetchedCover, origin).toString()
        }

        updateAttributes({
          title: fetchedTitle.trim(),
          description: fetchedDesc.trim().slice(0, 100),
          icon: fetchedIcon,
          cover: fetchedCover
        })
      } catch (error) {
        console.error('[Bookmark Extension] Grab failed:', error)
        if (active) {
          // 抓取失败时的极简退火填充
          updateAttributes({
            title: new URL(url).hostname,
            description: url,
            icon: '',
            cover: ''
          })
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    fetchMeta()

    return () => {
      active = false
    }
  }, [url, title, updateAttributes])

  const hostname = new URL(url).hostname

  return (
    <NodeViewWrapper className="bookmark-node-wrapper my-6 group relative">
      <div 
        onClick={() => window.open(url, '_blank')}
        className={cn(
          "flex max-w-full h-32 rounded-xl border border-border bg-card hover:bg-accent/30 overflow-hidden cursor-pointer shadow-sm select-none transition-all duration-300 hover:shadow-md active:scale-[0.99] border-l-4 border-l-primary/70"
        )}
      >
        {/* 左侧详情 */}
        <div className="flex-1 flex flex-col justify-between p-3.5 min-w-0">
          <div className="space-y-1">
            <h4 className="text-[14px] font-semibold text-foreground truncate leading-tight">
              {loading ? (
                <span className="flex items-center gap-1.5 text-muted-foreground font-normal">
                  <Loader2 size={13} className="animate-spin" />
                  正在解析网页书签...
                </span>
              ) : (
                title || hostname
              )}
            </h4>
            <p className="text-[12px] text-muted-foreground line-clamp-2 leading-relaxed">
              {description || '正在异步加载网页概要描述...'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground truncate">
            {icon ? (
              <img src={icon} alt="" className="w-3.5 h-3.5 rounded-sm shrink-0" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            ) : (
              <Globe size={12} className="shrink-0 text-primary/70" />
            )}
            <span className="truncate">{hostname}</span>
          </div>
        </div>

        {/* 右侧封面 */}
        {cover && (
          <div className="w-36 h-full shrink-0 border-l border-border/40 overflow-hidden relative hidden sm:block bg-muted">
            <img 
              src={cover} 
              alt="" 
              className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const BookmarkExtension = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: {
        default: '',
      },
      title: {
        default: '',
      },
      description: {
        default: '',
      },
      icon: {
        default: '',
      },
      cover: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="bookmark"]',
        getAttrs: (element) => ({
          url: element.getAttribute('data-url') || '',
          title: element.getAttribute('data-title') || '',
          description: element.getAttribute('data-description') || '',
          icon: element.getAttribute('data-icon') || '',
          cover: element.getAttribute('data-cover') || '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'bookmark',
        'data-url': node.attrs.url,
        'data-title': node.attrs.title,
        'data-description': node.attrs.description,
        'data-icon': node.attrs.icon,
        'data-cover': node.attrs.cover,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView)
  },

  markdownTokenName: 'bookmark',

  // 网页书签反序列化：独立一行的带有链接语法
  markdownTokenizer: {
    name: 'bookmark',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^\[书签\]\((https?:\/\/[^\s)]+)\)/)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src) => {
      const match = /^\[书签\]\((https?:\/\/[^\s)]+)\)/.exec(src)
      if (!match) return undefined

      return {
        type: 'bookmark',
        raw: match[0],
        attrs: { url: match[1] },
      }
    },
  },

  // 网页书签序列化 Markdown 格式
  renderMarkdown(node) {
    return `\n[书签](${node.attrs?.url || ''})\n`
  },

  parseMarkdown(token) {
    return {
      type: 'bookmark',
      attrs: {
        url: token.attrs?.url || '',
      },
    }
  },
})

export default BookmarkExtension
