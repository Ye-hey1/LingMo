import { create } from 'zustand'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

const EMPTY_ANNOTATIONS: Annotation[] = []

export interface Annotation {
  id: string
  type: 'highlight' | 'underline' | 'comment'
  color: 'yellow' | 'green' | 'blue' | 'red'
  pageIndex: number
  selectedText: string
  note?: string
  position: {
    rects: Array<{ x: number; y: number; width: number; height: number }>
  }
  createdAt: number
}

interface AnnotationFile {
  pdfPath: string
  pdfName: string
  annotations: Annotation[]
}

export interface AnnotationPopoverState {
  visible: boolean
  x: number
  y: number
  selectedText: string
  position: {
    pageIndex: number
    rects: Array<{ x: number; y: number; width: number; height: number }>
  } | null
}

interface PDFAnnotationStore {
  annotations: Map<string, AnnotationFile>
  activePdfPath: string | null
  sidebarOpen: boolean
  popoverState: AnnotationPopoverState

  loadAnnotations: (pdfPath: string) => Promise<void>
  addAnnotation: (pdfPath: string, annotation: Annotation) => Promise<void>
  removeAnnotation: (pdfPath: string, id: string) => Promise<void>
  updateAnnotation: (pdfPath: string, id: string, updates: Partial<Annotation>) => Promise<void>
  getAnnotations: (pdfPath: string) => Annotation[]
  setActivePdf: (path: string | null) => void
  toggleSidebar: () => void
  exportToMarkdown: (pdfPath: string) => Promise<string>
  openPopover: (state: Omit<AnnotationPopoverState, 'visible'>) => void
  closePopover: () => void
}

function getAnnotationFilePath(pdfPath: string): string {
  const dir = pdfPath.substring(0, pdfPath.lastIndexOf('/'))
  const baseName = pdfPath.substring(pdfPath.lastIndexOf('/') + 1).replace(/\.pdf$/i, '')
  return `${dir}/.${baseName}.annotations.json`
}

function getPdfName(pdfPath: string): string {
  return pdfPath.split('/').pop()?.replace(/\.pdf$/i, '') || 'Untitled'
}

function formatQuote(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join('\n')
}

function getTypeName(type: Annotation['type']): string {
  const typeMap: Record<Annotation['type'], string> = {
    highlight: '高亮',
    underline: '下划线',
    comment: '笔记',
  }
  return typeMap[type]
}

function getColorName(color: Annotation['color']): string {
  const colorMap: Record<Annotation['color'], string> = {
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    red: '红色',
  }
  return colorMap[color]
}

function formatRects(annotation: Annotation): string {
  if (!annotation.position.rects.length) return '无位置信息'

  return annotation.position.rects
    .map((rect, index) => {
      const x = Math.round(rect.x)
      const y = Math.round(rect.y)
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      return `${index + 1}: x=${x}, y=${y}, width=${width}, height=${height}`
    })
    .join('; ')
}

