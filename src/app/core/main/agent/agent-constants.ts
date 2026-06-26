export const AGENT_CENTER_TAB_ID = 'workspace-agent-center'
export const AGENT_CENTER_TAB_PATH = 'lingmo://agent-center'
export const AGENT_CENTER_TAB_NAME = 'Agent 调度'

export function isAgentCenterTabPath(path: string) {
  return path === AGENT_CENTER_TAB_PATH
}

