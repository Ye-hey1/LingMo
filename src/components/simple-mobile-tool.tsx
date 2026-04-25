'use client'

import { Button } from "@/components/ui/button"
import { CopySlash, Mic, ImagePlus, Link, FileText, SquarePen } from "lucide-react"
import { useTranslations } from "next-intl"

interface SimpleMobileToolProps {
  toolId: string
  onToolClick?: (toolId: string) => void
}

export function SimpleMobileTool({ toolId, onToolClick }: SimpleMobileToolProps) {
  const t = useTranslations()

  const getToolInfo = (id: string) => {
    switch (id) {
      case 'text':
        return { icon: <CopySlash className="w-5 h-5" />, label: t('record.mark.type.text') }
      case 'recording':
        return { icon: <Mic className="w-5 h-5" />, label: t('record.mark.type.recording') }
      case 'image':
        return { icon: <ImagePlus className="w-5 h-5" />, label: t('record.mark.type.image') }
      case 'link':
        return { icon: <Link className="w-5 h-5" />, label: t('record.mark.type.link') }
      case 'file':
        return { icon: <FileText className="w-5 h-5" />, label: t('record.mark.type.file') }
      case 'write':
        return { icon: <SquarePen className="w-5 h-5" />, label: t('navigation.write') }
      default:
        return { icon: null, label: '' }
    }
  }

  const toolInfo = getToolInfo(toolId)

  const handleClick = () => {
    if (onToolClick) {
      onToolClick(toolId)
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
      className="flex h-auto min-h-16 min-w-14 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 hover:bg-accent"
      aria-label={toolInfo.label}
      title={toolInfo.label}
    >
      <div className="text-primary">
        {toolInfo.icon}
      </div>
      <span className="text-[11px] leading-none text-muted-foreground">{toolInfo.label}</span>
    </Button>
  )
}
