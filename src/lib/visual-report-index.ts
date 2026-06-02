import { BaseDirectory, readDir, stat } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'

import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { listAllFileActivities } from '@/lib/file-activity'
import { VISUAL_REPORTS_ROOT, isVisualReportPath } from '@/lib/visual-report-constants'

export interface VisualReportListItem {
  path: string
  name: string
  modifiedAt?: string
  activityAt?: number
  source: 'activity' | 'scan'
}

async function getFileModifiedAt(relativePath: string): Promise<string | undefined> {
  try {
    const { path, baseDir } = await getFilePathOptions(relativePath)
    const metadata = baseDir ? await stat(path, { baseDir }) : await stat(path)
    return metadata.mtime?.toISOString()
  } catch {
    return undefined
  }
}

async function collectHtmlReports(rootPath: string, workspaceIsCustom: boolean): Promise<VisualReportListItem[]> {
  const items: VisualReportListItem[] = []

  async function walk(dirPath: string, relativeDir = ''): Promise<void> {
    const entries = workspaceIsCustom
      ? await readDir(dirPath)
      : await readDir(dirPath, { baseDir: BaseDirectory.AppData })

    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) continue

      const workspaceRelativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : `${VISUAL_REPORTS_ROOT}/${entry.name}`

      if (entry.isDirectory) {
        const childPath = workspaceIsCustom
          ? await join(dirPath, entry.name)
          : `article/${workspaceRelativePath}`
        await walk(childPath, workspaceRelativePath)
        continue
      }

      if (!/\.html?$/i.test(workspaceRelativePath) || !isVisualReportPath(workspaceRelativePath)) continue

      items.push({
        path: workspaceRelativePath,
        name: entry.name,
        modifiedAt: await getFileModifiedAt(workspaceRelativePath),
        source: 'scan',
      })
    }
  }

  try {
    await walk(rootPath)
  } catch (error) {
    if (!String(error).includes('not found')) {
      throw error
    }
  }

  return items
}

export async function listRecentVisualReports(limit = 12): Promise<VisualReportListItem[]> {
  const workspace = await getWorkspacePath()
  const rootPath = workspace.isCustom
    ? await join(workspace.path, VISUAL_REPORTS_ROOT)
    : `article/${VISUAL_REPORTS_ROOT}`
  const [scanned, activities] = await Promise.all([
    collectHtmlReports(rootPath, workspace.isCustom),
    listAllFileActivities(200),
  ])

  const activityMap = new Map<string, number>()
  for (const event of activities) {
    if (!/\.html?$/i.test(event.path) || !isVisualReportPath(event.path)) continue
    const prev = activityMap.get(event.path) || 0
    activityMap.set(event.path, Math.max(prev, event.timestamp))
  }

  const merged = new Map<string, VisualReportListItem>()

  for (const item of scanned) {
    merged.set(item.path, {
      ...item,
      activityAt: activityMap.get(item.path),
      source: activityMap.has(item.path) ? 'activity' : 'scan',
    })
  }

  for (const [path, activityAt] of activityMap.entries()) {
    const existing = merged.get(path)
    if (existing) {
      merged.set(path, { ...existing, activityAt, source: 'activity' })
      continue
    }

    merged.set(path, {
      path,
      name: path.split('/').pop() || path,
      modifiedAt: await getFileModifiedAt(path),
      activityAt,
      source: 'activity',
    })
  }

  return [...merged.values()]
    .filter(item => item.modifiedAt || item.activityAt)
    .sort((a, b) => {
      const aTime = a.activityAt || (a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0)
      const bTime = b.activityAt || (b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0)
      return bTime - aTime
    })
    .slice(0, limit)
}
