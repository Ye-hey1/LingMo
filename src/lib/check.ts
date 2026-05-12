import { platform } from '@tauri-apps/plugin-os'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
  }
}

let cachedMobileResult: boolean | null = null
let cachedTauriResult: boolean | null = null

export function isMobileDevice() {
  if (cachedMobileResult !== null) {
    return cachedMobileResult
  }

  if (checkIsTauri()) {
    try {
      const platformName = platform()
      cachedMobileResult = platformName === 'android' || platformName === 'ios'
      return cachedMobileResult
    } catch (error) {
      console.warn('Error detecting Tauri platform:', error)
    }
  }

  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase()
    cachedMobileResult = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent)
    return cachedMobileResult
  }

  cachedMobileResult = false
  return false
}

export function checkIsTauri(): boolean {
  if (cachedTauriResult !== null) {
    return cachedTauriResult
  }

  cachedTauriResult =
    typeof window !== 'undefined' &&
    (typeof window.__TAURI_INTERNALS__ !== 'undefined' || typeof window.__TAURI__ !== 'undefined')

  return cachedTauriResult
}
