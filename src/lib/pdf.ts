export async function extractTextFromPDF(
  _filePath: string,
  onProgress?: (progress: string) => void,
): Promise<string> {
  onProgress?.('PDF 预览已启用，文本提取暂不可用')
  return '[PDF 文件]'
}

export async function extractTextFromPDFFile(_file: File): Promise<string> {
  return '[PDF 文件]'
}

export async function getPDFInfo(_filePath: string): Promise<{ numPages: number }> {
  return { numPages: 1 }
}

export async function getPDFInfoFromFile(_file: File): Promise<{ numPages: number }> {
  return { numPages: 1 }
}
