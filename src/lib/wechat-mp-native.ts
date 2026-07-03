import { invoke } from '@tauri-apps/api/core'

export type WechatMpLoginStart = {
  qrImageDataUrl: string
  fingerprint: string
  status: 'waiting'
}

export type WechatMpLoginStatus = {
  status: 'waiting' | 'scanned' | 'success' | 'failed'
  token?: string | null
  message: string
}

export type WechatMpSessionStatus = {
  connected: boolean
  token?: string | null
  message: string
}

export type WechatMpAccount = {
  fakeid: string
  nickname: string
  alias: string
  serviceType: number
  signature: string
  roundHeadImg: string
}

export type WechatMpArticle = {
  aid: string
  title: string
  link: string
  digest: string
  cover: string
  createTime: number
  updateTime: number
}

export async function startWechatMpLogin() {
  return invoke<WechatMpLoginStart>('wechat_mp_start_login')
}

export async function pollWechatMpLogin() {
  return invoke<WechatMpLoginStatus>('wechat_mp_poll_login')
}

export async function getWechatMpStatus() {
  return invoke<WechatMpSessionStatus>('wechat_mp_status')
}

export async function searchWechatMpAccounts(query: string) {
  return invoke<WechatMpAccount[]>('wechat_mp_search_accounts', { query })
}

export async function listWechatMpArticles(input: { fakeid: string; begin?: number; count?: number }) {
  return invoke<WechatMpArticle[]>('wechat_mp_list_articles', { input })
}

export async function fetchWechatMpArticleHtml(url: string) {
  return invoke<string>('wechat_mp_fetch_article_html', { url })
}
