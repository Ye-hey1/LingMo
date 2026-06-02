import { fetch as tauriFetch, type ClientOptions, type Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'

export const PROXY_STORE_KEY = 'proxy'

export async function getProxyUrl() {
  const store = await Store.load('store.json')
  return (await store.get<string>(PROXY_STORE_KEY) || '').trim()
}

export async function setProxyUrl(proxyUrl: string) {
  const store = await Store.load('store.json')
  await store.set(PROXY_STORE_KEY, proxyUrl.trim())
  await store.save()
}

export async function getProxyConfig(): Promise<Proxy | undefined> {
  const proxyUrl = await getProxyUrl()
  return proxyUrl ? { all: proxyUrl } : undefined
}

export async function fetchWithProxy(input: URL | Request | string, init: RequestInit & ClientOptions = {}) {
  const proxy = init.proxy || await getProxyConfig()
  return tauriFetch(input, {
    ...init,
    ...(proxy ? { proxy } : {}),
  })
}
