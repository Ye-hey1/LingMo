const mutationQueues = new Map<string, Promise<void>>()
let registrationQueue = Promise.resolve()

function normalizeMutationKey(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
  const hasWindowsDrive = /^[a-zA-Z]:\//.test(normalized)
  const isAbsolute = normalized.startsWith('/') || hasWindowsDrive
  const parts: string[] = []

  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop()
      } else if (!isAbsolute) {
        parts.push(part)
      }
      continue
    }
    parts.push(part)
  }

  const prefix = hasWindowsDrive ? '' : isAbsolute ? '/' : ''
  return `${prefix}${parts.join('/')}`
    .toLowerCase()
}

export function getToolMutationTargets(toolName: string, params: Record<string, any>): string[] {
  const candidates: unknown[] = []

  for (const key of [
    'filePath',
    'folderPath',
    'path',
    'targetPath',
    'sourcePath',
    'oldPath',
    'newPath',
    'targetFolderPath',
    'destinationPath',
  ]) {
    if (typeof params[key] === 'string') candidates.push(params[key])
  }

  if (Array.isArray(params.filePaths)) candidates.push(...params.filePaths)
  if (Array.isArray(params.folderPaths)) candidates.push(...params.folderPaths)
  if (Array.isArray(params.paths)) candidates.push(...params.paths)

  if (toolName === 'create_file') {
    const folder = typeof params.folderPath === 'string' ? params.folderPath : ''
    const file = typeof params.fileName === 'string' ? params.fileName : ''
    if (file) candidates.push(folder ? `${folder}/${file}` : file)
  }

  if (toolName === 'replace_editor_content' || toolName === 'insert_at_cursor') {
    candidates.push('editor:active')
  }

  return Array.from(new Set(
    candidates
      .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
      .map(normalizeMutationKey),
  ))
}

export async function withMutationQueue<T>(targets: string[], fn: () => Promise<T>): Promise<T> {
  const keys = Array.from(new Set(targets.map(normalizeMutationKey).filter(Boolean))).sort()
  if (keys.length === 0) {
    return fn()
  }

  const registration = registrationQueue.then(() => {
    const currentQueues = keys.map(key => mutationQueues.get(key) || Promise.resolve())

    let releaseNext!: () => void
    const nextQueue = new Promise<void>((resolve) => {
      releaseNext = resolve
    })
    const waitCurrent = Promise.all(currentQueues).then(() => undefined)
    const chainedQueue = waitCurrent.then(() => nextQueue)

    for (const key of keys) {
      mutationQueues.set(key, chainedQueue)
    }

    return { keys, waitCurrent, chainedQueue, releaseNext }
  })
  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  )

  const registrationResult = await registration
  await registrationResult.waitCurrent

  try {
    return await fn()
  } finally {
    registrationResult.releaseNext()
    for (const key of registrationResult.keys) {
      if (mutationQueues.get(key) === registrationResult.chainedQueue) {
        mutationQueues.delete(key)
      }
    }
  }
}

export function getMutationQueueSize(): number {
  return mutationQueues.size
}
