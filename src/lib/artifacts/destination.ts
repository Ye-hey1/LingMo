import { exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, ensureSafeWorkspaceRelativePath } from '@/lib/workspace'

export type ArtifactDestinationType =
  | 'agent_note'
  | 'diagram'
  | 'visual_report'
  | 'skill_output'
  | 'skill_runtime'

export const ARTIFACT_ROOTS: Record<ArtifactDestinationType, string> = {
  agent_note: 'agent-notes',
  diagram: 'diagrams',
  visual_report: 'visual-reports',
  skill_output: 'outputs',
  skill_runtime: 'skills',
}

export function normalizeOptionalArtifactFolder(folderPath: unknown): string | undefined {
  if (typeof folderPath !== 'string') {
    return undefined
  }

  const normalized = folderPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/')

  return normalized || undefined
}

export async function getArtifactFolderPath(
  type: ArtifactDestinationType,
  folderPath?: unknown,
): Promise<string> {
  const normalizedFolder = normalizeOptionalArtifactFolder(folderPath)
  return await ensureSafeWorkspaceRelativePath(normalizedFolder || ARTIFACT_ROOTS[type])
}

function joinRelativePath(folderPath: string | undefined, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

function splitFileName(fileName: string, knownExtensions: string[] = []): { stem: string; extension: string } {
  const normalized = fileName.trim()
  const lower = normalized.toLowerCase()
  const compoundExtension = knownExtensions
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find(extension => lower.endsWith(extension.toLowerCase()))

  if (compoundExtension) {
    return {
      stem: normalized.slice(0, -compoundExtension.length),
      extension: normalized.slice(-compoundExtension.length),
    }
  }

  const lastDotIndex = normalized.lastIndexOf('.')
  if (lastDotIndex <= 0) {
    return { stem: normalized, extension: '' }
  }

  return {
    stem: normalized.slice(0, lastDotIndex),
    extension: normalized.slice(lastDotIndex),
  }
}

async function workspaceRelativePathExists(relativePath: string): Promise<boolean> {
  const { path, baseDir } = await getFilePathOptions(relativePath)
  return baseDir ? await exists(path, { baseDir }) : await exists(path)
}

export async function createUniqueArtifactPath(params: {
  folderPath?: string
  fileName: string
  knownExtensions?: string[]
  maxAttempts?: number
}): Promise<string> {
  const maxAttempts = params.maxAttempts ?? 100
  const { stem, extension } = splitFileName(params.fileName, params.knownExtensions)

  for (let index = 0; index < maxAttempts; index += 1) {
    const candidateFileName = index === 0
      ? params.fileName
      : `${stem}-${index + 1}${extension}`
    const candidatePath = await ensureSafeWorkspaceRelativePath(joinRelativePath(params.folderPath, candidateFileName))

    if (!await workspaceRelativePathExists(candidatePath)) {
      return candidatePath
    }
  }

  throw new Error('Unable to create a unique artifact file path.')
}
