import { ARTIFACT_ROOTS } from '@/lib/artifacts/destination'

export const VISUAL_REPORTS_ROOT = ARTIFACT_ROOTS.visual_report

export function isVisualReportPath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.?\//, '')
  return normalized === VISUAL_REPORTS_ROOT || normalized.startsWith(`${VISUAL_REPORTS_ROOT}/`)
}
