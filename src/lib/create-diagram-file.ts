import { exists, writeTextFile } from '@tauri-apps/plugin-fs'

import { CREATABLE_DIAGRAM_FILE_SUFFIXES, createDiagramContent, ensureDiagramFileName, getDefaultDiagramBaseName, type DiagramKind } from '@/lib/diagram'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'

function splitDiagramFileName(fileName: string): { stem: string; extension: string } {
  const extension = [...CREATABLE_DIAGRAM_FILE_SUFFIXES]
    .sort((a, b) => b.length - a.length)
    .find((suffix) => fileName.toLowerCase().endsWith(suffix)) || ''

  return {
    stem: extension ? fileName.slice(0, -extension.length) : fileName,
    extension,
  }
}

async function diagramFileExists(relativePath: string, workspace: Awaited<ReturnType<typeof getWorkspacePath>>) {
  const pathOptions = await getFilePathOptions(relativePath)

  try {
    if (workspace.isCustom) {
      return await exists(pathOptions.path)
    }

    return await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
  } catch {
    return false
  }
}

export async function createDiagramFile(parentPath = '', kind: DiagramKind = 'drawio'): Promise<string> {
  const state = useArticleStore.getState()
  const baseName = ensureDiagramFileName(getDefaultDiagramBaseName(kind), kind)
  const { stem, extension } = splitDiagramFileName(baseName)
  const workspace = await getWorkspacePath()

  let fileName = baseName
  let index = 1
  let relativePath = parentPath ? `${parentPath}/${fileName}` : fileName
  while (await diagramFileExists(relativePath, workspace)) {
    fileName = `${stem}_${index}${extension}`
    relativePath = parentPath ? `${parentPath}/${fileName}` : fileName
    index += 1
  }

  const pathOptions = await getFilePathOptions(relativePath)
  const content = createDiagramContent(kind)

  if (workspace.isCustom) {
    await writeTextFile(pathOptions.path, content)
  } else {
    await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
  }

  if (parentPath) {
    await state.ensurePathExpanded(parentPath)
  }

  const inserted = state.insertLocalEntry(relativePath, false)
  if (!inserted) {
    await state.loadFileTree({ skipRemoteSync: true })
    if (parentPath) {
      await useArticleStore.getState().ensurePathExpanded(parentPath)
    }
  }

  await useArticleStore.getState().setActiveFilePath(relativePath)
  await useArticleStore.getState().readArticle(relativePath, '', false)

  return relativePath
}
