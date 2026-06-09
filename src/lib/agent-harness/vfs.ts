import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { VfsRef } from './types'

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '')
}

function runRoot(runId: string) {
  return `.agent/runs/${normalizePath(runId)}`
}

async function ensureRunDir(runId: string, subdir: string) {
  const dir = `${runRoot(runId)}/${subdir}`
  if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  return dir
}

export async function writeAgentVfsText(
  runId: string,
  kind: VfsRef['kind'],
  path: string,
  content: string,
  summary?: string,
): Promise<VfsRef> {
  const safePath = normalizePath(path)
  const dir = await ensureRunDir(runId, kind)
  const fullPath = `${dir}/${safePath}`
  const parent = fullPath.slice(0, fullPath.lastIndexOf('/'))

  if (parent && !(await exists(parent, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(parent, { baseDir: BaseDirectory.AppData, recursive: true })
  }

  await writeTextFile(fullPath, content, { baseDir: BaseDirectory.AppData })

  return {
    uri: `agent://${runId}/${kind}/${safePath}` as VfsRef['uri'],
    runId,
    path: `${kind}/${safePath}`,
    kind,
    summary,
  }
}

export async function readAgentVfsText(ref: VfsRef): Promise<string> {
  return readTextFile(`${runRoot(ref.runId)}/${ref.path}`, { baseDir: BaseDirectory.AppData })
}