export const usePDFAnnotationStore = create<PDFAnnotationStore>((set, get) => ({
  annotations: new Map(),
  activePdfPath: null,
  sidebarOpen: false,
  popoverState: { visible: false, x: 0, y: 0, selectedText: '', position: null },

  loadAnnotations: async (pdfPath: string) => {
    const annPath = getAnnotationFilePath(pdfPath)
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(annPath)
      let content: string

      if (workspace.isCustom) {
        if (!(await exists(pathOptions.path))) {
          const empty: AnnotationFile = { pdfPath, pdfName: getPdfName(pdfPath), annotations: [] }
          const map = new Map(get().annotations)
          map.set(pdfPath, empty)
          set({ annotations: map })
          return
        }
        content = await readTextFile(pathOptions.path)
      } else {
        if (!(await exists(pathOptions.path, { baseDir: pathOptions.baseDir }))) {
          const empty: AnnotationFile = { pdfPath, pdfName: getPdfName(pdfPath), annotations: [] }
          const map = new Map(get().annotations)
          map.set(pdfPath, empty)
          set({ annotations: map })
          return
        }
        content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      const data = JSON.parse(content) as AnnotationFile
      const map = new Map(get().annotations)
      map.set(pdfPath, {
        pdfPath,
        pdfName: data.pdfName || getPdfName(pdfPath),
        annotations: Array.isArray(data.annotations) ? data.annotations : [],
      })
      set({ annotations: map })
    } catch {
      const empty: AnnotationFile = { pdfPath, pdfName: getPdfName(pdfPath), annotations: [] }
      const map = new Map(get().annotations)
      map.set(pdfPath, empty)
      set({ annotations: map })
    }
  },

  addAnnotation: async (pdfPath: string, annotation: Annotation) => {
    const map = new Map(get().annotations)
    const currentFile = map.get(pdfPath)
    const file: AnnotationFile = {
      pdfPath,
      pdfName: currentFile?.pdfName || getPdfName(pdfPath),
      annotations: [...(currentFile?.annotations || []), annotation],
    }

    map.set(pdfPath, file)
    set({ annotations: map })
    await saveAnnotations(pdfPath, file)
  },

  removeAnnotation: async (pdfPath: string, id: string) => {
    const map = new Map(get().annotations)
    const currentFile = map.get(pdfPath)
    if (!currentFile) return

    const file = {
      ...currentFile,
      annotations: currentFile.annotations.filter(annotation => annotation.id !== id),
    }
    map.set(pdfPath, file)
    set({ annotations: map })
    await saveAnnotations(pdfPath, file)
  },

  updateAnnotation: async (pdfPath: string, id: string, updates: Partial<Annotation>) => {
    const map = new Map(get().annotations)
    const currentFile = map.get(pdfPath)
    if (!currentFile) return

    const file = {
      ...currentFile,
      annotations: currentFile.annotations.map(annotation =>
        annotation.id === id ? { ...annotation, ...updates } : annotation,
      ),
    }

    map.set(pdfPath, file)
    set({ annotations: map })
    await saveAnnotations(pdfPath, file)
  },

  getAnnotations: (pdfPath: string) => {
    return get().annotations.get(pdfPath)?.annotations || EMPTY_ANNOTATIONS
  },

  setActivePdf: (path: string | null) => {
    set({ activePdfPath: path })
  },

  toggleSidebar: () => {
    set(state => ({ sidebarOpen: !state.sidebarOpen }))
  },

  openPopover: (state) => {
    set({ popoverState: { ...state, visible: true } })
  },

  closePopover: () => {
    set(state => ({ popoverState: { ...state.popoverState, visible: false } }))
  },

  exportToMarkdown: async (pdfPath: string) => {
    const file = get().annotations.get(pdfPath)
    if (!file || file.annotations.length === 0) return ''

    const pdfName = file.pdfName || getPdfName(pdfPath)
    const byPage = new Map<number, Annotation[]>()

    for (const annotation of file.annotations) {
      if (!byPage.has(annotation.pageIndex)) byPage.set(annotation.pageIndex, [])
      byPage.get(annotation.pageIndex)!.push(annotation)
    }

    let md = `# PDF 批注 - ${pdfName}.pdf\n\n`
    md += `源文件：\`${pdfPath}\`\n\n`

    for (const [pageIndex, annotations] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      md += `## 第 ${pageIndex + 1} 页\n\n`

      annotations
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach((annotation, index) => {
          md += `<a id="pdf-page-${pageIndex + 1}-annotation-${annotation.id}"></a>\n\n`
          md += `### 批注 ${index + 1}\n\n`
          md += `- 类型：${getTypeName(annotation.type)}\n`
          md += `- 颜色：${getColorName(annotation.color)}\n`
          md += `- 页码：${pageIndex + 1}\n`
          md += `- 位置：${formatRects(annotation)}\n\n`
          md += `${formatQuote(annotation.selectedText)}\n\n`

          if (annotation.note) {
            md += `笔记：${annotation.note}\n\n`
          }
        })
    }

    return md.trimEnd() + '\n'
  },
}))

async function saveAnnotations(pdfPath: string, file: AnnotationFile) {
  const annPath = getAnnotationFilePath(pdfPath)
  try {
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(annPath)
    const json = JSON.stringify(file, null, 2)

    if (workspace.isCustom) {
      const lastSeparator = Math.max(pathOptions.path.lastIndexOf('/'), pathOptions.path.lastIndexOf('\\'))
      const targetDir = lastSeparator >= 0 ? pathOptions.path.substring(0, lastSeparator) : ''
      if (targetDir && !(await exists(targetDir))) {
        await mkdir(targetDir, { recursive: true })
      }
      await writeTextFile(pathOptions.path, json)
    } else {
      await writeTextFile(pathOptions.path, json, { baseDir: pathOptions.baseDir })
    }
  } catch (err) {
    console.error('Failed to save annotations:', err)
  }
}
