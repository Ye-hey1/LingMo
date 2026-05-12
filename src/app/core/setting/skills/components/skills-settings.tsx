'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { SkillScanner } from './skill-scanner'
import { ScenarioManager } from './scenario-manager'
import { SkillInstall } from './skill-install'
import { SkillMarket } from './skill-market'
import { SkillCardV2 } from './skill-card-v2'
import { useSkillsV2Store } from '@/stores/skills-v2'
import { useToast } from '@/hooks/use-toast'

export function SkillsSettings() {
  const t = useTranslations('settings.skills')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const { skills, fetchSkills, deleteSkill, setEnabled, loading, deletingSkillId } = useSkillsV2Store()
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const enabledCount = skills.filter(s => s.enabled).length
  const filtered = search
    ? skills.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(search.toLowerCase()))
      )
    : skills

  const sourceLabel = (type: string) => {
    const map: Record<string, string> = {
      local: t('sourceLocal'),
      git: t('sourceGit'),
      archive: t('sourceArchive'),
      discovered: t('sourceDiscovered'),
    }
    return map[type] || type
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id)
      toast({ title: t('skillDeleted') })
    } catch (error) {
      toast({
        title: tc('error'),
        description: String(error),
        variant: 'destructive',
      })
    }
  }

  return (
    <Tabs defaultValue="market" className="w-full">
      <div className="flex items-center justify-between mb-4">
        <TabsList>
          <TabsTrigger value="market">{t('tabMarket')}</TabsTrigger>
          <TabsTrigger value="all">
            {t('tabAll')}
            {skills.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                {skills.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="scan">{t('tabScan')}</TabsTrigger>
          <TabsTrigger value="install">{t('tabInstall')}</TabsTrigger>
          <TabsTrigger value="scenarios">{t('tabScenarios')}</TabsTrigger>
        </TabsList>
        {skills.length > 0 && (
          <Badge variant="outline" className="text-xs">
            {t('enabledCount', { count: enabledCount })}
          </Badge>
        )}
      </div>

      <TabsContent value="market">
        <SkillMarket />
      </TabsContent>

      <TabsContent value="all">
        <div className="space-y-4">
          {skills.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-9"
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filtered.map(skill => (
              <SkillCardV2
                key={skill.id}
                skill={skill}
                onToggle={setEnabled}
                onDelete={handleDelete}
                sourceLabel={sourceLabel(skill.source_type)}
                deleteTitle={t('deleteSkillTitle')}
                deleteDesc={t('deleteSkillDesc')}
                cancelLabel={t('cancel')}
                deleteLabel={t('delete')}
                updateLabel={t('updateAvailable')}
                deleting={deletingSkillId === skill.id}
              />
            ))}
          </div>
          {skills.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>{t('noSkillsV2')}</p>
              <p className="text-sm">{t('noSkillsV2Desc')}</p>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="scan">
        <SkillScanner />
      </TabsContent>

      <TabsContent value="install">
        <SkillInstall />
      </TabsContent>

      <TabsContent value="scenarios">
        <ScenarioManager />
      </TabsContent>
    </Tabs>
  )
}
