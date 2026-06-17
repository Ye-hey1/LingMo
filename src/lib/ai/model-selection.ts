export function createConfiguredModelSelectionId(configKey: string, modelId: string): string {
  return `${configKey}:${modelId}`
}

export function parseConfiguredModelSelectionId(selectionId?: string) {
  const value = selectionId?.trim()
  if (!value) {
    return null
  }

  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null
  }

  return {
    configKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  }
}

export function matchesConfiguredModelSelection({
  configKey,
  modelId,
  selectionId,
}: {
  configKey: string
  modelId: string
  selectionId?: string
}) {
  const normalizedSelection = selectionId?.trim()
  if (!normalizedSelection) {
    return false
  }

  const parsedSelection = parseConfiguredModelSelectionId(normalizedSelection)
  if (parsedSelection) {
    return parsedSelection.configKey === configKey && parsedSelection.modelId === modelId
  }

  return normalizedSelection === modelId || normalizedSelection === `${configKey}-${modelId}`
}
