'use client'

interface HtmlPreviewProps {
  content: string
}

export function HtmlPreview({ content }: HtmlPreviewProps) {
  return (
    <iframe
      srcDoc={content}
      sandbox="allow-same-origin"
      title="HTML Preview"
      className="w-full h-full border-0 bg-white"
    />
  )
}
