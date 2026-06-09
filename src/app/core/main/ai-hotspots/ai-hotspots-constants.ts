export const AI_HOTSPOTS_TAB_ID = 'workspace-ai-hotspots'
export const AI_HOTSPOTS_TAB_PATH = 'lingmo://ai-hotspots'
export const AI_HOTSPOTS_TAB_NAME = 'AI 热点'

export function isAiHotspotsTabPath(path: string) {
  return path === AI_HOTSPOTS_TAB_PATH
}
