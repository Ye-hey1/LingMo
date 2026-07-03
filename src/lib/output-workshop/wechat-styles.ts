/**
 * WeChat article style presets adapted from huasheng_editor.
 *
 * These are intentionally data-only so intelligent layout can reuse the theme
 * recipes without embedding the standalone Vue editor.
 */

export type WechatStyleId =
  | "wechat-default"
  | "latepost-depth"
  | "wechat-anthropic"
  | "wechat-tech"
  | "wechat-elegant"
  | "wechat-deepread"
  | "wechat-ft"
  | "wechat-nyt"
  | "wechat-jonyive"
  | "wechat-medium"
  | "wechat-apple"
  | "guardian"
  | "nikkei"
  | "warm-docs"
  | "lemonde"

export type WechatElementStyle =
  | "container"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "strong"
  | "em"
  | "a"
  | "ul"
  | "ol"
  | "li"
  | "blockquote"
  | "code"
  | "pre"
  | "hr"
  | "img"
  | "table"
  | "th"
  | "td"
  | "tr"

export interface WechatStyleConfig {
  id: WechatStyleId
  name: string
  nameEn: string
  description: string
  bestFor: string
  recommended?: boolean
  styles: Record<WechatElementStyle, string>
}

export const BASE_READABLE_STYLES: Record<WechatElementStyle, string> = {
  container: 'max-width: 700px; margin: 0 auto; padding: 16px 16px 40px 16px; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif; font-size: 16px; line-height: 1.75 !important; color: #1f2933 !important; background-color: #fff !important; word-wrap: break-word;',
  h1: "font-size: 30px; font-weight: 700; color: #111827 !important; line-height: 1.25 !important; margin: 36px 0 18px; letter-spacing: 0;",
  h2: "font-size: 24px; font-weight: 700; color: #111827 !important; line-height: 1.32 !important; margin: 32px 0 16px; letter-spacing: 0;",
  h3: "font-size: 20px; font-weight: 650; color: #1f2933 !important; line-height: 1.4 !important; margin: 28px 0 14px;",
  h4: "font-size: 18px; font-weight: 600; color: #374151 !important; line-height: 1.45 !important; margin: 24px 0 12px;",
  h5: "font-size: 16px; font-weight: 600; color: #4b5563 !important; line-height: 1.5 !important; margin: 20px 0 10px;",
  h6: "font-size: 15px; font-weight: 600; color: #6b7280 !important; line-height: 1.5 !important; margin: 18px 0 8px;",
  p: "margin: 18px 0 !important; line-height: 1.8 !important; color: #1f2933 !important;",
  strong: "font-weight: 700; color: #111827 !important;",
  em: "font-style: italic; color: #4b5563 !important;",
  a: "color: #2563eb !important; text-decoration: none; border-bottom: 1px solid #2563eb;",
  ul: "margin: 18px 0; padding-left: 28px;",
  ol: "margin: 18px 0; padding-left: 28px;",
  li: "margin: 8px 0; line-height: 1.8 !important; color: #1f2933 !important;",
  blockquote: "margin: 20px 0; padding: 12px 18px; background-color: #f8fafc !important; border-left: 4px solid #94a3b8; color: #334155 !important; line-height: 1.65 !important;",
  code: 'font-family: "SF Mono", Consolas, Monaco, "Courier New", monospace; font-size: 14px; padding: 2px 6px; background-color: #f3f4f6 !important; color: #b91c1c !important; border-radius: 4px;',
  pre: "margin: 22px 0; padding: 18px; background-color: #111827 !important; color: #f9fafb !important; border-radius: 8px; overflow-x: auto; line-height: 1.6 !important;",
  hr: "margin: 34px 0; border: none; height: 1px; background-color: #e5e7eb !important;",
  img: "max-width: 100%; max-height: 560px !important; height: auto; display: block; margin: 24px auto; border-radius: 8px;",
  table: "width: 100%; margin: 24px 0; border-collapse: collapse; font-size: 15px;",
  th: "background-color: #f3f4f6 !important; padding: 10px 12px; text-align: left; border: 1px solid #e5e7eb; font-weight: 700; color: #111827 !important;",
  td: "padding: 10px 12px; border: 1px solid #e5e7eb; color: #1f2933 !important;",
  tr: "border-bottom: 1px solid #e5e7eb;",
}

function withReadableBase(overrides: Partial<Record<WechatElementStyle, string>>): Record<WechatElementStyle, string> {
  return { ...BASE_READABLE_STYLES, ...overrides }
}

