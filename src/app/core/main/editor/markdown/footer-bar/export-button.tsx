'use client'

import { Editor } from '@tiptap/react'
import { Download, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useArticleStore from '@/stores/article'
import { recordFileActivity } from '@/lib/file-activity'
import { exportMarkdownToPdf } from '@/lib/md-to-pdf'

interface ExportButtonProps {
  editor: Editor
}

export function ExportButton({ editor }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  const recordExport = useCallback((format: string, outputName: string) => {
    const activeFilePath = useArticleStore.getState().activeFilePath
    if (!activeFilePath) return
    void recordFileActivity({
      path: activeFilePath,
      type: 'export',
      title: `导出 ${format}`,
      description: outputName,
    })
  }, [])

  // Download file helper
  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [])

  // Export as PDF
  const exportPdf = useCallback(async () => {
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.(md|markdown)$/i, '') || 'document'

    try {
      const result = await exportMarkdownToPdf(editor.getMarkdown(), {
        defaultFileName: `${fileName}.pdf`,
        markdownPath: activeFilePath || undefined,
        title: fileName,
      })
      if (result) {
        recordExport('PDF', `${result.outputPath} · ${result.pageCount} 页`)
      }
    } catch (error) {
      console.error('PDF export failed:', error)
    }

    setIsOpen(false)
  }, [editor, recordExport])

  const handleExportMarkdown = useCallback(() => {
    const content = editor.getMarkdown()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    const outputName = `${fileName}.md`
    downloadFile(content, outputName, 'text/markdown')
    recordExport('Markdown', outputName)
    setIsOpen(false)
  }, [editor, downloadFile, recordExport])

  const handleExportHtml = useCallback(() => {
    const content = editor.getHTML()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    const outputName = `${fileName}.html`
    downloadFile(content, outputName, 'text/html')
    recordExport('HTML', outputName)
    setIsOpen(false)
  }, [editor, downloadFile, recordExport])

  const handleExportJson = useCallback(() => {
    const content = JSON.stringify(editor.getJSON(), null, 2)
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    const outputName = `${fileName}.json`
    downloadFile(content, outputName, 'application/json')
    recordExport('JSON', outputName)
    setIsOpen(false)
  }, [editor, downloadFile, recordExport])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title="导出"
          className="p-1 rounded hover:bg-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring/30"
        >
          <Download className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        <DropdownMenuItem onClick={handleExportMarkdown}>
          <FileText size={12} />
          <span>Markdown</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportHtml}>
          <FileCode size={12} />
          <span>HTML</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportJson}>
          <FileJson size={12} />
          <span>JSON</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPdf}>
          <FileText size={12} />
          <span>PDF</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
