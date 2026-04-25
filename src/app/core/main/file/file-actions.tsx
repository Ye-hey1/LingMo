"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus, FolderPlus, FolderInput, LoaderCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"
import useArticleStore from "@/stores/article"
import { debounce } from "lodash-es"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readDir, copyFile, mkdir, exists, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { TemplateSelectDialog, type TemplateSelectDialogRef, type TemplateSelectResult } from './template-select-dialog'
import { generateUniqueFilename } from '@/lib/default-filename'
import { getCurrentFolder } from '@/lib/path'
import { cloneDeep } from 'lodash-es'

export function FileActions() {
  const { newFolder, newFile, loadFileTree, setActiveFilePath, readArticle, activeFilePath, fileTree, setFileTree, collapsibleList } = useArticleStore()
  const t = useTranslations('article.file.toolbar')
  const [isImporting, setIsImporting] = React.useState(false)
  const templateDialogRef = React.useRef<TemplateSelectDialogRef>(null)

  const debounceNewFolder = debounce(newFolder, 200)

  async function handleNewArticle() {
    templateDialogRef.current?.open()
  }

  async function handleTemplateSelect(result: TemplateSelectResult) {
    if (!result.template) {
      // Blank: use existing newFile flow
      newFile()
      return
    }

    // Template selected: create file with template content
    const template = result.template
    try {
      const cacheTree = cloneDeep(fileTree)
      const parentPath = activeFilePath?.includes('/')
        ? activeFilePath.split('/').slice(0, -1).join('/')
        : ''

      const baseName = template.title.replace(/\s+/g, '_')
      const fileName = await generateUniqueFilename(parentPath, baseName)
      const relativePath = parentPath ? `${parentPath}/${fileName}` : fileName

      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(relativePath)

      // Write file with template content
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, template.content)
      } else {
        await writeTextFile(pathOptions.path, template.content, { baseDir: pathOptions.baseDir })
      }

      // Add to file tree
      if (parentPath) {
        const currentFolder = getCurrentFolder(parentPath, cacheTree)
        if (currentFolder) {
          // Ensure folder is expanded
          if (!collapsibleList.includes(parentPath)) {
            const list = [...collapsibleList, parentPath]
            useArticleStore.setState({ collapsibleList: list })
          }

          currentFolder.children?.unshift({
            name: fileName,
            isFile: true,
            isSymlink: false,
            parent: currentFolder,
            isEditing: false,
            isDirectory: false,
            isLocale: true,
            sha: '',
            children: []
          })
          setFileTree(cacheTree)
        }
      } else {
        cacheTree.unshift({
          name: fileName,
          isFile: true,
          isSymlink: false,
          parent: undefined,
          isEditing: false,
          isDirectory: false,
          isLocale: true,
          sha: '',
          children: []
        })
        setFileTree(cacheTree)
      }

      setActiveFilePath(relativePath)
      readArticle(relativePath, '', false)
    } catch (error) {
      console.error('Create file from template failed:', error)
      toast({
        description: String(error),
        variant: 'destructive'
      })
    }
  }

  // 递归复制文件夹中的所有 markdown 文件和图片
  async function copyMarkdownFilesRecursively(
    sourceDir: string,
    targetDir: string,
    relativePath: string = ''
  ): Promise<number> {
    let copiedCount = 0

    try {
      const entries = await readDir(sourceDir)

      for (const entry of entries) {
        // 跳过隐藏文件和文件夹
        if (entry.name.startsWith('.')) {
          continue
        }

        const sourcePath = await join(sourceDir, entry.name)
        const newRelativePath = relativePath ? await join(relativePath, entry.name) : entry.name
        const targetPath = await join(targetDir, newRelativePath)

        if (entry.isDirectory) {
          // 递归处理子文件夹
          const subDirCopied = await copyMarkdownFilesRecursively(
            sourcePath,
            targetDir,
            newRelativePath
          )
          copiedCount += subDirCopied
        } else if (entry.isFile) {
          // 检查是否是 markdown 文件或图片文件
          const isMd = entry.name.endsWith('.md')
          const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(entry.name)

          if (isMd || isImage) {
            // 确保目标文件夹存在
            const targetDirPath = relativePath ? await join(targetDir, relativePath) : targetDir
            if (!(await exists(targetDirPath))) {
              await mkdir(targetDirPath, { recursive: true })
            }

            // 复制文件
            await copyFile(sourcePath, targetPath)
            copiedCount++
          }
        }
      }
    } catch (error) {
      console.error('Error copying files:', error)
      throw error
    }

    return copiedCount
  }

  async function handleImportMarkdown() {
    try {
      setIsImporting(true)

      // 打开文件夹选择对话框
      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: t('importMarkdown')
      })

      if (!selectedPath) {
        setIsImporting(false)
        return
      }

      // 获取工作区路径
      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom ? workspace.path : await join(await import('@tauri-apps/api/path').then(m => m.appDataDir()), 'article')

      // 递归复制所有 markdown 文件和图片
      const copiedCount = await copyMarkdownFilesRecursively(selectedPath as string, targetDir)

      // 刷新文件树
      await loadFileTree()

      // 显示成功提示
      toast({
        title: t('importSuccess'),
        description: t('importSuccessDesc', { count: copiedCount })
      })
    } catch (error) {
      console.error('Import markdown error:', error)
      toast({
        title: t('importError'),
        description: String(error),
        variant: 'destructive'
      })
    } finally {
      setIsImporting(false)
    }
  }

  // Listen for template dialog open from other components (e.g. empty state)
  React.useEffect(() => {
    const handler = () => { handleNewArticle() }
    emitter.on('template-select-dialog:open', handler)
    return () => { emitter.off('template-select-dialog:open', handler) }
  }, [])

  return (
    <div className="flex items-center gap-1">
      <TooltipButton
        icon={<FilePlus className="h-4 w-4" />}
        tooltipText={t('newArticle')}
        onClick={handleNewArticle}
        side="bottom"
      />
      <TooltipButton
        icon={<FolderPlus className="h-4 w-4" />}
        tooltipText={t('newFolder')}
        onClick={debounceNewFolder}
        side="bottom"
      />
      <TooltipButton
        icon={isImporting ? <LoaderCircle className="animate-spin h-4 w-4" /> : <FolderInput className="h-4 w-4" />}
        tooltipText={isImporting ? t('importing') : t('importMarkdown')}
        onClick={handleImportMarkdown}
        disabled={isImporting}
        side="bottom"
      />
      <TemplateSelectDialog ref={templateDialogRef} onSelect={handleTemplateSelect} />
    </div>
  )
}
