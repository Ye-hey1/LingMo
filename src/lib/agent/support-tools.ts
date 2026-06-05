const SUPPORT_ONLY_TOOL_NAMES = new Set([
  'select_skill',
  'load_skill_content',
])

export function getBaseAgentToolName(toolName?: string): string {
  if (!toolName) {
    return ''
  }

  return toolName.includes('__') ? toolName.split('__').pop()! : toolName
}

export function isSupportOnlyToolName(toolName?: string): boolean {
  const baseName = getBaseAgentToolName(toolName).toLowerCase()
  return SUPPORT_ONLY_TOOL_NAMES.has(baseName)
}

export function isSupportOnlyObservationText(value?: string): boolean {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return false
  }

  return /^已选择\s*\d+\s*个\s*Skills?/i.test(normalized) ||
    /^Selected\s+\d+\s+skills?/i.test(normalized)
}
