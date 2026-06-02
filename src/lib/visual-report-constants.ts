export const VISUAL_REPORTS_ROOT = 'visual-reports'

export function isVisualReportPath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.?\//, '')
  return normalized === VISUAL_REPORTS_ROOT || normalized.startsWith(`${VISUAL_REPORTS_ROOT}/`)
}
