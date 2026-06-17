let refreshPromise: Promise<void> | null = null

async function invalidateSkillCaches() {
  try {
    const { invalidateSkillSlashCache } = await import('@/lib/ai-doc-commands/slash-bridge')
    invalidateSkillSlashCache()
  } catch (error) {
    console.warn('[Skills] Failed to invalidate slash command cache:', error)
  }
}

export async function refreshSkillsForAgent(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const { useSkillsStore } = await import('@/stores/skills')
    await useSkillsStore.getState().refreshSkills()
    await invalidateSkillCaches()
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export async function markSkillsChangedForAgent(): Promise<void> {
  await invalidateSkillCaches()
}

export async function ensureSkillsReadyForAgent(): Promise<void> {
  const { useSkillsStore } = await import('@/stores/skills')
  const store = useSkillsStore.getState()
  await store.initSkills()
  await invalidateSkillCaches()
}
