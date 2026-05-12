export function getPdfWorkerSrc(): string {
  if (typeof window === 'undefined') {
    return '/pdf.worker.min.mjs'
  }

  return new URL('/pdf.worker.min.mjs', window.location.href).toString()
}