export const WECHAT_STYLES: WechatStyleConfig[] = [
  {
    id: "wechat-default",
    name: "通用图文",
    nameEn: "WeChat Default",
    description: "稳妥通用的正文排版，适合日常笔记、项目记录和轻量文章。",
    bestFor: "日常图文、项目记录、轻量知识整理",
    styles: {
      container: 'max-width: 740px; margin: 0 auto; padding: 10px 12px 24px 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 16px; line-height: 1.8 !important; color: #3f3f3f !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 24px; font-weight: 600; color: #2c3e50 !important; line-height: 1.4 !important; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #3498db;",
      h2: "font-size: 22px; font-weight: 600; color: #2c3e50 !important; line-height: 1.4 !important; margin: 28px 0 14px; padding-left: 12px; border-left: 4px solid #3498db;",
      h3: "font-size: 20px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 24px 0 12px;",
      h4: "font-size: 18px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 20px 0 10px;",
      h5: "font-size: 17px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 18px 0 9px;",
      h6: "font-size: 16px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 16px 0 8px;",
      p: "margin: 16px 0 !important; line-height: 1.8 !important; color: #3f3f3f !important;",
      strong: "font-weight: 600; color: #2c3e50 !important;",
      em: "font-style: italic; color: #555 !important;",
      a: "color: #3498db !important; text-decoration: none; border-bottom: 1px solid #3498db;",
      ul: "margin: 16px 0; padding-left: 24px;",
      ol: "margin: 16px 0; padding-left: 24px;",
      li: "margin: 8px 0; line-height: 1.8 !important;",
      blockquote: "margin: 16px 0; padding: 8px 16px; background-color: #fafafa !important; border-left: 3px solid #999; color: #666 !important; line-height: 1.5 !important;",
      code: 'font-family: Consolas, Monaco, "Courier New", monospace; font-size: 14px; padding: 2px 6px; background-color: #f5f5f5 !important; color: #e74c3c !important; border-radius: 3px;',
      pre: "margin: 20px 0; padding: 16px; background-color: #2d2d2d !important; border-radius: 8px; overflow-x: auto; line-height: 1.6 !important;",
      hr: "margin: 32px 0; border: none; border-top: 1px solid #e0e0e0;",
      img: "max-width: 100%; max-height: 600px !important; height: auto; display: block; margin: 20px auto; border-radius: 8px;",
      table: "width: 100%; margin: 20px 0; border-collapse: collapse; font-size: 15px;",
      th: "background-color: #f0f0f0 !important; padding: 10px; text-align: left; border: 1px solid #e0e0e0; font-weight: 600;",
      td: "padding: 10px; border: 1px solid #e0e0e0;",
      tr: "border-bottom: 1px solid #e0e0e0;",
    },
  },
  {
    id: "latepost-depth",
    name: "晚点风格",
    nameEn: "LatePost Depth",
    description: "红色新闻强调、强信息密度和深度报道质感，适合商业复盘与行业观察。",
    bestFor: "商业复盘、创业观察、行业评论、深度分析",
    recommended: true,
    styles: withReadableBase({
      container: 'max-width: 700px; margin: 0 auto; padding: 16px 12px 36px 12px; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 17px; line-height: 1.8 !important; color: #1a1a1a !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 26px; font-weight: 700; color: #1a1a1a !important; line-height: 1.3 !important; margin: 36px 0 18px; padding-left: 16px; border-left: 5px solid #d32f2f;",
      h2: "font-size: 20px; font-weight: 600; color: #fff !important; line-height: 1.4 !important; margin: 32px 0 16px; padding: 12px 20px; background-color: #d32f2f !important; border-radius: 4px;",
      h3: "font-size: 18px; font-weight: 600; color: #d32f2f !important; line-height: 1.45 !important; margin: 28px 0 14px; padding-left: 14px; border-left: 4px solid #d32f2f;",
      strong: "font-weight: 700; color: #d32f2f !important; background-color: rgba(211, 47, 47, 0.08) !important; padding: 2px 6px; border-radius: 3px;",
      a: "color: #d32f2f !important; text-decoration: none; border-bottom: 1px solid #d32f2f;",
      blockquote: "margin: 20px 0; padding: 12px 18px; background-color: #f5f5f5 !important; border-left: 4px solid #d32f2f; color: #1a1a1a !important; font-size: 16px; line-height: 1.6 !important; border-radius: 4px;",
      code: 'font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 15px; padding: 3px 8px; background-color: #f5f5f5 !important; color: #d32f2f !important; border-radius: 4px; font-weight: 500;',
      pre: "margin: 24px 0; padding: 18px; background-color: #2a2a2a !important; color: #f5f5f5 !important; border-radius: 6px; overflow-x: auto; line-height: 1.6 !important; border-left: 4px solid #d32f2f;",
      th: "background-color: #d32f2f !important; color: #fff !important; padding: 10px 14px; text-align: left; font-weight: 600; border: none;",
    }),
  },
  {
    id: "wechat-anthropic",
    name: "Claude",
    nameEn: "Claude WeChat",
    description: "温暖纸感、柔和强调色和技术文档气质，适合 AI、产品、方法论文。",
    bestFor: "AI 笔记、产品方法、技术解释、知识型长文",
    recommended: true,
    styles: {
      container: 'max-width: 700px; margin: 0 auto; padding: 20px 24px 40px 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.75 !important; color: #2b2b2b !important; background-color: #faf9f7 !important; word-wrap: break-word; letter-spacing: 0;',
      h1: "font-size: 32px; font-weight: 600; color: #C15F3C !important; line-height: 1.2 !important; margin: 36px 0 18px; letter-spacing: 0; border-bottom: 1px solid rgba(193, 95, 60, 0.22); padding-bottom: 14px;",
      h2: "font-size: 26px; font-weight: 600; color: #C15F3C !important; line-height: 1.25 !important; margin: 32px 0 16px; letter-spacing: 0; padding-left: 14px; border-left: 4px solid #C15F3C;",
      h3: "font-size: 22px; font-weight: 600; color: #2b2b2b !important; line-height: 1.3 !important; margin: 28px 0 14px; letter-spacing: 0;",
      h4: "font-size: 19px; font-weight: 600; color: #3a3a3a !important; line-height: 1.35 !important; margin: 24px 0 12px; letter-spacing: 0;",
      h5: "font-size: 17px; font-weight: 600; color: #4a4a4a !important; line-height: 1.4 !important; margin: 20px 0 10px;",
      h6: "font-size: 16px; font-weight: 600; color: #5a5a5a !important; line-height: 1.45 !important; margin: 18px 0 9px;",
      p: "margin: 20px 0 !important; line-height: 1.8 !important; color: #2b2b2b !important; font-size: 17px; letter-spacing: 0;",
      strong: "font-weight: 600; color: #C15F3C !important; background-color: rgba(193, 95, 60, 0.08) !important; padding: 2px 6px; border-radius: 3px;",
      em: "font-style: italic; color: #5a5a5a !important;",
      a: "color: #C15F3C !important; text-decoration: none; border-bottom: 1px solid rgba(193, 95, 60, 0.4); font-weight: 500;",
      ul: "margin: 20px 0; padding-left: 28px;",
      ol: "margin: 20px 0; padding-left: 28px;",
      li: "margin: 10px 0; line-height: 1.8 !important; color: #2b2b2b !important; font-size: 17px;",
      blockquote: "margin: 18px 0; padding: 10px 16px; background: rgba(193, 95, 60, 0.06) !important; border-left: 4px solid #C15F3C; color: #2b2b2b !important; font-size: 17px; line-height: 1.6 !important; font-style: italic; border-radius: 6px;",
      code: 'font-family: "SF Mono", Consolas, Monaco, monospace; font-size: 15px; padding: 2px 6px; background-color: rgba(193, 95, 60, 0.08) !important; color: #C15F3C !important; border-radius: 6px; font-weight: 500; border: 1px solid rgba(193, 95, 60, 0.15);',
      pre: "margin: 24px 0; padding: 20px; background: #2b2b2b !important; color: #f5f5f5 !important; border-radius: 10px; overflow-x: auto; line-height: 1.55 !important;",
      hr: "margin: 36px auto; border: none; height: 2px; background-color: rgba(193, 95, 60, 0.2) !important; max-width: 200px;",
      img: "max-width: 100%; max-height: 500px !important; height: auto; display: block; margin: 24px auto; border-radius: 10px;",
      table: "width: 100%; margin: 24px 0; border-collapse: collapse; font-size: 16px; border-radius: 8px; overflow: hidden;",
      th: "background-color: rgba(193, 95, 60, 0.08) !important; padding: 12px 16px; text-align: left; border: none; font-weight: 600; color: #2b2b2b !important; border-bottom: 2px solid rgba(193, 95, 60, 0.2);",
      td: "padding: 12px 16px; border: none; border-bottom: 1px solid rgba(193, 95, 60, 0.1); color: #2b2b2b !important;",
      tr: "border: none;",
    },
  },
  {
    id: "wechat-elegant",
    name: "优雅简约",
    nameEn: "Elegant Minimal",
    description: "宋体感、居中标题和段首缩进，适合人文随笔与温和长文。",
    bestFor: "人文随笔、读书笔记、访谈整理、温和叙事",
    styles: withReadableBase({
      container: 'max-width: 720px; margin: 0 auto; padding: 12px 20px 30px 20px; font-family: "Songti SC", "SimSun", Georgia, serif; font-size: 17px; line-height: 1.85 !important; color: #333 !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 26px; font-weight: 400; color: #1a1a1a !important; line-height: 1.4 !important; margin: 36px 0 18px; text-align: center; letter-spacing: 2px;",
      h2: "font-size: 22px; font-weight: 400; color: #2c2c2c !important; line-height: 1.45 !important; margin: 32px 0 16px; text-align: center; letter-spacing: 1px;",
      h3: "font-size: 19px; font-weight: 400; color: #3a3a3a !important; line-height: 1.5 !important; margin: 28px 0 14px; letter-spacing: 0.5px;",
      p: "margin: 18px 0 !important; line-height: 1.85 !important; color: #444 !important; text-indent: 2em; letter-spacing: 0.5px;",
      a: "color: #8b7355 !important; text-decoration: none; border-bottom: 1px dotted #8b7355;",
      blockquote: "margin: 18px auto; padding: 10px 20px; background-color: transparent !important; border-left: 2px solid #ccc; color: #666 !important; max-width: 600px; line-height: 1.6 !important;",
      pre: "margin: 24px 0; padding: 18px; background-color: #f9f9f9 !important; border: 1px solid #e5e5e5; border-radius: 8px; overflow-x: auto; line-height: 1.7 !important;",
    }),
  },
  {
    id: "wechat-deepread",
    name: "深度阅读",
    nameEn: "Deep Read",
    description: "克制黑白、长段落友好，适合低干扰的深度正文阅读。",
    bestFor: "深度阅读、研究摘录、长文整理、严肃评论",
    styles: withReadableBase({
      container: 'max-width: 680px; margin: 0 auto; padding: 14px 12px 32px 12px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.75 !important; color: #1a1a1a !important; background-color: #fff !important; word-wrap: break-word; letter-spacing: 0;',
      h1: "font-size: 26px; font-weight: 700; color: #0a0a0a !important; line-height: 1.25 !important; margin: 36px 0 18px; letter-spacing: 0;",
      h2: "font-size: 22px; font-weight: 700; color: #0a0a0a !important; line-height: 1.3 !important; margin: 32px 0 16px; letter-spacing: 0;",
      blockquote: "margin: 20px 0; padding: 12px 18px; background-color: #f8f9fa !important; border-left: 4px solid #0a0a0a; color: #1a1a1a !important; font-size: 16px; line-height: 1.6 !important; font-style: normal;",
      pre: "margin: 24px 0; padding: 20px; background-color: #f6f8fa !important; color: #1a1a1a !important; border-radius: 8px; overflow-x: auto; line-height: 1.6 !important; border: 1px solid #e1e4e8;",
      code: 'font-family: "SF Mono", Consolas, Monaco, "Courier New", monospace; font-size: 15px; padding: 2px 6px; background-color: #f5f5f5 !important; color: #d73a49 !important; border-radius: 3px;',
    }),
  },
  {
    id: "wechat-tech",
    name: "技术风格",
    nameEn: "Tech WeChat",
    description: "高可读代码块、蓝绿强调和清晰标题层级，适合工程技术内容。",
    bestFor: "技术教程、源码解析、开发日志、API 说明",
    recommended: true,
    styles: {
      container: 'max-width: 740px; margin: 0 auto; padding: 10px 20px 24px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 16px; line-height: 1.75 !important; color: #2c3e50 !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 26px; font-weight: 700; color: #1a1a1a !important; line-height: 1.3 !important; margin: 36px 0 18px; padding: 0 0 12px; border-bottom: 3px solid #0066cc;",
      h2: "font-size: 22px; font-weight: 700; color: #1a1a1a !important; line-height: 1.3 !important; margin: 32px 0 16px; padding-left: 16px; padding-top: 4px; padding-bottom: 4px; border-left: 5px solid #00a67d; background-color: #f0f9ff !important;",
      h3: "font-size: 20px; font-weight: 600; color: #2c3e50 !important; line-height: 1.4 !important; margin: 28px 0 14px; padding-left: 12px; border-left: 3px solid #ff9800;",
      h4: "font-size: 18px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 24px 0 12px;",
      h5: "font-size: 17px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 20px 0 10px;",
      h6: "font-size: 16px; font-weight: 600; color: #34495e !important; line-height: 1.4 !important; margin: 18px 0 9px;",
      p: "margin: 18px 0 !important; line-height: 1.8 !important; color: #3a3a3a !important;",
      strong: "font-weight: 700; color: #1a1a1a !important; background-color: #fff3cd !important; padding: 2px 4px; border-radius: 6px;",
      em: "font-style: italic; color: #666 !important;",
      a: "color: #0066cc !important; text-decoration: none; border-bottom: 1px solid #0066cc;",
      ul: "margin: 18px 0; padding-left: 28px;",
      ol: "margin: 18px 0; padding-left: 28px;",
      li: "margin: 10px 0; line-height: 1.8 !important; color: #3a3a3a !important;",
      blockquote: "margin: 16px 0; padding: 8px 16px; background-color: #f5f9fc !important; border-left: 3px solid #2196f3; color: #555 !important; line-height: 1.5 !important;",
      code: 'font-family: "Fira Code", Consolas, Monaco, "Courier New", monospace; font-size: 14px; padding: 3px 6px; background-color: #ffe6e6 !important; color: #d63031 !important; border-radius: 6px; font-weight: 500;',
      pre: "margin: 24px 0; padding: 20px; background-color: #1e1e1e !important; border-radius: 8px; overflow-x: auto; line-height: 1.6 !important;",
      hr: "margin: 36px 0; border: none; height: 2px; background-color: #d7e8ff !important;",
      img: "max-width: 100%; max-height: 600px !important; height: auto; display: block; margin: 24px auto; border-radius: 8px;",
      table: "width: 100%; margin: 24px 0; border-collapse: collapse; font-size: 15px;",
      th: "background-color: #0066cc !important; color: #fff !important; padding: 12px; text-align: left; border: 1px solid #0052a3; font-weight: 600;",
      td: "padding: 12px; border: 1px solid #e0e0e0; background-color: #fff !important;",
      tr: "border-bottom: 1px solid #e0e0e0;",
    },
  },
  {
    id: "wechat-jonyive",
    name: "Jony Ive",
    nameEn: "Jony Ive",
    description: "Apple 产品文案式极简留白，轻字重、低噪声、强调产品感。",
    bestFor: "产品叙事、设计说明、品牌介绍、极简专栏",
    styles: withReadableBase({
      container: 'max-width: 620px; margin: 0 auto; padding: 16px 24px 40px 24px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.6 !important; color: #6e6e73 !important; background-color: #fbfbfd !important; word-wrap: break-word;',
      h1: "font-size: 39px; font-weight: 200; color: #1d1d1f !important; line-height: 1.15 !important; margin: 48px 0 24px; letter-spacing: 0;",
      h2: "font-size: 28px; font-weight: 300; color: #1d1d1f !important; line-height: 1.2 !important; margin: 40px 0 20px; letter-spacing: 0;",
      h3: "font-size: 20px; font-weight: 400; color: #1d1d1f !important; line-height: 1.25 !important; margin: 32px 0 16px; letter-spacing: 0;",
      p: "margin: 20px 0 !important; line-height: 1.6 !important; color: #6e6e73 !important; font-weight: 300;",
      strong: "font-weight: 500; color: #1d1d1f !important;",
      em: "font-style: normal; color: #6e6e73 !important; font-weight: 300;",
      a: "color: #06c !important; text-decoration: none; font-weight: 400;",
      blockquote: "margin: 32px auto; padding: 0; background-color: transparent !important; border-left: none; color: #1d1d1f !important; font-size: 18px; line-height: 1.4 !important; font-weight: 300; text-align: center; max-width: 520px; font-style: normal;",
      pre: "margin: 28px 0; padding: 20px; background-color: #f5f5f7 !important; color: #6e6e73 !important; border-radius: 10px; overflow-x: auto; line-height: 1.5 !important;",
    }),
  },
  {
    id: "wechat-ft",
    name: "金融时报",
    nameEn: "Financial Times WeChat",
    description: "FT 纸色、深红强调和报刊气质，适合商业分析与财经长文。",
    bestFor: "商业分析、财经评论、行业研究、趋势报告",
    styles: {
      container: 'max-width: 680px; margin: 0 auto; padding: 16px 20px 40px 20px; font-family: Georgia, "Times New Roman", Times, serif; font-size: 17px; line-height: 1.75 !important; color: #33302e !important; background-color: #fff1e5 !important; word-wrap: break-word;',
      h1: "font-size: 38px; font-weight: 600; color: #000 !important; line-height: 1.2 !important; margin: 56px 0 24px; font-family: Georgia, serif; letter-spacing: 0; border-bottom: 4px solid #990f3d; padding-bottom: 16px;",
      h2: "font-size: 30px; font-weight: 600; color: #990f3d !important; line-height: 1.3 !important; margin: 48px 0 20px; font-family: Georgia, serif; border-left: 6px solid #990f3d; padding-left: 20px;",
      h3: "font-size: 24px; font-weight: 600; color: #33302e !important; line-height: 1.4 !important; margin: 40px 0 16px; font-family: Georgia, serif; border-bottom: 2px solid #cec6b9; padding-bottom: 8px;",
      h4: "font-size: 20px; font-weight: 600; color: #33302e !important; line-height: 1.5 !important; margin: 32px 0 12px; font-family: Georgia, serif;",
      h5: "font-size: 18px; font-weight: 600; color: #33302e !important; line-height: 1.5 !important; margin: 28px 0 12px; font-family: Georgia, serif;",
      h6: "font-size: 17px; font-weight: 600; color: #33302e !important; line-height: 1.5 !important; margin: 24px 0 10px; font-family: Georgia, serif; font-style: italic;",
      p: "margin: 20px 0 !important; line-height: 1.75 !important; color: #33302e !important;",
      strong: "font-weight: 700; color: #990f3d !important;",
      em: "font-style: italic; color: #33302e !important;",
      a: "color: #0d7680 !important; text-decoration: none; border-bottom: 2px solid #0d7680; font-weight: 600;",
      ul: "margin: 24px 0; padding-left: 32px;",
      ol: "margin: 24px 0; padding-left: 32px;",
      li: "margin: 12px 0; line-height: 1.75 !important; color: #33302e !important;",
      blockquote: "margin: 24px 0; padding: 14px 20px; background-color: #fff1e5 !important; color: #990f3d !important; font-size: 17px; line-height: 1.6 !important; font-style: italic; font-family: Georgia, serif; border-left: 6px solid #990f3d;",
      code: 'font-family: "Courier New", Courier, monospace; font-size: 15px; padding: 3px 8px; background-color: #fff !important; color: #990f3d !important; border: 1px solid #cec6b9; font-weight: 600;',
      pre: "margin: 28px 0; padding: 24px; background-color: #fff !important; border-left: 4px solid #990f3d; overflow-x: auto; line-height: 1.6 !important;",
      hr: "margin: 48px auto; border: none; height: 2px; background-color: #990f3d !important; max-width: 80px;",
      img: "max-width: 100%; max-height: 600px !important; height: auto; display: block; margin: 32px auto; border: 3px solid #990f3d;",
      table: "width: 100%; margin: 32px 0; border-collapse: collapse; font-size: 16px; background-color: #fff !important;",
      th: "background-color: #990f3d !important; color: #fff !important; padding: 14px 16px; text-align: left; border: 1px solid #990f3d; font-weight: 700; font-family: Georgia, serif;",
      td: "padding: 14px 16px; border: 1px solid #cec6b9; color: #33302e !important; background-color: #fff !important;",
      tr: "border-bottom: 1px solid #cec6b9;",
    },
  },
  {
    id: "wechat-nyt",
    name: "纽约时报",
    nameEn: "New York Times WeChat",
    description: "经典新闻长文风格，强标题、衬线正文和克制黑白系统。",
    bestFor: "深度报道、观点文章、访谈整理、新闻叙事",
    styles: {
      container: 'max-width: 680px; margin: 0 auto; padding: 20px 12px 48px 12px; font-family: Georgia, "Times New Roman", Times, serif; font-size: 18px; line-height: 1.8 !important; color: #121212 !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 42px; font-weight: 700; color: #000 !important; line-height: 1.2 !important; margin: 56px 0 16px; font-family: Georgia, serif; letter-spacing: 0; border-bottom: 1px solid #000; padding-bottom: 16px;",
      h2: "font-size: 32px; font-weight: 700; color: #000 !important; line-height: 1.3 !important; margin: 48px 0 16px; font-family: Georgia, serif; letter-spacing: 0;",
      h3: "font-size: 24px; font-weight: 700; color: #121212 !important; line-height: 1.4 !important; margin: 40px 0 16px; font-family: Georgia, serif;",
      h4: "font-size: 20px; font-weight: 700; color: #1a1a1a !important; line-height: 1.5 !important; margin: 32px 0 12px; font-family: Georgia, serif;",
      h5: "font-size: 18px; font-weight: 700; color: #2a2a2a !important; line-height: 1.5 !important; margin: 28px 0 12px; font-family: Georgia, serif;",
      h6: "font-size: 16px; font-weight: 700; color: #3a3a3a !important; line-height: 1.5 !important; margin: 24px 0 10px; font-family: Georgia, serif; font-style: italic;",
      p: "margin: 20px 0 !important; line-height: 1.8 !important; color: #121212 !important; text-align: left;",
      strong: "font-weight: 700; color: #000 !important;",
      em: "font-style: italic; color: #121212 !important;",
      a: "color: #326891 !important; text-decoration: none; border-bottom: 1px solid #326891; word-break: break-all;",
      ul: "margin: 24px 0; padding-left: 40px;",
      ol: "margin: 24px 0; padding-left: 40px;",
      li: "margin: 12px 0; line-height: 1.8 !important; color: #121212 !important; text-align: left;",
      blockquote: "margin: 24px 0; padding: 14px 24px; background-color: #f7f7f7 !important; border-left: 5px solid #121212; color: #121212 !important; font-size: 18px; line-height: 1.6 !important; font-style: italic; font-family: Georgia, serif;",
      code: 'font-family: "Courier New", Courier, monospace; font-size: 16px; padding: 2px 6px; background-color: #f0f0f0 !important; color: #666 !important; border: 1px solid #ddd;',
      pre: "margin: 28px 0; padding: 24px; background-color: #f7f7f7 !important; border: 1px solid #ddd; overflow-x: auto; line-height: 1.6 !important;",
      hr: "margin: 48px auto; border: none; height: 1px; background-color: #ddd !important; max-width: 100px;",
      img: "max-width: 100%; max-height: 600px !important; height: auto; display: block; margin: 32px auto; border: 1px solid #ddd;",
      table: "width: 100%; margin: 32px 0; border-collapse: collapse; font-size: 16px; border: 1px solid #ddd;",
      th: "background-color: #f7f7f7 !important; padding: 14px 16px; text-align: left; border: 1px solid #ddd; font-weight: 700; color: #121212 !important; font-family: Georgia, serif;",
      td: "padding: 14px 16px; border: 1px solid #ddd; color: #121212 !important;",
      tr: "border-bottom: 1px solid #ddd;",
    },
  },
  {
    id: "wechat-medium",
    name: "Medium 长文",
    nameEn: "Medium WeChat",
    description: "清爽长文阅读节奏，适合知识文章、随笔和读书笔记。",
    bestFor: "长文随笔、读书笔记、知识解释、个人专栏",
    styles: {
      container: 'max-width: 680px; margin: 0 auto; padding: 20px 12px 40px 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.7 !important; color: #242424 !important; background-color: #fff !important; word-wrap: break-word; letter-spacing: 0;',
      h1: 'font-size: 28px; font-weight: 700; color: #242424 !important; line-height: 1.2 !important; margin: 36px 0 18px; letter-spacing: 0; font-family: Georgia, "Times New Roman", serif;',
      h2: 'font-size: 24px; font-weight: 700; color: #242424 !important; line-height: 1.25 !important; margin: 32px 0 16px; letter-spacing: 0; font-family: Georgia, "Times New Roman", serif;',
      h3: 'font-size: 20px; font-weight: 700; color: #242424 !important; line-height: 1.3 !important; margin: 28px 0 14px; letter-spacing: 0; font-family: Georgia, "Times New Roman", serif;',
      h4: 'font-size: 18px; font-weight: 700; color: #242424 !important; line-height: 1.35 !important; margin: 24px 0 12px; font-family: Georgia, "Times New Roman", serif;',
      h5: 'font-size: 17px; font-weight: 700; color: #242424 !important; line-height: 1.4 !important; margin: 20px 0 10px; font-family: Georgia, "Times New Roman", serif;',
      h6: 'font-size: 16px; font-weight: 700; color: #242424 !important; line-height: 1.4 !important; margin: 18px 0 9px; font-family: Georgia, "Times New Roman", serif;',
      p: "margin: 20px 0 !important; line-height: 1.75 !important; color: #242424 !important; font-size: 17px; letter-spacing: 0;",
      strong: "font-weight: 700; color: #242424 !important;",
      em: "font-style: italic; color: #242424 !important;",
      a: "color: #242424 !important; text-decoration: none; border-bottom: 1px solid #242424;",
      ul: "margin: 20px 0; padding-left: 32px;",
      ol: "margin: 20px 0; padding-left: 32px;",
      li: "margin: 10px 0; line-height: 1.7 !important; color: #242424 !important; font-size: 17px;",
      blockquote: 'margin: 20px 0; padding: 0 20px; border-left: 3px solid #242424; color: #242424 !important; font-size: 17px; line-height: 1.6 !important; font-style: italic; font-family: Georgia, "Times New Roman", serif;',
      code: 'font-family: Menlo, Monaco, "Courier New", monospace; font-size: 15px; padding: 2px 6px; background-color: #f5f5f5 !important; color: #d73a49 !important; border-radius: 3px;',
      pre: "margin: 24px 0; padding: 20px; background-color: #f7f7f7 !important; border-radius: 8px; overflow-x: auto; line-height: 1.5 !important;",
      hr: "margin: 36px auto; border: none; text-align: center; height: 1px; background-color: #e6e6e6 !important; max-width: 300px;",
      img: "max-width: 100%; max-height: 500px !important; height: auto; display: block; margin: 24px auto;",
      table: "width: 100%; margin: 24px 0; border-collapse: collapse; font-size: 16px;",
      th: "background-color: #f7f7f7 !important; padding: 10px 14px; text-align: left; border-bottom: 2px solid #e6e6e6; font-weight: 700; color: #242424 !important;",
      td: "padding: 10px 14px; border-bottom: 1px solid #e6e6e6; color: #242424 !important;",
      tr: "border: none;",
    },
  },
  {
    id: "wechat-apple",
    name: "Apple 极简",
    nameEn: "Apple Minimal",
    description: "更现代的 Apple 极简正文排版，适合简洁产品公告和知识说明。",
    bestFor: "产品公告、功能介绍、轻量知识说明、设计记录",
    styles: withReadableBase({
      container: 'max-width: 640px; margin: 0 auto; padding: 20px 12px 40px 12px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.65 !important; color: #86868b !important; background-color: #fbfbfd !important; word-wrap: break-word;',
      h1: "font-size: 32px; font-weight: 600; color: #1d1d1f !important; line-height: 1.15 !important; margin: 36px 0 18px; letter-spacing: 0;",
      h2: "font-size: 26px; font-weight: 600; color: #1d1d1f !important; line-height: 1.2 !important; margin: 32px 0 16px; letter-spacing: 0;",
      h3: "font-size: 21px; font-weight: 600; color: #1d1d1f !important; line-height: 1.25 !important; margin: 28px 0 14px; letter-spacing: 0;",
      p: "margin: 20px 0 !important; line-height: 1.7 !important; color: #86868b !important; font-size: 17px;",
      strong: "font-weight: 600; color: #1d1d1f !important;",
      em: "font-style: normal; color: #86868b !important;",
      a: "color: #06c !important; text-decoration: none;",
      blockquote: "margin: 24px auto; padding: 0; background-color: transparent !important; border-left: none; color: #1d1d1f !important; font-size: 18px; line-height: 1.45 !important; font-weight: 600; text-align: center; max-width: 560px; font-style: normal;",
      pre: "margin: 24px 0; padding: 20px; background-color: #f5f5f7 !important; color: #86868b !important; border-radius: 10px; overflow-x: auto; line-height: 1.5 !important;",
    }),
  },
  {
    id: "guardian",
    name: "Guardian 卫报",
    nameEn: "Guardian",
    description: "蓝黄红新闻识别度强，适合观点鲜明的媒体风图文。",
    bestFor: "观点文章、新闻解读、公共议题、专题评论",
    styles: withReadableBase({
      container: 'max-width: 700px; margin: 0 auto; padding: 16px 12px 40px 12px; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.6 !important; color: #121212 !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 42px; font-weight: 700; color: #052962 !important; line-height: 1.15 !important; margin: 40px 0 20px; padding-bottom: 12px; border-bottom: 3px solid #052962;",
      h2: "font-size: 32px; font-weight: 600; color: #052962 !important; line-height: 1.25 !important; margin: 35px 0 18px; border-left: 5px solid #C70000; background-color: #f6f6f6 !important; padding: 12px 16px;",
      h3: "font-size: 24px; font-weight: 600; color: #052962 !important; line-height: 1.3 !important; margin: 30px 0 15px; padding: 8px 12px; background-color: #FEC200 !important; display: inline-block;",
      strong: "font-weight: 700; color: #052962 !important; background-color: rgba(5, 41, 98, 0.05) !important; padding: 1px 4px;",
      a: "color: #0084C6 !important; text-decoration: none; border-bottom: 1px solid #0084C6;",
      blockquote: "margin: 24px 0; padding: 14px 20px; background-color: #FEC200 !important; border-left: 4px solid #C70000; color: #052962 !important; font-size: 17px; line-height: 1.5 !important; font-weight: 500;",
      pre: "margin: 25px 0; padding: 20px; background-color: #052962 !important; color: #fff !important; border-radius: 4px; overflow-x: auto; line-height: 1.5 !important;",
      th: "background-color: #052962 !important; color: #fff !important; padding: 12px 15px; text-align: left; font-weight: 600; border: 1px solid #052962;",
    }),
  },
  {
    id: "nikkei",
    name: "Nikkei 日经",
    nameEn: "Nikkei",
    description: "紧凑商务媒体风，字号偏小、节奏密，适合财经资讯摘要。",
    bestFor: "财经快讯、市场摘要、商业资讯、日式商务报道",
    styles: withReadableBase({
      container: 'max-width: 650px; margin: 0 auto; padding: 10px 12px 24px 12px; font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif; font-size: 15px; line-height: 1.6 !important; color: #1a1a1a !important; background-color: #fff !important; word-wrap: break-word;',
      h1: "font-size: 24px; font-weight: 700; color: #000 !important; line-height: 1.3 !important; margin: 25px 0 15px; padding-bottom: 8px; border-bottom: 2px solid #000;",
      h2: "font-size: 18px; font-weight: 700; color: #c41230 !important; line-height: 1.4 !important; margin: 20px 0 12px; padding-left: 10px; border-left: 3px solid #c41230;",
      h3: "font-size: 16px; font-weight: 600; color: #000 !important; line-height: 1.4 !important; margin: 18px 0 10px; padding: 4px 8px; background-color: #f5f5f5 !important;",
      p: "margin: 12px 0 !important; line-height: 1.6 !important; color: #1a1a1a !important; text-align: justify;",
      strong: "font-weight: 700; color: #000 !important; background-color: #fff3f3 !important; padding: 0 2px;",
      em: "font-style: normal; color: #c41230 !important; font-weight: 600;",
      blockquote: "margin: 16px 0; padding: 10px 15px; background-color: transparent !important; border-left: 2px solid #c41230; border-right: 2px solid #c41230; color: #1a1a1a !important; font-size: 14px; line-height: 1.5 !important;",
      th: "background-color: #c41230 !important; color: #fff !important; padding: 8px 10px; text-align: left; font-weight: 600; border: 1px solid #c41230;",
    }),
  },
  {
    id: "warm-docs",
    name: "焦橙文档",
    nameEn: "Warm Docs",
    description: "焦橙强调与文档式结构，适合教程、说明和内部知识库。",
    bestFor: "教程文档、说明书、工作流整理、团队知识库",
    styles: withReadableBase({
      container: 'max-width: 700px; margin: 0 auto; padding: 16px 20px 40px 20px; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif; font-size: 16px; line-height: 1.8 !important; color: #1A1A1A !important; background-color: #FAFAF9 !important; word-wrap: break-word;',
      h1: "font-size: 28px; font-weight: 700; color: #1A1A1A !important; line-height: 1.3 !important; margin: 36px 0 12px; padding-bottom: 12px; border-bottom: 3px solid #C2410C;",
      h2: "font-size: 22px; font-weight: 700; color: #1A1A1A !important; line-height: 1.35 !important; margin: 36px 0 14px; padding-top: 16px; border-top: 3px solid #C2410C;",
      h3: "font-size: 18px; font-weight: 600; color: #1A1A1A !important; line-height: 1.4 !important; margin: 28px 0 12px; padding-left: 14px; border-left: 4px solid #C2410C;",
      strong: "font-weight: 600; color: #C2410C !important;",
      a: "color: #C2410C !important; text-decoration: none; border-bottom: 1px solid #C2410C;",
      blockquote: "margin: 20px 0; padding: 12px 18px; background-color: #FFF7ED !important; border-left: 4px solid #C2410C; color: #1A1A1A !important; font-size: 15px; line-height: 1.7 !important; border-radius: 0 4px 4px 0;",
      code: 'font-family: "JetBrains Mono", "SF Mono", Consolas, monospace; font-size: 14px; padding: 2px 6px; background-color: #F5F5F0 !important; color: #C2410C !important; border-radius: 3px; border: 1px solid #E5E5E5;',
      pre: "margin: 22px 0; padding: 18px; background-color: #F5F5F0 !important; color: #1A1A1A !important; border: 1px solid #E5E5E5; border-radius: 4px; overflow-x: auto; line-height: 1.6 !important;",
    }),
  },
  {
    id: "lemonde",
    name: "Le Monde 世界报",
    nameEn: "Le Monde",
    description: "法式报刊与复古衬线气质，适合优雅的国际媒体长文。",
    bestFor: "文化评论、国际议题、优雅长文、专栏文章",
    styles: withReadableBase({
      container: 'max-width: 680px; margin: 0 auto; padding: 20px 20px 45px 20px; font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.8 !important; color: #2c2c2c !important; background-color: #fffef9 !important; word-wrap: break-word;',
      h1: 'font-size: 32px; font-weight: 400; color: #1a1a1a !important; line-height: 1.2 !important; margin: 36px 0 18px; text-align: center; letter-spacing: 0; font-family: "Didot", Georgia, serif; text-transform: uppercase;',
      h2: "font-size: 26px; font-weight: 300; color: #2c2c2c !important; line-height: 1.3 !important; margin: 32px 0 16px; text-align: center; padding: 14px 0; border-top: 1px solid #2c2c2c; border-bottom: 1px solid #2c2c2c; font-style: italic;",
      h3: "font-size: 21px; font-weight: 400; color: #2c2c2c !important; line-height: 1.35 !important; margin: 28px 0 14px; padding-left: 16px; font-style: italic;",
      p: "margin: 20px 0 !important; line-height: 1.85 !important; color: #2c2c2c !important; text-align: justify; text-indent: 2em;",
      strong: "font-weight: 600; color: #1a1a1a !important; letter-spacing: 0.05em;",
      a: "color: #2c2c2c !important; text-decoration: none; border-bottom: 1px dotted #2c2c2c;",
      blockquote: "margin: 20px auto; padding: 16px 26px; background-color: transparent !important; border-top: 1px solid #2c2c2c; border-bottom: 1px solid #2c2c2c; color: #2c2c2c !important; font-size: 17px; line-height: 1.6 !important; font-style: italic; text-align: center; max-width: 500px; font-family: Georgia, serif;",
      pre: "margin: 24px 0; padding: 20px; background-color: #f9f9f9 !important; color: #2c2c2c !important; border: 1px solid #2c2c2c; overflow-x: auto; line-height: 1.6 !important;",
    }),
  },
]

