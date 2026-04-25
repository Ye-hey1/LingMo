'use client'

import { SimpleMobileTool } from '@/components/simple-mobile-tool'
import emitter from '@/lib/emitter'
import { exists, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'
import { useTranslations } from 'next-intl'

interface MobileRecordToolsProps {
  onClose?: () => void
}

export function MobileRecordTools({ onClose }: MobileRecordToolsProps) {
  const router = useRouter()
  const t = useTranslations()
  const { loadFileTree, setActiveFilePath } = useArticleStore()

  // 移动端固定的记录工具（排除截图）
  const mobileTools = [
    { id: 'write' },
    { id: 'text' },
    { id: 'recording' },
    { id: 'image' },
    { id: 'link' },
    { id: 'file' }
  ]

  const createQuickWriteFile = async () => {
    let index = 0
    let fileName = 'untitled.md'

    while (true) {
      const pathOptions = await getFilePathOptions(fileName)
      const fileExists = pathOptions.baseDir
        ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        : await exists(pathOptions.path)
      if (!fileExists) break

      index += 1
      fileName = `untitled-${index}.md`
    }

    const pathOptions = await getFilePathOptions(fileName)
    if (pathOptions.baseDir) {
      await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
    } else {
      await writeTextFile(pathOptions.path, '')
    }

    return fileName
  }

  const handleQuickWrite = async () => {
    try {
      const fileName = await createQuickWriteFile()
      await loadFileTree()
      await setActiveFilePath(fileName)
      router.push('/mobile/writing')
      onClose?.()
    } catch {
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      })
    }
  }

  const handleToolClick = async (toolId: string) => {
    if (toolId === 'write') {
      await handleQuickWrite()
      return
    }

    // 发射工具快捷键事件
    emitter.emit(`toolbar-shortcut-${toolId}` as any)
    // 点击后关闭弹窗
    if (onClose) {
      onClose()
    }
  }

  // 暂时忽略 onClose 参数的 lint 警告，未来可能用于在操作成功后关闭抽屉
  void onClose

  return (
    <div className="grid w-full grid-cols-3 gap-1">
      {mobileTools.map((tool) => (
        <SimpleMobileTool 
          key={tool.id}
          toolId={tool.id}
          onToolClick={handleToolClick}
        />
      ))}
    </div>
  )
}
