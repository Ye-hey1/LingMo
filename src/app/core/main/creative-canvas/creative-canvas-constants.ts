export const CREATIVE_CANVAS_TAB_ID = 'workspace-creative-canvas'
export const CREATIVE_CANVAS_TAB_PATH = 'lingmo://creative-canvas'
export const CREATIVE_CANVAS_TAB_NAME = '无限画布'

export function isCreativeCanvasTabPath(path?: string | null) {
  return path === CREATIVE_CANVAS_TAB_PATH
}