export const WECHAT_STYLE_MAP = Object.fromEntries(
  WECHAT_STYLES.map((style) => [style.id, style])
) as Record<WechatStyleId, WechatStyleConfig>

export const WECHAT_STYLE_IDS = WECHAT_STYLES.map((style) => style.id)

export function isWechatStyleId(value: unknown): value is WechatStyleId {
  return typeof value === "string" && value in WECHAT_STYLE_MAP
}

export function getWechatStyle(id: string): WechatStyleConfig {
  return isWechatStyleId(id) ? WECHAT_STYLE_MAP[id] : WECHAT_STYLE_MAP["wechat-default"]
}

// ---------------------------------------------------------------------------
// 自定义微信主题（用户可在界面上编辑 CSS 并保存）
// ---------------------------------------------------------------------------

/** 自定义主题 id 前缀，避免与内置 WechatStyleId 冲突 */
export const CUSTOM_WECHAT_THEME_PREFIX = "custom-wechat-"
const CUSTOM_WECHAT_THEME_STORAGE_KEY = "lingmo-custom-wechat-themes"

export interface CustomWechatTheme {
  id: string
  name: string
  /** 基于 WechatStyleConfig 的可配置字段；styles 为各元素的 CSS */
  styles: Record<WechatElementStyle, string>
}

