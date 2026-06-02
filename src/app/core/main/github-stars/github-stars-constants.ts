export const GITHUB_STARS_TAB_ID = 'workspace-github-stars'
export const GITHUB_STARS_TAB_PATH = 'lingmo://github-stars'
export const GITHUB_STARS_TAB_NAME = 'GitHub 星标'

export function isGithubStarsTabPath(path: string) {
  return path === GITHUB_STARS_TAB_PATH
}
