const TRACKING_PARAM_PATTERN = /^utm_/i
const EXTRA_TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'spm',
])

export function normalizeHotspotUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAM_PATTERN.test(key) || EXTRA_TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key)
      }
    }

    const hasRootPath = parsed.pathname === '/'
    if (!hasRootPath && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    }

    return parsed.toString().replace(/\?$/, '')
  } catch {
    return trimmed
      .replace(/#.*$/, '')
      .replace(/[?&]utm_[^=&]+=[^&]*/gi, '')
      .replace(/[?&]$/, '')
      .replace(/\/+$/, '')
  }
}

export function normalizeHotspotTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~！￥…（）【】、，。；：“”‘’？《》「」『』]/g, '')
}

export function createHotspotId(sourceId: string, feedName: string, title: string, url: string): string {
  const input = [
    sourceId.trim().toLowerCase(),
    feedName.trim().toLowerCase(),
    normalizeHotspotTitle(title),
    normalizeHotspotUrl(url),
  ].join('|')

  return `hotspot-${hashString(input)}`
}

export function toIsoString(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function hashString(input: string): string {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