/** 内存缓存，避免每次渲染都读 localStorage */
let customThemesCache: CustomWechatTheme[] | null = null

/** 读取 localStorage 中的自定义主题（带内存缓存） */
export function loadCustomWechatThemes(): CustomWechatTheme[] {
  if (customThemesCache) return customThemesCache
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_WECHAT_THEME_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as CustomWechatTheme[] : []
    customThemesCache = Array.isArray(parsed) ? parsed : []
  } catch {
    customThemesCache = []
  }
  return customThemesCache
}

/** 持久化自定义主题列表到 localStorage，并刷新内存缓存 */
function persistCustomWechatThemes(themes: CustomWechatTheme[]): void {
  customThemesCache = themes
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CUSTOM_WECHAT_THEME_STORAGE_KEY, JSON.stringify(themes))
  } catch (error) {
    console.warn("[wechat-styles] 自定义主题保存失败:", error)
  }
}

/** 新增或更新一个自定义主题（按 id 去重）。返回最终 id。 */
export function saveCustomWechatTheme(theme: CustomWechatTheme): string {
  const themes = loadCustomWechatThemes()
  const id = theme.id.startsWith(CUSTOM_WECHAT_THEME_PREFIX)
    ? theme.id
    : `${CUSTOM_WECHAT_THEME_PREFIX}${Date.now().toString(36)}`
  const normalized: CustomWechatTheme = { ...theme, id }
  const idx = themes.findIndex((t) => t.id === id)
  if (idx >= 0) {
    themes[idx] = normalized
  } else {
    themes.push(normalized)
  }
  persistCustomWechatThemes(themes)
  return id
}

