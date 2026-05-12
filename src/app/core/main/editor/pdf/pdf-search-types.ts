export interface PdfSearchResult {
  id: string
  pageNumber: number
  matchIndex: number
  text: string
}

export interface PdfSearchHighlight extends PdfSearchResult {
  left: number
  top: number
  width: number
  height: number
}
