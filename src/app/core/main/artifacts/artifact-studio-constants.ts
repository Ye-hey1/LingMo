export const ARTIFACT_STUDIO_TAB_ID = 'workspace-artifact-studio'
export const ARTIFACT_STUDIO_TAB_PATH = 'lingmo://artifact-studio'
export const ARTIFACT_STUDIO_TAB_NAME = '智能排版'

export function isArtifactStudioTabPath(path: string) {
  return path === ARTIFACT_STUDIO_TAB_PATH
}

