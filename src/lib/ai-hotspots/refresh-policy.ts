export function shouldAutoRefreshAiHotspots(params: {
  autoRefreshOnOpen: boolean
  lastRefreshAt: string | null
  cooldownMinutes: number
  now?: Date
}) {
  if (!params.autoRefreshOnOpen) return false
  if (!params.lastRefreshAt) return true
  if (params.cooldownMinutes <= 0) return true

  const lastRefreshTime = Date.parse(params.lastRefreshAt)
  if (!Number.isFinite(lastRefreshTime)) return true

  const now = params.now ?? new Date()
  const cooldownMs = params.cooldownMinutes * 60 * 1000
  return now.getTime() - lastRefreshTime >= cooldownMs
}
