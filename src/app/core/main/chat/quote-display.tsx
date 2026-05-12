import { X, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"
import { useMemo, useState } from "react"
import { getQuotePreview } from "./quote-preview"

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

interface QuoteDisplayProps {
  quoteData: QuoteData
  onRemove: () => void
}

export function QuoteDisplay({ quoteData, onRemove }: QuoteDisplayProps) {
  const t = useTranslations('editor.quoteDisplay')
  const { fileName, startLine, endLine, fullContent } = quoteData
  const [expanded, setExpanded] = useState(false)

  const displayTitle = useMemo(() => {
    if (startLine !== -1 && endLine !== -1) {
      if (startLine === endLine) {
        return t('line', { fileName, line: startLine })
      }
      return t('lines', { fileName, start: startLine, end: endLine })
    }
    return t('fromFile', { fileName })
  }, [endLine, fileName, startLine, t])

  const previewWhenCollapsed = getQuotePreview(fullContent, 120)
  const previewText = expanded ? fullContent : previewWhenCollapsed
  const canExpand = fullContent.length > previewWhenCollapsed.length

  return (
    <div className="rounded-md border border-border/55 bg-background/70 px-1.5 py-1">
      <div className="mb-0.5 flex items-center justify-between gap-1.5">
        <div className="min-w-0 flex items-center gap-1">
          <span className="shrink-0 rounded bg-muted px-1 py-0 text-[10px] font-medium text-muted-foreground">引用</span>
          <span className="truncate text-[10px] font-medium text-muted-foreground">{displayTitle}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-4.5 shrink-0"
          onClick={onRemove}
          title="移除引用"
        >
          <X className="size-2.5" />
        </Button>
      </div>

      <div className={`whitespace-pre-wrap break-words text-[10px] leading-4 text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
        {previewText}
      </div>

      {canExpand && (
        <button
          type="button"
          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown className={`size-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          <span>{expanded ? '收起' : '展开'}</span>
        </button>
      )}
    </div>
  )
}

