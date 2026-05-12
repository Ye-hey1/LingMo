import { readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

export async function readWorkspaceBinaryFile(filePath: string): Promise<Uint8Array> {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(filePath)

  return workspace.isCustom
    ? await readFile(pathOptions.path)
    : await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })
}

export async function readWorkspaceTextFile(filePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(filePath)

  return workspace.isCustom
    ? await readTextFile(pathOptions.path)
    : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
}
