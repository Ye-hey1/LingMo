import { writeTextFile } from '@tauri-apps/plugin-fs'
import { cloneDeep } from 'lodash-es'

import { createDiagramContent, DIAGRAM_FILE_SUFFIXES, ensureDiagramFileName, getDefaultDiagramBaseName, type DiagramKind } from '@/lib/diagram'
import { getCurrentFolder } from '@/lib/path'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useArticleStore, { DirTree } from '@/stores/article'

function createDiagramNode(name: string, parent?: DirTree): DirTree {
  return {
    name,
    isFile: true,
    isSymlink: false,
    parent,
    isEditing: false,
    isDirectory: false,
    isLocale: true,
    sha: '',
    children: [],
  }
}

function splitDiagramFileName(fileName: string): { stem: string; extension: string } {
  const extension = [...DIAGRAM_FILE_SUFFIXES]
    .sort((a, b) => b.length - a.length)
    .find((suffix) => fileName.toLowerCase().endsWith(suffix)) || ''

  return {
    stem: extension ? fileName.slice(0, -extension.length) : fileName,
    extension,
  }
}

export async function createDiagramFile(parentPath = '', kind: DiagramKind = 'drawio'): Promise<string> {
  const state = useArticleStore.getState()
  const cacheTree = cloneDeep(state.fileTree)
  const currentFolder = parentPath ? getCurrentFolder(parentPath, cacheTree) : undefined
  const baseName = ensureDiagramFileName(getDefaultDiagramBaseName(kind), kind)
  const { stem, extension } = splitDiagramFileName(baseName)
  const siblingNames = new Set((currentFolder?.children ?? cacheTree).map((item) => item.name))

  let fileName = baseName
  let index = 1
  while (siblingNames.has(fileName)) {
    fileName = `${stem}_${index}${extension}`
    index += 1
  }

  const relativePath = parentPath ? `${parentPath}/${fileName}` : fileName
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(relativePath)
  const content = createDiagramContent(kind)

  if (workspace.isCustom) {
    await writeTextFile(pathOptions.path, content)
  } else {
    await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
  }

  if (currentFolder) {
    currentFolder.children?.unshift(createDiagramNode(fileName, currentFolder))
  } else {
    cacheTree.unshift(createDiagramNode(fileName))
  }

  state.setFileTree(cacheTree)
  state.setActiveFilePath(relativePath)
  await state.readArticle(relativePath, '', false)

  return relativePath
}
