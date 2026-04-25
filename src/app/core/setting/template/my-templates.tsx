'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSettingStore, { GenTemplate, GenTemplateRange, TemplateCategory } from '@/stores/setting'
import { getTemplateRangeLabel, getTemplateRangeOptions } from '@/lib/template-range-utils'
import { getCategoryLabel, getCategoryOptions, getCategoryColor } from '@/lib/template-category-utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash, Pencil } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'

// 表单区域（分类 Select + 范围 Select + 状态 Switch + 内容 Textarea）
function TemplateFormFields({
  templateTitle, setTemplateTitle,
  templateContent, setTemplateContent,
  templateRange, setTemplateRange,
  templateCategory, setTemplateCategory,
  templateStatus, setTemplateStatus,
  disableStatus,
  t,
}: {
  templateTitle: string; setTemplateTitle: (v: string) => void
  templateContent: string; setTemplateContent: (v: string) => void
  templateRange: GenTemplateRange; setTemplateRange: (v: GenTemplateRange) => void
  templateCategory: TemplateCategory | undefined; setTemplateCategory: (v: TemplateCategory | undefined) => void
  templateStatus: boolean; setTemplateStatus: (v: boolean) => void
  disableStatus?: boolean
  t: (key: string) => string
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>{t('settings.template.name')}</Label>
        <Input
          value={templateTitle}
          onChange={(e) => setTemplateTitle(e.target.value)}
          placeholder={t('settings.template.name')}
        />
      </div>
      <div className="grid gap-2">
        <div className="flex justify-between">
          <Label>{t('settings.template.selectCategory')}</Label>
          <div className="flex items-center gap-2">
            <Label>{t('settings.template.status')}</Label>
            <Switch
              checked={templateStatus}
              onCheckedChange={setTemplateStatus}
              disabled={disableStatus}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Select
            value={templateCategory || ''}
            onValueChange={(v) => setTemplateCategory(v as TemplateCategory || undefined)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={t('settings.template.selectCategory')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {getCategoryOptions(t).map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={templateRange}
            onValueChange={(v: GenTemplateRange) => setTemplateRange(v)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={t('settings.template.selectScope')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {getTemplateRangeOptions(t).map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>{t('settings.template.content')}</Label>
        <Textarea
          rows={5}
          value={templateContent}
          onChange={(e) => setTemplateContent(e.target.value)}
          placeholder={t('settings.template.content')}
        />
      </div>
    </div>
  )
}

export function MyTemplates() {
  const t = useTranslations()
  const { templateList, setTemplateList } = useSettingStore()
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [currentTemplate, setCurrentTemplate] = useState<GenTemplate | null>(null)

  // Form states
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateContent, setTemplateContent] = useState('')
  const [templateRange, setTemplateRange] = useState<GenTemplateRange>(GenTemplateRange.All)
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory | undefined>(undefined)
  const [templateStatus, setTemplateStatus] = useState(true)

  function createTemplateHandler() {
    const newTemplate: GenTemplate = {
      id: `${Date.now()}`,
      status: templateStatus,
      title: templateTitle || t('settings.template.customTemplate'),
      content: templateContent,
      range: templateRange,
      category: templateCategory,
    }
    setTemplateList([...templateList, newTemplate])
    resetForm()
    setDialogOpen(false)
  }

  function updateTemplateHandler() {
    if (!currentTemplate) return
    setTemplateList(templateList.map(item => {
      if (item.id === currentTemplate.id) {
        return {
          ...item,
          title: templateTitle,
          content: templateContent,
          range: templateRange,
          category: templateCategory,
          status: templateStatus,
        }
      }
      return item
    }))
    setEditDialogOpen(false)
    resetForm()
  }

  function deleteTemplateHandler(id: string) {
    confirm(t('settings.template.deleteConfirm')).then(async (res) => {
      if (res) {
        setTemplateList(templateList.filter(item => item.id !== id))
      }
    })
  }

  function openAddDialog() {
    resetForm()
    setDialogOpen(true)
  }

  function openEditDialog(template: GenTemplate) {
    setCurrentTemplate(template)
    setTemplateTitle(template.title)
    setTemplateContent(template.content)
    setTemplateRange(template.range)
    setTemplateCategory(template.category)
    setTemplateStatus(template.status)
    setEditDialogOpen(true)
  }

  function resetForm() {
    setTemplateTitle('')
    setTemplateContent('')
    setTemplateRange(GenTemplateRange.All)
    setTemplateCategory(undefined)
    setTemplateStatus(true)
    setCurrentTemplate(null)
  }

  useEffect(() => {}, [templateList])

  const formProps = {
    templateTitle, setTemplateTitle,
    templateContent, setTemplateContent,
    templateRange, setTemplateRange,
    templateCategory, setTemplateCategory,
    templateStatus, setTemplateStatus,
    t,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        {isMobile ? (
          <Drawer open={dialogOpen} onOpenChange={setDialogOpen}>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm" onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-2" />
                {t('settings.template.addTemplate')}
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{t('settings.template.addTemplate')}</DrawerTitle>
                <DrawerDescription>{t('settings.template.addTemplateDesc') || t('settings.template.customTemplate')}</DrawerDescription>
              </DrawerHeader>
              <div className="px-4">
                <TemplateFormFields {...formProps} />
              </div>
              <DrawerFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={createTemplateHandler}>{t('common.confirm')}</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-2" />
                {t('settings.template.addTemplate')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('settings.template.addTemplate')}</DialogTitle>
                <DialogDescription>{t('settings.template.addTemplateDesc') || t('settings.template.customTemplate')}</DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <TemplateFormFields {...formProps} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={createTemplateHandler}>{t('common.confirm')}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Edit Dialog/Drawer */}
      {isMobile ? (
        <Drawer open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('settings.template.editTemplate')}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4">
              <TemplateFormFields {...formProps} disableStatus={currentTemplate?.id === '0'} />
            </div>
            <DrawerFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={updateTemplateHandler}>{t('common.confirm')}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings.template.editTemplate')}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <TemplateFormFields {...formProps} disableStatus={currentTemplate?.id === '0'} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={updateTemplateHandler}>{t('common.confirm')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Template list */}
      <div className="grid gap-4">
        {templateList.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div className={`${!item.status ? 'opacity-50' : ''}`}>
                    <h3 className="font-medium">{item.title}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(item)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteTemplateHandler(item.id)}
                      disabled={item.id === '0'}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.category && (
                    <Badge className={`text-[10px] px-1.5 py-0 ${getCategoryColor(item.category)}`}>
                      {getCategoryLabel(item.category, t)}
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {t('settings.template.scope')}: <span className="font-medium">{getTemplateRangeLabel(item.range, t)}</span>
                  </span>
                </div>
                <p className={`text-sm whitespace-pre-wrap mt-2 line-clamp-3 ${!item.status ? 'opacity-50' : ''}`}>
                  {item.content || t('settings.template.noContent')}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
