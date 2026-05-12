import { readTextFile } from '@tauri-apps/plugin-fs'

import { createEmptyDiagramContent } from '@/lib/diagram'
import emitter from '@/lib/emitter'
import { saveLocalFile } from '@/lib/sync/auto-sync'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'

export async function readDiagramFileContent(filePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(filePath)

  try {
    return workspace.isCustom
      ? await readTextFile(pathOptions.path)
      : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
  } catch {
    return createEmptyDiagramContent(filePath)
  }
}

export async function saveDiagramFileContent(filePath: string, content: string): Promise<void> {
  await saveLocalFile(filePath, content)

  const articleStore = useArticleStore.getState()
  if (articleStore.activeFilePath === filePath) {
    articleStore.setCurrentArticle(content)
  }

  emitter.emit('article-saved', { path: filePath, content })
}
