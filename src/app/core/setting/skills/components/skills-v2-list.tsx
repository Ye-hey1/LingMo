'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Sparkles, Trash2, Database } from 'lucide-react'
import { useSkillsV2Store } from '@/stores/skills-v2'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function SkillsV2List() {
  const t = useTranslations('settings.skills')
  const { skills, fetchSkills, deleteSkill, setEnabled, loading } = useSkillsV2Store()

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Database className="size-5 animate-pulse text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {skills.map(skill => (
        <Card key={skill.id} className="py-2">
          <CardContent className="py-2 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Sparkles className="size-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{skill.name}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{skill.source_type}</Badge>
                    {skill.update_status === 'available' && (
                      <Badge variant="default" className="text-xs">{t('updateAvailable')}</Badge>
                    )}
                  </div>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={(checked) => setEnabled(skill.id, checked)}
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('deleteSkillTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('deleteSkillDesc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteSkill(skill.id)}>{t('delete')}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {skills.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Sparkles className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p>{t('noSkillsV2')}</p>
          <p className="text-sm">{t('noSkillsV2Desc')}</p>
        </div>
      )}
    </div>
  )
}
