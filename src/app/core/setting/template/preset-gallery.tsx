'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import useSettingStore, { GenTemplate, TemplateCategory } from '@/stores/setting'
import { PRESET_TEMPLATES, PresetTemplate } from '@/lib/preset-templates'
import { getTemplateRangeLabel } from '@/lib/template-range-utils'
import { getCategoryLabel, getCategoryColor } from '@/lib/template-category-utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Search, Plus, Eye } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { useToast } from '@/hooks/use-toast'

export function PresetGallery() {
  const t = useTranslations()
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const { templateList, setTemplateList } = useSettingStore()
  const { toast } = useToast()

  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [previewPreset, setPreviewPreset] = useState<PresetTemplate | null>(null)

  const filteredPresets = useMemo(() => {
    return PRESET_TEMPLATES.filter(preset => {
      const matchCategory = activeCategory === 'all' || preset.category === activeCategory
      const matchSearch = !searchQuery ||
        preset.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        preset.description.toLowerCase().includes(searchQuery.toLowerCase())
      return matchCategory && matchSearch
    })
  }, [activeCategory, searchQuery])

  function isPresetAdded(preset: PresetTemplate): boolean {
    return templateList.some(t => t.title === preset.title)
  }

  function handleUsePreset(preset: PresetTemplate) {
    if (isPresetAdded(preset)) {
      toast({ description: t('settings.template.templateAlreadyAdded') })
      return
    }
    const newTemplate: GenTemplate = {
      id: `${Date.now()}`,
      title: preset.title,
      content: preset.content,
      range: preset.range,
      status: true,
      category: preset.category,
    }
    setTemplateList([...templateList, newTemplate])
    toast({ description: t('settings.template.templateAdded') })
  }

  const categories: { value: TemplateCategory | 'all'; label: string }[] = [
    { value: 'all', label: t('settings.template.allCategories') },
    ...Object.values(TemplateCategory).map(value => ({
      value,
      label: getCategoryLabel(value, t),
    })),
  ]

  const previewContent = (
    <div className="grid gap-4">
      {previewPreset && (
        <>
          <div className="flex items-center gap-2">
            <Badge className={getCategoryColor(previewPreset.category)}>
              {getCategoryLabel(previewPreset.category, t)}
            </Badge>
            <Badge variant="outline">
              {getTemplateRangeLabel(previewPreset.range, t)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{previewPreset.description}</p>
          <Textarea
            readOnly
            rows={10}
            value={previewPreset.content}
            className="font-mono text-sm"
          />
        </>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('settings.template.searchPresets')}
          className="pl-9"
        />
      </div>

      {/* 分类过滤 */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <Badge
            key={cat.value}
            variant={activeCategory === cat.value ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setActiveCategory(cat.value)}
          >
            {cat.label}
          </Badge>
        ))}
      </div>

      {/* 预设卡片网格 */}
      {filteredPresets.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          {t('settings.template.noPresetsFound')}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredPresets.map((preset, index) => (
            <Card key={index}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium">{preset.title}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setPreviewPreset(preset)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant={isPresetAdded(preset) ? 'ghost' : 'outline'}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleUsePreset(preset)}
                        disabled={isPresetAdded(preset)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] px-1.5 py-0 ${getCategoryColor(preset.category)}`}>
                      {getCategoryLabel(preset.category, t)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {getTemplateRangeLabel(preset.range, t)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {preset.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 预览弹窗 */}
      {isMobile ? (
        <Drawer open={!!previewPreset} onOpenChange={(open) => !open && setPreviewPreset(null)}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{previewPreset?.title}</DrawerTitle>
              <DrawerDescription>{previewPreset?.description}</DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              {previewContent}
            </div>
            <DrawerFooter>
              <Button variant="outline" onClick={() => setPreviewPreset(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => {
                  if (previewPreset) handleUsePreset(previewPreset)
                  setPreviewPreset(null)
                }}
                disabled={previewPreset ? isPresetAdded(previewPreset) : false}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('settings.template.useTemplate')}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={!!previewPreset} onOpenChange={(open) => !open && setPreviewPreset(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{previewPreset?.title}</DialogTitle>
              <DialogDescription>{previewPreset?.description}</DialogDescription>
            </DialogHeader>
            {previewContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewPreset(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => {
                  if (previewPreset) handleUsePreset(previewPreset)
                  setPreviewPreset(null)
                }}
                disabled={previewPreset ? isPresetAdded(previewPreset) : false}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('settings.template.useTemplate')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
