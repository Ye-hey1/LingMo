"use client"

import { useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTranslations } from 'next-intl'
import { TemplateCategory } from '@/stores/setting'
import { PRESET_TEMPLATES, type PresetTemplate } from '@/lib/preset-templates'
import { getCategoryLabel, getCategoryColor } from '@/lib/template-category-utils'
import { FileText, Plus } from 'lucide-react'

export interface TemplateSelectResult {
  template: PresetTemplate | null
}

export interface TemplateSelectDialogRef {
  open: () => void
}

interface TemplateSelectDialogProps {
  onSelect: (result: TemplateSelectResult) => void
}

export const TemplateSelectDialog = forwardRef<TemplateSelectDialogRef, TemplateSelectDialogProps>(
  ({ onSelect }, ref) => {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all')
    const t = useTranslations('settings.template')

    useImperativeHandle(ref, () => ({
      open: () => {
        setSearch('')
        setActiveCategory('all')
        setOpen(true)
      }
    }))

    const filteredTemplates = useMemo(() => {
      let result = PRESET_TEMPLATES
      if (activeCategory !== 'all') {
        result = result.filter(t => t.category === activeCategory)
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        result = result.filter(t =>
          t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
        )
      }
      return result
    }, [activeCategory, search])

    const categories = useMemo(() => {
      return Object.values(TemplateCategory)
    }, [])

    function handleSelectBlank() {
      setOpen(false)
      onSelect({ template: null })
    }

    function handleSelectTemplate(template: PresetTemplate) {
      setOpen(false)
      onSelect({ template })
    }

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('selectTemplate')}</DialogTitle>
            <DialogDescription>{t('selectTemplateDesc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Search */}
            <Input
              placeholder={t('searchPresets')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-sm"
            />

            {/* Category badges */}
            <div className="flex flex-wrap gap-1.5">
              <Badge
                variant={activeCategory === 'all' ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => setActiveCategory('all')}
              >
                {t('allCategories')}
              </Badge>
              {categories.map(cat => (
                <Badge
                  key={cat}
                  variant={activeCategory === cat ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => setActiveCategory(cat)}
                >
                  {getCategoryLabel(cat, t)}
                </Badge>
              ))}
            </div>

            {/* Template grid */}
            <ScrollArea className="h-[320px]">
              <div className="space-y-2 pr-3">
                {/* Blank template card */}
                <button
                  onClick={handleSelectBlank}
                  className="w-full text-left rounded-lg border p-3 hover:bg-accent hover:border-primary/50 transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5 text-muted-foreground group-hover:text-primary">
                      <Plus className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{t('blankForNew')}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t('blankTemplateDesc')}</div>
                    </div>
                  </div>
                </button>

                {/* Preset template cards */}
                {filteredTemplates.map(template => (
                  <button
                    key={template.title}
                    onClick={() => handleSelectTemplate(template)}
                    className="w-full text-left rounded-lg border p-3 hover:bg-accent hover:border-primary/50 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5 text-muted-foreground group-hover:text-primary">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{template.title}</span>
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColor(template.category)}`}>
                            {getCategoryLabel(template.category, t)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{template.description}</div>
                        <div className="mt-2 rounded bg-muted/50 p-2 text-[11px] text-muted-foreground line-clamp-3 font-mono whitespace-pre-wrap">
                          {template.content.split('\n').slice(0, 5).join('\n')}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}

                {filteredTemplates.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    {t('noPresetsFound')}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
)

TemplateSelectDialog.displayName = 'TemplateSelectDialog'
