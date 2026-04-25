import { TemplateCategory } from '@/stores/setting'

export function getCategoryLabel(category: TemplateCategory, t: (key: string) => string): string {
  const keyMap: Record<TemplateCategory, string> = {
    [TemplateCategory.Note]: 'settings.template.category.note',
    [TemplateCategory.Work]: 'settings.template.category.work',
    [TemplateCategory.Study]: 'settings.template.category.study',
    [TemplateCategory.Life]: 'settings.template.category.life',
    [TemplateCategory.Creative]: 'settings.template.category.creative',
  }
  return t(keyMap[category])
}

export function getCategoryOptions(t: (key: string) => string) {
  return Object.values(TemplateCategory).map(value => ({
    value,
    label: getCategoryLabel(value, t)
  }))
}

export function getCategoryColor(category: TemplateCategory): string {
  const colorMap: Record<TemplateCategory, string> = {
    [TemplateCategory.Note]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    [TemplateCategory.Work]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    [TemplateCategory.Study]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    [TemplateCategory.Life]: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
    [TemplateCategory.Creative]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  }
  return colorMap[category] || 'bg-secondary text-secondary-foreground'
}