/** 删除一个自定义主题 */
export function deleteCustomWechatTheme(id: string): void {
  const themes = loadCustomWechatThemes().filter((t) => t.id !== id)
  persistCustomWechatThemes(themes)
}

/** 判断 id 是否为自定义主题 */
export function isCustomWechatThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_WECHAT_THEME_PREFIX)
}

/**
 * 判断 id 是否为内置或自定义微信主题。
 * 与 isWechatStyleId 的区别：不 narrowing 到 WechatStyleId 字面量（自定义 id 是动态的）。
 */
export function isWechatStyleIdOrCustom(id: string): boolean {
  return isWechatStyleId(id) || isCustomWechatThemeId(id)
}

/**
 * 获取微信主题配置（内置或自定义）。自定义主题转成 WechatStyleConfig 形态。
 */
export function getWechatStyleOrCustom(id: string): WechatStyleConfig {
  if (isWechatStyleId(id)) return WECHAT_STYLE_MAP[id]
  const custom = loadCustomWechatThemes().find((t) => t.id === id)
  if (custom) {
    return {
      id: "wechat-default", // WechatStyleConfig.id 是字面量联合，自定义主题用 default 占位
      name: custom.name,
      nameEn: custom.name,
      description: "自定义主题",
      bestFor: "自定义样式",
      styles: custom.styles,
    }
  }
  return WECHAT_STYLE_MAP["wechat-default"]
}
