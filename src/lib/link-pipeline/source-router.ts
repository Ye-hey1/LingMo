import type { LinkSourceType } from '@/db/link-pipeline'

export type LinkOrganizationPolicy = 'generic_ai' | 'adapter_structured' | 'capture_only'

export interface LinkSourceRoute {
  type: LinkSourceType
  organization: LinkOrganizationPolicy
}

function matchesHost(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

export function routeLinkSource(value: string): LinkSourceRoute {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { type: 'unknown', organization: 'capture_only' }
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (matchesHost(host, 'github.com')) {
    return { type: 'github', organization: 'adapter_structured' }
  }
  if (matchesHost(host, 'mp.weixin.qq.com')) {
    return { type: 'wechat', organization: 'generic_ai' }
  }
  if (matchesHost(host, 'xiaohongshu.com') || matchesHost(host, 'xhslink.com')) {
    return { type: 'xiaohongshu', organization: 'adapter_structured' }
  }
  if (
    matchesHost(host, 'youtube.com')
    || matchesHost(host, 'youtu.be')
    || matchesHost(host, 'bilibili.com')
    || matchesHost(host, 'b23.tv')
  ) {
    return { type: 'video', organization: 'adapter_structured' }
  }
  return { type: 'webpage', organization: 'generic_ai' }
}
